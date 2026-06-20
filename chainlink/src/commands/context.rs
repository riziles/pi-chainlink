use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

/// Run the context-provider.py script deployed in .chainlink/integrations/.
///
/// Falls back gracefully when Python is not available.
pub fn run(chainlink_dir: &Path, args: &[String]) -> Result<()> {
    let script_path = chainlink_dir
        .join("integrations")
        .join("context-provider.py");

    if !script_path.exists() {
        bail!(
            "context-provider.py not found at {}. Run 'chainlink init' first.",
            script_path.display()
        );
    }

    // Try python3 first, then python
    let python = find_python()?;

    let status = Command::new(&python)
        .arg(&script_path)
        .args(args)
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .status()
        .with_context(|| format!("Failed to run {} {}", python, script_path.display()))?;

    if !status.success() {
        bail!(
            "{} exited with status {}",
            script_path.display(),
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

/// Find an available Python interpreter.
fn find_python() -> Result<String> {
    for candidate in &["python3", "python"] {
        if Command::new(candidate)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok()
        {
            return Ok(candidate.to_string());
        }
    }
    bail!(
        "Python not found. Install Python 3.6+ to use `chainlink context`, \
         or run the script manually: python .chainlink/integrations/context-provider.py"
    );
}
