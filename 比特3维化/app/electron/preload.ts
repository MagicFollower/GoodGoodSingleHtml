// preload：只做 contextBridge 转接，不含业务逻辑（sandbox 下也只能用这两个 API）。

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';

type Handler = (...a: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

function on(channel: string, fn: Handler) {
  const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => fn(...args);
  // 先摘掉同名的旧监听再挂：React StrictMode 下 effect 会跑两遍，
  // 不摘就会留下一个"不在 map 里、offAll 摘不掉"的幽灵监听。
  ipcRenderer.removeAllListeners(channel);
  handlers.set(channel, wrapped as Handler);
  ipcRenderer.on(channel, wrapped);
}

const api = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  pickFiles: (kind: string) => ipcRenderer.invoke('files:pick', kind),
  pickDir: () => ipcRenderer.invoke('dir:pick'),
  pickDemo: () => ipcRenderer.invoke('files:demo'),
  exists: (p: string) => ipcRenderer.invoke('path:exists', p),
  defaultOut: (inPath: string, kind: string) => ipcRenderer.invoke('path:defaultOut', inPath, kind),
  runJob: (job: unknown) => ipcRenderer.invoke('job:run', job),
  inspect: (p: string) => ipcRenderer.invoke('container:inspect', p),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  reveal: (p: string) => ipcRenderer.invoke('shell:reveal', p),
  openFolder: (dir: string) => ipcRenderer.invoke('shell:openFolder', dir),
  ping: () => ipcRenderer.invoke('app:info'),
  // Electron 32 起 File.path 被移除，拖放取绝对路径只能走 webUtils.getPathForFile（必须在 preload 里调）
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onJobProgress: (fn: Handler) => on('job:progress', fn),
  onJobPhase: (fn: Handler) => on('job:phase', fn),
  onThemeChanged: (fn: Handler) => on('theme:changed', fn),
  offAll: () => {
    for (const [channel, h] of handlers) ipcRenderer.removeListener(channel, h as (...a: unknown[]) => void);
    handlers.clear();
  }
};

contextBridge.exposeInMainWorld('api', api);

export type PreloadApi = typeof api;
