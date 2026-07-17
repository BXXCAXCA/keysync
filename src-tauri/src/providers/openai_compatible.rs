use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;

use crate::errors::{KeySyncError, Result};
use crate::providers::http::{build_client, join_url, parse_error_response};
use crate::providers::{ChatStreamEvent, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, TestResult, UnifiedChatRequest};

pub struct OpenAiCompatibleAdapter;

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModel {
    id: String,
}

#[async_trait]
impl ProviderAdapter for OpenAiCompatibleAdapter {
    fn kind(&self) -> ProviderKind { ProviderKind::OpenAiCompatible }

    async fn list_models(&self, config: &ProviderConfig, api_key: &str) -> Result<Vec<ModelInfo>> {
        let client = build_client(config.proxy_url.as_deref())?;
        let url = join_url(&config.base_url, config.models_path.as_deref().or(Some("/models")));
        let response = client
            .get(url)
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("model list request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(parse_error_response(response, "model list").await);
        }

        let payload = response
            .json::<OpenAiModelsResponse>()
            .await
            .map_err(|err| KeySyncError::Provider(format!("failed to parse OpenAI-compatible model list: {err}")))?;

        Ok(payload.data.into_iter().map(|model| model_info_from_id(&config.id, model.id)).collect())
    }

    async fn test_key(&self, config: &ProviderConfig, api_key: &str, model: Option<&str>) -> Result<TestResult> {
        let started = Instant::now();
        let models = self.list_models(config, api_key).await?;
        let selected_model = model.map(str::to_owned).or_else(|| models.first().map(|item| item.id.clone()));
        let selected_model = selected_model.ok_or_else(|| KeySyncError::Provider("model list is empty; cannot run minimal request".into()))?;

        let client = build_client(config.proxy_url.as_deref())?;
        let url = join_url(&config.base_url, config.chat_path.as_deref().or(Some("/chat/completions")));
        let response = client
            .post(url)
            .bearer_auth(api_key)
            .json(&json!({
                "model": selected_model,
                "messages": [{ "role": "user", "content": "ping" }],
                "stream": false,
                "max_tokens": 1
            }))
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("minimal chat request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(parse_error_response(response, "minimal chat request").await);
        }

        Ok(TestResult {
            ok: true,
            provider_id: config.id.clone(),
            model_count: Some(models.len()),
            selected_model: Some(selected_model),
            latency_ms: Some(started.elapsed().as_millis() as u64),
            message: "API key, model list, and minimal chat request succeeded".into(),
        })
    }

    async fn chat_stream(&self, _config: &ProviderConfig, _api_key: &str, _request: UnifiedChatRequest) -> Result<Vec<ChatStreamEvent>> {
        Ok(vec![
            ChatStreamEvent::Start,
            ChatStreamEvent::Error { code: "not_implemented".into(), message: "Streaming parser will be implemented after provider detection".into() },
        ])
    }
}

pub fn model_info_from_id(provider_id: &str, id: String) -> ModelInfo {
    let lower = id.to_lowercase();
    let mut capabilities = vec!["chat".to_owned()];
    if lower.contains("vision") || lower.contains("vl") || lower.contains("gpt-4o") || lower.contains("omni") {
        capabilities.push("vision".to_owned());
    }
    if lower.contains("embedding") || lower.contains("embed") {
        capabilities.retain(|cap| cap.as_str() != "chat");
        capabilities.push("embedding".to_owned());
    }
    if lower.contains("reason") || lower.starts_with('o') {
        capabilities.push("reasoning".to_owned());
    }

    ModelInfo {
        display_name: id.clone(),
        id,
        provider_id: provider_id.to_owned(),
        capabilities,
        context_window: None,
        is_favorite: false,
        is_hidden: false,
        alias: None,
        default_params: None,
    }
}
