// BT3D Box 主进程。
//
// 加解密一律走 electron/vendor/ 下的两份单文件实现（sdk/ 的逐字节拷贝，构建期校验哈希）。
// 主进程不实现任何格式逻辑，只做：窗口、文件对话框、任务编排、进度回灌、设置持久化、自证。

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import fsSync, { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installChaCha20Shim, rfc8439Vector, shimSample } from './chacha20-shim';

type Theme = 'system' | 'light' | 'dark';
type JobKind = 'encode' | 'decode';
type Settings = {
  theme: Theme;
  outDir: string;
  decodeStrategy: 'strip' | 'suffix';       // 去掉 .bt3d / 追加 .restored
  collision: 'ask' | 'rename' | 'overwrite';
  revealDek: boolean;
  keepLog: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
};

const APP_TITLE = 'BT3D Box';
const DEFAULTS: Settings = {
  theme: 'system',
  outDir: '',
  decodeStrategy: 'strip',
  collision: 'rename',
  revealDek: false,
  keepLog: true,
};

const SELFTEST = process.argv.includes('--selftest');
const SHOOT_IDX = process.argv.indexOf('--shoot');
const SHOOT_DIR = SHOOT_IDX >= 0 ? process.argv[SHOOT_IDX + 1] : '';
const PROBE = process.argv.includes('--probe');
// 自证/截图这一趟不许动用户状态：不写 settings.json、不记忆窗口几何、不读回旧几何。
const EPHEMERAL = SELFTEST || !!SHOOT_DIR || PROBE;
const SELF_LOG: string[] = [];
const say = (line: string) => {
  SELF_LOG.push(line);
  console.log(line);
};

process.stdout.on('error', () => {});      // 探针接了已关闭的管道时不要弹模态错误框
process.stderr.on('error', () => {});

function requireVendor<T = any>(file: string): T {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(__dirname, file)) as T;
}

type SdkEncode = { encodeFile: (i: string, o?: string, opt?: any) => Promise<any>; defaultOutPath: (i: string) => string; SUFFIX: string; Bt3dError: any; HEADER_SIZE: number; LAYER_BYTES: number };
type SdkDecode = { decodeFile: (i: string, o: string) => Promise<any>; readHeader: (i: string) => Promise<any>; parseHeader: (b: Buffer, n?: number) => any; HEADER_SIZE: number; LAYER_BYTES: number };

// Electron 的 Node 挂在 BoringSSL 上，没有 chacha20（实测见 bin/crypto-probe.cjs）。
// 必须在用到密钥流之前装垫片；系统 Node 下 native 可用时这个函数什么都不做。
const shim = installChaCha20Shim();

const enc = requireVendor<SdkEncode>('bt3d-encode.js');
const dec = requireVendor<SdkDecode>('bt3d-decode.js');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings: Settings = { ...DEFAULTS };

function loadSettings() {
  try {
    const raw = JSON.parse(fsSync.readFileSync(settingsPath(), 'utf8'));
    settings = { ...DEFAULTS, ...raw };
  } catch {
    settings = { ...DEFAULTS };
  }
}
function saveSettings() {
  if (EPHEMERAL) return;
  try {
    fsSync.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fsSync.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    say(`settings-save-fail ${String((e as Error).message)}`);
  }
}

let win: BrowserWindow | null = null;

function applyThemeSource(source: Theme) {
  nativeTheme.themeSource = source;      // 属性名是 themeSource，不是 theme
}

function windowBg(): string {
  return nativeTheme.shouldUseDarkColors ? '#0b0f17' : '#f5f7fb';
}

function clampBoundsIntoWorkArea(b: { x: number; y: number; width: number; height: number }) {
  const displays = screen.getAllDisplays();
  const visible = displays.find((d) =>
    b.x + 120 > d.workArea.x && b.x < d.workArea.x + d.workArea.width - 120 &&
    b.y + 60 > d.workArea.y && b.y < d.workArea.y + d.workArea.height - 60);
  const area = (visible || displays[0]).workArea;
  const width = Math.min(b.width, area.width);
  const height = Math.min(b.height, area.height);
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

function createWindow() {
  applyThemeSource(settings.theme);
  const saved = !EPHEMERAL && settings.bounds && settings.bounds.width > 0 ? clampBoundsIntoWorkArea(settings.bounds) : null;
  win = new BrowserWindow({
    title: APP_TITLE,
    ...(saved ? saved : { width: 1280, height: 820 }),
    minWidth: 940,
    minHeight: 620,
    backgroundColor: windowBg(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // 标题只有一个真源：不 preventDefault 的话 index.html 的 <title> 会盖掉主进程设定
  win.on('page-title-updated', (e) => e.preventDefault());

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), SHOOT_DIR ? { search: 'demo=1' } : undefined);

  win.once('ready-to-show', () => {
    win!.show();
    say(`window-shown title=${win!.getTitle()} dark=${nativeTheme.shouldUseDarkColors}`);
  });

  const persist = () => {
    if (!win) return;
    const b = win.getBounds();
    settings.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    saveSettings();
  };
  win.on('move', persist);
  win.on('resize', persist);
  win.on('closed', () => { win = null; });

  nativeTheme.on('updated', () => {
    win?.setBackgroundColor(windowBg());
    win?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
  });
}

function send(channel: string, payload: unknown) {
  win?.webContents.send(channel, payload);
}

// ---- IPC ----

ipcMain.handle('app:info', () => ({
  app: APP_TITLE,
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: `${process.platform} ${os.release()} ${process.arch}`,
  userData: app.getPath('userData'),
  dark: nativeTheme.shouldUseDarkColors,
  themeSource: nativeTheme.themeSource,
  sdkHeader: enc.HEADER_SIZE,
  sdkLayerBytes: enc.LAYER_BYTES,
  shimInstalled: shim.installed,
  shimReason: shim.reason
}));

ipcMain.handle('files:pick', async (_e, kind: JobKind) => {
  const r = await dialog.showOpenDialog(win!, {
    title: kind === 'encode' ? '选择要混淆的文件' : '选择要还原的 .bt3d 容器',
    buttonLabel: '加入任务',
    properties: ['openFile', 'multiSelections'],
    filters: kind === 'encode'
      ? [{ name: '所有文件', extensions: ['*'] }]
      : [{ name: 'BT3D 容器', extensions: ['bt3d'] }, { name: '所有文件', extensions: ['*'] }]
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) continue;
      out.push({ path: p, name: path.basename(p), size: st.size });
    } catch { /* 读不到的项直接跳过，不入队 */ }
  }
  return out;
});

ipcMain.handle('dir:pick', async () => {
  const r = await dialog.showOpenDialog(win!, { title: '选择输出目录', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? '' : r.filePaths[0];
});

ipcMain.handle('path:exists', (_e, p: string) => fsSync.existsSync(p));
ipcMain.handle('path:defaultOut', (_e, inPath: string, kind: JobKind) => resolveOut(inPath, kind));
ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle('shell:openFolder', (_e, dir: string) => shell.openPath(dir));

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  const before = settings.theme;
  settings = { ...settings, ...patch };
  if (settings.theme !== before) applyThemeSource(settings.theme);
  saveSettings();
  return settings;
});

ipcMain.handle('container:inspect', (_e, p: string) => inspectContainer(p));

ipcMain.handle('job:run', async (_e, job: { id: string; kind: JobKind; inPath: string; outPath: string }) => {
  const total = job.kind === 'encode'
    ? (await fs.stat(job.inPath)).size
    : (await dec.readHeader(job.inPath)).origSize;

  send('job:phase', { id: job.id, phase: job.kind === 'decode' ? 'verifying' : 'writing', total });
  const started = Date.now();
  const sdk = job.kind === 'encode' ? enc : dec;
  const task = job.kind === 'encode'
    ? (sdk as SdkEncode).encodeFile(job.inPath, job.outPath)
    : (sdk as SdkDecode).decodeFile(job.inPath, job.outPath);

  const timer = setInterval(() => {
    try {
      const size = fsSync.statSync(job.outPath).size;
      const done = job.kind === 'encode' ? Math.max(0, Math.min(total, size - enc.HEADER_SIZE)) : Math.min(total, size);
      const bps = done / Math.max(1, (Date.now() - started) / 1000);
      send('job:progress', { id: job.id, done, total, pct: total ? done / total : 1, bps, phase: 'writing' });
    } catch { /* 输出文件还没创建（解码的校验阶段），这轮不回灌 */ }
  }, 150);

  try {
    const r = await task;
    return { ok: true as const, ms: Date.now() - started, ...r };
  } catch (e: any) {
    const code = e && e.code ? e.code : e instanceof Error ? e.name : 'UNKNOWN';
    return { ok: false as const, ms: Date.now() - started, code: String(code), message: String(e?.message ?? e) };
  } finally {
    clearInterval(timer);
  }
});

ipcMain.handle('files:demo', async () => {
  // 截图/演示用：造两个真实可读的文件，路径与大小都是真的，队列里点执行会真跑
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bt3d-box-demo-'));
  const out = [];
  for (const [name, size] of [['notes.pdf', 400000], ['archive.tar.gz', 120000]] as [string, number][]) {
    const p = path.join(dir, name);
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i++) buf[i] = (i * 31 + name.length) & 0xff;
    await fs.writeFile(p, buf);
    out.push({ path: p, name, size });
  }
  return out;
});

// ---- 输出名策略（与 CLI 的追加规则同源） ----

function resolveOut(inPath: string, kind: JobKind): string {
  if (kind === 'encode') return (sdk_defaultOutPath(inPath));
  const dir = settings.outDir && fsSync.existsSync(settings.outDir) ? settings.outDir : path.dirname(inPath);
  const base = path.basename(inPath);
  const stripped = base.toLowerCase().endsWith(enc.SUFFIX) ? base.slice(0, -enc.SUFFIX.length) : base;
  const name = settings.decodeStrategy === 'suffix' ? `${stripped}.restored` : stripped;
  let out = path.join(dir, name);
  if (settings.collision === 'rename' && fsSync.existsSync(out)) {
    const ext = path.extname(name);
    for (let i = 1; i < 1000; i++) {
      const cand = path.join(dir, `${name.slice(0, name.length - ext.length)}(${i})${ext}`);
      if (!fsSync.existsSync(cand)) { out = cand; break; }
    }
  }
  return out;
}
const sdk_defaultOutPath = (p: string) => (enc as SdkEncode).defaultOutPath(p);

async function inspectContainer(p: string) {
  const { size } = await fs.stat(p);
  const h = await dec.readHeader(p);
  const full = Math.floor(h.origSize / enc.LAYER_BYTES);
  const tail = h.origSize % enc.LAYER_BYTES;
  return {
    fileSize: size,
    origSize: h.origSize,
    layerCount: h.layerCount,
    fullLayers: full,
    tailBytes: tail,
    dimX: h.dimX,
    dimY: h.dimY,
    flags: `0x${h.flags.toString(16).padStart(2, '0')}`,
    nonceHex: h.nonce.toString('hex'),
    dekHex: settings.revealDek ? h.dek.toString('hex') : `${h.dek.toString('hex').slice(0, 8)}…（32 字节，默认隐去）`,
    tagHex: h.tag.toString('hex'),
    overhead: size - h.origSize,
    sha256: size > 64 * 1024 * 1024 ? '(>64 MiB，未计算)' : sha256File(p)
  };
}

function sha256File(p: string) {
  return createHash('sha256').update(fsSync.readFileSync(p)).digest('hex');
}

// ---- 截图：给"界面完整/清晰直观"这条要求留可核对的证据 ----

async function runShoot(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  // 渲染层的 data-theme 只跟着它自己 state 里的挡位走：'dark'/'light' 是钉死的，只有 'system' 才读 matchMedia。
  // 所以拍照前必须把这一趟的名义挡位改回 system 并重载，否则下面翻 themeSource 对页面无效，
  // light-*.png 与 dark-*.png 会拍成同一套（EPHEMERAL 下不会写回 settings.json）。
  settings.theme = 'system';
  win!.webContents.reload();
  await new Promise((r) => win!.webContents.once('did-finish-load', () => r(null)));
  win!.setContentSize(1440, 880);
  await new Promise((r) => setTimeout(r, 1800));
  const labels = ['encode', 'decode', 'inspect', 'settings', 'about'];
  for (const themeName of ['dark', 'light'] as const) {
    applyThemeSource(themeName);
    await new Promise((r) => setTimeout(r, 520));
    for (let i = 0; i < labels.length; i++) {
      const clicked = await win!.webContents.executeJavaScript(
        `(() => { const it = document.querySelectorAll('.line-sidebar__item')[${i}]; if (it) it.click(); return !!it; })()`);
      await new Promise((r) => setTimeout(r, 1000));
      const img = await win!.webContents.capturePage();
      const file = path.join(dir, `${themeName}-${labels[i]}.png`);
      await fs.writeFile(file, img.toPNG());
      const themeAttr = await win!.webContents.executeJavaScript(`document.documentElement.getAttribute('data-theme')`);
      say(`shot ${themeName}/${labels[i]} nav=${clicked} data-theme=${themeAttr} ${img.getSize().width}x${img.getSize().height} → ${file}`);
    }
  }
  // 两列挡位单独补一张：这里必须是深色，且宽度要落在 1264 这一挡（≤1399），
  // 否则「主列被压成 0 高」那类缺陷在截图里根本看不见（2026-10-18 用户实测就是这么漏的）。
  applyThemeSource('dark');
  win!.setContentSize(1264, 755);
  await new Promise((r) => setTimeout(r, 900));
  const twoCol = await win!.webContents.capturePage();
  await fs.writeFile(path.join(dir, 'dark-two-col.png'), twoCol.toPNG());
  say(`shot two-col ${twoCol.getSize().width}x${twoCol.getSize().height}`);
  app.quit();
}

// ---- 界面体检：把"看着不对"变成可核对的 DOM/计算样式读数 ----

// 中间区域卡片几何：逐张打盒与"与上一张的上下间隔"，间距优化要靠这行读数而不是肉眼。
const CARDS_JS = `(Array.from(document.querySelectorAll('.main .panel')).map((p, i, a) => {
    const r = p.getBoundingClientRect();
    const prev = a[i - 1] ? a[i - 1].getBoundingClientRect() : null;
    return i + ':[' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']' + (prev ? ' 上间隔=' + Math.round(r.y - (prev.y + prev.height)) : ' 首张');
  }).join(' | ') || '无卡片')`;

const PROBE_JS = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const cls = (el) => String(el.getAttribute('class') || '').trim().split(' ').join('.');
  const tag = (el) => el.tagName.toLowerCase() + (cls(el) ? '.' + cls(el) : '');
  const rect = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); };
  const hit = (x, y) => 'y' + x + '/' + y + ': ' + Array.from(document.elementsFromPoint(x, y)).slice(0, 6).map(tag).join(' < ');
  const panel = document.querySelector('.panel');
  const veil = document.querySelector('.bg-veil');
  const main = document.querySelector('.main');
  const side = document.querySelector('.side');
  const fade = main ? main.firstElementChild : null;
  const out = [];
  out.push('viewport=' + window.innerWidth + 'x' + window.innerHeight + ' dpr=' + window.devicePixelRatio);
  out.push('dataTheme=' + root.getAttribute('data-theme') + ' tok:' + ['--bg', '--surface', '--surface-2', '--veil'].map((k) => k + '=' + cs.getPropertyValue(k).trim()).join(' '));
  out.push('bodyBg=' + getComputedStyle(document.body).backgroundColor + ' cols=' + getComputedStyle(document.querySelector('.layout')).gridTemplateColumns);
  out.push('panel=' + (panel ? '[' + rect(panel) + '] bg=' + getComputedStyle(panel).backgroundColor + ' inline=' + (panel.style.background || '-') : 'none'));
  out.push('veil=' + (veil ? '[' + rect(veil) + '] op=' + getComputedStyle(veil).opacity + ' z=' + getComputedStyle(veil).zIndex + ' pos=' + getComputedStyle(veil).position : 'none'));
  out.push('main=' + (main ? '[' + rect(main) + '] scrollH=' + main.scrollHeight + ' child=' + (fade ? tag(fade) + ' op=' + getComputedStyle(fade).opacity + ' filter=' + getComputedStyle(fade).backdropFilter : 'EMPTY') : 'none'));
  out.push('side=' + (side ? '[' + rect(side) + '] scrollH=' + side.scrollHeight : 'none'));
  out.push('img=' + (Array.from(document.querySelectorAll('img')).slice(0, 8).map((i) => tag(i) + ' src=' + String(i.currentSrc || i.src).slice(0, 40) + ' nat=' + i.naturalWidth + 'x' + i.naturalHeight + ' [' + rect(i) + ']').join(' | ') || 'none'));
  out.push('btn=' + (Array.from(document.querySelectorAll('.specular-button')).slice(0, 4).map((b) => '[' + rect(b) + '] bg=' + getComputedStyle(b).bgColor + ' pos=' + getComputedStyle(b).position + ' html=' + b.innerHTML.slice(0, 90).replace(/</g, '(')).join(' || ')));
  out.push('cards=' + ${CARDS_JS});
  out.push('hold=' + (Array.from(document.querySelectorAll('.hold-button')).map((b) => '[' + rect(b) + '] fs=' + getComputedStyle(b).fontSize + ' 文本=' + (b.textContent || '').slice(0, 8)).join(' | ') || 'none'));
  out.push('stack=' + Array.from(document.querySelectorAll('.bg-veil, .panel, .topbar, .dropzone, .statusbar')).slice(0, 6).map((el) => (cls(el).split('.')[0] || el.tagName) + ':' + getComputedStyle(el).position + '/' + getComputedStyle(el).zIndex + '/' + (getComputedStyle(el).filter || 'none') + '/' + getComputedStyle(el).backdropFilter).join(' | '));
  out.push('gl=' + (Array.from(document.querySelectorAll('canvas')).map((cv) => (cls(cv) || 'canvas') + ':' + (() => { const g = cv.getContext('webgl2') || cv.getContext('webgl'); return g ? (g.isContextLost() ? 'LOST' : 'ok') : 'nogl'; })()).join(' ') || 'none'));
  out.push('canvas=' + (Array.from(document.querySelectorAll('canvas')).slice(0, 8).map((i) => (cls(i) || 'canvas') + ' [' + rect(i) + '] ' + i.width + 'x' + i.height).join(' | ') || 'none'));
  const w = window.innerWidth, h = window.innerHeight;
  out.push(hit(Math.round(w * 0.18), Math.round(h * 0.55)));
  out.push(hit(Math.round(w * 0.55), Math.round(h * 0.62)));
  out.push(hit(Math.round(w * 0.55), Math.round(h * 0.04)));
  out.push(hit(Math.round(w * 0.24), Math.round(h * 0.45)));
  return out.join('\\n');
})()`;

async function runProbe() {
  const dir = path.join(os.tmpdir(), 'bt3d-shots');
  await fs.mkdir(dir, { recursive: true });
  win!.setContentSize(1264, 755);
  await new Promise((r) => setTimeout(r, 700));
  const step = async (label: string) => {
    await new Promise((r) => setTimeout(r, 1200));
    const report = String(await win!.webContents.executeJavaScript(PROBE_JS));
    say(`PROBE-BEGIN ${label}`);
    for (const line of report.split('\n')) say(`  ${line}`);
    const img = await win!.webContents.capturePage();
    const file = path.join(dir, `probe-${label}.png`);
    await fs.writeFile(file, img.toPNG());
    say(`PROBE-END ${label} → ${file}`);
    // 逐像素读数直接由主进程取，判据不依赖外部看图工具（toBitmap 的字节序是 BGRA；getBitmap 是它的 void 别名）
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    const px = (x: number, y: number) => {
      if (x >= width || y >= height) return `(-${x},${y} 越界 ${width}x${height})`;
      const i = (y * width + x) * 4;
      return '#' + [bmp[i + 2], bmp[i + 1], bmp[i]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    say(`  px@topbar(60,30)=${px(60, 30)} gap(232,400)=${px(232, 400)} panel(700,130)=${px(700, 130)} ` +
      `dropzone(700,340)=${px(700, 340)} btn(305,517)=${px(305, 517)} 画布=${width}x${height}`);
  };
  await step('A-boot');
  // 逐挡量中间区域的卡片间距（五挡的卡片数与高度都不同，只看一挡会把别挡的毛病漏掉）
  for (let i = 0; i < 5; i++) {
    await win!.webContents.executeJavaScript(
      `(() => { const it = document.querySelectorAll('.line-sidebar__item')[${i}]; if (it) it.click(); return !!it; })()`);
    await new Promise((r) => setTimeout(r, 800));
    const cards = String(await win!.webContents.executeJavaScript(CARDS_JS));
    const inner = String(await win!.webContents.executeJavaScript(
      `(() => { const m = document.querySelector('.main'); return [Math.round(m.getBoundingClientRect().height), m.scrollHeight, m.firstElementChild ? getComputedStyle(m.firstElementChild).display : '-'].join('|'); })()`));
    say(`PROBE-CARDS view=${i} main高/内容/包装display=${inner} → ${cards}`);
  }
  await step('B-nav-decode');
  // 故障注入一（单独做，别和上面那步叠在一起）：把这些 WebGL 画布的上下文弄丢，
  // 看"画布出故障"在本运行时到底是变白还是变透明 —— 这一条决定白洗的成因归属。
  const lostN = await win!.webContents.executeJavaScript(`(() => {
    let n = 0;
    for (const cv of Array.from(document.querySelectorAll('canvas'))) {
      const g = cv.getContext('webgl2') || cv.getContext('webgl');
      if (g) { g.getExtension('WEBGL_lose_context')?.loseContext(); n += 1; }
    }
    return n;
  })()`);
  say(`注入：丢掉的 WebGL 上下文数=${lostN}`);
  await step('C-context-lost');
  // 故障注入二：背景层容器涂成实心白，等价于"这层画布交付出实心白"的最坏情况。
  // 判据：面板与按钮的读数不许变（见 adapt.css 的 z-index 注释）。
  await win!.webContents.executeJavaScript(
    `(() => { const v = document.querySelector('.bg-veil'); if (v) v.style.background = '#fff'; return !!v; })()`);
  await step('D-veil-white');
  // 对照组：把背景层挪回修复前的 z-index:0（画在静态内容之上）。
  // 同一份实心白，两种层序 —— 只有这一挡会把面板洗成用户截图里的 #94979D。
  await win!.webContents.executeJavaScript(
    `(() => { const v = document.querySelector('.bg-veil'); if (v) v.style.zIndex = '0'; return !!v; })()`);
  await step('E-veil-white-z0');
  process.exit(0);
}

// ---- 自证：不靠人眼看弹窗 ----

async function runSelftest() {
  const checks: string[] = [];
  const assert = (name: string, ok: boolean, info = '') => {
    checks.push(`${ok ? 'ok' : 'FAIL'} ${name}${info ? ` ｜ ${info}` : ''}`);
    if (!ok) say(`SELFTEST-FAIL ${name} ${info}`);
  };

  // 1. vendored SDK 与仓库 sdk/ 逐字节同源：dev 期直接比文件，打包后比构建期写下的清单
  const manifestPath = path.join(__dirname, 'vendor-manifest.json');
  const manifest = fsSync.existsSync(manifestPath)
    ? (JSON.parse(fsSync.readFileSync(manifestPath, 'utf8')) as { files: Record<string, { sha256: string; bytes: number }> })
    : null;
  for (const f of ['bt3d-encode.js', 'bt3d-decode.js']) {
    const a = createHash('sha256').update(fsSync.readFileSync(path.join(__dirname, f))).digest('hex');
    const repoPath = path.resolve(__dirname, '..', '..', 'sdk', f);
    const expected = manifest?.files[f]?.sha256
      ?? (fsSync.existsSync(repoPath) ? createHash('sha256').update(fsSync.readFileSync(repoPath)).digest('hex') : null);
    assert(`vendor 同源 ${f}`, expected !== null && a === expected,
      `实读 ${a.slice(0, 16)} vs 期望 ${expected ? expected.slice(0, 16) : '无参照'}`);
  }

  // 2. 密钥流垫片的两个外部锚点（与本仓库 格式规格.md §16.2 判据 14 同一条，另一条是系统 Node 实测值）
  assert('垫片锚点 RFC8439-2.4.2', rfc8439Vector() === '6e2e359a2568f98041ba0728dd0d6981', rfc8439Vector());
  assert('垫片锚点 交叉样本', shimSample() === '18b84231ade6a6d113615c61af434e27', `${shimSample()} ｜ 垫片状态 ${shim.reason}`);

  // 3. 合成往返：300,000 字节（3 满层 + 末层），编码→解码→逐字节比对
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bt3d-box-self-'));
  const src = path.join(dir, 'src.bin');
  const cno = path.join(dir, 'src.bin.bt3d');
  const back = path.join(dir, 'back.bin');
  const data = randomBytes(300000);
  await fs.writeFile(src, data);
  const e = await enc.encodeFile(src);
  assert('缺省输出名 = 源名 + .bt3d', e.outPath === src + '.bt3d' && fsSync.existsSync(e.outPath), e.outPath);
  assert('容器长度 = 原长 + 128', e.outSize === 300000 + 128, `${e.outSize}`);
  assert('层数 = 3', e.layerCount === 3, `${e.layerCount}`);
  const d = await dec.decodeFile(cno, back);
  assert('解码写回长度', d.written === 300000, `${d.written}`);
  assert('逐字节还原', fsSync.readFileSync(back).equals(data));
  const info = await inspectContainer(cno);
  assert('inspect 头部口径', info.dimX === 1024 && info.dimY === 1024 && info.flags === '0x1c' && info.overhead === 128,
    `${info.dimX}x${info.dimY} flags=${info.flags} 开销=${info.overhead}`);

  // 3. 解码失败不得截断既有输出
  const sentinel = Buffer.from('SENTINEL-MUST-SURVIVE'.repeat(64));
  const victim = path.join(dir, 'victim.bin');
  await fs.writeFile(victim, sentinel);
  const tampered = fsSync.readFileSync(cno);
  tampered[200] ^= 0x01;
  const tPath = path.join(dir, 'tampered.bt3d');
  await fs.writeFile(tPath, tampered);
  let code = '';
  try { await dec.decodeFile(tPath, victim); } catch (err: any) { code = String(err?.code); }
  assert('篡改容器报 TAG_MISMATCH', code === 'TAG_MISMATCH', code || '未报错');
  assert('失败后原输出文件未被截断', fsSync.readFileSync(victim).equals(sentinel), `${fsSync.statSync(victim).size} 字节`);

  // 4. IPC 往返与渲染层就绪
  const ping = await win!.webContents.executeJavaScript('window.api && typeof window.api.appInfo === "function"');
  assert('contextBridge 暴露 api', ping === true);

  // 5. 主题一致性：主进程与渲染层必须同值
  const darkRenderer = await win!.webContents.executeJavaScript(`matchMedia('(prefers-color-scheme: dark)').matches`);
  assert(`themeSource=${nativeTheme.themeSource} 两侧一致`, darkRenderer === nativeTheme.shouldUseDarkColors,
    `main=${nativeTheme.shouldUseDarkColors} renderer=${darkRenderer}`);
  const bg = await win!.webContents.executeJavaScript(`getComputedStyle(document.body).backgroundColor`);
  assert('背景色跟随明暗', bg !== 'rgba(0, 0, 0, 0)', bg);

  // 6. 栅格断点：媒体查询量的是视口，setBounds 含窗口边框，所以用 setContentSize 才对得上号
  const colsOf = async () => win!.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('.layout');
       return [getComputedStyle(el).gridTemplateColumns.split(' ').length, window.innerWidth].join('|'); })()`);
  const expectAt = async (w: number, want: number) => {
    win!.setContentSize(w, 860);
    await new Promise((r) => setTimeout(r, 340));
    const [cols, inner] = (await colsOf()).split('|').map(Number);
    assert(`视口 ${w} → ${want} 列`, cols === want, `实测 ${cols} 列，innerWidth=${inner}`);
    return cols;
  };
  await expectAt(1500, 3);
  await expectAt(1200, 2);
  await expectAt(980, 1);

  // 7. 最小尺寸闸门
  win!.setBounds({ x: 200, y: 120, width: 100, height: 100 });
  await new Promise((r) => setTimeout(r, 240));
  const b = win!.getBounds();
  assert('minWidth/minHeight 咬住', b.width >= 940 && b.height >= 620, `${b.width}x${b.height}`);

  // 8. 伪造越界几何后窗口仍落在某块 workArea 内
  const fixed = clampBoundsIntoWorkArea({ x: -24000, y: -24000, width: 9000, height: 9000 });
  const inside = screen.getAllDisplays().some((d) =>
    fixed.x >= d.workArea.x && fixed.y >= d.workArea.y &&
    fixed.x + fixed.width <= d.workArea.x + d.workArea.width + 1 &&
    fixed.y + fixed.height <= d.workArea.y + d.workArea.height + 1);
  assert('离屏几何被夹回', inside, JSON.stringify(fixed));

  // 9. 层序与栏高：这两条是 2026-10-18「深色界面显示异常」那次的直接回归闸门
  const veilZ = await win!.webContents.executeJavaScript(
    `getComputedStyle(document.querySelector('.bg-veil')).zIndex`);
  assert('背景层在内容之下（z-index 为负）', Number(veilZ) < 0, `z-index=${veilZ}`);
  win!.setContentSize(1264, 755);
  await new Promise((r) => setTimeout(r, 400));
  await win!.webContents.executeJavaScript(
    `(() => { const it = document.querySelectorAll('.line-sidebar__item')[1]; if (it) it.click(); return !!it; })()`);
  await new Promise((r) => setTimeout(r, 900));
  const mainBox = String(await win!.webContents.executeJavaScript(`(() => {
    const m = document.querySelector('.main'); const r = m.getBoundingClientRect();
    const child = m.firstElementChild;
    return [Math.round(r.height), m.scrollHeight, child ? getComputedStyle(child).opacity : '-'].join('|');
  })()`));
  const [mh, msc, mop] = mainBox.split('|');
  assert('两列挡位主列不被压成 0 高', Number(mh) >= 200, `main 高=${mh} 内容=${msc}（旧缺陷读数 0 / 449）`);
  assert('切挡后入场动画落到可见', mop === '1', `opacity=${mop}`);

  // 10. 中间区域卡片节奏：五挡逐个切过去量相邻两张 .panel 的上下间隔，取最小值。
  // 旧状态是 0（FadeContent 的包装 div 是块盒，卡片直接挨着），所以阈值要卡在"看得见的那一层"。
  let minGap = 9999;
  for (let i = 0; i < 5; i++) {
    await win!.webContents.executeJavaScript(
      `(() => { const it = document.querySelectorAll('.line-sidebar__item')[${i}]; if (it) it.click(); return !!it; })()`);
    await new Promise((r) => setTimeout(r, 420));
    const g = Number(await win!.webContents.executeJavaScript(`(() => {
      const a = Array.from(document.querySelectorAll('.main .panel'));
      let m = 9999;
      for (let i = 1; i < a.length; i++) {
        const p = a[i - 1].getBoundingClientRect(), r = a[i].getBoundingClientRect();
        m = Math.min(m, Math.round(r.y - (p.y + p.height)));
      }
      return m;
    })()`));
    if (g < minGap) minGap = g;
  }
  assert('中间区域卡片上下间隔 ≥16px（五挡取最小）', minGap >= 16, `实测最小 ${minGap}px ｜ 旧状态 0px`);

  await fs.rm(dir, { recursive: true, force: true });

  const failed = checks.filter((c) => c.startsWith('FAIL')).length;
  for (const c of checks) say(`SELF ${c}`);
  say(`SELFTEST done checks=${checks.length} fail=${failed}`);
  say(`renderer-marker ${await win!.webContents.executeJavaScript('document.readyState')}`);
  app.quit();
  process.exitCode = failed ? 1 : 0;
}

// ---- 生命周期 ----

if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    app.setName(APP_TITLE);
    loadSettings();
    if (process.platform === 'win32') app.setAppUserModelId('com.bt3d.box');
    createWindow();
    if (SELFTEST) {
      win!.webContents.once('did-finish-load', () => setTimeout(() => {
        void runSelftest().catch((e) => {
          say(`SELFTEST-THROW ${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`);
          process.exit(1);
        });
      }, 900));
      // 兜底：任何一步卡住也要收场，别让自证变成永远不退出的一次性运行
      setTimeout(() => { say('SELFTEST-TIMEOUT 未在上限内完成'); process.exit(1); }, 90000).unref?.();
    } else if (SHOOT_DIR) {
      win!.webContents.once('did-finish-load', () => setTimeout(() => {
        void runShoot(SHOOT_DIR).catch((e) => { say(`SHOOT-THROW ${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`); process.exit(1); });
      }, 2600));
    } else if (PROBE) {
      win!.webContents.once('did-finish-load', () => setTimeout(() => {
        void runProbe().catch((e) => { say(`PROBE-THROW ${String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`); process.exit(1); });
      }, 2600));
    }
    app.on('activate', () => ifNothingOpen());
  });
}

function ifNothingOpen() {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

if (SELFTEST) {
  fsSync.writeFileSync(path.join(os.tmpdir(), 'bt3d-box-selftest-log.txt'), '');
  const origLog = console.log;
  console.log = (...a: unknown[]) => {
    origLog(...a);
    try { fsSync.appendFileSync(path.join(os.tmpdir(), 'bt3d-box-selftest-log.txt'), a.join(' ') + '\n'); } catch { /* 落盘失败不影响运行 */ }
  };
}
