use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use futures_util::{future::{AbortHandle, Abortable}, StreamExt};
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
    default_provider_templates, ChatStartResult, ChatStreamEvent, ChatStreamPayload, ImageAttachment,
    ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind, ProviderTemplate, TestResult,
    UnifiedChatRequest,
};

const CHAT_STREAM_EVENT: &str = "chat-stream-event";
const ANTHROPIC_VERSION: &str = "2023-06-01";
static ACTIVE_STREAMS: OnceLock<Mutex<HashMap<String, AbortHandle>>> = OnceLock::new();

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
pub async fn start_chat_stream_with_key(window: tauri::Window, config: ProviderConfig, api_key: String, request: UnifiedChatRequest, stream_id: Option<String>) -> std::result::Result<ChatStartResult, ErrorPayload> {
    let stream_id = stream_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let stream_id_for_task = stream_id.clone();
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    insert_active_stream(&stream_id, abort_handle)?;

    match config.kind {
        ProviderKind::OpenAiChat | ProviderKind::OpenAiCompatible | ProviderKind::Custom => {
            tauri::async_runtime::spawn(async move {
                let result = Abortable::new(
                    run_openai_compatible_stream(window.clone(), stream_id_for_task.clone(), config, api_key, request),
                    abort_registration,
                ).await;
                handle_stream_task_result(&window, &stream_id_for_task, result);
            });
        }
        ProviderKind::OpenAiResponses => {
            tauri::async_runtime::spawn(async move {
                let result = Abortable::new(
                    run_openai_responses_stream(window.clone(), stream_id_for_task.clone(), config, api_key, request),
                    abort_registration,
                ).await;
                handle_stream_task_result(&window, &stream_id_for_task, result);
            });
        }
        ProviderKind::GoogleGemini => {
            tauri::async_runtime::spawn(async move {
                let result = Abortable::new(
                    run_gemini_stream(window.clone(), stream_id_for_task.clone(), config, api_key, request),
                    abort_registration,
                ).await;
                handle_stream_task_result(&window, &stream_id_for_task, result);
            });
        }
        ProviderKind::AnthropicClaude => {
            tauri::async_runtime::spawn(async move {
                let result = Abortable::new(
                    run_anthropic_stream(window.clone(), stream_id_for_task.clone(), config, api_key, request),
                    abort_registration,
                ).await;
                handle_stream_task_result(&window, &stream_id_for_task, result);
            });
        }
    }

    Ok(ChatStartResult { stream_id })
}

#[tauri::command]
pub fn stop_chat_stream(window: tauri::Window, stream_id: String) -> std::result::Result<bool, ErrorPayload> {
    let aborted = abort_active_stream(&stream_id).map_err(ErrorPayload::from)?;
    if aborted {
        emit_stream_event(&window, &stream_id, ChatStreamEvent::Done).map_err(ErrorPayload::from)?;
    }
    Ok(aborted)
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

fn handle_stream_task_result(window: &tauri::Window, stream_id: &str, result: std::result::Result<crate::errors::Result<()>, futures_util::future::Aborted>) {
    match result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            let _ = emit_stream_event(window, stream_id, ChatStreamEvent::Error { code: "stream_error".into(), message: err.to_string() });
        }
        Err(_) => {}
    }
    let _ = remove_active_stream(stream_id);
}

async fn run_openai_compatible_stream(window: tauri::Window, stream_id: String, config: ProviderConfig, api_key: String, request: UnifiedChatRequest) -> crate::errors::Result<()> {
    emit_stream_event(&window, &stream_id, ChatStreamEvent::Start)?;

    let response = build_client()?
        .post(join_url(&config.base_url, config.chat_path.as_deref().or(Some("/chat/completions"))))
        .bearer_auth(api_key)
        .json(&json!({
            "model": request.model,
            "messages": build_openai_messages(&request),
            "stream": true,
            "stream_options": { "include_usage": true },
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(512)
        }))
        .send()
        .await
        .map_err(|err| KeySyncError::Network(format!("streaming chat request failed: {err}")))?;

    if !response.status().is_success() {
        let _ = remove_active_stream(&stream_id);
        return Err(parse_error_response(response, "streaming chat request").await);
    }

    process_sse_stream(window, stream_id, response, process_openai_sse_block).await
}

async fn run_openai_responses_stream(window: tauri::Window, stream_id: String, config: ProviderConfig, api_key: String, request: UnifiedChatRequest) -> crate::errors::Result<()> {
    emit_stream_event(&window, &stream_id, ChatStreamEvent::Start)?;

    let mut body = json!({
        "model": request.model,
        "input": build_responses_input(&request),
        "stream": true,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_output_tokens": request.max_tokens.unwrap_or(512)
    });

    if let Some(system_prompt) = request.system_prompt.as_ref().filter(|value| !value.trim().is_empty()) {
        body["instructions"] = json!(system_prompt);
    }

    let response = build_client()?
        .post(join_url(&config.base_url, config.responses_path.as_deref().or(Some("/responses"))))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|err| KeySyncError::Network(format!("OpenAI Responses streaming request failed: {err}")))?;

    if !response.status().is_success() {
        let _ = remove_active_stream(&stream_id);
        return Err(parse_error_response(response, "OpenAI Responses streaming request").await);
    }

    process_sse_stream(window, stream_id, response, process_responses_sse_block).await
}

async fn run_gemini_stream(window: tauri::Window, stream_id: String, config: ProviderConfig, api_key: String, request: UnifiedChatRequest) -> crate::errors::Result<()> {
    emit_stream_event(&window, &stream_id, ChatStreamEvent::Start)?;

    let response = build_client()?
        .post(gemini_stream_url(&config, &request.model))
        .header("x-goog-api-key", api_key)
        .json(&json!({
            "contents": build_gemini_contents(&request),
            "generationConfig": {
                "temperature": request.temperature.unwrap_or(0.7),
                "maxOutputTokens": request.max_tokens.unwrap_or(512)
            }
        }))
        .send()
        .await
        .map_err(|err| KeySyncError::Network(format!("Gemini streaming request failed: {err}")))?;

    if !response.status().is_success() {
        let _ = remove_active_stream(&stream_id);
        return Err(parse_error_response(response, "Gemini streaming request").await);
    }

    process_sse_stream(window, stream_id, response, process_gemini_sse_block).await
}

async fn run_anthropic_stream(window: tauri::Window, stream_id: String, config: ProviderConfig, api_key: String, request: UnifiedChatRequest) -> crate::errors::Result<()> {
    emit_stream_event(&window, &stream_id, ChatStreamEvent::Start)?;

    let mut body = json!({
        "model": request.model,
        "messages": build_anthropic_messages(&request),
        "stream": true,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_tokens": request.max_tokens.unwrap_or(512)
    });
    if let Some(system_prompt) = request.system_prompt.as_ref().filter(|value| !value.trim().is_empty()) {
        body["system"] = json!(system_prompt);
    }

    let response = build_client()?
        .post(join_url(&config.base_url, config.chat_path.as_deref().or(Some("/messages"))))
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|err| KeySyncError::Network(format!("Anthropic streaming request failed: {err}")))?;

    if !response.status().is_success() {
        let _ = remove_active_stream(&stream_id);
        return Err(parse_error_response(response, "Anthropic streaming request").await);
    }

    process_sse_stream(window, stream_id, response, process_anthropic_sse_block).await
}

async fn process_sse_stream(
    window: tauri::Window,
    stream_id: String,
    response: reqwest::Response,
    block_handler: fn(&tauri::Window, &str, &str) -> crate::errors::Result<bool>,
) -> crate::errors::Result<()> {
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if !is_stream_active(&stream_id)? {
            emit_stream_event(&window, &stream_id, ChatStreamEvent::Done)?;
            return Ok(());
        }

        let chunk = chunk.map_err(|err| KeySyncError::Network(format!("failed to read streaming chunk: {err}")))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));

        while let Some(index) = buffer.find("\n\n") {
            if !is_stream_active(&stream_id)? {
                emit_stream_event(&window, &stream_id, ChatStreamEvent::Done)?;
                return Ok(());
            }
            let event_block = buffer[..index].to_owned();
            buffer = buffer[index + 2..].to_owned();
            if block_handler(&window, &stream_id, &event_block)? {
                let _ = remove_active_stream(&stream_id);
                return Ok(());
            }
        }
    }

    let _ = remove_active_stream(&stream_id);
    emit_stream_event(&window, &stream_id, ChatStreamEvent::Done)?;
    Ok(())
}

fn build_openai_messages(request: &UnifiedChatRequest) -> Vec<Value> {
    let mut messages = Vec::new();
    if let Some(system_prompt) = request.system_prompt.as_ref().filter(|value| !value.trim().is_empty()) {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }

    for message in &request.messages {
        if message.content.trim().is_empty() && message.images.is_empty() {
            continue;
        }

        if message.images.is_empty() {
            messages.push(json!({ "role": &message.role, "content": &message.content }));
            continue;
        }

        let mut content = Vec::new();
        if !message.content.trim().is_empty() {
            content.push(json!({ "type": "text", "text": &message.content }));
        }
        for image in &message.images {
            content.push(json!({
                "type": "image_url",
                "image_url": { "url": image_data_url(image) }
            }));
        }
        messages.push(json!({ "role": &message.role, "content": content }));
    }

    messages
}

fn build_responses_input(request: &UnifiedChatRequest) -> Vec<Value> {
    let mut input = Vec::new();
    for message in &request.messages {
        if (message.content.trim().is_empty() && message.images.is_empty()) || message.role == "system" {
            continue;
        }
        let role = if message.role == "assistant" { "assistant" } else { "user" };
        let mut content = Vec::new();

        if !message.content.trim().is_empty() {
            content.push(json!({
                "type": if role == "assistant" { "output_text" } else { "input_text" },
                "text": &message.content
            }));
        }

        if role == "user" {
            for image in &message.images {
                content.push(json!({
                    "type": "input_image",
                    "image_url": image_data_url(image)
                }));
            }
        }

        if !content.is_empty() {
            input.push(json!({ "role": role, "content": content }));
        }
    }

    if input.is_empty() {
        input.push(json!({
            "role": "user",
            "content": [{ "type": "input_text", "text": "ping" }]
        }));
    }

    input
}

fn build_gemini_contents(request: &UnifiedChatRequest) -> Vec<Value> {
    let mut contents = Vec::new();

    if let Some(system_prompt) = request.system_prompt.as_ref().filter(|value| !value.trim().is_empty()) {
        contents.push(json!({
            "role": "user",
            "parts": [{ "text": system_prompt }]
        }));
        contents.push(json!({
            "role": "model",
            "parts": [{ "text": "Understood." }]
        }));
    }

    for message in &request.messages {
        let role = if message.role == "assistant" { "model" } else { "user" };
        if message.content.trim().is_empty() && message.images.is_empty() {
            continue;
        }
        let mut parts = Vec::new();
        if !message.content.trim().is_empty() {
            parts.push(json!({ "text": &message.content }));
        }
        if role == "user" {
            for image in &message.images {
                parts.push(json!({
                    "inlineData": {
                        "mimeType": image_media_type(image),
                        "data": &image.data_base64
                    }
                }));
            }
        }
        if !parts.is_empty() {
            contents.push(json!({ "role": role, "parts": parts }));
        }
    }

    contents
}

fn build_anthropic_messages(request: &UnifiedChatRequest) -> Vec<Value> {
    let mut messages = Vec::new();
    for message in &request.messages {
        if (message.content.trim().is_empty() && message.images.is_empty()) || message.role == "system" {
            continue;
        }
        let role = if message.role == "assistant" { "assistant" } else { "user" };

        if message.images.is_empty() {
            messages.push(json!({
                "role": role,
                "content": &message.content
            }));
            continue;
        }

        let mut content = Vec::new();
        if !message.content.trim().is_empty() {
            content.push(json!({ "type": "text", "text": &message.content }));
        }
        if role == "user" {
            for image in &message.images {
                content.push(json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image_media_type(image),
                        "data": &image.data_base64
                    }
                }));
            }
        }
        if !content.is_empty() {
            messages.push(json!({ "role": role, "content": content }));
        }
    }

    if messages.is_empty() {
        messages.push(json!({ "role": "user", "content": "ping" }));
    }

    messages
}

fn image_media_type(image: &ImageAttachment) -> &str {
    if image.media_type.trim().is_empty() {
        "application/octet-stream"
    } else {
        image.media_type.as_str()
    }
}

fn image_data_url(image: &ImageAttachment) -> String {
    format!("data:{};base64,{}", image_media_type(image), image.data_base64)
}

fn process_openai_sse_block(window: &tauri::Window, stream_id: &str, block: &str) -> crate::errors::Result<bool> {
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

fn process_responses_sse_block(window: &tauri::Window, stream_id: &str, block: &str) -> crate::errors::Result<bool> {
    for line in block.lines() {
        let Some(raw_data) = line.strip_prefix("data:") else { continue };
        let data = raw_data.trim();
        if data.is_empty() || data == "[DONE]" {
            if data == "[DONE]" {
                emit_stream_event(window, stream_id, ChatStreamEvent::Done)?;
                return Ok(true);
            }
            continue;
        }

        let value: Value = serde_json::from_str(data)
            .map_err(|err| KeySyncError::Provider(format!("failed to parse OpenAI Responses streaming SSE payload: {err}")))?;
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or_default();

        match event_type {
            "response.output_text.delta" => {
                if let Some(text) = value.get("delta").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                    emit_stream_event(window, stream_id, ChatStreamEvent::Delta { text: text.to_owned() })?;
                }
            }
            "response.completed" => {
                emit_stream_event(window, stream_id, ChatStreamEvent::Done)?;
                return Ok(true);
            }
            "response.failed" | "response.incomplete" | "error" => {
                let message = value.pointer("/error/message")
                    .or_else(|| value.pointer("/response/error/message"))
                    .and_then(Value::as_str)
                    .unwrap_or("OpenAI Responses stream ended with an error");
                emit_stream_event(window, stream_id, ChatStreamEvent::Error { code: "responses_stream_error".into(), message: message.to_owned() })?;
                return Ok(true);
            }
            "response.output_item.done" | "response.content_part.done" => {
                if let Some(text) = value.pointer("/item/content/0/text").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                    emit_stream_event(window, stream_id, ChatStreamEvent::Delta { text: text.to_owned() })?;
                }
            }
            _ => {}
        }

        if let Some(usage) = value.pointer("/response/usage") {
            emit_stream_event(
                window,
                stream_id,
                ChatStreamEvent::Usage {
                    input_tokens: usage.get("input_tokens").and_then(Value::as_u64),
                    output_tokens: usage.get("output_tokens").and_then(Value::as_u64),
                },
            )?;
        }
    }

    Ok(false)
}

fn process_gemini_sse_block(window: &tauri::Window, stream_id: &str, block: &str) -> crate::errors::Result<bool> {
    for line in block.lines() {
        let Some(raw_data) = line.strip_prefix("data:") else { continue };
        let data = raw_data.trim();
        if data.is_empty() {
            continue;
        }

        let value: Value = serde_json::from_str(data)
            .map_err(|err| KeySyncError::Provider(format!("failed to parse Gemini streaming SSE payload: {err}")))?;

        if let Some(parts) = value.pointer("/candidates/0/content/parts").and_then(Value::as_array) {
            for part in parts {
                if let Some(text) = part.get("text").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                    emit_stream_event(window, stream_id, ChatStreamEvent::Delta { text: text.to_owned() })?;
                }
            }
        }

        if let Some(usage) = value.get("usageMetadata") {
            emit_stream_event(
                window,
                stream_id,
                ChatStreamEvent::Usage {
                    input_tokens: usage.get("promptTokenCount").and_then(Value::as_u64),
                    output_tokens: usage.get("candidatesTokenCount").and_then(Value::as_u64),
                },
            )?;
        }

        if let Some(reason) = value.pointer("/candidates/0/finishReason") {
            if !reason.is_null() {
                emit_stream_event(window, stream_id, ChatStreamEvent::Done)?;
                return Ok(true);
            }
        }
    }

    Ok(false)
}

fn process_anthropic_sse_block(window: &tauri::Window, stream_id: &str, block: &str) -> crate::errors::Result<bool> {
    for line in block.lines() {
        let Some(raw_data) = line.strip_prefix("data:") else { continue };
        let data = raw_data.trim();
        if data.is_empty() {
            continue;
        }

        let value: Value = serde_json::from_str(data)
            .map_err(|err| KeySyncError::Provider(format!("failed to parse Anthropic streaming SSE payload: {err}")))?;

        match value.get("type").and_then(Value::as_str) {
            Some("content_block_delta") => {
                if let Some(text) = value.pointer("/delta/text").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                    emit_stream_event(window, stream_id, ChatStreamEvent::Delta { text: text.to_owned() })?;
                }
            }
            Some("message_delta") => {
                if let Some(usage) = value.get("usage") {
                    emit_stream_event(
                        window,
                        stream_id,
                        ChatStreamEvent::Usage {
                            input_tokens: usage.get("input_tokens").and_then(Value::as_u64),
                            output_tokens: usage.get("output_tokens").and_then(Value::as_u64),
                        },
                    )?;
                }
            }
            Some("message_stop") => {
                emit_stream_event(window, stream_id, ChatStreamEvent::Done)?;
                return Ok(true);
            }
            Some("error") => {
                let message = value.pointer("/error/message").and_then(Value::as_str).unwrap_or("Anthropic stream error");
                emit_stream_event(window, stream_id, ChatStreamEvent::Error { code: "anthropic_stream_error".into(), message: message.to_owned() })?;
                return Ok(true);
            }
            _ => {}
        }
    }

    Ok(false)
}

fn gemini_stream_url(config: &ProviderConfig, model_id: &str) -> String {
    let model_path = if model_id.starts_with("models/") {
        format!("/{model_id}:streamGenerateContent?alt=sse")
    } else {
        format!("/models/{model_id}:streamGenerateContent?alt=sse")
    };
    join_url(&config.base_url, Some(&model_path))
}

fn emit_stream_event(window: &tauri::Window, stream_id: &str, event: ChatStreamEvent) -> crate::errors::Result<()> {
    window
        .emit(CHAT_STREAM_EVENT, ChatStreamPayload { stream_id: stream_id.to_owned(), event })
        .map_err(|err| KeySyncError::Provider(format!("failed to emit chat stream event: {err}")))
}

fn active_streams() -> &'static Mutex<HashMap<String, AbortHandle>> {
    ACTIVE_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn insert_active_stream(stream_id: &str, abort_handle: AbortHandle) -> std::result::Result<(), ErrorPayload> {
    let mut streams = active_streams()
        .lock()
        .map_err(|_| ErrorPayload::from(KeySyncError::Provider("active stream registry is poisoned".into())))?;
    streams.insert(stream_id.to_owned(), abort_handle);
    Ok(())
}

fn remove_active_stream(stream_id: &str) -> crate::errors::Result<bool> {
    let mut streams = active_streams()
        .lock()
        .map_err(|_| KeySyncError::Provider("active stream registry is poisoned".into()))?;
    Ok(streams.remove(stream_id).is_some())
}

fn abort_active_stream(stream_id: &str) -> crate::errors::Result<bool> {
    let mut streams = active_streams()
        .lock()
        .map_err(|_| KeySyncError::Provider("active stream registry is poisoned".into()))?;
    let Some(abort_handle) = streams.remove(stream_id) else {
        return Ok(false);
    };
    abort_handle.abort();
    Ok(true)
}

fn is_stream_active(stream_id: &str) -> crate::errors::Result<bool> {
    let streams = active_streams()
        .lock()
        .map_err(|_| KeySyncError::Provider("active stream registry is poisoned".into()))?;
    Ok(streams.contains_key(stream_id))
}
