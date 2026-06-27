import { useEffect, useMemo, useState } from "react";
import { KeyRound, MessageSquareText, RefreshCw, Server, ShieldCheck, UploadCloud } from "lucide-react";
import type { ModelInfo, ProviderTemplate, SecretRecordSummary, TestResult } from "./types";
import {
  getAppStatus,
  listModelsWithKey,
  loadProviderTemplates,
  templateToConfig,
  testProviderWithKey,
  vaultDecryptSecretWithMasterPassword,
  vaultDeleteSecretRecord,
  vaultListSecretRecords,
  vaultSaveSecretWithMasterPassword,
} from "./lib/tauri";

const demoMessages = [
  { role: "system", content: "System prompt, temperature, context length, and model settings will be configured here." },
  { role: "user", content: "Test this key and send a minimal request to the selected model." },
  { role: "assistant", content: "Provider adapters normalize model lists, minimal tests, and streaming responses into one UI event format." },
];

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unknown error";
}

export default function App() {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("openai");
  const [status, setStatus] = useState("Loading...");
  const [apiKey, setApiKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [savedSecrets, setSavedSecrets] = useState<SecretRecordSummary[]>([]);
  const [selectedSecretId, setSelectedSecretId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadProviderTemplates().then(setTemplates);
    getAppStatus().then(setStatus);
    reloadVaultRecords();
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
    setSelectedModel("");
    setSelectedSecretId("");
  }, [activeProviderId]);

  async function reloadVaultRecords() {
    try {
      const records = await vaultListSecretRecords();
      setSavedSecrets(records);
    } catch {
      setSavedSecrets([]);
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
      setTestResult({ ok: true, providerId: activeProvider.id, message: `Saved encrypted key: ${record.displayName}` });
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSavedKey() {
    if (!selectedSecretId) return;
    setBusy(true);
    try {
      await vaultDeleteSecretRecord(selectedSecretId);
      setSelectedSecretId("");
      await reloadVaultRecords();
      setTestResult(activeProvider ? { ok: true, providerId: activeProvider.id, message: "Deleted saved key." } : null);
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

  async function unlockSelectedSecret() {
    if (!activeProvider || !selectedSecretId || !masterPassword) return null;
    setBusy(true);
    setTestResult(null);
    try {
      return await vaultDecryptSecretWithMasterPassword(selectedSecretId, masterPassword);
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
      return null;
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
          <button className="active">MVP architecture review</button><button>Provider test scratchpad</button><button>Vision model check</button>
        </div></section>
      </aside>

      <section className="chat-panel">
        <header><div><h1>Lightweight chat client</h1><p>Streaming chat, stop generation, image input, and model switching will live here.</p></div><button className="secondary" onClick={handleListModelsWithSavedKey} disabled={busy || !selectedSecretId || !masterPassword}><RefreshCw size={16} /> Refresh models</button></header>
        <div className="messages">
          {demoMessages.map((message, index) => <article key={index} className={`message ${message.role}`}><span>{message.role}</span><p>{message.content}</p></article>)}
        </div>
        <footer className="composer"><button><UploadCloud size={18} /> Image</button><input placeholder="Send a test message to the selected model..." /><button className="primary">Send</button></footer>
      </section>

      <aside className="inspector">
        <section className="card"><h2><KeyRound size={16} /> API key vault</h2><p>Keys are stored as encrypted local vault records. Master password unlock is required before testing a saved key.</p><label>Master password<input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="Required to save or unlock" /></label><label>Saved key<select value={selectedSecretId} onChange={(event) => setSelectedSecretId(event.target.value)}><option value="">Select saved key</option>{providerSecrets.map((secret) => <option key={secret.id} value={secret.id}>{secret.displayName}</option>)}</select></label><div className="button-row"><button onClick={handleListModelsWithSavedKey} disabled={busy || !selectedSecretId || !masterPassword}>List saved</button><button className="primary" onClick={handleTestProviderWithSavedKey} disabled={busy || !selectedSecretId || !masterPassword}>Test saved</button></div><button className="danger" onClick={handleDeleteSavedKey} disabled={busy || !selectedSecretId}>Delete saved key</button>{testResult && <p className={testResult.ok ? "ok" : "warn"}>{testResult.message}</p>}</section>
        <section className="card"><h2>Save new key</h2><label>Display name<input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Personal OpenAI key" /></label><label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-... or provider token" /></label><div className="button-row"><button onClick={handleListModelsWithRawKey} disabled={busy || !apiKey.trim()}>List raw</button><button onClick={handleTestProviderWithRawKey} disabled={busy || !apiKey.trim()}>Test raw</button></div><button className="primary full" onClick={handleSaveKey} disabled={busy || !apiKey.trim() || !masterPassword}>Encrypt and save</button></section>
        <section className="card"><h2>Active provider</h2>{activeProvider ? <dl><dt>Name</dt><dd>{activeProvider.name}</dd><dt>Base URL</dt><dd>{activeProvider.baseUrl}</dd><dt>Streaming</dt><dd>{activeProvider.supportsStreaming ? "Supported" : "Not supported"}</dd><dt>Images</dt><dd>{activeProvider.supportsImages ? "Supported" : "Not supported"}</dd></dl> : <p>No provider loaded.</p>}</section>
        <section className="card"><h2>Models</h2>{models.length ? <><label>Selected model<select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label><div className="model-list">{models.slice(0, 8).map((model) => <span key={model.id}>{model.displayName}<small>{model.capabilities.join(", ")}</small></span>)}</div></> : <p>No models loaded yet.</p>}</section>
        <section className="card"><h2>Model params</h2><label>System prompt<textarea placeholder="You are a helpful assistant." /></label><label>Temperature<input type="number" defaultValue="0.7" step="0.1" /></label><label>Context length<input type="number" defaultValue="8192" /></label></section>
      </aside>
    </main>
  );
}
