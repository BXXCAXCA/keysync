use crate::errors::ErrorPayload;
use crate::providers::anthropic::AnthropicAdapter;
use crate::providers::gemini::GeminiAdapter;
use crate::providers::openai::OpenAiChatAdapter;
use crate::providers::openai_compatible::OpenAiCompatibleAdapter;
use crate::providers::openai_responses::OpenAiResponsesAdapter;
use crate::providers::{default_provider_templates, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, ProviderTemplate, TestResult};

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

#[tauri::command]
pub async fn list_models_with_key(config: ProviderConfig, api_key: String) -> std::result::Result<Vec<ModelInfo>, ErrorPayload> {
    let adapter = adapter_for_kind(&config.kind);
    adapter.list_models(&config, &api_key).await.map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn test_provider_with_key(config: ProviderConfig, api_key: String, model: Option<String>) -> std::result::Result<TestResult, ErrorPayload> {
    let adapter = adapter_for_kind(&config.kind);
    adapter.test_key(&config, &api_key, model.as_deref()).await.map_err(ErrorPayload::from)
}

fn adapter_for_kind(kind: &ProviderKind) -> Box<dyn ProviderAdapter> {
    match kind {
        ProviderKind::OpenAiChat => Box::new(OpenAiChatAdapter),
        ProviderKind::OpenAiResponses => Box::new(OpenAiResponsesAdapter),
        ProviderKind::OpenAiCompatible | ProviderKind::Custom => Box::new(OpenAiCompatibleAdapter),
        ProviderKind::GoogleGemini => Box::new(GeminiAdapter),
        ProviderKind::AnthropicClaude => Box::new(AnthropicAdapter),
    }
}
