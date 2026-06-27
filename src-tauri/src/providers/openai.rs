use async_trait::async_trait;

use crate::errors::Result;
use crate::providers::openai_compatible::OpenAiCompatibleAdapter;
use crate::providers::{ChatStreamEvent, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, TestResult, UnifiedChatRequest};

pub struct OpenAiChatAdapter;

#[async_trait]
impl ProviderAdapter for OpenAiChatAdapter {
    fn kind(&self) -> ProviderKind { ProviderKind::OpenAiChat }

    async fn list_models(&self, config: &ProviderConfig, api_key: &str) -> Result<Vec<ModelInfo>> {
        OpenAiCompatibleAdapter.list_models(config, api_key).await
    }

    async fn test_key(&self, config: &ProviderConfig, api_key: &str, model: Option<&str>) -> Result<TestResult> {
        OpenAiCompatibleAdapter.test_key(config, api_key, model).await
    }

    async fn chat_stream(&self, config: &ProviderConfig, api_key: &str, request: UnifiedChatRequest) -> Result<Vec<ChatStreamEvent>> {
        OpenAiCompatibleAdapter.chat_stream(config, api_key, request).await
    }
}
