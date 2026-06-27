use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::errors::{KeySyncError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfig {
    pub endpoint: String,
    pub username: String,
    pub password: String,
    pub remote_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncConflictPolicy {
    AutoMergeAndKeepConflictCopies,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnvelope<T> {
    pub version: u32,
    pub device_id: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub payload: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavSyncResult {
    pub ok: bool,
    pub operation: String,
    pub remote_url: String,
    pub bytes: usize,
    pub message: String,
}

pub struct WebDavSyncService {
    client: reqwest::Client,
}

impl WebDavSyncService {
    pub fn new() -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .map_err(|err| KeySyncError::Network(format!("failed to build WebDAV client: {err}")))?;
        Ok(Self { client })
    }

    pub fn remote_paths() -> Vec<&'static str> {
        vec!["/KeySyncAI/vault.sync.json.enc", "/KeySyncAI/settings.sync.json.enc", "/KeySyncAI/history.sync.json.enc"]
    }

    pub async fn test_connection(&self, config: &WebDavConfig) -> Result<WebDavSyncResult> {
        let url = remote_dir_url(config);
        let method = Method::from_bytes(b"PROPFIND")
            .map_err(|err| KeySyncError::Sync(format!("failed to build PROPFIND method: {err}")))?;
        let response = self
            .client
            .request(method, &url)
            .basic_auth(&config.username, Some(&config.password))
            .header("Depth", "0")
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("WebDAV connection test failed: {err}")))?;

        if !response.status().is_success() && response.status().as_u16() != 207 {
            return Err(webdav_error(response, "connection test").await);
        }

        Ok(WebDavSyncResult {
            ok: true,
            operation: "test_connection".into(),
            remote_url: url,
            bytes: 0,
            message: "WebDAV connection succeeded".into(),
        })
    }

    pub async fn upload_vault(&self, config: &WebDavConfig, content: Vec<u8>) -> Result<WebDavSyncResult> {
        let dir_url = remote_dir_url(config);
        self.ensure_remote_dir(config, &dir_url).await?;
        let url = remote_file_url(config, "vault.sync.json.enc");
        let bytes = content.len();
        let response = self
            .client
            .put(&url)
            .basic_auth(&config.username, Some(&config.password))
            .body(content)
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("WebDAV upload failed: {err}")))?;

        if !response.status().is_success() {
            return Err(webdav_error(response, "vault upload").await);
        }

        Ok(WebDavSyncResult {
            ok: true,
            operation: "upload_vault".into(),
            remote_url: url,
            bytes,
            message: "Encrypted vault uploaded".into(),
        })
    }

    pub async fn download_vault(&self, config: &WebDavConfig) -> Result<(WebDavSyncResult, Vec<u8>)> {
        let url = remote_file_url(config, "vault.sync.json.enc");
        let response = self
            .client
            .get(&url)
            .basic_auth(&config.username, Some(&config.password))
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("WebDAV download failed: {err}")))?;

        if !response.status().is_success() {
            return Err(webdav_error(response, "vault download").await);
        }

        let content = response
            .bytes()
            .await
            .map_err(|err| KeySyncError::Network(format!("failed to read WebDAV download body: {err}")))?
            .to_vec();

        Ok((WebDavSyncResult {
            ok: true,
            operation: "download_vault".into(),
            remote_url: url,
            bytes: content.len(),
            message: "Encrypted vault downloaded".into(),
        }, content))
    }

    async fn ensure_remote_dir(&self, config: &WebDavConfig, dir_url: &str) -> Result<()> {
        let response = self
            .client
            .request(Method::from_bytes(b"MKCOL").map_err(|err| KeySyncError::Sync(format!("failed to build MKCOL method: {err}")))?, dir_url)
            .basic_auth(&config.username, Some(&config.password))
            .send()
            .await
            .map_err(|err| KeySyncError::Network(format!("WebDAV MKCOL failed: {err}")))?;

        let status = response.status().as_u16();
        if response.status().is_success() || status == 405 || status == 409 {
            return Ok(());
        }

        Err(webdav_error(response, "ensure remote directory").await)
    }
}

fn remote_dir_url(config: &WebDavConfig) -> String {
    let endpoint = config.endpoint.trim_end_matches('/');
    let remote_dir = config.remote_dir.trim_matches('/');
    if remote_dir.is_empty() {
        format!("{endpoint}/")
    } else {
        format!("{endpoint}/{remote_dir}/")
    }
}

fn remote_file_url(config: &WebDavConfig, filename: &str) -> String {
    format!("{}{}", remote_dir_url(config), filename)
}

async fn webdav_error(response: reqwest::Response, operation: &str) -> KeySyncError {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let body = body.chars().take(700).collect::<String>();
    KeySyncError::Sync(format!("{operation} failed with HTTP {status}: {body}"))
}
