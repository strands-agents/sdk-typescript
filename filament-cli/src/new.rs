use anyhow::{Context, Result, bail};
use clap::Parser;
use cliclack::{confirm, input, intro, outro, outro_cancel, select, spinner};
use flate2::read::GzDecoder;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use tar::Archive;

/// Template identifier
#[derive(Debug, Clone, PartialEq, Eq)]
struct Template {
    name: &'static str,
    bundle: &'static [u8],
}

/// Available templates
const TEMPLATES: &[Template] = &[
    Template {
        name: "pingpong-rust",
        bundle: include_bytes!(concat!(env!("OUT_DIR"), "/pingpong-rust.tar.gz")),
    },
    Template {
        name: "pingpong-ts",
        bundle: include_bytes!(concat!(env!("OUT_DIR"), "/pingpong-ts.tar.gz")),
    },
];

impl Template {
    /// Returns the display label for the template
    fn label(&self) -> &str {
        self.name
    }

    /// Returns the bundle bytes
    fn bundle(&self) -> &'static [u8] {
        self.bundle
    }
}

/// Command to initialize a new Filament module
#[derive(Parser)]
pub struct NewCommand {
    /// Name of the project
    name: Option<String>,

    /// Destination directory (defaults to project name)
    #[arg(long)]
    path: Option<PathBuf>,

    /// Template name
    #[arg(long, short = 't')]
    template: Option<String>,
}

impl NewCommand {
    /// Executes the interactive wizard to generate a new module
    pub fn invoke(&self) -> Result<()> {
        intro("Create a new Filament module")?;

        let template = self.resolve_template()?;
        let name = self.resolve_name()?;
        let target_path = self.path.clone().unwrap_or_else(|| PathBuf::from(&name));

        if target_path.exists() {
            if !self.confirm_overwrite(&target_path)? {
                outro_cancel("Operation cancelled")?;
                return Ok(());
            }
            fs::remove_dir_all(&target_path)
                .with_context(|| format!("Failed to remove `{}`", target_path.display()))?;
        }

        let s = spinner();
        s.start("Generating project files...");

        match self.extract_template(&target_path, &name, template) {
            Ok(count) => {
                s.stop(format!("Created {} files", count));
                outro(format!("Created {}", name))?;
            }
            Err(e) => {
                s.stop("Failed to generate project");
                let _ = fs::remove_dir_all(&target_path);
                return Err(e);
            }
        }

        Ok(())
    }

    /// Determines the template based on CLI arguments or interactive prompt
    fn resolve_template(&self) -> Result<&'static Template> {
        if let Some(ref name) = self.template {
            if let Some(template) = TEMPLATES
                .iter()
                .find(|t| t.name == name && !t.bundle.is_empty())
            {
                return Ok(template);
            } else {
                outro_cancel(format!(
                    "Template '{}' not found. Available templates: {}",
                    name,
                    TEMPLATES
                        .iter()
                        .map(|t| t.name)
                        .collect::<Vec<_>>()
                        .join(", ")
                ))?;
                bail!("Template unavailable");
            }
        }

        let templates: Vec<_> = TEMPLATES.iter().filter(|t| !t.bundle.is_empty()).collect();
        if templates.is_empty() {
            outro_cancel("No templates available")?;
            bail!("No templates available");
        }

        let mut selector = select("Template");
        for template in templates {
            selector = selector.item(template, template.label(), "");
        }

        selector.interact().map_err(Into::into)
    }

    /// Determines the project name based on CLI arguments or interactive prompt
    fn resolve_name(&self) -> Result<String> {
        if let Some(ref name) = self.name {
            if let Err(err) = validate_name(name) {
                outro_cancel(err)?;
                bail!(err);
            }
            Ok(name.clone())
        } else {
            input("Project Name")
                .placeholder("my-module")
                .validate(|input: &String| validate_name(input).map_err(|e| e.to_string()))
                .interact()
                .map_err(Into::into)
        }
    }

    /// Prompts the user for confirmation before overwriting an existing directory
    fn confirm_overwrite(&self, path: &Path) -> Result<bool> {
        confirm(format!(
            "Directory '{}' already exists. Overwrite?",
            path.display()
        ))
        .interact()
        .map_err(Into::into)
    }

    /// Extracts the selected template to the target directory, handling variable replacement and file permissions
    fn extract_template(&self, target_path: &Path, name: &str, template: &Template) -> Result<u64> {
        let bundle = template.bundle();

        fs::create_dir_all(target_path)
            .with_context(|| format!("Failed to create `{}`", target_path.display()))?;

        let cursor = Cursor::new(bundle);
        let decoder = GzDecoder::new(cursor);
        let mut archive = Archive::new(decoder);
        let mut file_count = 0;

        for entry in archive.entries()? {
            let mut entry = entry?;
            let path = entry.path()?;

            if path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                bail!("Malicious path detected in template: {}", path.display());
            }

            let dest_path = target_path.join(path);
            let entry_type = entry.header().entry_type();

            // Handle directories specifically to avoid OS Error 21 (Is a Directory)
            if entry_type.is_dir() {
                fs::create_dir_all(&dest_path)?;
                continue;
            }

            // Ensure parent directory exists for files
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)?;
            }

            #[cfg(unix)]
            let mode = entry.header().mode().ok();

            let mut buffer = Vec::new();
            entry.read_to_end(&mut buffer)?;

            match String::from_utf8(buffer) {
                Ok(content) => {
                    let processed = content.replace("{{name}}", name);
                    fs::write(&dest_path, processed)?;
                }
                Err(e) => {
                    let bytes = e.into_bytes();
                    fs::write(&dest_path, bytes)?;
                }
            }

            #[cfg(unix)]
            if let Some(mode) = mode {
                use std::os::unix::fs::PermissionsExt;
                let perms = fs::Permissions::from_mode(mode);
                fs::set_permissions(&dest_path, perms)?;
            }

            file_count += 1;
        }

        Ok(file_count)
    }
}

/// Validates that the project name contains only allowed characters
fn validate_name(input: &str) -> Result<(), &'static str> {
    if input.is_empty() {
        return Err("Name cannot be empty");
    }

    if !input
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Use alphanumeric characters, hyphens, or underscores only");
    }

    if input.starts_with(|c: char| c.is_numeric()) {
        return Err("Name cannot start with a digit");
    }

    Ok(())
}
