use crate::errors::{KeySyncError, Result};

pub fn join_url(base_url: &str, path: Option<&str>) -> String {
    let base = base_url.trim_end_matches('/');
    let path = path.unwrap_or("").trim();
    if path.is_empty() {
        base.to_owned()
    } else if path.starts_with('/') {
        format!("{base}{path}")
    } else {
        format!("{base}/{path}")
    }
}

pub async fn parse_error_response(response: reqwest::Response, operation: &str) -> KeySyncError {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let body = redact_sensitive_text(&body);
    let body = body.chars().take(700).collect::<String>();
    KeySyncError::Provider(format!("{operation} failed with HTTP {status}: {body}"))
}

pub fn redact_sensitive_text(input: &str) -> String {
    input
        .replace("Bearer ", "Bearer [redacted] ")
        .replace("api_key", "api_key_redacted")
        .replace("apikey", "apikey_redacted")
}

pub fn build_client(proxy_url: Option<&str>) -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(45));
    if let Some(proxy_url) = proxy_url.filter(|value| !value.trim().is_empty()) {
        let proxy = reqwest::Proxy::all(proxy_url)
            .map_err(|err| KeySyncError::Network(format!("invalid proxy URL: {err}")))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|err| KeySyncError::Network(format!("failed to build HTTP client: {err}")))
}
