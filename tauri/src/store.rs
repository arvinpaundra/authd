//! The secret store seam: one entry holds the whole vault as JSON. `keyring` picks the backend
//!
//! at compile time — Keychain, Secret Service, Credential Manager — and nothing above this
//! module knows which.
//!
//! Never shell out to `/usr/bin/security`: the secret would land in argv, where `ps` can read it.

use keyring::Entry;

const SERVICE: &str = "dev.authd.app";
const USER: &str = "vault";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| format!("Keychain unavailable: {e}"))
}

pub fn load() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(json) => Ok(Some(json)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read the Keychain: {e}")),
    }
}

pub fn save(json: &str) -> Result<(), String> {
    entry()?
        .set_password(json)
        .map_err(|e| format!("Could not write to the Keychain: {e}"))
}
