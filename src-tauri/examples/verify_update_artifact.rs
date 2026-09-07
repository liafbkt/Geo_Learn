// Release-only verifier, never registered as application IPC.
// Uses the same verification path as
// https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs

use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{
    error::Error,
    path::{Path, PathBuf},
};

fn verify(data: &[u8], signature: &str, public_key: &str) -> Result<(), Box<dyn Error>> {
    let key_text = String::from_utf8(STANDARD.decode(public_key.trim())?)?;
    let signature_text = String::from_utf8(STANDARD.decode(signature.trim())?)?;
    let key = PublicKey::decode(&key_text)?;
    let signature = Signature::decode(&signature_text)?;
    key.verify(data, &signature, true)?;
    Ok(())
}

fn find_installer(directory: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let mut installers = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_type()?.is_file() && entry.path().extension().is_some_and(|ext| ext == "exe")
        {
            installers.push(entry.path());
        }
    }
    if installers.len() != 1 {
        return Err("Expected exactly one NSIS installer".into());
    }
    let installer = installers.remove(0);
    if !installer.with_extension("exe.sig").is_file() {
        return Err("Missing NSIS updater signature".into());
    }
    Ok(installer)
}

fn run() -> Result<(), Box<dyn Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("tauri.conf.json"))?)?;
    let key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("Missing updater public key")?;
    let mut arguments = std::env::args_os().skip(1);
    let directory = match arguments.next() {
        Some(path) if arguments.next().is_none() => PathBuf::from(path),
        None => root.join("target/x86_64-pc-windows-msvc/release/bundle/nsis"),
        Some(_) => return Err("Expected at most one updater artifact directory".into()),
    };
    let installer = find_installer(&directory)?;
    let bytes = std::fs::read(&installer)?;
    let signature = std::fs::read_to_string(installer.with_extension("exe.sig"))?;
    verify(&bytes, &signature, key)?;
    Ok(())
}

fn main() {
    if run().is_err() {
        // Never echo cryptographic inputs (or arbitrary library error contents).
        eprintln!("Updater artifact verification failed: check installer, signature and committed public key.");
        std::process::exit(1);
    }
    println!("NSIS updater signature verified against the committed public key.");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_malformed_trust_material() {
        assert!(verify(b"installer", "", "").is_err());
        assert!(verify(b"installer", "not-base64", "not-base64").is_err());
        let malformed = STANDARD.encode("untrusted comment: malformed\nAAAA\n");
        assert!(verify(b"installer", &malformed, &malformed).is_err());
    }

    #[test]
    fn requires_one_installer_and_its_signature() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_installer(dir.path()).is_err());
        std::fs::write(dir.path().join("app-setup.exe"), b"installer").unwrap();
        assert!(find_installer(dir.path()).is_err());
        std::fs::write(dir.path().join("app-setup.exe.sig"), b"signature").unwrap();
        assert_eq!(
            find_installer(dir.path()).unwrap(),
            dir.path().join("app-setup.exe")
        );
        std::fs::write(dir.path().join("other-setup.exe"), b"installer").unwrap();
        assert!(find_installer(dir.path()).is_err());
    }
}
