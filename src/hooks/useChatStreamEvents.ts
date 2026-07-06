import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ChatStreamPayload, TestResult } from "../types";
import type { ChatMessage } from "../lib/chat";
import { appendAssistantDelta } from "../lib/chat";

export type UpdateChatMessages = (updater: (messages: ChatMessage[]) => ChatMessage[]) => void;

export interface UseChatStreamEventsArgs {
  activeStreamIdRef: MutableRefObject<string | null>;
  activeProviderIdRef: MutableRefObject<string>;
  chatMessagesRef: MutableRefObject<ChatMessage[]>;
  updateChatMessages: UpdateChatMessages;
  persistCurrentConversation: (messages: ChatMessage[]) => void | Promise<void>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setCurrentStreamId: Dispatch<SetStateAction<string | null>>;
  setTestResult: Dispatch<SetStateAction<TestResult | null>>;
}

export function useChatStreamEvents(args: UseChatStreamEventsArgs) {
  const argsRef = useRef(args);

  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<ChatStreamPayload>("chat-stream-event", (event) => {
      const {
        activeStreamIdRef,
        activeProviderIdRef,
        chatMessagesRef,
        updateChatMessages,
        persistCurrentConversation,
        setBusy,
        setCurrentStreamId,
        setTestResult,
      } = argsRef.current;
      const payload = event.payload;

      if (payload.streamId !== activeStreamIdRef.current) return;

      if (payload.event.type === "start") {
        setBusy(true);
        return;
      }

      if (payload.event.type === "delta") {
        updateChatMessages((messages) => appendAssistantDelta(messages, payload.event.text));
        return;
      }

      if (payload.event.type === "usage") {
        setTestResult((current) => ({
          ok: true,
          providerId: current?.providerId ?? activeProviderIdRef.current,
          message: `Usage: input ${payload.event.inputTokens ?? "?"}, output ${payload.event.outputTokens ?? "?"}`,
        }));
        return;
      }

      if (payload.event.type === "error") {
        updateChatMessages((messages) => [
          ...messages,
          { role: "assistant", content: `Stream error: ${payload.event.message}` },
        ]);
        setBusy(false);
        activeStreamIdRef.current = null;
        setCurrentStreamId(null);
        void persistCurrentConversation(chatMessagesRef.current);
        return;
      }

      if (payload.event.type === "done") {
        setBusy(false);
        activeStreamIdRef.current = null;
        setCurrentStreamId(null);
        void persistCurrentConversation(chatMessagesRef.current);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
