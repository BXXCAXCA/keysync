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

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  modelsPath?: string;
  chatPath?: string;
  responsesPath?: string;
  proxyId?: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  providerId: string;
  capabilities: string[];
  contextWindow?: number;
  isFavorite: boolean;
  isHidden: boolean;
  alias?: string;
}

export interface TestResult {
  ok: boolean;
  providerId: string;
  modelCount?: number;
  selectedModel?: string;
  latencyMs?: number;
  message: string;
}

export interface VaultSecurityProfile {
  defaultMode: string;
  optionalMode: string;
  plaintextRevealPolicy: string;
  syncFilePolicy: string;
  envelopeAlgorithm: string;
  kdfAlgorithm: string;
  systemKeychainStatus: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
