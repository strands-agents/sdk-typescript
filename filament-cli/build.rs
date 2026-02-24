use anyhow::{Context, Result};
use flate2::Compression;
use flate2::write::GzEncoder;
use std::env;
use std::fs::{self, File};
use std::path::{Path, PathBuf};

fn main() -> Result<()> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR")?;
    let out_dir = env::var("OUT_DIR")?;
    let templates_dir = PathBuf::from(&manifest_dir).join("templates");

    println!("cargo:rerun-if-changed=templates");

    // Bundle the WIT file
    let wit_dir = PathBuf::from(&manifest_dir)
        .parent()
        .unwrap()
        .join("filament-wit");
    println!("cargo:rerun-if-changed=../filament-wit/filament.wit");

    let wit_path = wit_dir.join("filament.wit");
    if wit_path.exists() {
        let wit_bundle = PathBuf::from(&out_dir).join("filament.wit");
        fs::copy(&wit_path, &wit_bundle)?;
        println!("✓ WIT file bundled successfully");
    }

    // Discover all templates in the templates directory
    let templates = discover_templates(&templates_dir)?;

    if templates.is_empty() {
        println!("cargo:warning=No templates found in templates directory");
        return Ok(());
    }

    // Process each template
    for template_name in templates {
        let template_dir = templates_dir.join(&template_name);
        println!("Processing template: {}", template_name);

        // Validate template files
        validate_template(&template_dir, &template_name)?;

        // Create bundled tar.gz
        let bundle_path = PathBuf::from(&out_dir).join(format!("{}.tar.gz", template_name));
        bundle_template(&template_dir, &bundle_path)?;

        println!(
            "✓ Template '{}' validated and bundled successfully",
            template_name
        );
    }

    Ok(())
}

/// Discovers all template directories in the templates folder
fn discover_templates(templates_dir: &Path) -> Result<Vec<String>> {
    if !templates_dir.exists() {
        anyhow::bail!("Templates directory not found: {}", templates_dir.display());
    }

    let mut templates = Vec::new();

    for entry in fs::read_dir(templates_dir)? {
        let entry = entry?;
        let path = entry.path();

        // Only include directories (ignore files like .DS_Store)
        if path.is_dir()
            && let Some(name) = path.file_name().and_then(|n| n.to_str())
        {
            templates.push(name.to_string());
        }
    }

    templates.sort();
    Ok(templates)
}

fn validate_template(template_dir: &Path, template_name: &str) -> Result<()> {
    println!("Validating template '{}'...", template_name);

    // Check that filament.toml exists (required for all templates)
    let filament_toml = template_dir.join("filament.toml");
    if !filament_toml.exists() {
        anyhow::bail!("Template '{}' missing filament.toml", template_name);
    }

    // Validate filament.toml parses
    let content =
        fs::read_to_string(&filament_toml).context("Failed to read template filament.toml")?;
    toml::from_str::<toml::Value>(&content).context("Template filament.toml is not valid TOML")?;

    // Validate based on project type
    if template_dir.join("Cargo.toml").exists() {
        validate_rust_template(template_dir)?;
    } else if template_dir.join("package.json").exists() {
        validate_typescript_template(template_dir)?;
    } else if template_dir.join("pyproject.toml").exists() {
        validate_python_template(template_dir)?;
    } else {
        println!(
            "cargo:warning=Template '{}' has unknown project type",
            template_name
        );
    }

    println!("✓ Template '{}' validation passed", template_name);
    Ok(())
}

fn validate_rust_template(template_dir: &Path) -> Result<()> {
    let cargo_toml = template_dir.join("Cargo.toml");
    let lib_rs = template_dir.join("src/lib.rs");

    if !lib_rs.exists() {
        anyhow::bail!("Rust template missing src/lib.rs");
    }

    // Validate Cargo.toml parses
    let cargo_content = fs::read_to_string(&cargo_toml)?;
    toml::from_str::<toml::Value>(&cargo_content)
        .context("Template Cargo.toml is not valid TOML")?;

    // Validate lib.rs is valid UTF-8
    fs::read_to_string(&lib_rs).context("Template lib.rs is not valid UTF-8")?;

    Ok(())
}

fn validate_typescript_template(template_dir: &Path) -> Result<()> {
    let package_json = template_dir.join("package.json");

    // Validate package.json parses as JSON
    let content = fs::read_to_string(&package_json)?;
    serde_json::from_str::<serde_json::Value>(&content)
        .context("Template package.json is not valid JSON")?;

    Ok(())
}

fn validate_python_template(template_dir: &Path) -> Result<()> {
    let pyproject_toml = template_dir.join("pyproject.toml");

    // Validate pyproject.toml parses
    let content = fs::read_to_string(&pyproject_toml)?;
    toml::from_str::<toml::Value>(&content).context("Template pyproject.toml is not valid TOML")?;

    Ok(())
}

fn bundle_template(template_dir: &Path, output_path: &Path) -> Result<()> {
    let tar_gz = File::create(output_path).context("Failed to create bundle file")?;

    let enc = GzEncoder::new(tar_gz, Compression::best());
    let mut tar = tar::Builder::new(enc);

    // Add all files from template directory recursively
    tar.append_dir_all(".", template_dir)
        .context("Failed to add template files to bundle")?;

    tar.finish().context("Failed to finalize tar archive")?;

    println!("✓ Template bundled to: {}", output_path.display());

    Ok(())
}
