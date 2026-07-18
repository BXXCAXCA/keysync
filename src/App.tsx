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
  return "未知错误";
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

function chatRoleLabel(role: ChatMessage["role"]): string {
  if (role === "system") return "系统";
  if (role === "user") return "用户";
  return "助手";
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
  const [status, setStatus] = useState("正在加载…");
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
  const [customProviderJson, setCustomProviderJson] = useState("");
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
    await deleteRecord(selectedSecretId, "已删除保存的密钥。");
    setSelectedSecretId("");
  }

  async function handleExportEncryptedBackup() {
    setBusy(true);
    try {
      downloadJson("keysync-encrypted-backup.json", await vaultExportEncryptedBackup());
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message: "已导出加密备份。" } : null);
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
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message: "已导出明文备份，请妥善保管。" } : null);
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
    const displayContent = `${userContent || "[图片提示]"}${userImages.length ? `${userContent ? "\n" : ""}[已附加 ${userImages.length} 张图片]` : ""}`;
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
      updateChatMessages((messages) => [...messages, { role: "assistant", content: `无法启动流式请求：${errorMessage(error)}` }]);
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
      setSyncMessage("保存 WebDAV 配置需要主密码。");
      return;
    }
    await runWebDavAction(async () => {
      const summary = await webdavSaveConfigWithMasterPassword(webdavConfig, masterPassword);
      setSavedWebdavSummary(summary);
      setWebdavConfig((current) => ({ ...current, password: "" }));
      return { message: "已加密保存 WebDAV 配置", bytes: 0, remoteUrl: `${summary.endpoint}/${summary.remoteDir}` };
    });
  }

  async function handleUnlockSavedWebDavConfig() {
    if (!masterPassword) {
      setSyncMessage("解锁 WebDAV 配置需要主密码。");
      return;
    }
    await runWebDavAction(async () => {
      const unlocked = await webdavUnlockSavedConfig(masterPassword);
      setWebdavConfig(unlocked);
      return { message: "已解锁保存的 WebDAV 配置并填入表单", bytes: 0, remoteUrl: `${unlocked.endpoint}/${unlocked.remoteDir}` };
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
      setSyncMessage("使用保存的 WebDAV 配置需要主密码。");
      return;
    }
    await runWebDavAction(async () => webdavTestSavedConnection(masterPassword));
  }

  async function handleSavedWebDavUpload() {
    if (!masterPassword) {
      setSyncMessage("使用保存的 WebDAV 配置需要主密码。");
      return;
    }
    await runWebDavAction(async () => webdavUploadLocalVaultWithSavedConfig(masterPassword));
  }

  async function handleSavedWebDavDownload() {
    if (!masterPassword) {
      setSyncMessage("使用保存的 WebDAV 配置需要主密码。");
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
      setSyncMessage("已使用系统钥匙串数据密钥保存代理设置。");
    } catch (error) {
      setSyncMessage(`Proxy settings failed: ${errorMessage(error)}`);
    }
  }

  async function handleSaveCustomProvider() {
    try {
      const template = JSON.parse(customProviderJson) as ProviderTemplate;
      if (!template.id || !template.name || !template.kind || !template.baseUrl) {
        throw new Error("模板必须包含 id、name、kind 和 baseUrl。");
      }
      const saved = await saveAppSettings({
        ...appSettings,
        customProviderTemplates: [
          ...appSettings.customProviderTemplates.filter((item) => item.id !== template.id),
          { ...template, editable: true },
        ],
      });
      setAppSettings(saved);
      setTemplates(await loadProviderTemplates());
      setActiveProviderId(template.id);
      setCustomProviderJson("");
      setTestResult({ ok: true, providerId: template.id, message: `Saved custom provider ${template.name}.` });
    } catch (error) {
      setTestResult(activeProvider ? { ok: false, providerId: activeProvider.id, message: errorMessage(error) } : null);
    }
  }

  async function handleDeleteCustomProvider() {
    if (!activeProvider?.editable) return;
    const saved = await saveAppSettings({
      ...appSettings,
      customProviderTemplates: appSettings.customProviderTemplates.filter((template) => template.id !== activeProvider.id),
    });
    setAppSettings(saved);
    setTemplates(await loadProviderTemplates());
    setActiveProviderId("openai");
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
        <section><h2><Server size={16} /> 服务商</h2><div className="provider-list">
          {templates.map((provider) => (
            <button key={provider.id} className={provider.id === activeProviderId ? "active" : ""} onClick={() => setActiveProviderId(provider.id)}>
              <span>{provider.name}</span><small>{provider.kind}</small>
            </button>
          ))}
        </div></section>
        <section><h2><MessageSquareText size={16} /> 对话</h2><div className="conversation-list">
          <button onClick={handleNewConversation} className={!currentConversationId ? "active" : ""}>新建对话<small>未保存草稿</small></button>
          {conversationSummaries.map((conversation) => (
            <button key={conversation.id} className={conversation.id === currentConversationId ? "active" : ""} onClick={() => void handleLoadConversation(conversation.id)}>
              <span>{conversation.title}</span><small>{conversation.modelId} · {conversation.messageCount} 条消息</small>
            </button>
          ))}
        </div>{currentConversationId && <button className="danger" onClick={() => void handleDeleteConversation(currentConversationId)}>删除对话</button>}</section>
      </aside>

      <section className="chat-panel">
        <header><div><h1>轻量大模型客户端</h1><p>已支持 OpenAI 兼容接口、Responses、Gemini 与 Anthropic 的流式对话。每次生成结束后会自动保存到本地。</p></div><button className="secondary" onClick={handleListModelsWithSavedKey} disabled={busy || !selectedSecretId}><RefreshCw size={16} /> 刷新模型</button></header>
        <div className="messages">
          {chatMessages.map((message, index) => (
            <article key={index} className={`message ${message.role}`}>
              <span>{chatRoleLabel(message.role)}</span>
              <p>{message.content || (message.role === "assistant" ? "正在生成…" : "")}</p>
              {(message.images?.length ?? 0) > 0 && (
                <div className="message-attachments">
                  {message.images?.map((image, imageIndex) => (
                    <img
                      key={`${image.mediaType}-${imageIndex}`}
                      src={`data:${image.mediaType};base64,${image.dataBase64}`}
                      alt={`附件图片 ${imageIndex + 1}`}
                    />
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        <footer className="composer">
          <button onClick={() => imageInputRef.current?.click()} disabled={busy}><UploadCloud size={18} /> 图片</button>
          <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => void handleImageFiles(event.target.files)} />
          <div className="composer-input">
            {pendingImages.length > 0 && <div className="image-chips">{pendingImages.map((image, index) => <span key={`${image.name}-${index}`} className="image-chip">{image.name}<button onClick={() => setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
            <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) void handleSendChat(); }} placeholder="向所选模型发送测试消息…" />
          </div>
          {currentStreamId ? <button className="danger inline" onClick={handleStopChat}>停止</button> : <button className="primary" disabled={busy || !selectedSecretId || !selectedModel || (!chatInput.trim() && pendingImages.length === 0)} onClick={handleSendChat}>发送</button>}
        </footer>
      </section>

      <aside className="inspector">
        <section className="card"><h2><KeyRound size={16} /> API 密钥库</h2><p>新记录使用系统钥匙串数据密钥保存。仅旧记录、迁移或 WebDAV 配置需要主密码。</p><label>主密码<input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="用于旧记录或 WebDAV 配置" /></label><label>已保存密钥<select value={selectedSecretId} onChange={(event) => setSelectedSecretId(event.target.value)}><option value="">选择已保存密钥</option>{providerSecrets.map((secret) => <option key={secret.id} value={secret.id}>{secret.displayName}</option>)}</select></label><div className="button-row"><button onClick={handleListModelsWithSavedKey} disabled={busy || !selectedSecretId}>拉取模型</button><button className="primary" onClick={handleTestProviderWithSavedKey} disabled={busy || !selectedSecretId}>测试密钥</button></div><button className="secondary full" onClick={handleMigrateSavedKey} disabled={busy || !selectedSecretId || !masterPassword}>将旧密钥迁移至系统钥匙串</button><button className="danger" onClick={handleDeleteSavedKey} disabled={busy || !selectedSecretId}>删除已保存密钥</button>{testResult && <p className={testResult.ok ? "ok" : "warn"}>{testResult.message}</p>}</section>
        <section className="card"><h2>备份</h2><p>加密备份会保留加密记录。明文导出受到刻意限制，仅建议用于迁移。</p><input ref={encryptedBackupInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImportBackup(event.target.files, "encrypted")} /><input ref={plaintextBackupInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImportBackup(event.target.files, "plaintext")} /><div className="button-row"><button onClick={() => void handleExportEncryptedBackup()} disabled={busy}>导出加密备份</button><button onClick={() => encryptedBackupInputRef.current?.click()} disabled={busy}>导入加密备份</button></div><label>输入 EXPORT 以允许明文导出<input value={plaintextExportConfirmation} onChange={(event) => setPlaintextExportConfirmation(event.target.value)} placeholder="EXPORT" /></label><div className="button-row"><button className="danger inline" onClick={() => void handleExportPlaintextBackup()} disabled={busy || plaintextExportConfirmation !== "EXPORT"}>导出明文 JSON</button><button onClick={() => plaintextBackupInputRef.current?.click()} disabled={busy}>导入明文 JSON</button></div></section>
        <section className="card"><h2>系统钥匙串</h2><p>默认密钥库模式使用操作系统钥匙串数据密钥保护新记录。只要仍有记录依赖该密钥，就不能将其删除。</p>{keychainStatus && <p className={keychainStatus.available ? "ok" : "warn"}>{keychainStatus.message}</p>}<dl><dt>服务</dt><dd>{keychainStatus?.service ?? "app.keysync.ai"}</dd><dt>账户</dt><dd>{keychainStatus?.account ?? "vault-data-key"}</dd><dt>数据密钥</dt><dd>{keychainStatus?.hasDataKey ? "已存在" : "缺失"}</dd></dl><div className="button-row"><button onClick={reloadSystemKeychainStatus} disabled={busy}>刷新</button><button className="primary" onClick={handleInitSystemKeychain} disabled={busy}>初始化数据密钥</button></div><button className="danger" onClick={handleDeleteSystemKeychain} disabled={busy || !keychainStatus?.hasDataKey}>删除数据密钥</button></section>
        <section className="card"><h2>保存新密钥</h2><label>显示名称<input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="个人 OpenAI 密钥" /></label><label>API 密钥<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-… 或服务商令牌" /></label><div className="button-row"><button onClick={handleListModelsWithRawKey} disabled={busy || !apiKey.trim()}>拉取模型</button><button onClick={handleTestProviderWithRawKey} disabled={busy || !apiKey.trim()}>测试当前密钥</button></div><button className="primary full" onClick={handleSaveKey} disabled={busy || !apiKey.trim()}>使用系统钥匙串保存</button><button className="secondary full" onClick={handleSaveKeyWithMasterPassword} disabled={busy || !apiKey.trim() || !masterPassword}>使用主密码保存</button></section>
        <section className="card"><h2>代理</h2><p>支持 HTTP、HTTPS 或 SOCKS5 URL。URL 中的凭据会使用系统钥匙串数据密钥在本地加密。</p><label>全局代理<input type="password" value={appSettings.globalProxyUrl ?? ""} onChange={(event) => setAppSettings((current) => ({ ...current, globalProxyUrl: event.target.value || undefined }))} placeholder="socks5://user:password@host:1080" /></label>{activeProvider && <><label>{activeProvider.name} 专用代理<input type="password" value={appSettings.providerProxyUrls[activeProvider.id] ?? ""} onChange={(event) => setAppSettings((current) => ({ ...current, providerProxyUrls: { ...current.providerProxyUrls, [activeProvider.id]: event.target.value } }))} placeholder="留空则使用全局代理" /></label><label className="checkbox-label"><input type="checkbox" checked={appSettings.providerProxyDisabled.includes(activeProvider.id)} onChange={(event) => setAppSettings((current) => ({ ...current, providerProxyDisabled: event.target.checked ? [...new Set([...current.providerProxyDisabled, activeProvider.id])] : current.providerProxyDisabled.filter((providerId) => providerId !== activeProvider.id) }))} />此服务商直接连接</label></>}<p>当前路由：{activeProxyUrl ? "自定义代理" : "直接连接"}</p><button className="primary full" onClick={() => void handleSaveProxySettings()} disabled={busy}>加密保存代理设置</button></section>
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
        {conflictRecords.length > 0 && <section className="card"><h2>冲突处理</h2><p>合并时已保留远端冲突副本。重命名即可保留，也可以删除重复副本。</p><div className="model-list">{conflictRecords.map((record) => <span key={record.id}>{record.displayName}<small>{record.providerId} · {record.updatedAt}</small><input value={conflictRename[record.id] ?? record.displayName.replace(" [conflict remote]", "")} onChange={(event) => setConflictRename({ ...conflictRename, [record.id]: event.target.value })} /><div className="button-row"><button onClick={() => void handleAcceptConflict(record)} disabled={busy}>保留并重命名</button><button className="danger" onClick={() => void deleteRecord(record.id, "已删除冲突副本。")} disabled={busy}>删除冲突副本</button></div></span>)}</div></section>}
        <section className="card"><h2>当前服务商</h2>{activeProvider ? <><dl><dt>名称</dt><dd>{activeProvider.name}</dd><dt>基础 URL</dt><dd>{activeProvider.baseUrl}</dd><dt>流式输出</dt><dd>{activeProvider.supportsStreaming ? "支持" : "不支持"}</dd><dt>图片输入</dt><dd>{activeProvider.supportsImages ? "支持" : "不支持"}</dd></dl>{activeProvider.editable && <button className="danger" onClick={() => void handleDeleteCustomProvider()}>删除自定义服务商</button>}</> : <p>尚未加载服务商。</p>}</section>
        <section className="card"><h2>自定义服务商模板</h2><p>粘贴 OpenAI 兼容或服务商专用模板；它会加密保存在本地设置中。</p><textarea value={customProviderJson} onChange={(event) => setCustomProviderJson(event.target.value)} placeholder={'{"id":"my-provider","name":"我的服务商","kind":"openai_compatible","baseUrl":"https://api.example.com/v1","modelsPath":"/models","chatPath":"/chat/completions","supportsStreaming":true,"supportsImages":false}'} /><button className="primary full" onClick={() => void handleSaveCustomProvider()} disabled={!customProviderJson.trim()}>保存自定义模板</button></section>
        <section className="card"><h2>模型</h2>{models.length ? <><label>当前模型<select value={selectedModel} onChange={(event) => applySelectedModel(event.target.value)}>{models.filter((model) => !model.isHidden || model.id === selectedModel).map((model) => <option key={model.id} value={model.id}>{model.isFavorite ? "★ " : ""}{model.alias || model.displayName}</option>)}</select></label>{selectedModelInfo && <><label>模型别名<input value={modelAlias} onChange={(event) => setModelAlias(event.target.value)} placeholder={selectedModelInfo.displayName} /></label><div className="button-row"><button onClick={() => void handleSaveModelPreferences()}>保存别名</button><button onClick={() => void handleSaveModelPreferences({ favorite: !selectedModelInfo.isFavorite })}>{selectedModelInfo.isFavorite ? "取消收藏" : "收藏"}</button></div><div className="button-row"><button onClick={() => void handleSaveModelPreferences({ saveCurrentDefaults: true })}>保存当前参数</button><button className="danger inline" onClick={() => void handleSaveModelPreferences({ hidden: !selectedModelInfo.isHidden })}>{selectedModelInfo.isHidden ? "显示模型" : "隐藏模型"}</button></div></>}<div className="model-list">{models.filter((model) => !model.isHidden).slice(0, 8).map((model) => <span key={model.id}>{model.isFavorite ? "★ " : ""}{model.alias || model.displayName}<small>{model.capabilities.join(", ")}</small></span>)}</div></> : <p>尚未加载模型。</p>}</section>
        <section className="card"><h2>模型参数</h2><label>系统提示词<textarea value={chatMessages.find((message) => message.role === "system")?.content ?? ""} onChange={(event) => updateChatMessages((messages) => [{ role: "system", content: event.target.value }, ...messages.filter((message) => message.role !== "system")])} placeholder="你是一位乐于助人的助手。" /></label><label>温度<input type="number" value={temperature} min="0" max="2" step="0.1" onChange={(event) => setTemperature(event.target.value)} /></label><label>最大输出 Token<input type="number" value={maxTokens} min="1" step="1" onChange={(event) => setMaxTokens(event.target.value)} /></label><label>上下文长度<input type="number" value={contextLength} min="256" step="256" onChange={(event) => setContextLength(event.target.value)} /></label><p>发送前会按上下文长度裁剪较早的消息。图片会保存在对话中，并仅在对应轮次保留时参与请求。</p></section>
      </aside>
    </main>
  );
}
