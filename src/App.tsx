import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, MessageSquareText, RefreshCw, Server, ShieldCheck, UploadCloud } from "lucide-react";
import type { AppSettings, ModelInfo, ProviderTemplate, SecretRecordSummary, SystemKeychainStatus, TestResult, UnifiedMessage, WebDavConfig, WebDavConfigSummary } from "./types";
import type { ChatMessage } from "./lib/chat";
import {
  appendAssistantDelta,
  buildContextMessages,
  createClientId,
  initialMessages,
  parseFiniteNumber,
  parsePositiveInt,
} from "./lib/chat";
import { useChatStreamEvents } from "./hooks/useChatStreamEvents";
import { useConversations } from "./hooks/useConversations";
import { WebDavSyncCard } from "./components/WebDavSyncCard";
import {
  getAppStatus,
  loadAppSettings,
  listCachedModels,
  listModelsWithKey,
  loadProviderTemplates,
  startChatStreamWithKey,
  stopChatStream,
  saveModelCache,
  saveAppSettings,
  templateToConfig,
  testProviderWithKey,
  updateModelPreferences,
  vaultDecryptSecretWithMasterPassword,
  vaultDeleteSecretRecord,
  vaultDeleteSystemDataKey,
  vaultExportEncryptedBackup,
  vaultExportPlaintextBackup,
  vaultInitSystemDataKey,
  vaultImportEncryptedBackup,
  vaultImportPlaintextBackup,
  vaultListConflictRecords,
  vaultListSecretRecords,
  vaultMigrateSecretToSystemKeychain,
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

type PendingImage = { name: string; mediaType: string; dataBase64: string };
type StoredCredentialPayload = { apiKey: string; customHeaders: Array<[string, string]> };

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unknown error";
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

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

function downloadJson(filename: string, data: unknown) {
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  const [modelAlias, setModelAlias] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialMessages);
  const [currentStreamId, setCurrentStreamId] = useState<string | null>(null);
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("512");
  const [contextLength, setContextLength] = useState("8192");
  const [webdavConfig, setWebdavConfig] = useState<WebDavConfig>({ endpoint: "", username: "", password: "", remoteDir: "KeySyncAI" });
  const [savedWebdavSummary, setSavedWebdavSummary] = useState<WebDavConfigSummary | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [keychainStatus, setKeychainStatus] = useState<SystemKeychainStatus | null>(null);
  const [plaintextExportConfirmation, setPlaintextExportConfirmation] = useState("");
  const [appSettings, setAppSettings] = useState<AppSettings>({ providerProxyUrls: {}, providerProxyDisabled: [], customProviderTemplates: [] });
  const {
    conversationSummaries,
    currentConversationId,
    saveCurrentConversation,
    loadExistingConversation,
    deleteExistingConversation,
    resetCurrentConversation,
  } = useConversations();
  const activeStreamIdRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const encryptedBackupInputRef = useRef<HTMLInputElement | null>(null);
  const plaintextBackupInputRef = useRef<HTMLInputElement | null>(null);
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

  useChatStreamEvents({
    activeStreamIdRef,
    activeProviderIdRef,
    chatMessagesRef,
    updateChatMessages,
    persistCurrentConversation,
    setBusy,
    setCurrentStreamId,
    setTestResult,
  });

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
    reloadSavedWebDavSummary();
    reloadSystemKeychainStatus();
    loadAppSettings().then(setAppSettings).catch(() => setAppSettings({ providerProxyUrls: {}, providerProxyDisabled: [], customProviderTemplates: [] }));
  }, []);

  const activeProvider = useMemo(
    () => templates.find((provider) => provider.id === activeProviderId) ?? templates[0],
    [templates, activeProviderId]
  );

  const providerSecrets = useMemo(
    () => savedSecrets.filter((secret) => secret.providerId === activeProviderId),
    [savedSecrets, activeProviderId]
  );

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel]
  );

  const activeProxyUrl = activeProvider
    ? appSettings.providerProxyDisabled.includes(activeProvider.id)
      ? undefined
      : appSettings.providerProxyUrls[activeProvider.id] || appSettings.globalProxyUrl
    : undefined;

  useEffect(() => {
    let cancelled = false;
    void listCachedModels(activeProviderId)
      .then((cachedModels) => {
        if (cancelled) return;
        setModels(cachedModels);
        if (!currentConversationIdRef.current) {
          setSelectedModel(cachedModels.find((model) => !model.isHidden)?.id ?? cachedModels[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    setTestResult(null);
    if (!currentConversationIdRef.current) {
      setSelectedModel("");
    }
    setSelectedSecretId("");
    return () => {
      cancelled = true;
    };
  }, [activeProviderId]);

  useEffect(() => {
    setModelAlias(selectedModelInfo?.alias ?? "");
  }, [selectedModelInfo]);

  async function persistCurrentConversation(messages: ChatMessage[] = chatMessagesRef.current) {
    try {
      const detail = await saveCurrentConversation({
        id: currentConversationIdRef.current,
        providerId: activeProviderIdRef.current,
        modelId: selectedModelRef.current,
        messages,
        temperature: temperatureRef.current,
        maxTokens: maxTokensRef.current,
        contextLength: contextLengthRef.current,
      });
      if (detail) {
        currentConversationIdRef.current = detail.summary.id;
      }
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProviderIdRef.current, message: `Conversation save failed: ${errorMessage(error)}` });
    }
  }

  function handleNewConversation() {
    activeStreamIdRef.current = null;
    currentConversationIdRef.current = null;
    resetCurrentConversation();
    updateChatMessages(() => initialMessages);
    setChatInput("");
    setPendingImages([]);
    setTestResult(null);
  }

  async function handleLoadConversation(conversationId: string) {
    try {
      const loaded = await loadExistingConversation(conversationId);
      currentConversationIdRef.current = loaded.detail.summary.id;
      setSelectedModel(loaded.detail.summary.modelId);
      setActiveProviderId(loaded.detail.summary.providerId);
      setTemperature(loaded.temperature);
      setMaxTokens(loaded.maxTokens);
      setContextLength(loaded.contextLength);
      updateChatMessages(() => loaded.messages);
      setChatInput("");
      setPendingImages([]);
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProviderIdRef.current, message: errorMessage(error) });
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    const wasCurrent = currentConversationIdRef.current === conversationId;
    try {
      await deleteExistingConversation(conversationId);
      if (wasCurrent) {
        handleNewConversation();
      }
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

  async function handleExportEncryptedBackup() {
    setBusy(true);
    try {
      downloadJson("keysync-encrypted-backup.json", await vaultExportEncryptedBackup());
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message: "Encrypted backup exported." } : null);
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    } finally {
      setBusy(false);
    }
  }

  async function handleExportPlaintextBackup() {
    if (plaintextExportConfirmation !== "EXPORT") return;
    setBusy(true);
    try {
      const backup = await vaultExportPlaintextBackup(plaintextExportConfirmation, masterPassword);
      downloadJson("keysync-plaintext-backup.json", backup);
      setPlaintextExportConfirmation("");
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message: "Plaintext backup exported. Store it securely." } : null);
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportBackup(files: FileList | null, mode: "encrypted" | "plaintext") {
    const file = files?.item(0);
    if (!file) return;
    setBusy(true);
    try {
      const content = await readTextFile(file);
      const result = mode === "encrypted"
        ? await vaultImportEncryptedBackup(content)
        : await vaultImportPlaintextBackup(content);
      await reloadVaultRecords();
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message: `Imported ${result.imported} record(s), ${result.conflicts} conflict copy/copies.` } : null);
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    } finally {
      setBusy(false);
      if (encryptedBackupInputRef.current) encryptedBackupInputRef.current.value = "";
      if (plaintextBackupInputRef.current) plaintextBackupInputRef.current.value = "";
    }
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

    const streamId = createClientId("stream");
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
    updateChatMessages((messages) => [
      ...messages,
      { role: "user", content: displayContent, images: userImages },
      { role: "assistant", content: "" },
    ]);
    setBusy(true);

    try {
      const result = await startChatStreamWithKey(providerConfig(activeProvider), secret.apiKey, {
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
      const result = await listModelsWithKey(providerConfig(activeProvider), unlockedApiKey);
      const cachedModels = await saveModelCache(activeProvider.id, result);
      setModels(cachedModels);
      setSelectedModel(cachedModels.find((model) => !model.isHidden)?.id ?? cachedModels[0]?.id ?? "");
      setTestResult({ ok: true, providerId: activeProvider.id, modelCount: cachedModels.length, message: `Fetched ${cachedModels.length} models.` });
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
      const result = await testProviderWithKey(providerConfig(activeProvider), unlockedApiKey, selectedModel || undefined);
      setTestResult(result);
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function providerConfig(provider: ProviderTemplate) {
    const proxyUrl = appSettings.providerProxyDisabled.includes(provider.id)
      ? undefined
      : appSettings.providerProxyUrls[provider.id] || appSettings.globalProxyUrl;
    return templateToConfig(provider, proxyUrl);
  }

  async function handleSaveProxySettings() {
    try {
      const saved = await saveAppSettings(appSettings);
      setAppSettings(saved);
      setSyncMessage("Proxy settings saved with the system keychain data key.");
    } catch (error) {
      setSyncMessage(`Proxy settings failed: ${errorMessage(error)}`);
    }
  }

  async function handleMigrateSavedKey() {
    if (!activeProvider || !selectedSecretId || !masterPassword) return;
    setBusy(true);
    try {
      const record = await vaultMigrateSecretToSystemKeychain(selectedSecretId, masterPassword);
      await reloadVaultRecords();
      setTestResult({ ok: true, providerId: activeProvider.id, message: `Migrated ${record.displayName} to the system keychain.` });
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function applySelectedModel(modelId: string) {
    const model = models.find((item) => item.id === modelId);
    setSelectedModel(modelId);
    const params = model?.defaultParams;
    if (typeof params?.temperature === "number") setTemperature(String(params.temperature));
    if (typeof params?.maxTokens === "number") setMaxTokens(String(params.maxTokens));
    if (typeof params?.contextLength === "number") setContextLength(String(params.contextLength));
  }

  async function handleSaveModelPreferences(options?: { favorite?: boolean; hidden?: boolean; saveCurrentDefaults?: boolean }) {
    if (!activeProvider || !selectedModelInfo) return;
    try {
      const updated = await updateModelPreferences({
        providerId: activeProvider.id,
        modelId: selectedModelInfo.id,
        isFavorite: options?.favorite ?? selectedModelInfo.isFavorite,
        isHidden: options?.hidden ?? selectedModelInfo.isHidden,
        alias: modelAlias,
        defaultParams: options?.saveCurrentDefaults
          ? {
              temperature: parseFiniteNumber(temperature, 0.7),
              maxTokens: parsePositiveInt(maxTokens, 512),
              contextLength: parsePositiveInt(contextLength, 8192),
            }
          : selectedModelInfo.defaultParams,
      });
      setModels((current) => current.map((model) => (model.id === updated.id ? updated : model)));
      setTestResult({ ok: true, providerId: activeProvider.id, message: `Saved preferences for ${updated.displayName}.` });
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
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
          {chatMessages.map((message, index) => (
            <article key={index} className={`message ${message.role}`}>
              <span>{message.role}</span>
              <p>{message.content || (message.role === "assistant" ? "Streaming..." : "")}</p>
              {(message.images?.length ?? 0) > 0 && (
                <div className="message-attachments">
                  {message.images?.map((image, imageIndex) => (
                    <img
                      key={`${image.mediaType}-${imageIndex}`}
                      src={`data:${image.mediaType};base64,${image.dataBase64}`}
                      alt={`Attached image ${imageIndex + 1}`}
                    />
                  ))}
                </div>
              )}
            </article>
          ))}
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
        <section className="card"><h2><KeyRound size={16} /> API key vault</h2><p>New records are saved with the OS keychain data key. Master password is only needed for older records, migration, or WebDAV config.</p><label>Master password<input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="For legacy records / WebDAV config" /></label><label>Saved key<select value={selectedSecretId} onChange={(event) => setSelectedSecretId(event.target.value)}><option value="">Select saved key</option>{providerSecrets.map((secret) => <option key={secret.id} value={secret.id}>{secret.displayName}</option>)}</select></label><div className="button-row"><button onClick={handleListModelsWithSavedKey} disabled={busy || !selectedSecretId}>List saved</button><button className="primary" onClick={handleTestProviderWithSavedKey} disabled={busy || !selectedSecretId}>Test saved</button></div><button className="secondary full" onClick={handleMigrateSavedKey} disabled={busy || !selectedSecretId || !masterPassword}>Migrate legacy key to system keychain</button><button className="danger" onClick={handleDeleteSavedKey} disabled={busy || !selectedSecretId}>Delete saved key</button>{testResult && <p className={testResult.ok ? "ok" : "warn"}>{testResult.message}</p>}</section>
        <section className="card"><h2>Backup</h2><p>Encrypted backups preserve encrypted records. Plaintext export is intentionally gated and should only be used for migration.</p><input ref={encryptedBackupInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImportBackup(event.target.files, "encrypted")} /><input ref={plaintextBackupInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImportBackup(event.target.files, "plaintext")} /><div className="button-row"><button onClick={() => void handleExportEncryptedBackup()} disabled={busy}>Export encrypted</button><button onClick={() => encryptedBackupInputRef.current?.click()} disabled={busy}>Import encrypted</button></div><label>Type EXPORT to allow plaintext export<input value={plaintextExportConfirmation} onChange={(event) => setPlaintextExportConfirmation(event.target.value)} placeholder="EXPORT" /></label><div className="button-row"><button className="danger inline" onClick={() => void handleExportPlaintextBackup()} disabled={busy || plaintextExportConfirmation !== "EXPORT"}>Export plaintext JSON</button><button onClick={() => plaintextBackupInputRef.current?.click()} disabled={busy}>Import plaintext JSON</button></div></section>
        <section className="card"><h2>System keychain</h2><p>Default vault mode uses an OS keychain data key for new local records. The data key cannot be deleted while saved records still depend on it.</p>{keychainStatus && <p className={keychainStatus.available ? "ok" : "warn"}>{keychainStatus.message}</p>}<dl><dt>Service</dt><dd>{keychainStatus?.service ?? "app.keysync.ai"}</dd><dt>Account</dt><dd>{keychainStatus?.account ?? "vault-data-key"}</dd><dt>Data key</dt><dd>{keychainStatus?.hasDataKey ? "Present" : "Missing"}</dd></dl><div className="button-row"><button onClick={reloadSystemKeychainStatus} disabled={busy}>Refresh</button><button className="primary" onClick={handleInitSystemKeychain} disabled={busy}>Init data key</button></div><button className="danger" onClick={handleDeleteSystemKeychain} disabled={busy || !keychainStatus?.hasDataKey}>Delete data key</button></section>
        <section className="card"><h2>Save new key</h2><label>Display name<input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Personal OpenAI key" /></label><label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-... or provider token" /></label><div className="button-row"><button onClick={handleListModelsWithRawKey} disabled={busy || !apiKey.trim()}>List raw</button><button onClick={handleTestProviderWithRawKey} disabled={busy || !apiKey.trim()}>Test raw</button></div><button className="primary full" onClick={handleSaveKey} disabled={busy || !apiKey.trim()}>Save with system keychain</button><button className="secondary full" onClick={handleSaveKeyWithMasterPassword} disabled={busy || !apiKey.trim() || !masterPassword}>Save with master password</button></section>
        <section className="card"><h2>Proxy</h2><p>Use an HTTP, HTTPS, or SOCKS5 URL. Credentials in the URL are encrypted locally with the system keychain data key.</p><label>Global proxy<input type="password" value={appSettings.globalProxyUrl ?? ""} onChange={(event) => setAppSettings((current) => ({ ...current, globalProxyUrl: event.target.value || undefined }))} placeholder="socks5://user:password@host:1080" /></label>{activeProvider && <><label>{activeProvider.name} override<input type="password" value={appSettings.providerProxyUrls[activeProvider.id] ?? ""} onChange={(event) => setAppSettings((current) => ({ ...current, providerProxyUrls: { ...current.providerProxyUrls, [activeProvider.id]: event.target.value } }))} placeholder="Leave empty to use global proxy" /></label><label className="checkbox-label"><input type="checkbox" checked={appSettings.providerProxyDisabled.includes(activeProvider.id)} onChange={(event) => setAppSettings((current) => ({ ...current, providerProxyDisabled: event.target.checked ? [...new Set([...current.providerProxyDisabled, activeProvider.id])] : current.providerProxyDisabled.filter((providerId) => providerId !== activeProvider.id) }))} />Connect this provider directly</label></>}<p>Active route: {activeProxyUrl ? "custom proxy" : "direct connection"}</p><button className="primary full" onClick={() => void handleSaveProxySettings()} disabled={busy}>Save encrypted proxy settings</button></section>
        <WebDavSyncCard
          busy={busy}
          masterPassword={masterPassword}
          savedWebdavSummary={savedWebdavSummary}
          syncMessage={syncMessage}
          webdavConfig={webdavConfig}
          setWebdavConfig={setWebdavConfig}
          onTestRaw={handleWebDavTest}
          onSaveConfig={handleSaveWebDavConfig}
          onUploadRaw={handleWebDavUpload}
          onDownloadRaw={handleWebDavDownload}
          onTestSaved={handleSavedWebDavTest}
          onUnlockSaved={handleUnlockSavedWebDavConfig}
          onUploadSaved={handleSavedWebDavUpload}
          onDownloadSaved={handleSavedWebDavDownload}
        />
        {conflictRecords.length > 0 && <section className="card"><h2>Conflict review</h2><p>Remote conflict copies were preserved during merge. Rename to keep them, or delete duplicate copies.</p><div className="model-list">{conflictRecords.map((record) => <span key={record.id}>{record.displayName}<small>{record.providerId} · {record.updatedAt}</small><input value={conflictRename[record.id] ?? record.displayName.replace(" [conflict remote]", "")} onChange={(event) => setConflictRename({ ...conflictRename, [record.id]: event.target.value })} /><div className="button-row"><button onClick={() => void handleAcceptConflict(record)} disabled={busy}>Keep renamed</button><button className="danger" onClick={() => void deleteRecord(record.id, "Deleted conflict copy.")} disabled={busy}>Delete conflict</button></div></span>)}</div></section>}
        <section className="card"><h2>Active provider</h2>{activeProvider ? <dl><dt>Name</dt><dd>{activeProvider.name}</dd><dt>Base URL</dt><dd>{activeProvider.baseUrl}</dd><dt>Streaming</dt><dd>{activeProvider.supportsStreaming ? "Supported" : "Not supported"}</dd><dt>Images</dt><dd>{activeProvider.supportsImages ? "Supported" : "Not supported"}</dd></dl> : <p>No provider loaded.</p>}</section>
        <section className="card"><h2>Models</h2>{models.length ? <><label>Selected model<select value={selectedModel} onChange={(event) => applySelectedModel(event.target.value)}>{models.filter((model) => !model.isHidden || model.id === selectedModel).map((model) => <option key={model.id} value={model.id}>{model.isFavorite ? "★ " : ""}{model.alias || model.displayName}</option>)}</select></label>{selectedModelInfo && <><label>Model alias<input value={modelAlias} onChange={(event) => setModelAlias(event.target.value)} placeholder={selectedModelInfo.displayName} /></label><div className="button-row"><button onClick={() => void handleSaveModelPreferences()}>Save alias</button><button onClick={() => void handleSaveModelPreferences({ favorite: !selectedModelInfo.isFavorite })}>{selectedModelInfo.isFavorite ? "Unfavorite" : "Favorite"}</button></div><div className="button-row"><button onClick={() => void handleSaveModelPreferences({ saveCurrentDefaults: true })}>Save current params</button><button className="danger inline" onClick={() => void handleSaveModelPreferences({ hidden: !selectedModelInfo.isHidden })}>{selectedModelInfo.isHidden ? "Show model" : "Hide model"}</button></div></>}<div className="model-list">{models.filter((model) => !model.isHidden).slice(0, 8).map((model) => <span key={model.id}>{model.isFavorite ? "★ " : ""}{model.alias || model.displayName}<small>{model.capabilities.join(", ")}</small></span>)}</div></> : <p>No models loaded yet.</p>}</section>
        <section className="card"><h2>Model params</h2><label>System prompt<textarea value={chatMessages.find((message) => message.role === "system")?.content ?? ""} onChange={(event) => updateChatMessages((messages) => [{ role: "system", content: event.target.value }, ...messages.filter((message) => message.role !== "system")])} placeholder="You are a helpful assistant." /></label><label>Temperature<input type="number" value={temperature} min="0" max="2" step="0.1" onChange={(event) => setTemperature(event.target.value)} /></label><label>Max output tokens<input type="number" value={maxTokens} min="1" step="1" onChange={(event) => setMaxTokens(event.target.value)} /></label><label>Context length<input type="number" value={contextLength} min="256" step="256" onChange={(event) => setContextLength(event.target.value)} /></label><p>Context length trims recent history before sending. Images are retained in saved conversations and included only when context keeps that turn.</p></section>
      </aside>
    </main>
  );
}
