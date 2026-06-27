use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::Emitter;
use uuid::Uuid;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::providers::anthropic::AnthropicAdapter;
use crate::providers::gemini::GeminiAdapter;
use crate::providers::http::{build_client, join_url, parse_error_response};
use crate::providers::openai::OpenAiChatAdapter;
use crate::providers::openai_compatible::OpenAiCompatibleAdapter;
use crate::providers::openai_responses::OpenAiResponsesAdapter;
use crate::providers::{
    default_provider_templates, ChatStartResult, ChatStreamEvent, ChatStreamPayload, ModelInfo,
    ProviderAdapter, ProviderConfig, ProviderKind, ProviderTemplate, TestResult, UnifiedChatRequest,
};

const CHAT_STREAM_EVENT: &str = "chat-stream-event";

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

#[tauri::command]
pub async fn start_chat_stream_with_key(window: tauri::Window, config: ProviderConfig, api_key: String, request: UnifiedChatRequest) -> std::result::Result<ChatStartResult, ErrorPayload> {
    let stream_id = Uuid::new_v4().to_string();
    let stream_id_for_task = stream_id.clone();

    match config.kind {
        ProviderKind::OpenAiChat | ProviderKind::OpenAiCompatible | ProviderKind::Custom => {
            tauri::async_runtime::spawn(async move {
                if let Err(err) = run_openai_compatible_stream(window.clone(), stream_id_for_task.clone(), config, api_key, request).await {
                    let _ = emit_stream_event(
                        &window,
                        &stream_id_for_task,
                        ChatStreamEvent::Error { code: "stream_error".into(), message: err.to_string() },
                    );
                }
            });
            Ok(ChatStartResult { stream_id })
        }
        ProviderKind::OpenAiResponses | ProviderKind::GoogleGemini | ProviderKind::AnthropicClaude => Err(ErrorPayload::from(KeySyncError::Provider(
            "streaming chat is currently implemented for OpenAI-compatible providers only".into(),
        ))),
    }
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

async fn run_openai_compatible_stream(window: tauri::Window, stream_id: String, config: ProviderConfig, api_key: String, request: UnifiedChatRequest) -> crate::errors::Result<()> {
    emit_stream_event(&window, &stream_id, ChatStreamEvent::Start)?;

    let client = build_client()?;
    let url = join_url(&config.base_url, config.chat_path.as_deref().or(Some("/chat/completions")));
    let messages = build_openai_messages(&request);

    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": request.model,
            "messages": messages,
            "stream": true,
            "stream_options": { "include_usage": true },
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(512)
        }))
        .send()
        .await
        .map_err(|err| KeySyncError::Network(format!("streaming chat request failed: {err}")))?;

    if !response.status().is_success() {
        return Err(parse_error_response(response, "streaming chat request").await);
    }

    let mut buffer = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| KeySyncError::Network(format!("failed to read streaming chunk: {err}")))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));

        while let Some(index) = buffer.find("\n\n") {
            let event_block = buffer[..index].to_owned();
            buffer = buffer[index + 2..].to_owned();
            if process_sse_block(&window, &stream_id, &event_block)? {
                return Ok(());
            }
        }
    }

    emit_stream_event(&window, &stream_id, ChatStreamEvent::Done)?;
    Ok(())
}

fn build_openai_messages(request: &UnifiedChatRequest) -> Vec<Value> {
    let mut messages = Vec::new();
    if let Some(system_prompt) = request.system_prompt.as_ref().filter(|value| !value.trim().is_empty()) {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }

    for message in &request.messages {
        messages.push(json!({ "role": &message.role, "content": &message.content }));
    }

    messages
}

fn process_sse_block(window: &tauri::Window, stream_id: &str, block: &str) -> crate::errors::Result<bool> {
    for line in block.lines() {
        let Some(raw_data) = line.strip_prefix("data:") else { continue };
        let data = raw_data.trim();
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            emit_stream_event(window, stream_id, ChatStreamEvent::Done)?;
            return Ok(true);
        }

        let value: Value = serde_json::from_str(data)
            .map_err(|err| KeySyncError::Provider(format!("failed to parse streaming SSE payload: {err}")))?;

        if let Some(text) = value.pointer("/choices/0/delta/content").and_then(Value::as_str) {
            if !text.is_empty() {
                emit_stream_event(window, stream_id, ChatStreamEvent::Delta { text: text.to_owned() })?;
            }
        }

        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            emit_stream_event(
                window,
                stream_id,
                ChatStreamEvent::Usage {
                    input_tokens: usage.get("prompt_tokens").and_then(Value::as_u64),
                    output_tokens: usage.get("completion_tokens").and_then(Value::as_u64),
                },
            )?;
        }

        if let Some(reason) = value.pointer("/choices/0/finish_reason") {
            if !reason.is_null() {
                emit_stream_event(window, stream_id, ChatStreamEvent::Done)?;
                return Ok(true);
            }
        }
    }

    Ok(false)
}

fn emit_stream_event(window: &tauri::Window, stream_id: &str, event: ChatStreamEvent) -> crate::errors::Result<()> {
    window
        .emit(
            CHAT_STREAM_EVENT,
            ChatStreamPayload { stream_id: stream_id.to_owned(), event },
        )
        .map_err(|err| KeySyncError::Provider(format!("failed to emit chat stream event: {err}")))
}
