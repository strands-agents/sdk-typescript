use anyhow::{Context, Result, bail};
use clap::Parser;
use cliclack::{intro, outro, spinner};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use wasm_encoder::{CustomSection, Encode};

/// Supported project types for compilation
#[derive(Debug, Clone, Copy)]
enum ProjectType {
    Rust,
    Python,
    TypeScript,
}

/// Build a Filament module and embed its manifest
#[derive(Parser)]
pub struct BuildCommand {
    /// Path to the module directory (defaults to current directory)
    #[arg(long, short)]
    path: Option<PathBuf>,

    /// Output path for the WASM file
    #[arg(long, short)]
    output: Option<PathBuf>,

    /// Build in release mode
    #[arg(long, default_value = "true")]
    release: bool,
}

impl BuildCommand {
    pub fn invoke(&self) -> Result<()> {
        intro("Filament Module Builder")?;

        let module_dir = self.path.clone().unwrap_or_else(|| PathBuf::from("."));
        let manifest_path = module_dir.join("filament.toml");

        if !manifest_path.exists() {
            bail!(
                "Missing filament.toml in `{}`. Is this a module directory?",
                module_dir.display()
            );
        }

        let manifest_content =
            fs::read_to_string(&manifest_path).context("Failed to read filament.toml")?;

        // Validate the manifest can be parsed into the expected structure
        let _manifest: filament::module::ModuleManifest =
            toml::from_str(&manifest_content).context("Invalid manifest structure in filament.toml. Expected [metadata] section with name and version fields.")?;

        let project_type = detect_project_type(&module_dir)?;

        let s = spinner();
        s.start("Compiling WebAssembly module...");

        let artifact_path = match project_type {
            ProjectType::Rust => build_rust(&module_dir, self.release)?,
            ProjectType::Python => build_python(&module_dir)?,
            ProjectType::TypeScript => build_typescript(&module_dir)?,
        };

        if !artifact_path.exists() {
            s.stop("Build failed");
            bail!("Build artifact not found at: {}", artifact_path.display());
        }

        s.stop("Compilation complete");
        s.start("Embedding module manifest...");

        let final_output = self.output.clone().unwrap_or_else(|| artifact_path.clone());

        embed_manifest(&artifact_path, &final_output, &manifest_content)?;

        s.stop("Manifest embedded");

        outro(format!(
            "Build successful!\n   Artifact: {}",
            final_output.display()
        ))?;

        Ok(())
    }
}

fn detect_project_type(path: &Path) -> Result<ProjectType> {
    if path.join("Cargo.toml").exists() {
        return Ok(ProjectType::Rust);
    }
    if path.join("pyproject.toml").exists() {
        return Ok(ProjectType::Python);
    }
    if path.join("package.json").exists() {
        return Ok(ProjectType::TypeScript);
    }
    bail!("Could not detect project type. Missing Cargo.toml, pyproject.toml, or package.json");
}

fn build_rust(dir: &Path, release: bool) -> Result<PathBuf> {
    let cargo_toml = dir.join("Cargo.toml");
    let cargo_content = fs::read_to_string(&cargo_toml)?;
    let cargo: toml::Value = toml::from_str(&cargo_content)?;

    let package_name = cargo
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(|n| n.as_str())
        .context("Could not determine package name from Cargo.toml")?;

    let mut cmd = Command::new("cargo");
    cmd.arg("build")
        .arg("--target")
        .arg("wasm32-wasip2")
        .current_dir(dir);

    if release {
        cmd.arg("--release");
    }

    let output = cmd.output().context("Failed to execute cargo")?;
    if !output.status.success() {
        bail!(
            "Cargo build failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let build_type = if release { "release" } else { "debug" };
    // Cargo replaces hyphens with underscores in output filenames
    let wasm_filename = package_name.replace('-', "_");
    Ok(dir
        .join("target/wasm32-wasip2")
        .join(build_type)
        .join(format!("{}.wasm", wasm_filename)))
}

fn build_python(dir: &Path) -> Result<PathBuf> {
    let mut cmd = Command::new("componentize-py");
    cmd.arg("componentize")
        .arg("app")
        .arg("-o")
        .arg("module.wasm")
        .current_dir(dir);

    let output = cmd
        .output()
        .context("Failed to execute componentize-py. Is it installed?")?;

    if !output.status.success() {
        bail!(
            "Python build failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(dir.join("module.wasm"))
}

fn build_typescript(dir: &Path) -> Result<PathBuf> {
    // Install dependencies
    let mut install = Command::new("npm");
    install.arg("install").current_dir(dir);

    let output = install.output().context("Failed to execute npm install")?;
    if !output.status.success() {
        bail!(
            "npm install failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    // Check if compile script exists and run it (for TypeScript projects)
    let package_json_path = dir.join("package.json");
    if package_json_path.exists() {
        let package_json = fs::read_to_string(&package_json_path)?;
        if package_json.contains("\"compile\"") {
            let mut compile = Command::new("npm");
            compile.arg("run").arg("compile").current_dir(dir);

            let output = compile
                .output()
                .context("Failed to execute npm run compile")?;
            if !output.status.success() {
                bail!(
                    "TypeScript compilation failed:\n{}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
    }

    // Create dist directory for output
    let dist_dir = dir.join("dist");
    fs::create_dir_all(&dist_dir)?;

    // Determine entry point (dist/index.js for TS, or index.js for plain JS)
    let entry_point = if dist_dir.join("index.js").exists() {
        dist_dir.join("index.js")
    } else if dir.join("index.js").exists() {
        dir.join("index.js")
    } else {
        bail!("Could not find JavaScript entry point (dist/index.js or index.js)");
    };

    // Write bundled WIT to temp location in dist
    let wit_content = include_bytes!(concat!(env!("OUT_DIR"), "/filament.wit"));
    let wit_path = dist_dir.join("filament.wit");
    fs::write(&wit_path, wit_content)?;

    // Run jco componentize
    let output_wasm = dist_dir.join("module.wasm");
    let mut jco = Command::new("npx");
    jco.arg("jco")
        .arg("componentize")
        .arg(&entry_point)
        .arg("--wit")
        .arg(&wit_path)
        .arg("--world-name")
        .arg("module")
        .arg("--out")
        .arg(&output_wasm)
        .current_dir(dir);

    let output = jco.output().context("Failed to execute jco componentize")?;
    if !output.status.success() {
        bail!(
            "jco componentize failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(output_wasm)
}

/// Appends the manifest as a custom section to the end of the WASM file
fn embed_manifest(input: &Path, output: &Path, manifest: &str) -> Result<()> {
    use std::io::Write;

    // Copy input to output if they're different files
    if input != output {
        fs::copy(input, output).context("Failed to copy WASM artifact")?;
    }

    // Generate the custom section bytes
    let custom = CustomSection {
        name: Cow::Borrowed("filament/manifest"),
        data: Cow::Borrowed(manifest.as_bytes()),
    };

    let mut section_bytes = Vec::new();
    // Custom sections need a section ID of 0
    section_bytes.push(0x00);
    custom.encode(&mut section_bytes);

    // Append the section bytes to the file
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(output)
        .context("Failed to open WASM for appending")?;

    file.write_all(&section_bytes)
        .context("Failed to append manifest section")?;

    Ok(())
}
