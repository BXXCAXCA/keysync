import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, MessageSquareText, RefreshCw, Server, ShieldCheck, UploadCloud } from "lucide-react";
import type { ChatStreamPayload, ConversationSummary, ModelInfo, ProviderTemplate, SecretRecordSummary, SystemKeychainStatus, TestResult, UnifiedMessage, WebDavConfig, WebDavConfigSummary } from "./types";
import {
  deleteConversation,
  getAppStatus,
  listConversations,
  listModelsWithKey,
  loadConversation,
  loadProviderTemplates,
  saveConversation,
  startChatStreamWithKey,
  stopChatStream,
  templateToConfig,
  testProviderWithKey,
  vaultDecryptSecretWithMasterPassword,
  vaultDeleteSecretRecord,
  vaultDeleteSystemDataKey,
  vaultInitSystemDataKey,
  vaultListConflictRecords,
  vaultListSecretRecords,
  vaultRenameSecretRecord,
  vaultSaveSecretWithMasterPassword,
  vaultSystemKeychainStatus,
  webdavDownloadRemoteVault,
  webdavDownloadRemoteVaultWithSavedConfig,
  webdavLoadSavedConfigSummary,
  webdavSaveConfigWithMasterPassword,
  webdavTestConnection,
  webdavTestSavedConnection,
  webdavUnlockSavedConfig,
  webdavUploadLocalVault,
  webdavUploadLocalVaultWithSavedConfig,
} from "./lib/tauri";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type PendingImage = { name: string; mediaType: string; dataBase64: string };
type StoredCredentialPayload = { apiKey: string; customHeaders: Array<[string, string]> };

const initialMessages: ChatMessage[] = [
  { role: "system", content: "System prompt, temperature, context length, and model settings will be configured here." },
  { role: "assistant", content: "Save a provider credential, select a model, then send a message to test streaming chat." },
];

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unknown error";
}

function appendAssistantDelta(messages: ChatMessage[], delta: string): ChatMessage[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === "assistant") {
      next[index] = { ...next[index], content: `${next[index].content}${delta}` };
      return next;
    }
  }
  return [...next, { role: "assistant", content: delta }];
}

function createStreamId(): string {
  const cryptoWithUuid = crypto as Crypto & { randomUUID?: () => string };
  return cryptoWithUuid.randomUUID?.() ?? `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseFiniteNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function estimateMessageBudget(message: UnifiedMessage): number {
  return message.content.length + message.images.length * 1024 + 32;
}

function buildContextMessages(messages: ChatMessage[], nextMessage: UnifiedMessage, contextLength: number): UnifiedMessage[] {
  const budget = Math.max(256, contextLength) * 4;
  const history = messages
    .filter((message) => message.role !== "system")
    .map<UnifiedMessage>((message) => ({ role: message.role, content: message.content, images: [] }));
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

function titleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  return (firstUser?.content ?? "New conversation").replace(/\s+/g, " ").slice(0, 64);
}

function readImageFile(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const [, dataBase64 = ""] = dataUrl.split(",");
      resolve({
        name: file.name,
        mediaType: file.type || "application/octet-stream",
        dataBase64,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function saveCredentialWithSystemKeychain(providerId: string, displayName: string, payload: StoredCredentialPayload): Promise<SecretRecordSummary> {
  return await invoke<SecretRecordSummary>("vault_save_secret_with_system_keychain", { providerId, displayName, payload });
}

async function unlockCredentialWithSystemKeychain(recordId: string): Promise<StoredCredentialPayload> {
  return await invoke<StoredCredentialPayload>("vault_decrypt_secret_with_system_keychain", { recordId });
}

export default function App() {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("openai");
  const [status, setStatus] = useState("Loading...");
  const [apiKey, setApiKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [savedSecrets, setSavedSecrets] = useState<SecretRecordSummary[]>([]);
  const [conflictRecords, setConflictRecords] = useState<SecretRecordSummary[]>([]);
  const [conflictRename, setConflictRename] = useState<Record<string, string>>({});
  const [selectedSecretId, setSelectedSecretId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentStreamId, setCurrentStreamId] = useState<string | null>(null);
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("512");
  const [contextLength, setContextLength] = useState("8192");
  const [webdavConfig, setWebdavConfig] = useState<WebDavConfig>({ endpoint: "", username: "", password: "", remoteDir: "KeySyncAI" });
  const [savedWebdavSummary, setSavedWebdavSummary] = useState<WebDavConfigSummary | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [keychainStatus, setKeychainStatus] = useState<SystemKeychainStatus | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>(initialMessages);
  const currentConversationIdRef = useRef<string | null>(null);
  const activeProviderIdRef = useRef(activeProviderId);
  const selectedModelRef = useRef(selectedModel);
  const temperatureRef = useRef(temperature);
  const maxTokensRef = useRef(maxTokens);
  const contextLengthRef = useRef(contextLength);

  function updateChatMessages(updater: (messages: ChatMessage[]) => ChatMessage[]) {
    const next = updater(chatMessagesRef.current);
    chatMessagesRef.current = next;
    setChatMessages(next);
  }

  useEffect(() => {
    activeProviderIdRef.current = activeProviderId;
    selectedModelRef.current = selectedModel;
    temperatureRef.current = temperature;
    maxTokensRef.current = maxTokens;
    contextLengthRef.current = contextLength;
    currentConversationIdRef.current = currentConversationId;
  });

  useEffect(() => {
    loadProviderTemplates().then(setTemplates);
    getAppStatus().then(setStatus);
    reloadVaultRecords();
    reloadConversations();
    reloadSavedWebDavSummary();
    reloadSystemKeychainStatus();
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<ChatStreamPayload>("chat-stream-event", (event) => {
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
        updateChatMessages((messages) => [...messages, { role: "assistant", content: `Stream error: ${payload.event.message}` }]);
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

  const activeProvider = useMemo(
    () => templates.find((provider) => provider.id === activeProviderId) ?? templates[0],
    [templates, activeProviderId]
  );

  const providerSecrets = useMemo(
    () => savedSecrets.filter((secret) => secret.providerId === activeProviderId),
    [savedSecrets, activeProviderId]
  );

  useEffect(() => {
    setModels([]);
    setTestResult(null);
    if (!currentConversationIdRef.current) {
      setSelectedModel("");
    }
    setSelectedSecretId("");
  }, [activeProviderId]);

  async function reloadConversations() {
    try {
      setConversationSummaries(await listConversations());
    } catch {
      setConversationSummaries([]);
    }
  }

  async function persistCurrentConversation(messages: ChatMessage[] = chatMessagesRef.current) {
    if (!selectedModelRef.current) return;
    const persistedMessages = messages
      .filter((message) => message.role !== "system")
      .filter((message) => !(message.role === "assistant" && message.content === initialMessages[1].content))
      .filter((message) => message.content.trim());
    if (!persistedMessages.some((message) => message.role === "user")) return;

    const systemPrompt = messages.find((message) => message.role === "system")?.content;
    try {
      const detail = await saveConversation({
        id: currentConversationIdRef.current ?? undefined,
        title: titleFromMessages(persistedMessages),
        providerId: activeProviderIdRef.current,
        modelId: selectedModelRef.current,
        systemPrompt,
        params: {
          temperature: parseFiniteNumber(temperatureRef.current, 0.7),
          maxTokens: parsePositiveInt(maxTokensRef.current, 512),
          contextLength: parsePositiveInt(contextLengthRef.current, 8192),
        },
        messages: persistedMessages.map((message) => ({
          role: message.role,
          content: message.content,
          attachments: [],
        })),
      });
      currentConversationIdRef.current = detail.summary.id;
      setCurrentConversationId(detail.summary.id);
      await reloadConversations();
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProviderIdRef.current, message: `Conversation save failed: ${errorMessage(error)}` });
    }
  }

  function handleNewConversation() {
    activeStreamIdRef.current = null;
    currentConversationIdRef.current = null;
    setCurrentConversationId(null);
    updateChatMessages(() => initialMessages);
    setChatInput("");
    setPendingImages([]);
    setTestResult(null);
  }

  async function handleLoadConversation(conversationId: string) {
    try {
      const detail = await loadConversation(conversationId);
      currentConversationIdRef.current = detail.summary.id;
      setCurrentConversationId(detail.summary.id);
      setActiveProviderId(detail.summary.providerId);
      setTimeout(() => setSelectedModel(detail.summary.modelId), 0);
      const params = detail.summary.params;
      setTemperature(String(typeof params.temperature === "number" ? params.temperature : 0.7));
      setMaxTokens(String(typeof params.maxTokens === "number" ? params.maxTokens : 512));
      setContextLength(String(typeof params.contextLength === "number" ? params.contextLength : 8192));
      const loadedMessages: ChatMessage[] = [
        { role: "system", content: detail.summary.systemPrompt ?? initialMessages[0].content },
        ...detail.messages.map((message) => ({ role: message.role as ChatMessage["role"], content: message.content })),
      ];
      updateChatMessages(() => loadedMessages.length > 1 ? loadedMessages : initialMessages);
      setChatInput("");
      setPendingImages([]);
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProviderIdRef.current, message: errorMessage(error) });
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    try {
      await deleteConversation(conversationId);
      if (currentConversationIdRef.current === conversationId) {
        handleNewConversation();
      }
      await reloadConversations();
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProviderIdRef.current, message: errorMessage(error) });
    }
  }

  async function reloadVaultRecords() {
    try {
      const [records, conflicts] = await Promise.all([vaultListSecretRecords(), vaultListConflictRecords()]);
      setSavedSecrets(records);
      setConflictRecords(conflicts);
    } catch {
      setSavedSecrets([]);
      setConflictRecords([]);
    }
  }

  async function reloadSystemKeychainStatus() {
    try {
      setKeychainStatus(await vaultSystemKeychainStatus());
    } catch (error) {
      setKeychainStatus({ available: false, hasDataKey: false, service: "app.keysync.ai", account: "vault-data-key", message: errorMessage(error) });
    }
  }

  async function handleInitSystemKeychain() {
    setBusy(true);
    try {
      setKeychainStatus(await vaultInitSystemDataKey());
    } catch (error) {
      setKeychainStatus({ available: false, hasDataKey: false, service: "app.keysync.ai", account: "vault-data-key", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSystemKeychain() {
    setBusy(true);
    try {
      setKeychainStatus(await vaultDeleteSystemDataKey());
    } catch (error) {
      setKeychainStatus({ available: false, hasDataKey: false, service: "app.keysync.ai", account: "vault-data-key", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function reloadSavedWebDavSummary() {
    try {
      const summary = await webdavLoadSavedConfigSummary();
      setSavedWebdavSummary(summary);
      if (summary) {
        setWebdavConfig((current) => ({
          ...current,
          endpoint: summary.endpoint,
          username: summary.username,
          remoteDir: summary.remoteDir,
          password: "",
        }));
      }
    } catch {
      setSavedWebdavSummary(null);
    }
  }

  async function handleListModelsWithRawKey() {
    if (!activeProvider || !apiKey.trim()) return;
    await listModelsUsingKey(apiKey.trim());
  }

  async function handleTestProviderWithRawKey() {
    if (!activeProvider || !apiKey.trim()) return;
    await testProviderUsingKey(apiKey.trim());
  }

  async function handleSaveKey() {
    if (!activeProvider || !apiKey.trim()) return;
    setBusy(true);
    setTestResult(null);
    try {
      const displayName = keyName.trim() || `${activeProvider.name} key`;
      const record = await saveCredentialWithSystemKeychain(activeProvider.id, displayName, {
        apiKey: apiKey.trim(),
        customHeaders: [],
      });
      await reloadVaultRecords();
      await reloadSystemKeychainStatus();
      setSelectedSecretId(record.id);
      setKeyName("");
      setApiKey("");
      setTestResult({ ok: true, providerId: activeProvider.id, message: `Saved with system keychain: ${record.displayName}` });
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveKeyWithMasterPassword() {
    if (!activeProvider || !apiKey.trim() || !masterPassword) return;
    setBusy(true);
    setTestResult(null);
    try {
      const displayName = keyName.trim() || `${activeProvider.name} key`;
      const record = await vaultSaveSecretWithMasterPassword(activeProvider.id, displayName, {
        apiKey: apiKey.trim(),
        customHeaders: [],
      }, masterPassword);
      await reloadVaultRecords();
      setSelectedSecretId(record.id);
      setKeyName("");
      setApiKey("");
      setTestResult({ ok: true, providerId: activeProvider.id, message: `Saved with master password: ${record.displayName}` });
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSavedKey() {
    if (!selectedSecretId) return;
    await deleteRecord(selectedSecretId, "Deleted saved key.");
    setSelectedSecretId("");
  }

  async function deleteRecord(recordId: string, message: string) {
    setBusy(true);
    try {
      await vaultDeleteSecretRecord(recordId);
      await reloadVaultRecords();
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message } : null);
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptConflict(record: SecretRecordSummary) {
    const proposed = conflictRename[record.id]?.trim() || record.displayName.replace(" [conflict remote]", "");
    setBusy(true);
    try {
      await vaultRenameSecretRecord(record.id, proposed);
      await reloadVaultRecords();
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message: `Kept conflict copy as ${proposed}.` } : null);
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    } finally {
      setBusy(false);
    }
  }

  async function handleListModelsWithSavedKey() {
    const secret = await unlockSelectedSecret();
    if (secret) await listModelsUsingKey(secret.apiKey);
  }

  async function handleTestProviderWithSavedKey() {
    const secret = await unlockSelectedSecret();
    if (secret) await testProviderUsingKey(secret.apiKey);
  }

  async function handleImageFiles(files: FileList | null) {
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    try {
      const attachments = await Promise.all(images.map(readImageFile));
      setPendingImages((current) => [...current, ...attachments]);
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleSendChat() {
    if (!activeProvider || !selectedModel || (!chatInput.trim() && pendingImages.length === 0) || currentStreamId) return;
    const secret = await unlockSelectedSecret();
    if (!secret) return;

    const streamId = createStreamId();
    const parsedTemperature = parseFiniteNumber(temperature, 0.7);
    const parsedMaxTokens = parsePositiveInt(maxTokens, 512);
    const parsedContextLength = parsePositiveInt(contextLength, 8192);
    const userContent = chatInput.trim();
    const userImages = pendingImages.map(({ mediaType, dataBase64 }) => ({ mediaType, dataBase64 }));
    const nextMessage: UnifiedMessage = { role: "user", content: userContent, images: userImages };
    const requestMessages = buildContextMessages(chatMessagesRef.current, nextMessage, parsedContextLength);
    const displayContent = `${userContent || "[Image prompt]"}${userImages.length ? `${userContent ? "\n" : ""}[Attached ${userImages.length} image${userImages.length === 1 ? "" : "s"}]` : ""}`;
    activeStreamIdRef.current = streamId;
    selectedModelRef.current = selectedModel;
    setCurrentStreamId(streamId);
    setChatInput("");
    setPendingImages([]);
    updateChatMessages((messages) => [...messages, { role: "user", content: displayContent }, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const result = await startChatStreamWithKey(templateToConfig(activeProvider), secret.apiKey, {
        model: selectedModel,
        stream: true,
        temperature: parsedTemperature,
        maxTokens: parsedMaxTokens,
        messages: requestMessages,
        systemPrompt: chatMessagesRef.current.find((message) => message.role === "system")?.content,
      }, streamId);

      if (result.streamId !== streamId) {
        activeStreamIdRef.current = result.streamId;
        setCurrentStreamId(result.streamId);
      }
    } catch (error) {
      if (activeStreamIdRef.current === streamId) {
        activeStreamIdRef.current = null;
      }
      setBusy(false);
      setCurrentStreamId(null);
      updateChatMessages((messages) => [...messages, { role: "assistant", content: `Failed to start stream: ${errorMessage(error)}` }]);
      void persistCurrentConversation(chatMessagesRef.current);
    }
  }

  async function handleStopChat() {
    if (!currentStreamId) return;
    const streamId = currentStreamId;
    activeStreamIdRef.current = null;
    setCurrentStreamId(null);
    setBusy(false);
    updateChatMessages((messages) => appendAssistantDelta(messages, "\n\n[Stopped]"));
    void persistCurrentConversation(chatMessagesRef.current);
    try {
      await stopChatStream(streamId);
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    }
  }

  async function handleSaveWebDavConfig() {
    if (!masterPassword) {
      setSyncMessage("Master password is required to save WebDAV config.");
      return;
    }
    await runWebDavAction(async () => {
      const summary = await webdavSaveConfigWithMasterPassword(webdavConfig, masterPassword);
      setSavedWebdavSummary(summary);
      setWebdavConfig((current) => ({ ...current, password: "" }));
      return { message: "Saved encrypted WebDAV config", bytes: 0, remoteUrl: `${summary.endpoint}/${summary.remoteDir}` };
    });
  }

  async function handleUnlockSavedWebDavConfig() {
    if (!masterPassword) {
      setSyncMessage("Master password is required to unlock WebDAV config.");
      return;
    }
    await runWebDavAction(async () => {
      const unlocked = await webdavUnlockSavedConfig(masterPassword);
      setWebdavConfig(unlocked);
      return { message: "Unlocked saved WebDAV config into the form", bytes: 0, remoteUrl: `${unlocked.endpoint}/${unlocked.remoteDir}` };
    });
  }

  async function handleWebDavTest() {
    await runWebDavAction(async () => webdavTestConnection(webdavConfig));
  }

  async function handleWebDavUpload() {
    await runWebDavAction(async () => webdavUploadLocalVault(webdavConfig));
  }

  async function handleWebDavDownload() {
    await runWebDavAction(async () => {
      const result = await webdavDownloadRemoteVault(webdavConfig, false);
      await reloadVaultRecords();
      return result;
    });
  }

  async function handleSavedWebDavTest() {
    if (!masterPassword) {
      setSyncMessage("Master password is required to use saved WebDAV config.");
      return;
    }
    await runWebDavAction(async () => webdavTestSavedConnection(masterPassword));
  }

  async function handleSavedWebDavUpload() {
    if (!masterPassword) {
      setSyncMessage("Master password is required to use saved WebDAV config.");
      return;
    }
    await runWebDavAction(async () => webdavUploadLocalVaultWithSavedConfig(masterPassword));
  }

  async function handleSavedWebDavDownload() {
    if (!masterPassword) {
      setSyncMessage("Master password is required to use saved WebDAV config.");
      return;
    }
    await runWebDavAction(async () => {
      const result = await webdavDownloadRemoteVaultWithSavedConfig(masterPassword, false);
      await reloadVaultRecords();
      return result;
    });
  }

  async function runWebDavAction(action: () => Promise<{ message: string; bytes: number; remoteUrl: string }>) {
    setBusy(true);
    setSyncMessage("");
    try {
      const result = await action();
      setSyncMessage(`${result.message}. Bytes: ${result.bytes}. Remote: ${result.remoteUrl}`);
    } catch (error) {
      setSyncMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function unlockSelectedSecret() {
    if (!activeProvider || !selectedSecretId) return null;
    setBusy(true);
    setTestResult(null);
    try {
      return await unlockCredentialWithSystemKeychain(selectedSecretId);
    } catch (systemError) {
      if (!masterPassword) {
        setTestResult({ ok: false, providerId: activeProvider.id, message: `System keychain unlock failed: ${errorMessage(systemError)}. Enter master password for legacy records.` });
        return null;
      }
      try {
        return await vaultDecryptSecretWithMasterPassword(selectedSecretId, masterPassword);
      } catch (masterError) {
        setTestResult({ ok: false, providerId: activeProvider.id, message: `Unlock failed. System: ${errorMessage(systemError)} Master: ${errorMessage(masterError)}` });
        return null;
      }
    } finally {
      setBusy(false);
    }
  }

  async function listModelsUsingKey(unlockedApiKey: string) {
    if (!activeProvider) return;
    setBusy(true);
    setTestResult(null);
    try {
      const result = await listModelsWithKey(templateToConfig(activeProvider), unlockedApiKey);
      setModels(result);
      setSelectedModel(result[0]?.id ?? "");
      setTestResult({ ok: true, providerId: activeProvider.id, modelCount: result.length, message: `Fetched ${result.length} models.` });
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function testProviderUsingKey(unlockedApiKey: string) {
    if (!activeProvider) return;
    setBusy(true);
    setTestResult(null);
    try {
      const result = await testProviderWithKey(templateToConfig(activeProvider), unlockedApiKey, selectedModel || undefined);
      setTestResult(result);
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={24} /><div><strong>KeySync AI</strong><span>{status}</span></div></div>
        <section><h2><Server size={16} /> Providers</h2><div className="provider-list">
          {templates.map((provider) => (
            <button key={provider.id} className={provider.id === activeProviderId ? "active" : ""} onClick={() => setActiveProviderId(provider.id)}>
              <span>{provider.name}</span><small>{provider.kind}</small>
            </button>
          ))}
        </div></section>
        <section><h2><MessageSquareText size={16} /> Conversations</h2><div className="conversation-list">
          <button onClick={handleNewConversation} className={!currentConversationId ? "active" : ""}>New chat<small>Unsaved scratchpad</small></button>
          {conversationSummaries.map((conversation) => (
            <button key={conversation.id} className={conversation.id === currentConversationId ? "active" : ""} onClick={() => void handleLoadConversation(conversation.id)}>
              <span>{conversation.title}</span><small>{conversation.modelId} · {conversation.messageCount} messages</small>
            </button>
          ))}
        </div>{currentConversationId && <button className="danger" onClick={() => void handleDeleteConversation(currentConversationId)}>Delete conversation</button>}</section>
      </aside>

      <section className="chat-panel">
        <header><div><h1>Lightweight chat client</h1><p>Streaming chat is wired for OpenAI-compatible, Responses, Gemini, and Anthropic providers. Conversations auto-save locally after each stream.</p></div><button className="secondary" onClick={handleListModelsWithSavedKey} disabled={busy || !selectedSecretId}><RefreshCw size={16} /> Refresh models</button></header>
        <div className="messages">
          {chatMessages.map((message, index) => <article key={index} className={`message ${message.role}`}><span>{message.role}</span><p>{message.content || (message.role === "assistant" ? "Streaming..." : "")}</p></article>)}
        </div>
        <footer className="composer">
          <button onClick={() => imageInputRef.current?.click()} disabled={busy}><UploadCloud size={18} /> Image</button>
          <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => void handleImageFiles(event.target.files)} />
          <div className="composer-input">
            {pendingImages.length > 0 && <div className="image-chips">{pendingImages.map((image, index) => <span key={`${image.name}-${index}`} className="image-chip">{image.name}<button onClick={() => setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
            <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) void handleSendChat(); }} placeholder="Send a test message to the selected model..." />
          </div>
          {currentStreamId ? <button className="danger inline" onClick={handleStopChat}>Stop</button> : <button className="primary" disabled={busy || !selectedSecretId || !selectedModel || (!chatInput.trim() && pendingImages.length === 0)} onClick={handleSendChat}>Send</button>}
        </footer>
      </section>

      <aside className="inspector">
        <section className="card"><h2><KeyRound size={16} /> API key vault</h2><p>New records are saved with the OS keychain data key. Master password is only needed for older records or WebDAV config.</p><label>Master password<input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="For legacy records / WebDAV config" /></label><label>Saved key<select value={selectedSecretId} onChange={(event) => setSelectedSecretId(event.target.value)}><option value="">Select saved key</option>{providerSecrets.map((secret) => <option key={secret.id} value={secret.id}>{secret.displayName}</option>)}</select></label><div className="button-row"><button onClick={handleListModelsWithSavedKey} disabled={busy || !selectedSecretId}>List saved</button><button className="primary" onClick={handleTestProviderWithSavedKey} disabled={busy || !selectedSecretId}>Test saved</button></div><button className="danger" onClick={handleDeleteSavedKey} disabled={busy || !selectedSecretId}>Delete saved key</button>{testResult && <p className={testResult.ok ? "ok" : "warn"}>{testResult.message}</p>}</section>
        <section className="card"><h2>System keychain</h2><p>Default vault mode uses an OS keychain data key for new local records.</p>{keychainStatus && <p className={keychainStatus.available ? "ok" : "warn"}>{keychainStatus.message}</p>}<dl><dt>Service</dt><dd>{keychainStatus?.service ?? "app.keysync.ai"}</dd><dt>Account</dt><dd>{keychainStatus?.account ?? "vault-data-key"}</dd><dt>Data key</dt><dd>{keychainStatus?.hasDataKey ? "Present" : "Missing"}</dd></dl><div className="button-row"><button onClick={reloadSystemKeychainStatus} disabled={busy}>Refresh</button><button className="primary" onClick={handleInitSystemKeychain} disabled={busy}>Init data key</button></div><button className="danger" onClick={handleDeleteSystemKeychain} disabled={busy || !keychainStatus?.hasDataKey}>Delete data key</button></section>
        <section className="card"><h2>Save new key</h2><label>Display name<input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Personal OpenAI key" /></label><label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-... or provider token" /></label><div className="button-row"><button onClick={handleListModelsWithRawKey} disabled={busy || !apiKey.trim()}>List raw</button><button onClick={handleTestProviderWithRawKey} disabled={busy || !apiKey.trim()}>Test raw</button></div><button className="primary full" onClick={handleSaveKey} disabled={busy || !apiKey.trim()}>Save with system keychain</button><button className="secondary full" onClick={handleSaveKeyWithMasterPassword} disabled={busy || !apiKey.trim() || !masterPassword}>Save with master password</button></section>
        <section className="card"><h2>WebDAV sync</h2><p>Manual MVP sync for the encrypted local vault file. Downloads now merge by record ID and keep conflict copies.</p>{savedWebdavSummary && <p className="ok">Saved: {savedWebdavSummary.username} @ {savedWebdavSummary.endpoint}/{savedWebdavSummary.remoteDir}</p>}<label>Endpoint<input value={webdavConfig.endpoint} onChange={(event) => setWebdavConfig({ ...webdavConfig, endpoint: event.target.value })} placeholder="https://dav.example.com/remote.php/dav/files/user" /></label><label>Remote directory<input value={webdavConfig.remoteDir} onChange={(event) => setWebdavConfig({ ...webdavConfig, remoteDir: event.target.value })} placeholder="KeySyncAI" /></label><label>Username<input value={webdavConfig.username} onChange={(event) => setWebdavConfig({ ...webdavConfig, username: event.target.value })} /></label><label>Password<input type="password" value={webdavConfig.password} onChange={(event) => setWebdavConfig({ ...webdavConfig, password: event.target.value })} placeholder="Required only to save raw config" /></label><div className="button-row"><button onClick={handleWebDavTest} disabled={busy || !webdavConfig.endpoint}>Test raw</button><button onClick={handleSaveWebDavConfig} disabled={busy || !webdavConfig.endpoint || !masterPassword}>Save encrypted</button></div><div className="button-row"><button onClick={handleWebDavUpload} disabled={busy || !webdavConfig.endpoint}>Upload raw</button><button onClick={handleWebDavDownload} disabled={busy || !webdavConfig.endpoint}>Merge download raw</button></div><div className="button-row"><button onClick={handleSavedWebDavTest} disabled={busy || !savedWebdavSummary || !masterPassword}>Test saved</button><button onClick={handleUnlockSavedWebDavConfig} disabled={busy || !savedWebdavSummary || !masterPassword}>Unlock to form</button></div><div className="button-row"><button onClick={handleSavedWebDavUpload} disabled={busy || !savedWebdavSummary || !masterPassword}>Upload saved</button><button className="primary" onClick={handleSavedWebDavDownload} disabled={busy || !savedWebdavSummary || !masterPassword}>Merge download saved</button></div>{syncMessage && <p className="ok">{syncMessage}</p>}</section>
        {conflictRecords.length > 0 && <section className="card"><h2>Conflict review</h2><p>Remote conflict copies were preserved during merge. Rename to keep them, or delete duplicate copies.</p><div className="model-list">{conflictRecords.map((record) => <span key={record.id}>{record.displayName}<small>{record.providerId} · {record.updatedAt}</small><input value={conflictRename[record.id] ?? record.displayName.replace(" [conflict remote]", "")} onChange={(event) => setConflictRename({ ...conflictRename, [record.id]: event.target.value })} /><div className="button-row"><button onClick={() => void handleAcceptConflict(record)} disabled={busy}>Keep renamed</button><button className="danger" onClick={() => void deleteRecord(record.id, "Deleted conflict copy.")} disabled={busy}>Delete conflict</button></div></span>)}</div></section>}
        <section className="card"><h2>Active provider</h2>{activeProvider ? <dl><dt>Name</dt><dd>{activeProvider.name}</dd><dt>Base URL</dt><dd>{activeProvider.baseUrl}</dd><dt>Streaming</dt><dd>{activeProvider.supportsStreaming ? "Supported" : "Not supported"}</dd><dt>Images</dt><dd>{activeProvider.supportsImages ? "Supported" : "Not supported"}</dd></dl> : <p>No provider loaded.</p>}</section>
        <section className="card"><h2>Models</h2>{models.length ? <><label>Selected model<select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label><div className="model-list">{models.slice(0, 8).map((model) => <span key={model.id}>{model.displayName}<small>{model.capabilities.join(", ")}</small></span>)}</div></> : <p>No models loaded yet.</p>}</section>
        <section className="card"><h2>Model params</h2><label>System prompt<textarea value={chatMessages.find((message) => message.role === "system")?.content ?? ""} onChange={(event) => updateChatMessages((messages) => [{ role: "system", content: event.target.value }, ...messages.filter((message) => message.role !== "system")])} placeholder="You are a helpful assistant." /></label><label>Temperature<input type="number" value={temperature} min="0" max="2" step="0.1" onChange={(event) => setTemperature(event.target.value)} /></label><label>Max output tokens<input type="number" value={maxTokens} min="1" step="1" onChange={(event) => setMaxTokens(event.target.value)} /></label><label>Context length<input type="number" value={contextLength} min="256" step="256" onChange={(event) => setContextLength(event.target.value)} /></label><p>Context length trims recent history before sending. Images are attached only on the current turn.</p></section>
      </aside>
    </main>
  );
}
