pub mod anthropic;
pub mod gemini;
pub mod openai;
pub mod openai_compatible;
pub mod openai_responses;
pub mod types;

pub use types::*;

pub fn default_provider_templates() -> Vec<ProviderTemplate> {
    vec![
        ProviderTemplate::new("openai", "OpenAI", ProviderKind::OpenAiChat, "https://api.openai.com/v1", Some("/models"), Some("/chat/completions"), Some("/responses"), true, true, false),
        ProviderTemplate::new("openai-responses", "OpenAI Responses", ProviderKind::OpenAiResponses, "https://api.openai.com/v1", Some("/models"), None, Some("/responses"), true, true, false),
        ProviderTemplate::new("gemini", "Google Gemini", ProviderKind::GoogleGemini, "https://generativelanguage.googleapis.com/v1beta", Some("/models"), None, None, true, true, false),
        ProviderTemplate::new("anthropic", "Anthropic Claude", ProviderKind::AnthropicClaude, "https://api.anthropic.com/v1", Some("/models"), Some("/messages"), None, true, true, false),
        ProviderTemplate::new("openai-compatible", "Custom OpenAI Compatible", ProviderKind::OpenAiCompatible, "https://example.com/v1", Some("/models"), Some("/chat/completions"), None, true, false, true),
    ]
}
