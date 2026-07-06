import type { Dispatch, SetStateAction } from "react";

import type { WebDavConfig, WebDavConfigSummary } from "../types";

interface WebDavSyncCardProps {
  busy: boolean;
  masterPassword: string;
  savedWebdavSummary: WebDavConfigSummary | null;
  syncMessage: string;
  webdavConfig: WebDavConfig;
  setWebdavConfig: Dispatch<SetStateAction<WebDavConfig>>;
  onTestRaw: () => void | Promise<void>;
  onSaveConfig: () => void | Promise<void>;
  onUploadRaw: () => void | Promise<void>;
  onDownloadRaw: () => void | Promise<void>;
  onTestSaved: () => void | Promise<void>;
  onUnlockSaved: () => void | Promise<void>;
  onUploadSaved: () => void | Promise<void>;
  onDownloadSaved: () => void | Promise<void>;
}

export function WebDavSyncCard({
  busy,
  masterPassword,
  savedWebdavSummary,
  syncMessage,
  webdavConfig,
  setWebdavConfig,
  onTestRaw,
  onSaveConfig,
  onUploadRaw,
  onDownloadRaw,
  onTestSaved,
  onUnlockSaved,
  onUploadSaved,
  onDownloadSaved,
}: WebDavSyncCardProps) {
  return (
    <section className="card">
      <h2>WebDAV sync</h2>
      <p>Manual MVP sync for the encrypted local vault file. Downloads now merge by record ID and keep conflict copies.</p>
      {savedWebdavSummary && (
        <p className="ok">
          Saved: {savedWebdavSummary.username} @ {savedWebdavSummary.endpoint}/{savedWebdavSummary.remoteDir}
        </p>
      )}
      <label>
        Endpoint
        <input
          value={webdavConfig.endpoint}
          onChange={(event) => setWebdavConfig({ ...webdavConfig, endpoint: event.target.value })}
          placeholder="https://dav.example.com/remote.php/dav/files/user"
        />
      </label>
      <label>
        Remote directory
        <input
          value={webdavConfig.remoteDir}
          onChange={(event) => setWebdavConfig({ ...webdavConfig, remoteDir: event.target.value })}
          placeholder="KeySyncAI"
        />
      </label>
      <label>
        Username
        <input value={webdavConfig.username} onChange={(event) => setWebdavConfig({ ...webdavConfig, username: event.target.value })} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={webdavConfig.password}
          onChange={(event) => setWebdavConfig({ ...webdavConfig, password: event.target.value })}
          placeholder="Required only to save raw config"
        />
      </label>
      <div className="button-row">
        <button onClick={onTestRaw} disabled={busy || !webdavConfig.endpoint}>Test raw</button>
        <button onClick={onSaveConfig} disabled={busy || !webdavConfig.endpoint || !masterPassword}>Save encrypted</button>
      </div>
      <div className="button-row">
        <button onClick={onUploadRaw} disabled={busy || !webdavConfig.endpoint}>Upload raw</button>
        <button onClick={onDownloadRaw} disabled={busy || !webdavConfig.endpoint}>Merge download raw</button>
      </div>
      <div className="button-row">
        <button onClick={onTestSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>Test saved</button>
        <button onClick={onUnlockSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>Unlock to form</button>
      </div>
      <div className="button-row">
        <button onClick={onUploadSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>Upload saved</button>
        <button className="primary" onClick={onDownloadSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>
          Merge download saved
        </button>
      </div>
      {syncMessage && <p className="ok">{syncMessage}</p>}
    </section>
  );
}
