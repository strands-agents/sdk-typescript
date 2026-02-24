use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::{format_ident, quote};
use syn::{
    Attribute, Data, DeriveInput, Field, Fields, GenericArgument, Ident, PathArguments, Type,
    parse_macro_input,
};

/// Derive macro that auto-generates FFI wrapper types from `wasmtime::component::bindgen!` output.
///
/// For each WIT enum, record, or variant it generates a PyO3/UniFFI-compatible
/// struct (suffixed with `_`) and a `From<WitType>` impl for zero-boilerplate conversion.
#[proc_macro_derive(Export, attributes(component))]
pub fn export_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match export_derive_inner(&input) {
        Ok(ts) => ts.into(),
        Err(e) => e.to_compile_error().into(),
    }
}

fn export_derive_inner(input: &DeriveInput) -> syn::Result<TokenStream2> {
    let kind = match get_meta(&input.attrs, &["enum", "record", "variant"])? {
        Some(k) => k,
        None => return Ok(TokenStream2::new()),
    };

    let wrapper = match kind.as_str() {
        "enum" => gen_wrapper_enum(input)?,
        "record" => gen_wrapper_record(input)?,
        "variant" => gen_wrapper_variant(input)?,
        _ => TokenStream2::new(),
    };

    // Generate `from_py_dict` extraction impls for records (Python dict → WIT type).
    let extract = match kind.as_str() {
        "record" => gen_extract_record(input)?,
        _ => TokenStream2::new(),
    };

    Ok(quote! { #wrapper #extract })
}

/// Generates a PyO3/UniFFI wrapper for a WIT enum.
/// Maps variants to a simple struct containing a string value.
fn gen_wrapper_enum(input: &DeriveInput) -> syn::Result<TokenStream2> {
    let (name, wrapper, attrs) = wrapper_header(input);
    let Data::Enum(data) = &input.data else {
        return Ok(TokenStream2::new());
    };

    let arms = data
        .variants
        .iter()
        .map(|v| {
            let ident = &v.ident;
            let wit = get_name(&v.attrs)?.unwrap_or_else(|| ident.to_string().to_lowercase());
            Ok(quote!(#name::#ident => #wit))
        })
        .collect::<syn::Result<Vec<_>>>()?;

    Ok(quote! {
        #attrs
        #[derive(Clone)]
        pub struct #wrapper { pub value: String }

        #[cfg(any(feature = "pyo3", feature = "uniffi"))]
        impl From<#name> for #wrapper {
            fn from(v: #name) -> Self {
                Self { value: match v { #(#arms,)* }.to_string() }
            }
        }
    })
}

/// Generates a PyO3/UniFFI wrapper for a WIT record.
fn gen_wrapper_record(input: &DeriveInput) -> syn::Result<TokenStream2> {
    let (name, wrapper, attrs) = wrapper_header(input);
    let Data::Struct(data) = &input.data else {
        return Ok(TokenStream2::new());
    };
    let Fields::Named(fields) = &data.fields else {
        return Ok(TokenStream2::new());
    };

    let defs = fields
        .named
        .iter()
        .map(|f| {
            let id = field_ident(f)?;
            let ty = map_type(&f.ty);
            Ok(quote!(pub #id: #ty))
        })
        .collect::<syn::Result<Vec<_>>>()?;

    let convs = fields
        .named
        .iter()
        .map(|f| {
            let id = field_ident(f)?;
            let val = map_convert(quote!(v.#id), &f.ty);
            Ok(quote!(#id: #val))
        })
        .collect::<syn::Result<Vec<_>>>()?;

    Ok(quote! {
        #attrs
        #[derive(Clone)]
        pub struct #wrapper { #(#defs,)* }

        #[cfg(any(feature = "pyo3", feature = "uniffi"))]
        impl From<#name> for #wrapper {
            fn from(v: #name) -> Self { Self { #(#convs,)* } }
        }
    })
}

/// Generates a PyO3/UniFFI wrapper for a WIT variant.
/// Flattens the variant into a struct with a `kind` discriminator and optional payload fields.
fn gen_wrapper_variant(input: &DeriveInput) -> syn::Result<TokenStream2> {
    let (name, wrapper, attrs) = wrapper_header(input);
    let Data::Enum(data) = &input.data else {
        return Ok(TokenStream2::new());
    };

    let fields = data
        .variants
        .iter()
        .map(|v| match &v.fields {
            Fields::Unnamed(f) => {
                let id = variant_field_name(&v.ident, &v.attrs)?;
                let ty = map_type(&f.unnamed[0].ty);
                Ok(Some(quote!(pub #id: Option<#ty>)))
            }
            _ => Ok(None),
        })
        .collect::<syn::Result<Vec<_>>>()?
        .into_iter()
        .flatten();

    let arms = data
        .variants
        .iter()
        .map(|v| {
            let id = &v.ident;
            let wit = get_name(&v.attrs)?.unwrap_or_else(|| id.to_string().to_lowercase());
            let field = variant_field_name(id, &v.attrs)?;
            Ok(match &v.fields {
                Fields::Unnamed(f) => {
                    let conv = map_convert(quote!(x), &f.unnamed[0].ty);
                    quote! {
                        #name::#id(x) => #wrapper {
                            kind: #wit.to_string(),
                            #field: Some(#conv),
                            ..Default::default()
                        }
                    }
                }
                _ => quote! {
                    #name::#id => #wrapper { kind: #wit.to_string(), ..Default::default() }
                },
            })
        })
        .collect::<syn::Result<Vec<_>>>()?;

    Ok(quote! {
        #attrs
        #[derive(Clone, Default)]
        pub struct #wrapper { pub kind: String, #(#fields,)* }

        #[cfg(any(feature = "pyo3", feature = "uniffi"))]
        impl From<#name> for #wrapper {
            fn from(v: #name) -> Self { match v { #(#arms,)* } }
        }
    })
}

/// Generate `Type::from_py_dict(&PyAny) -> PyResult<Self>` for WIT records.
///
/// `Option<T>` fields yield `None` when the key is missing, but raise a
/// `TypeError` if the key exists with an incompatible type. Required fields
/// raise `TypeError` on missing or wrong-type values.
///
/// Only emits for records whose fields are all PyO3-extractable primitives
/// (after unwrapping Option). Skips records with enum, record, or Vec inner
/// types since those don't implement `FromPyObject`.
fn gen_extract_record(input: &DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let name_str = name.to_string();
    let Data::Struct(data) = &input.data else {
        return Ok(TokenStream2::new());
    };
    let Fields::Named(fields) = &data.fields else {
        return Ok(TokenStream2::new());
    };

    for f in &fields.named {
        let leaf = unpack(&f.ty, "Option").unwrap_or(&f.ty);
        if !is_primitive(leaf) {
            return Ok(TokenStream2::new());
        }
    }

    let extractions = fields
        .named
        .iter()
        .map(|f| {
            let id = field_ident(f)?;
            let key = id.to_string();
            let ty_name = primitive_display_name(&f.ty);
            if let Some(inner) = unpack(&f.ty, "Option") {
                let inner_name = primitive_display_name(inner);
                // Missing key → None. Present but wrong type → TypeError.
                Ok(quote! {
                    #id: match pyo3::types::PyAnyMethods::get_item(obj, #key) {
                        Ok(v) => Some(pyo3::types::PyAnyMethods::extract::<#inner>(&v)
                            .map_err(|_| pyo3::exceptions::PyTypeError::new_err(
                                format!("{}.{}: expected {}", #name_str, #key, #inner_name)
                            ))?),
                        Err(_) => None,
                    }
                })
            } else {
                let ty = &f.ty;
                // Missing or wrong type → TypeError.
                Ok(quote! {
                    #id: pyo3::types::PyAnyMethods::get_item(obj, #key)
                        .and_then(|v| pyo3::types::PyAnyMethods::extract::<#ty>(&v))
                        .map_err(|_| pyo3::exceptions::PyTypeError::new_err(
                            format!("{}.{}: expected {}", #name_str, #key, #ty_name)
                        ))?
                })
            }
        })
        .collect::<syn::Result<Vec<_>>>()?;

    Ok(quote! {
        #[cfg(feature = "pyo3")]
        impl #name {
            pub fn from_py_dict(obj: &pyo3::Bound<'_, pyo3::PyAny>) -> pyo3::PyResult<Self> {
                Ok(Self { #(#extractions,)* })
            }
        }
    })
}

fn wrapper_header(input: &DeriveInput) -> (Ident, Ident, TokenStream2) {
    let name = input.ident.clone();
    let wrapper = format_ident!("{}_", name);
    let name_str = name.to_string();
    let attrs = quote! {
        #[doc = "@generated by strands-derive"]
        #[cfg_attr(feature = "pyo3", pyo3::pyclass(frozen, get_all, name = #name_str, skip_from_py_object))]
        #[cfg_attr(all(feature = "uniffi", not(feature = "pyo3")), derive(uniffi::Record))]
    };
    (name, wrapper, attrs)
}

fn field_ident(f: &Field) -> syn::Result<&Ident> {
    f.ident
        .as_ref()
        .ok_or_else(|| syn::Error::new_spanned(f, "expected named field"))
}

/// Recursively maps WIT types to their `_`-suffixed wrapper counterparts.
fn map_type(ty: &Type) -> TokenStream2 {
    if let Some(inner) = unpack(ty, "Option") {
        let t = map_type(inner);
        quote!(Option<#t>)
    } else if let Some(inner) = unpack(ty, "Vec") {
        let t = map_type(inner);
        quote!(Vec<#t>)
    } else if is_primitive(ty) {
        quote!(#ty)
    } else if let Some(id) = get_ident(ty) {
        let w = format_ident!("{}_", id);
        quote!(#w)
    } else {
        quote!(#ty)
    }
}

fn map_convert(val: TokenStream2, ty: &Type) -> TokenStream2 {
    if let Some(inner) = unpack(ty, "Option") {
        let c = map_convert(quote!(i), inner);
        quote!(#val.map(|i| #c))
    } else if let Some(inner) = unpack(ty, "Vec") {
        let c = map_convert(quote!(i), inner);
        quote!(#val.into_iter().map(|i| #c).collect())
    } else if is_primitive(ty) {
        val
    } else {
        quote!(#val.into())
    }
}

fn variant_field_name(ident: &Ident, attrs: &[Attribute]) -> syn::Result<Ident> {
    let wit = get_name(attrs)?.unwrap_or_else(|| ident.to_string().to_lowercase());
    Ok(format_ident!("{}", wit.replace('-', "_")))
}

fn get_meta(attrs: &[Attribute], keys: &[&str]) -> syn::Result<Option<String>> {
    let Some(attr) = attrs.iter().find(|a| a.path().is_ident("component")) else {
        return Ok(None);
    };
    let mut found = None;
    attr.parse_nested_meta(|m| {
        if keys.iter().any(|k| m.path.is_ident(k)) {
            found = Some(
                m.path
                    .get_ident()
                    .ok_or_else(|| syn::Error::new_spanned(&m.path, "expected identifier"))?
                    .to_string(),
            );
        }
        Ok(())
    })?;
    Ok(found)
}

fn get_name(attrs: &[Attribute]) -> syn::Result<Option<String>> {
    let Some(attr) = attrs.iter().find(|a| a.path().is_ident("component")) else {
        return Ok(None);
    };
    let mut found = None;
    attr.parse_nested_meta(|m| {
        if m.path.is_ident("name") {
            let s = m.value()?.parse::<syn::LitStr>()?;
            found = Some(s.value());
        }
        Ok(())
    })?;
    Ok(found)
}

fn unpack<'a>(ty: &'a Type, container: &str) -> Option<&'a Type> {
    if let Type::Path(p) = ty
        && let Some(s) = p.path.segments.last()
        && s.ident == container
        && let PathArguments::AngleBracketed(args) = &s.arguments
        && let Some(GenericArgument::Type(t)) = args.args.first()
    {
        return Some(t);
    }

    None
}

fn get_ident(ty: &Type) -> Option<&Ident> {
    if let Type::Path(p) = ty {
        p.path.segments.last().map(|s| &s.ident)
    } else {
        None
    }
}

/// Human-readable type name for error messages (e.g. "String" not "wasmtime::...::String").
fn primitive_display_name(ty: &Type) -> String {
    let leaf = unpack(ty, "Option").unwrap_or(ty);
    get_ident(leaf).map_or("unknown".into(), |id| id.to_string())
}

fn is_primitive(ty: &Type) -> bool {
    get_ident(ty).is_some_and(|id| {
        matches!(
            id.to_string().as_str(),
            "String"
                | "bool"
                | "char"
                | "u8"
                | "u16"
                | "u32"
                | "u64"
                | "i8"
                | "i16"
                | "i32"
                | "i64"
                | "f32"
                | "f64"
        )
    })
}
