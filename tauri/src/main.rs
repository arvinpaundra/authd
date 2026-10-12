#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    authd_lib::run()
}
