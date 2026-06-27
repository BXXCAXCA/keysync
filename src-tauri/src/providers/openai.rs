use async_trait::async_trait;

use crate::errors::{KeySyncError, Result};
use crate::providers::{ChatStreamEvent, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, TestResult, UnifiedChatRequest};

pub struct OpenAiChatAdapter;

#[async_trait]
impl ProviderAdapter for OpenAiChatAdapter {
    fn kind(&self) -> ProviderKind { ProviderKind::OpenAiChat }

    async fn list_models(&self, _config: &ProviderConfig, _api_key: &str) -> Result<Vec<ModelInfo>> {
        Err(KeySyncError::Provider("OpenAI model listing is not implemented yet".into()))
    }

    async fn test_key(&self, config: &ProviderConfig, _api_key: &str, model: Option<&str>) -> Result<TestResult> {
        Ok(TestResult { ok: false, provider_id: config.id.clone(), model_count: None, selected_model: model.map(str::to_owned), latency_ms: None, message: "OpenAI adapter placeholder is wired".into() })
    }

    async fn chat_stream(&self, _config: &ProviderConfig, _api_key: &str, _request: UnifiedChatRequest) -> Result<Vec<ChatStreamEvent>> {
        Ok(vec![ChatStreamEvent::Start, ChatStreamEvent::Error { code: "not_implemented".into(), message: "OpenAI streaming is not implemented yet".into() }])
    }
}
