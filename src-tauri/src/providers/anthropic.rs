use async_trait::async_trait;
use serde_json::json;
use std::time::Instant;

use crate::errors::{KeySyncError, Result};
use crate::providers::http::{build_client, join_url, parse_error_response};
use crate::providers::{ChatStreamEvent, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, TestResult, UnifiedChatRequest};

pub struct AnthropicAdapter;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_CLAUDE_MODELS: &[&str] = &[
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
];

#[async_trait]
impl ProviderAdapter for AnthropicAdapter {
    fn kind(&self) -> ProviderKind { ProviderKind::AnthropicClaude }

    async fn list_models(&self, config: &ProviderConfig, _api_key: &str) -> Result<Vec<ModelInfo>> {
        Ok(DEFAULT_CLAUDE_MODELS
            .iter()
            .map(|id| ModelInfo {
                id: (*id).to_owned(),
                display_name: (*id).to_owned(),
                provider_id: config.id.clone(),
                capabilities: vec!["chat".to_owned(), "vision".to_owned()],
                context_window: Some(200_000),
                is_favorite: false,
                is_hidden: false,
                alias: None,
                default_params: None,
            })
            .collect())
    }

    async fn test_key(&self, config: &ProviderConfig, api_key: &str, model: Option<&str>) -> Result<TestResult> {
        let started = Instant::now();
        let models = self.list_models(config, api_key).await?;
        let selected_model = model
            .map(str::to_owned)
            .or_else(|| models.first().map(|item| item.id.clone()))
            .ok_or_else(|| KeySyncError::Provider("Claude model list is empty; cannot run minimal request".into()))?;

        let response = build_client(config.proxy_url.as_deref())?
            .post(join_url(&config.base_url, config.chat_path.as_deref().or(Some("/messages"))))
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&json!({
                "model": selected_model,
                "max_tokens": 1,
                "temperature": 0.0,
                "messages": [{
                    "role": "user",
                    "content": "ping"
                }]
            }))
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("Anthropic minimal Messages request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(parse_error_response(response, "Anthropic minimal Messages request").await);
        }

        Ok(TestResult {
            ok: true,
            provider_id: config.id.clone(),
            model_count: Some(models.len()),
            selected_model: Some(selected_model),
            latency_ms: Some(started.elapsed().as_millis() as u64),
            message: "Anthropic API key and minimal Messages request succeeded".into(),
        })
    }

    async fn chat_stream(&self, _config: &ProviderConfig, _api_key: &str, _request: UnifiedChatRequest) -> Result<Vec<ChatStreamEvent>> {
        Ok(vec![
            ChatStreamEvent::Start,
            ChatStreamEvent::Error { code: "not_implemented".into(), message: "Anthropic streaming will be implemented after minimal Messages verification".into() },
        ])
    }
}
