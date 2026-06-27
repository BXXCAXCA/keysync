import { useEffect, useMemo, useState } from "react";
import { KeyRound, MessageSquareText, RefreshCw, Server, ShieldCheck, UploadCloud } from "lucide-react";
import type { ModelInfo, ProviderTemplate, TestResult } from "./types";
import { getAppStatus, listModelsWithKey, loadProviderTemplates, templateToConfig, testProviderWithKey } from "./lib/tauri";

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
  const [selectedModel, setSelectedModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadProviderTemplates().then(setTemplates);
    getAppStatus().then(setStatus);
  }, []);

  const activeProvider = useMemo(
    () => templates.find((provider) => provider.id === activeProviderId) ?? templates[0],
    [templates, activeProviderId]
  );

  useEffect(() => {
    setModels([]);
    setTestResult(null);
    setSelectedModel("");
  }, [activeProviderId]);

  async function handleListModels() {
    if (!activeProvider || !apiKey.trim()) return;
    setBusy(true);
    setTestResult(null);
    try {
      const result = await listModelsWithKey(templateToConfig(activeProvider), apiKey.trim());
      setModels(result);
      setSelectedModel(result[0]?.id ?? "");
      setTestResult({ ok: true, providerId: activeProvider.id, modelCount: result.length, message: `Fetched ${result.length} models.` });
    } catch (error) {
      setTestResult({ ok: false, providerId: activeProvider.id, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleTestProvider() {
    if (!activeProvider || !apiKey.trim()) return;
    setBusy(true);
    setTestResult(null);
    try {
      const result = await testProviderWithKey(templateToConfig(activeProvider), apiKey.trim(), selectedModel || undefined);
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
        <header><div><h1>Lightweight chat client</h1><p>Streaming chat, stop generation, image input, and model switching will live here.</p></div><button className="secondary" onClick={handleListModels} disabled={busy || !apiKey.trim()}><RefreshCw size={16} /> Refresh models</button></header>
        <div className="messages">
          {demoMessages.map((message, index) => <article key={index} className={`message ${message.role}`}><span>{message.role}</span><p>{message.content}</p></article>)}
        </div>
        <footer className="composer"><button><UploadCloud size={18} /> Image</button><input placeholder="Send a test message to the selected model..." /><button className="primary">Send</button></footer>
      </section>

      <aside className="inspector">
        <section className="card"><h2><KeyRound size={16} /> API key test</h2><p>Temporary test input only. The next milestone stores keys through the encrypted vault instead of keeping them in UI state.</p><label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-... or provider token" /></label><div className="button-row"><button onClick={handleListModels} disabled={busy || !apiKey.trim()}>List models</button><button className="primary" onClick={handleTestProvider} disabled={busy || !apiKey.trim()}>Test key</button></div>{testResult && <p className={testResult.ok ? "ok" : "warn"}>{testResult.message}</p>}</section>
        <section className="card"><h2>Active provider</h2>{activeProvider ? <dl><dt>Name</dt><dd>{activeProvider.name}</dd><dt>Base URL</dt><dd>{activeProvider.baseUrl}</dd><dt>Streaming</dt><dd>{activeProvider.supportsStreaming ? "Supported" : "Not supported"}</dd><dt>Images</dt><dd>{activeProvider.supportsImages ? "Supported" : "Not supported"}</dd></dl> : <p>No provider loaded.</p>}</section>
        <section className="card"><h2>Models</h2>{models.length ? <><label>Selected model<select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label><div className="model-list">{models.slice(0, 8).map((model) => <span key={model.id}>{model.displayName}<small>{model.capabilities.join(", ")}</small></span>)}</div></> : <p>No models loaded yet.</p>}</section>
        <section className="card"><h2>Model params</h2><label>System prompt<textarea placeholder="You are a helpful assistant." /></label><label>Temperature<input type="number" defaultValue="0.7" step="0.1" /></label><label>Context length<input type="number" defaultValue="8192" /></label></section>
      </aside>
    </main>
  );
}
