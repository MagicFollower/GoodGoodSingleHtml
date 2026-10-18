// 渲染层能拿到的主进程能力（由 preload 经 contextBridge 暴露）。
// 类型必须与 electron/preload.ts 的实现同步：改一边就要改另一边，否则 tsc 会红。

export type JobKind = 'encode' | 'decode';
export type Theme = 'system' | 'light' | 'dark';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type PickedFile = { path: string; name: string; size: number };
export type JobResult =
  | { ok: true; ms: number; origSize?: number; layerCount?: number; outSize?: number; written?: number; outPath?: string }
  | { ok: false; ms: number; code: string; message: string };

export type ProgressPayload = { id: string; done: number; total: number; pct: number; bps: number; phase: string };
export type PhasePayload = { id: string; phase: string; total: number };

export type Settings = {
  theme: Theme;
  outDir: string;
  decodeStrategy: 'strip' | 'suffix';
  collision: 'ask' | 'rename' | 'overwrite';
  revealDek: boolean;
  keepLog: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
};

export type AppInfo = {
  app: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userData: string;
  dark: boolean;
  themeSource: string;
  sdkHeader: number;
  sdkLayerBytes: number;
};

export type InspectResult = {
  fileSize: number;
  origSize: number;
  layerCount: number;
  fullLayers: number;
  tailBytes: number;
  dimX: number;
  dimY: number;
  flags: string;
  nonceHex: string;
  dekHex: string;
  tagHex: string;
  overhead: number;
  sha256: string;
};

export type Api = {
  appInfo(): Promise<AppInfo>;
  pickFiles(kind: JobKind): Promise<PickedFile[]>;
  pickDir(): Promise<string>;
  pickDemo(): Promise<PickedFile[]>;
  exists(p: string): Promise<boolean>;
  defaultOut(inPath: string, kind: JobKind): Promise<string>;
  runJob(job: { id: string; kind: JobKind; inPath: string; outPath: string }): Promise<JobResult>;
  inspect(p: string): Promise<InspectResult>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  reveal(p: string): Promise<string>;
  openFolder(dir: string): Promise<string>;
  ping(): Promise<AppInfo>;
  pathForFile(file: File): string;
  onJobProgress(fn: (p: ProgressPayload) => void): void;
  onJobPhase(fn: (p: PhasePayload) => void): void;
  onThemeChanged(fn: (dark: boolean) => void): void;
  offAll(): void;
};

declare global {
  interface Window {
    api: Api;
  }
}

export const KB = 1024;
export const MB = KB * 1024;

export const GB = MB * 1024;

export const fmtBytes = (n: number) => {
  if (!Number.isFinite(n)) return '—';
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(n / KB < 10 ? 1 : 0)} KB`;
  if (n < GB) { const m = n / MB; return `${m.toFixed(m < 10 ? 2 : 1)} MB`; }
  return `${(n / GB).toFixed(n / GB < 10 ? 2 : 0)} GB`;
};

export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);

export const fmtRate = (bps: number) => `${fmtBytes(bps)}/s`;

export const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

export const extOf = (p: string) => {
  const n = baseName(p);
  const i = n.lastIndexOf('.');
  return i <= 0 ? '' : n.slice(i + 1).toLowerCase();
};

export const isContainer = (p: string) => p.toLowerCase().endsWith('.bt3d');
