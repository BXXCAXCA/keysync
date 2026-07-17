use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;

use crate::errors::{KeySyncError, Result};
use crate::providers::http::{build_client, join_url, parse_error_response};
use crate::providers::{ChatStreamEvent, ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, TestResult, UnifiedChatRequest};

pub struct GeminiAdapter;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiModelsResponse {
    models: Vec<GeminiModel>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiModel {
    name: String,
    display_name: Option<String>,
    supported_generation_methods: Option<Vec<String>>,
    input_token_limit: Option<u64>,
}

#[async_trait]
impl ProviderAdapter for GeminiAdapter {
    fn kind(&self) -> ProviderKind { ProviderKind::GoogleGemini }

    async fn list_models(&self, config: &ProviderConfig, api_key: &str) -> Result<Vec<ModelInfo>> {
        let client = build_client(config.proxy_url.as_deref())?;
        let url = join_url(&config.base_url, config.models_path.as_deref().or(Some("/models")));
        let response = client
            .get(url)
            .header("x-goog-api-key", api_key)
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("Gemini model list request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(parse_error_response(response, "Gemini model list").await);
        }

        let payload = response
            .json::<GeminiModelsResponse>()
            .await
            .map_err(|err| KeySyncError::Provider(format!("failed to parse Gemini model list: {err}")))?;

        Ok(payload.models.into_iter().map(|model| gemini_model_info(&config.id, model)).collect())
    }

    async fn test_key(&self, config: &ProviderConfig, api_key: &str, model: Option<&str>) -> Result<TestResult> {
        let started = Instant::now();
        let models = self.list_models(config, api_key).await?;
        let selected_model = model
            .map(str::to_owned)
            .or_else(|| models.iter().find(|item| item.capabilities.iter().any(|cap| cap == "chat")).map(|item| item.id.clone()))
            .or_else(|| models.first().map(|item| item.id.clone()))
            .ok_or_else(|| KeySyncError::Provider("Gemini model list is empty; cannot run minimal request".into()))?;

        let response = build_client(config.proxy_url.as_deref())?
            .post(gemini_generate_url(config, &selected_model))
            .header("x-goog-api-key", api_key)
            .json(&json!({
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": "ping" }]
                }],
                "generationConfig": {
                    "maxOutputTokens": 1,
                    "temperature": 0.0
                }
            }))
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("Gemini minimal generateContent request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(parse_error_response(response, "Gemini minimal generateContent request").await);
        }

        Ok(TestResult {
            ok: true,
            provider_id: config.id.clone(),
            model_count: Some(models.len()),
            selected_model: Some(selected_model),
            latency_ms: Some(started.elapsed().as_millis() as u64),
            message: "Gemini API key, model list, and minimal generateContent request succeeded".into(),
        })
    }

    async fn chat_stream(&self, _config: &ProviderConfig, _api_key: &str, _request: UnifiedChatRequest) -> Result<Vec<ChatStreamEvent>> {
        Ok(vec![
            ChatStreamEvent::Start,
            ChatStreamEvent::Error { code: "not_implemented".into(), message: "Gemini streaming will be implemented after non-streaming adapter verification".into() },
        ])
    }
}

fn gemini_model_info(provider_id: &str, model: GeminiModel) -> ModelInfo {
    let id = model.name;
    let display_name = model.display_name.unwrap_or_else(|| id.clone());
    let methods = model.supported_generation_methods.unwrap_or_default();
    let mut capabilities = Vec::new();

    if methods.iter().any(|method| method == "generateContent") {
        capabilities.push("chat".to_owned());
    }
    if methods.iter().any(|method| method == "embedContent" || method == "batchEmbedContents") {
        capabilities.push("embedding".to_owned());
    }
    if id.to_lowercase().contains("vision") || display_name.to_lowercase().contains("vision") || id.to_lowercase().contains("gemini") {
        capabilities.push("vision".to_owned());
    }
    if capabilities.is_empty() {
        capabilities.push("unknown".to_owned());
    }

    ModelInfo {
        id,
        display_name,
        provider_id: provider_id.to_owned(),
        capabilities,
        context_window: model.input_token_limit,
        is_favorite: false,
        is_hidden: false,
        alias: None,
        default_params: None,
    }
}

fn gemini_generate_url(config: &ProviderConfig, model_id: &str) -> String {
    let model_path = if model_id.starts_with("models/") {
        format!("/{model_id}:generateContent")
    } else {
        format!("/models/{model_id}:generateContent")
    };
    join_url(&config.base_url, Some(&model_path))
}
