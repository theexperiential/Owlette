//! Embed a Windows VERSIONINFO resource (and the product icon) in owlette-host.exe.
//!
//! Until 2026-09-08 this binary shipped with NO version resource at all: no
//! CompanyName, ProductName, FileDescription, FileVersion, no icon, and no
//! signature. Combined with a statically linked CRT and a size-optimised,
//! stripped, LTO'd image, that is the exact static profile Defender's ML
//! classifier associates with dropper stubs — and on signature set 1.459.111.0
//! it began quarantining the installed service host as
//! `Trojan:Win32/Bearfoos.B!ml`, deregistering OwletteService on the way out.
//!
//! Every legitimate Windows service binary carries this metadata; adding it is
//! the single cheapest change to the classifier's inputs. It is NOT a guarantee
//! (only a signature gives reputation that persists across builds), so a
//! rebuilt candidate must still be scanned with
//! `MpCmdRun -Scan -ScanType 3 -File <copy> -DisableRemediation` before it goes
//! anywhere near an installer.
//!
//! FileVersion/ProductVersion come from `CARGO_PKG_VERSION`, which is why the
//! host crate's version is now kept in step by scripts/sync-versions.js — a
//! stale "3.0.0" stamped into the metadata would defeat the purpose.
//!
//! `winresource` is the same crate Tauri already uses for the desktop app, so
//! it is a dependency this repo has been building with for months. It needs
//! `rc.exe` from the Windows SDK, which any machine with the MSVC toolchain
//! (a prerequisite of this crate anyway) provides.

use std::env;
use std::path::Path;

fn main() {
    // Only meaningful for the Windows target; a cross-check build elsewhere
    // must not fail for want of rc.exe.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let mut res = winresource::WindowsResource::new();
    res.set("CompanyName", "Tridant Inc.");
    res.set("ProductName", "owlette");
    res.set("FileDescription", "owlette agent service host");
    res.set("InternalName", "owlette-host");
    res.set("OriginalFilename", "owlette-host.exe");
    res.set("LegalCopyright", "Copyright (c) Tridant Inc. Licensed under FSL-1.1-Apache-2.0.");

    // The product icon lives with the desktop app. Optional: a checkout that
    // lacks it (or a future move) must not break the service build.
    let icon = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("desktop")
        .join("src-tauri")
        .join("icons")
        .join("icon.ico");
    if icon.is_file() {
        res.set_icon(icon.to_str().expect("icon path is valid UTF-8"));
        println!("cargo:rerun-if-changed={}", icon.display());
    }

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");

    if let Err(e) = res.compile() {
        panic!("failed to embed the Windows version resource: {e}");
    }
}
