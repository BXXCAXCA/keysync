use async_trait::async_trait;
use serde_json::json;
use std::time::Instant;

use crate::errors::{KeySyncError, Result};
use crate::providers::http::{build_client, join_url, parse_error_response};
use crate::providers::openai_compatible::OpenAiCompatibleAdapter;
use crate::providers::{ChatStreamEvent, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, TestResult, UnifiedChatRequest};

pub struct OpenAiResponsesAdapter;

#[async_trait]
impl ProviderAdapter for OpenAiResponsesAdapter {
    fn kind(&self) -> ProviderKind { ProviderKind::OpenAiResponses }

    async fn list_models(&self, config: &ProviderConfig, api_key: &str) -> Result<Vec<ModelInfo>> {
        OpenAiCompatibleAdapter.list_models(config, api_key).await
    }

    async fn test_key(&self, config: &ProviderConfig, api_key: &str, model: Option<&str>) -> Result<TestResult> {
        let started = Instant::now();
        let models = self.list_models(config, api_key).await?;
        let selected_model = model.map(str::to_owned).or_else(|| models.first().map(|item| item.id.clone()))
            .ok_or_else(|| KeySyncError::Provider("model list is empty; cannot run minimal Responses request".into()))?;

        let client = build_client()?;
        let url = join_url(&config.base_url, config.responses_path.as_deref().or(Some("/responses")));
        let response = client
            .post(url)
            .bearer_auth(api_key)
            .json(&json!({
                "model": selected_model,
                "input": "ping",
                "max_output_tokens": 1
            }))
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("minimal Responses request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(parse_error_response(response, "minimal Responses request").await);
        }

        Ok(TestResult {
            ok: true,
            provider_id: config.id.clone(),
            model_count: Some(models.len()),
            selected_model: Some(selected_model),
            latency_ms: Some(started.elapsed().as_millis() as u64),
            message: "API key, model list, and minimal Responses request succeeded".into(),
        })
    }

    async fn chat_stream(&self, _config: &ProviderConfig, _api_key: &str, _request: UnifiedChatRequest) -> Result<Vec<ChatStreamEvent>> {
        Ok(vec![ChatStreamEvent::Start, ChatStreamEvent::Done])
    }
}
