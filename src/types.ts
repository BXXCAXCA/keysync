export type ProviderKind =
  | "openai_chat"
  | "openai_responses"
  | "openai_compatible"
  | "google_gemini"
  | "anthropic_claude"
  | "custom";

export interface ProviderTemplate {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  modelsPath?: string;
  chatPath?: string;
  responsesPath?: string;
  supportsStreaming: boolean;
  supportsImages: boolean;
  editable: boolean;
}

export interface TestResult {
  ok: boolean;
  providerId: string;
  modelCount?: number;
  selectedModel?: string;
  latencyMs?: number;
  message: string;
}
