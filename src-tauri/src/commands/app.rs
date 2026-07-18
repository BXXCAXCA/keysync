use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppStatus {
    pub name: &'static str,
    pub phase: &'static str,
}

#[tauri::command]
pub fn app_status() -> AppStatus {
    AppStatus {
        name: "KeySync AI",
        phase: "bootstrap skeleton",
    }
}
