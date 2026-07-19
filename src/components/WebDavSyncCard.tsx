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
  onUploadSettings: () => void | Promise<void>;
  onDownloadSettings: () => void | Promise<void>;
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
  onUploadSettings,
  onDownloadSettings,
}: WebDavSyncCardProps) {
  return (
    <section className="card">
      <h2>WebDAV 同步</h2>
      <p>手动同步本地加密密钥库。下载会按记录 ID 合并，并保留冲突副本。</p>
      {savedWebdavSummary && (
        <p className="ok">
          已保存：{savedWebdavSummary.username} @ {savedWebdavSummary.endpoint}/{savedWebdavSummary.remoteDir}
        </p>
      )}
      <label>
        服务地址
        <input
          value={webdavConfig.endpoint}
          onChange={(event) => setWebdavConfig({ ...webdavConfig, endpoint: event.target.value })}
          placeholder="https://dav.example.com/remote.php/dav/files/user"
        />
      </label>
      <label>
        远程目录
        <input
          value={webdavConfig.remoteDir}
          onChange={(event) => setWebdavConfig({ ...webdavConfig, remoteDir: event.target.value })}
          placeholder="KeySyncAI"
        />
      </label>
      <label>
        用户名
        <input value={webdavConfig.username} onChange={(event) => setWebdavConfig({ ...webdavConfig, username: event.target.value })} />
      </label>
      <label>
        密码
        <input
          type="password"
          value={webdavConfig.password}
          onChange={(event) => setWebdavConfig({ ...webdavConfig, password: event.target.value })}
          placeholder="仅保存原始配置时需要"
        />
      </label>
      <div className="button-row">
        <button onClick={onTestRaw} disabled={busy || !webdavConfig.endpoint}>测试当前配置</button>
        <button onClick={onSaveConfig} disabled={busy || !webdavConfig.endpoint || !masterPassword}>加密保存</button>
      </div>
      <div className="button-row">
        <button onClick={onUploadRaw} disabled={busy || !webdavConfig.endpoint}>上传当前密钥库</button>
        <button onClick={onDownloadRaw} disabled={busy || !webdavConfig.endpoint}>下载并合并</button>
      </div>
      <div className="button-row">
        <button onClick={onTestSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>测试已保存配置</button>
        <button onClick={onUnlockSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>解锁并填入表单</button>
      </div>
      <div className="button-row">
        <button onClick={onUploadSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>上传已保存密钥库</button>
        <button className="primary" onClick={onDownloadSaved} disabled={busy || !savedWebdavSummary || !masterPassword}>
          下载已保存密钥库并合并
        </button>
      </div>
      <div className="button-row">
        <button onClick={onUploadSettings} disabled={busy || !savedWebdavSummary || !masterPassword}>上传设置与模型偏好</button>
        <button onClick={onDownloadSettings} disabled={busy || !savedWebdavSummary || !masterPassword}>下载设置并合并</button>
      </div>
      {syncMessage && <p className="ok">{syncMessage}</p>}
    </section>
  );
}
