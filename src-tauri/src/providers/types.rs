use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProviderKind {
    #[serde(rename = "openai_chat")]
    OpenAiChat,
    #[serde(rename = "openai_responses")]
    OpenAiResponses,
    #[serde(rename = "openai_compatible")]
    OpenAiCompatible,
    #[serde(rename = "google_gemini")]
    GoogleGemini,
    #[serde(rename = "anthropic_claude")]
    AnthropicClaude,
    #[serde(rename = "custom")]
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTemplate {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub models_path: Option<String>,
    pub chat_path: Option<String>,
    pub responses_path: Option<String>,
    pub supports_streaming: bool,
    pub supports_images: bool,
    pub editable: bool,
}

impl ProviderTemplate {
    #[allow(clippy::too_many_arguments)]
    pub fn new(id: &str, name: &str, kind: ProviderKind, base_url: &str, models_path: Option<&str>, chat_path: Option<&str>, responses_path: Option<&str>, supports_streaming: bool, supports_images: bool, editable: bool) -> Self {
        Self {
            id: id.to_owned(),
            name: name.to_owned(),
            kind,
            base_url: base_url.to_owned(),
            models_path: models_path.map(str::to_owned),
            chat_path: chat_path.map(str::to_owned),
            responses_path: responses_path.map(str::to_owned),
            supports_streaming,
            supports_images,
            editable,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub models_path: Option<String>,
    pub chat_path: Option<String>,
    pub responses_path: Option<String>,
    pub proxy_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub provider_id: String,
    pub capabilities: Vec<String>,
    pub context_window: Option<u64>,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub provider_id: String,
    pub model_count: Option<usize>,
    pub selected_model: Option<String>,
    pub latency_ms: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedMessage {
    pub role: String,
    pub content: String,
    pub images: Vec<ImageAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachment {
    pub media_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedChatRequest {
    pub model: String,
    pub system_prompt: Option<String>,
    pub messages: Vec<UnifiedMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStreamEvent {
    Start,
    Delta { text: String },
    Usage { input_tokens: Option<u64>, output_tokens: Option<u64> },
    Done,
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamPayload {
    pub stream_id: String,
    pub event: ChatStreamEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStartResult {
    pub stream_id: String,
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn kind(&self) -> ProviderKind;
    async fn list_models(&self, config: &ProviderConfig, api_key: &str) -> crate::errors::Result<Vec<ModelInfo>>;
    async fn test_key(&self, config: &ProviderConfig, api_key: &str, model: Option<&str>) -> crate::errors::Result<TestResult>;
    async fn chat_stream(&self, config: &ProviderConfig, api_key: &str, request: UnifiedChatRequest) -> crate::errors::Result<Vec<ChatStreamEvent>>;
}
