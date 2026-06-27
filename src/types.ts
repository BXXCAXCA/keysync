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

export interface UnifiedMessage {
  role: "system" | "user" | "assistant" | string;
  content: string;
  images: Array<{ mediaType: string; dataBase64: string }>;
}

export interface UnifiedChatRequest {
  model: string;
  systemPrompt?: string;
  messages: UnifiedMessage[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
}

export type ChatStreamEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "done" }
  | { type: "error"; code: string; message: string };

export interface ChatStreamPayload {
  streamId: string;
  event: ChatStreamEvent;
}

export interface ChatStartResult {
  streamId: string;
}

export interface SecretPayload {
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  customHeaders: Array<[string, string]>;
}

export interface SecretRecordSummary {
  id: string;
  providerId: string;
  displayName: string;
  updatedAt: string;
}

export interface VaultSecurityProfile {
  defaultMode: string;
  optionalMode: string;
  plaintextRevealPolicy: string;
  syncFilePolicy: string;
  envelopeAlgorithm: string;
  kdfAlgorithm: string;
  systemKeychainStatus: string;
  localVaultFile: string;
}

export interface SystemKeychainStatus {
  available: boolean;
  hasDataKey: boolean;
  service: string;
  account: string;
  message: string;
}

export interface WebDavConfig {
  endpoint: string;
  username: string;
  password: string;
  remoteDir: string;
}

export interface WebDavConfigSummary {
  endpoint: string;
  username: string;
  remoteDir: string;
  hasPassword: boolean;
  updatedAt: string;
}

export interface WebDavSyncResult {
  ok: boolean;
  operation: string;
  remoteUrl: string;
  bytes: number;
  message: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
