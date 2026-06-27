use crate::providers::{default_provider_templates, ProviderTemplate, TestResult};

#[tauri::command]
pub fn list_provider_templates() -> Vec<ProviderTemplate> {
    default_provider_templates()
}

#[tauri::command]
pub async fn test_provider_placeholder(provider_id: String) -> TestResult {
    TestResult {
        ok: false,
        provider_id,
        model_count: None,
        selected_model: None,
        latency_ms: None,
        message: "Provider test command is wired. Next step: attach encrypted key unlock and real provider adapter.".into(),
    }
}
