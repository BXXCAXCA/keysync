use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    System,
    Disabled,
    Global,
    ProviderSpecific,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub password_secret_id: Option<String>,
}

pub fn resolve_proxy(
    provider_proxy: Option<ProxyConfig>,
    global_proxy: Option<ProxyConfig>,
) -> Option<ProxyConfig> {
    provider_proxy.or(global_proxy)
}
