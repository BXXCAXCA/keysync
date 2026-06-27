import { invoke } from "@tauri-apps/api/core";
import type { ModelInfo, ProviderConfig, ProviderTemplate, TestResult } from "../types";
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
