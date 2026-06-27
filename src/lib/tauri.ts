import { invoke } from "@tauri-apps/api/core";
import type {
  ChatStartResult,
  ModelInfo,
  ProviderConfig,
  ProviderTemplate,
  SecretPayload,
  SecretRecordSummary,
  TestResult,
  UnifiedChatRequest,
  VaultSecurityProfile,
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

export function templateToConfig(template: ProviderTemplate): ProviderConfig {
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    baseUrl: template.baseUrl,
    modelsPath: template.modelsPath,
    chatPath: template.chatPath,
    responsesPath: template.responsesPath,
  };
}

export async function listModelsWithKey(config: ProviderConfig, apiKey: string): Promise<ModelInfo[]> {
  return await invoke<ModelInfo[]>("list_models_with_key", { config, apiKey });
}

export async function testProviderWithKey(config: ProviderConfig, apiKey: string, model?: string): Promise<TestResult> {
  return await invoke<TestResult>("test_provider_with_key", { config, apiKey, model: model || null });
}

export async function startChatStreamWithKey(config: ProviderConfig, apiKey: string, request: UnifiedChatRequest): Promise<ChatStartResult> {
  return await invoke<ChatStartResult>("start_chat_stream_with_key", { config, apiKey, request });
}

export async function stopChatStream(streamId: string): Promise<boolean> {
  return await invoke<boolean>("stop_chat_stream", { streamId });
}

export async function getVaultSecurityProfile(): Promise<VaultSecurityProfile> {
  return await invoke<VaultSecurityProfile>("vault_security_profile");
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

export async function vaultSaveSecretWithMasterPassword(providerId: string, displayName: string, payload: SecretPayload, masterPassword: string): Promise<SecretRecordSummary> {
  return await invoke<SecretRecordSummary>("vault_save_secret_with_master_password", { providerId, displayName, payload, masterPassword });
}

export async function vaultDecryptSecretWithMasterPassword(recordId: string, masterPassword: string): Promise<SecretPayload> {
  return await invoke<SecretPayload>("vault_decrypt_secret_with_master_password", { recordId, masterPassword });
}

export async function vaultDeleteSecretRecord(recordId: string): Promise<boolean> {
  return await invoke<boolean>("vault_delete_secret_record", { recordId });
}
