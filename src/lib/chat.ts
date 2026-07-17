import type { ImageAttachment, UnifiedMessage } from "../types";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  images?: ImageAttachment[];
};

export const initialMessages: ChatMessage[] = [
  { role: "system", content: "System prompt, temperature, context length, and model settings will be configured here." },
  { role: "assistant", content: "Save a provider credential, select a model, then send a message to test streaming chat." },
];

export function normalizeChatRole(role: string): ChatRole {
  if (role === "system" || role === "user" || role === "assistant") return role;
  return "assistant";
}

export function appendAssistantDelta(messages: ChatMessage[], delta: string): ChatMessage[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === "assistant") {
      next[index] = { ...next[index], content: `${next[index].content}${delta}` };
      return next;
    }
  }
  return [...next, { role: "assistant", content: delta }];
}

export function createClientId(prefix = "id"): string {
  const cryptoWithUuid = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  return cryptoWithUuid?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseFiniteNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function estimateMessageBudget(message: UnifiedMessage): number {
  return message.content.length + message.images.length * 1024 + 32;
}

export function buildContextMessages(messages: ChatMessage[], nextMessage: UnifiedMessage, contextLength: number): UnifiedMessage[] {
  const budget = Math.max(256, contextLength) * 4;
  const history = messages
    .filter((message) => message.role !== "system")
    .map<UnifiedMessage>((message) => ({
      role: message.role,
      content: message.content,
      images: message.images ?? [],
    }));
  const combined = [...history, nextMessage];
  const selected: UnifiedMessage[] = [];
  let used = 0;

  for (let index = combined.length - 1; index >= 0; index -= 1) {
    const message = combined[index];
    const estimated = estimateMessageBudget(message);
    if (selected.length > 0 && used + estimated > budget) break;
    selected.unshift(message);
    used += estimated;
  }

  return selected;
}

export function titleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  return (firstUser?.content ?? "New conversation").replace(/\s+/g, " ").slice(0, 64);
}
