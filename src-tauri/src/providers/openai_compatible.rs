use async_trait::async_trait;

use crate::errors::Result;
use crate::providers::{ChatStreamEvent, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, TestResult, UnifiedChatRequest};

pub struct OpenAiCompatibleAdapter;

#[async_trait]
impl ProviderAdapter for OpenAiCompatibleAdapter {
    fn kind(&self) -> ProviderKind { ProviderKind::OpenAiCompatible }
    async fn list_models(&self, _config: &ProviderConfig, _api_key: &str) -> Result<Vec<ModelInfo>> { Ok(Vec::new()) }
    async fn test_key(&self, config: &ProviderConfig, _api_key: &str, model: Option<&str>) -> Result<TestResult> {
        Ok(TestResult { ok: false, provider_id: config.id.clone(), model_count: Some(0), selected_model: model.map(str::to_owned), latency_ms: None, message: "OpenAI-compatible adapter placeholder is wired".into() })
    }
    async fn chat_stream(&self, _config: &ProviderConfig, _api_key: &str, _request: UnifiedChatRequest) -> Result<Vec<ChatStreamEvent>> { Ok(vec![ChatStreamEvent::Start, ChatStreamEvent::Done]) }
}
