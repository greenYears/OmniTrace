// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tmpomnitrace_bootstrapmpul84appomnitrace_lib::run()
}
