import { invoke } from "@tauri-apps/api/core";
import type {
  ChatStartResult,
  AppSettings,
  ConversationDetail,
  ConversationSummary,
  ModelInfo,
  ProviderConfig,
  ProviderTemplate,
  SaveConversationInput,
  SecretPayload,
  SecretRecordSummary,
  PlaintextBackup,
  SystemKeychainStatus,
  TestResult,
  UnifiedChatRequest,
  UpdateModelPreferencesInput,
  VaultSecurityProfile,
  VaultImportResult,
  WebDavConfig,
  WebDavConfigSummary,
  WebDavSyncResult,
} from "../types";
import { providerTemplates as fallbackTemplates } from "../data/providerTemplates";

export async function loadProviderTemplates(): Promise<ProviderTemplate[]> {
  try {
    return await invoke<ProviderTemplate[]>("list_provider_templates");
  } catch {
    return fallbackTemplates;
  }
}

export async function getAppStatus(): Promise<string> {
  try {
    const status = await invoke<{ name: string; phase: string }>("app_status");
    return `${status.name}: ${status.phase}`;
  } catch {
    return "KeySync AI: frontend preview mode";
  }
}

export async function runProviderTest(providerId: string): Promise<TestResult> {
  try {
    return await invoke<TestResult>("test_provider_placeholder", { providerId });
  } catch (error) {
    return {
      ok: false,
      providerId,
      message: error instanceof Error ? error.message : "Provider test command is not ready yet.",
    };
  }
}

export function templateToConfig(template: ProviderTemplate, proxyUrl?: string): ProviderConfig {
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    baseUrl: template.baseUrl,
    modelsPath: template.modelsPath,
    chatPath: template.chatPath,
    responsesPath: template.responsesPath,
    proxyUrl,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  return await invoke<AppSettings>("load_app_settings");
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  return await invoke<AppSettings>("save_app_settings", { settings });
}

export async function listModelsWithKey(config: ProviderConfig, apiKey: string): Promise<ModelInfo[]> {
  return await invoke<ModelInfo[]>("list_models_with_key", { config, apiKey });
}

export async function testProviderWithKey(config: ProviderConfig, apiKey: string, model?: string): Promise<TestResult> {
  return await invoke<TestResult>("test_provider_with_key", { config, apiKey, model: model || null });
}

export async function saveModelCache(providerId: string, models: ModelInfo[]): Promise<ModelInfo[]> {
  return await invoke<ModelInfo[]>("save_model_cache", { providerId, models });
}

export async function listCachedModels(providerId: string): Promise<ModelInfo[]> {
  return await invoke<ModelInfo[]>("list_cached_models", { providerId });
}

export async function updateModelPreferences(input: UpdateModelPreferencesInput): Promise<ModelInfo> {
  return await invoke<ModelInfo>("update_model_preferences", { input });
}

export async function startChatStreamWithKey(config: ProviderConfig, apiKey: string, request: UnifiedChatRequest, streamId?: string): Promise<ChatStartResult> {
  return await invoke<ChatStartResult>("start_chat_stream_with_key", { config, apiKey, request, streamId: streamId || null });
}

export async function stopChatStream(streamId: string): Promise<boolean> {
  return await invoke<boolean>("stop_chat_stream", { streamId });
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return await invoke<ConversationSummary[]>("list_conversations");
}

export async function loadConversation(conversationId: string): Promise<ConversationDetail> {
  return await invoke<ConversationDetail>("load_conversation", { conversationId });
}

export async function saveConversation(input: SaveConversationInput): Promise<ConversationDetail> {
  return await invoke<ConversationDetail>("save_conversation", { input });
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  return await invoke<boolean>("delete_conversation", { conversationId });
}

export async function getVaultSecurityProfile(): Promise<VaultSecurityProfile> {
  return await invoke<VaultSecurityProfile>("vault_security_profile");
}

export async function vaultSystemKeychainStatus(): Promise<SystemKeychainStatus> {
  return await invoke<SystemKeychainStatus>("vault_system_keychain_status");
}

export async function vaultInitSystemDataKey(): Promise<SystemKeychainStatus> {
  return await invoke<SystemKeychainStatus>("vault_init_system_data_key");
}

export async function vaultDeleteSystemDataKey(): Promise<SystemKeychainStatus> {
  return await invoke<SystemKeychainStatus>("vault_delete_system_data_key");
}

export async function vaultEncryptWithMasterPassword(plaintext: string, masterPassword: string): Promise<string> {
  return await invoke<string>("vault_encrypt_with_master_password", { plaintext, masterPassword });
}

export async function vaultDecryptWithMasterPassword(envelope: string, masterPassword: string): Promise<string> {
  return await invoke<string>("vault_decrypt_with_master_password", { envelope, masterPassword });
}

export async function vaultListSecretRecords(): Promise<SecretRecordSummary[]> {
  return await invoke<SecretRecordSummary[]>("vault_list_secret_records");
}

export async function vaultListConflictRecords(): Promise<SecretRecordSummary[]> {
  return await invoke<SecretRecordSummary[]>("vault_list_conflict_records");
}

export async function vaultSaveSecretWithMasterPassword(providerId: string, displayName: string, payload: SecretPayload, masterPassword: string): Promise<SecretRecordSummary> {
  return await invoke<SecretRecordSummary>("vault_save_secret_with_master_password", { providerId, displayName, payload, masterPassword });
}

export async function vaultDecryptSecretWithMasterPassword(recordId: string, masterPassword: string): Promise<SecretPayload> {
  return await invoke<SecretPayload>("vault_decrypt_secret_with_master_password", { recordId, masterPassword });
}

export async function vaultMigrateSecretToSystemKeychain(recordId: string, masterPassword: string): Promise<SecretRecordSummary> {
  return await invoke<SecretRecordSummary>("vault_migrate_secret_to_system_keychain", { recordId, masterPassword });
}

export async function vaultDeleteSecretRecord(recordId: string): Promise<boolean> {
  return await invoke<boolean>("vault_delete_secret_record", { recordId });
}

export async function vaultRenameSecretRecord(recordId: string, displayName: string): Promise<SecretRecordSummary> {
  return await invoke<SecretRecordSummary>("vault_rename_secret_record", { recordId, displayName });
}

export async function vaultExportEncryptedBackup(): Promise<string> {
  return await invoke<string>("vault_export_encrypted_backup");
}

export async function vaultImportEncryptedBackup(content: string): Promise<VaultImportResult> {
  return await invoke<VaultImportResult>("vault_import_encrypted_backup", { content });
}

export async function vaultExportPlaintextBackup(confirmation: string, masterPassword?: string): Promise<PlaintextBackup> {
  return await invoke<PlaintextBackup>("vault_export_plaintext_backup", { confirmation, masterPassword: masterPassword || null });
}

export async function vaultImportPlaintextBackup(content: string): Promise<VaultImportResult> {
  return await invoke<VaultImportResult>("vault_import_plaintext_backup", { content });
}

export async function webdavTestConnection(config: WebDavConfig): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_test_connection", { config });
}

export async function webdavUploadLocalVault(config: WebDavConfig): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_upload_local_vault", { config });
}

export async function webdavDownloadRemoteVault(config: WebDavConfig, overwrite: boolean): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_download_remote_vault", { config, overwrite });
}

export async function webdavSaveConfigWithMasterPassword(config: WebDavConfig, masterPassword: string): Promise<WebDavConfigSummary> {
  return await invoke<WebDavConfigSummary>("webdav_save_config_with_master_password", { config, masterPassword });
}

export async function webdavLoadSavedConfigSummary(): Promise<WebDavConfigSummary | null> {
  return await invoke<WebDavConfigSummary | null>("webdav_load_saved_config_summary");
}

export async function webdavUnlockSavedConfig(masterPassword: string): Promise<WebDavConfig> {
  return await invoke<WebDavConfig>("webdav_unlock_saved_config", { masterPassword });
}

export async function webdavTestSavedConnection(masterPassword: string): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_test_saved_connection", { masterPassword });
}

export async function webdavUploadLocalVaultWithSavedConfig(masterPassword: string): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_upload_local_vault_with_saved_config", { masterPassword });
}

export async function webdavDownloadRemoteVaultWithSavedConfig(masterPassword: string, overwrite: boolean): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_download_remote_vault_with_saved_config", { masterPassword, overwrite });
}

export async function webdavUploadSettingsWithSavedConfig(masterPassword: string): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_upload_settings_with_saved_config", { masterPassword });
}

export async function webdavDownloadSettingsWithSavedConfig(masterPassword: string): Promise<WebDavSyncResult> {
  return await invoke<WebDavSyncResult>("webdav_download_settings_with_saved_config", { masterPassword });
}
