import { useCallback, useEffect, useState } from "react";

import type { ConversationDetail, ConversationSummary } from "../types";
import type { ChatMessage } from "../lib/chat";
import {
  initialMessages,
  normalizeChatRole,
  parseFiniteNumber,
  parsePositiveInt,
  titleFromMessages,
} from "../lib/chat";
import {
  deleteConversation,
  listConversations,
  loadConversation,
  saveConversation,
} from "../lib/tauri";

export interface SaveCurrentConversationInput {
  id?: string | null;
  providerId: string;
  modelId: string;
  messages: ChatMessage[];
  temperature: string;
  maxTokens: string;
  contextLength: string;
}

export interface LoadedConversationState {
  detail: ConversationDetail;
  messages: ChatMessage[];
  temperature: string;
  maxTokens: string;
  contextLength: string;
}

function persistableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role !== "system")
    .filter((message) => !(message.role === "assistant" && message.content === initialMessages[1].content))
    .filter((message) => message.content.trim() || (message.images?.length ?? 0) > 0);
}

function messagesWithSystemPrompt(detail: ConversationDetail): ChatMessage[] {
  return [
    { role: "system", content: detail.summary.systemPrompt ?? initialMessages[0].content },
    ...detail.messages.map((message) => ({
      role: normalizeChatRole(message.role),
      content: message.content,
      images: message.attachments,
    })),
  ];
}

export function useConversations() {
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  const reloadConversations = useCallback(async () => {
    try {
      setConversationSummaries(await listConversations());
    } catch {
      setConversationSummaries([]);
    }
  }, []);

  useEffect(() => {
    void reloadConversations();
  }, [reloadConversations]);

  const saveCurrentConversation = useCallback(async (input: SaveCurrentConversationInput) => {
    if (!input.modelId) return null;

    const persistedMessages = persistableMessages(input.messages);
    if (!persistedMessages.some((message) => message.role === "user")) return null;

    const systemPrompt = input.messages.find((message) => message.role === "system")?.content;
    const detail = await saveConversation({
      id: input.id ?? undefined,
      title: titleFromMessages(persistedMessages),
      providerId: input.providerId,
      modelId: input.modelId,
      systemPrompt,
      params: {
        temperature: parseFiniteNumber(input.temperature, 0.7),
        maxTokens: parsePositiveInt(input.maxTokens, 512),
        contextLength: parsePositiveInt(input.contextLength, 8192),
      },
      messages: persistedMessages.map((message) => ({
        role: message.role,
        content: message.content,
        attachments: message.images ?? [],
      })),
    });

    setCurrentConversationId(detail.summary.id);
    await reloadConversations();
    return detail;
  }, [reloadConversations]);

  const loadExistingConversation = useCallback(async (conversationId: string): Promise<LoadedConversationState> => {
    const detail = await loadConversation(conversationId);
    const params = detail.summary.params;
    const messages = messagesWithSystemPrompt(detail);

    setCurrentConversationId(detail.summary.id);
    return {
      detail,
      messages: messages.length > 1 ? messages : initialMessages,
      temperature: String(typeof params.temperature === "number" ? params.temperature : 0.7),
      maxTokens: String(typeof params.maxTokens === "number" ? params.maxTokens : 512),
      contextLength: String(typeof params.contextLength === "number" ? params.contextLength : 8192),
    };
  }, []);

  const deleteExistingConversation = useCallback(async (conversationId: string) => {
    const deleted = await deleteConversation(conversationId);
    setCurrentConversationId((current) => (current === conversationId ? null : current));
    await reloadConversations();
    return deleted;
  }, [reloadConversations]);

  const resetCurrentConversation = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

  return {
    conversationSummaries,
    currentConversationId,
    setCurrentConversationId,
    reloadConversations,
    saveCurrentConversation,
    loadExistingConversation,
    deleteExistingConversation,
    resetCurrentConversation,
  };
}
