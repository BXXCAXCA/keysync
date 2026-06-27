import { useEffect, useMemo, useState } from "react";
import { KeyRound, MessageSquareText, RefreshCw, Server, ShieldCheck, UploadCloud } from "lucide-react";
import type { ProviderTemplate, TestResult } from "./types";
import { getAppStatus, loadProviderTemplates, runProviderTest } from "./lib/tauri";

const demoMessages = [
  { role: "system", content: "System prompt, temperature, context length, and model settings will be configured here." },
  { role: "user", content: "Test this key and send a minimal request to the selected model." },
  { role: "assistant", content: "Provider adapters will normalize streaming responses into one UI event format." },
];

export default function App() {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("openai");
  const [status, setStatus] = useState("Loading...");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    loadProviderTemplates().then(setTemplates);
    getAppStatus().then(setStatus);
  }, []);

  const activeProvider = useMemo(
    () => templates.find((provider) => provider.id === activeProviderId) ?? templates[0],
    [templates, activeProviderId]
  );

  async function handleTestProvider() {
    if (!activeProvider) return;
    setTestResult(await runProviderTest(activeProvider.id));
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
        <header><div><h1>Lightweight chat client</h1><p>Streaming chat, stop generation, image input, and model switching will live here.</p></div><button className="secondary"><RefreshCw size={16} /> Refresh models</button></header>
        <div className="messages">
          {demoMessages.map((message, index) => <article key={index} className={`message ${message.role}`}><span>{message.role}</span><p>{message.content}</p></article>)}
        </div>
        <footer className="composer"><button><UploadCloud size={18} /> Image</button><input placeholder="Send a test message to the selected model..." /><button className="primary">Send</button></footer>
      </section>

      <aside className="inspector">
        <section className="card"><h2><KeyRound size={16} /> API key vault</h2><p>Keys are hidden by default. Plaintext reveal will require system verification or master password unlock.</p><button className="primary">Add encrypted key</button></section>
        <section className="card"><h2>Active provider</h2>{activeProvider ? <dl><dt>Name</dt><dd>{activeProvider.name}</dd><dt>Base URL</dt><dd>{activeProvider.baseUrl}</dd><dt>Streaming</dt><dd>{activeProvider.supportsStreaming ? "Supported" : "Not supported"}</dd><dt>Images</dt><dd>{activeProvider.supportsImages ? "Supported" : "Not supported"}</dd></dl> : <p>No provider loaded.</p>}<button onClick={handleTestProvider}>Run placeholder test</button>{testResult && <p className={testResult.ok ? "ok" : "warn"}>{testResult.message}</p>}</section>
        <section className="card"><h2>Model params</h2><label>System prompt<textarea placeholder="You are a helpful assistant." /></label><label>Temperature<input type="number" defaultValue="0.7" step="0.1" /></label><label>Context length<input type="number" defaultValue="8192" /></label></section>
      </aside>
    </main>
  );
}
