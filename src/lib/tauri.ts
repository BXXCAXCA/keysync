import { invoke } from "@tauri-apps/api/core";
import type { ProviderTemplate, TestResult } from "../types";
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
