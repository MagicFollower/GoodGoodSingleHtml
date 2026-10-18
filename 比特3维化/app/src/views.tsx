import type { AppInfo, InspectResult, JobKind, Settings } from './lib/api';
import { fmtBytes } from './lib/api';
import type { Colors } from './components/rb';
import { AccentText, Execute, GhostButton, Panel, PathInput, Select, Stat, Toggle, Tip } from './components/rb';
import type { Job } from './App';

type Totals = { queued: number; done: number; failed: number; bytes: number; ms: number };

type Common = {
  c: Colors;
  info: AppInfo | null;
  totals: Totals;
  active: Job | null;
  outDir: string;
  message: string;
  onBrowseDir: () => void;
  onBrowseFiles: () => void;
  onDrop: (paths: string[]) => void;
  onExecute: () => void;
  onClear: () => void;
};

const LAYER_BYTES = 131072;
const MAX_PAYLOAD = 256 * 1024 * 1024 * 1024;

export function EncodeView(p: Common & { mode: JobKind }) {
  const est = p.totals.queued;
  return (
    <>
      <Panel c={p.c} title="混淆 · 写入容器" hint="原文件不会被修改，输出一条追加 .bt3d">
        <div className="col">
          <div className="row">
            <GhostButton c={p.c} title="支持多选，也可以直接拖到右下队列" onClick={p.onBrowseFiles}>添加文件</GhostButton>
            <GhostButton c={p.c} title="只清掉还没执行的任务" onClick={p.onClear}>清空待执行</GhostButton>
            <Tip content="按住直到液面走满才入队，避免误点触发整批写盘。">
              <span className="pill">为什么是按住？</span>
            </Tip>
          </div>

          <div className="field">
            <span className="field__label">输出位置</span>
            <div className="pill pill--wide">
              加密挡位固定写在源文件同目录：a.jpg → a.jpg.bt3d，archive.tar.gz → archive.tar.gz.bt3d
            </div>
          </div>

          <div className="grid-3">
            <div className="col"><span className="field__label">待执行</span><Stat c={p.c} value={est} /></div>
            <div className="col"><span className="field__label">每个容器额外</span><Stat c={p.c} value={128} suffix=" B" /></div>
            <div className="col"><span className="field__label">单文件上限</span><Stat c={p.c} value={256} suffix=" GiB" /></div>
          </div>

          <div className="row">
            <Execute c={p.c} disabled={!p.totals.queued} onHold={p.onExecute} label="按住执行混淆" done="已提交" />
          </div>
        </div>
      </Panel>

      <Panel c={p.c} title="这一挡在做什么" hint="口径来自 sdk/bt3d-encode.js">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>层内按螺旋填充序写入 1024×1024 矩阵，再由仿射 <span className="rb-mono">r = a·q + b mod 2²⁰</span> 打散，末层用秩压缩保持长度精确。</li>
          <li>逐层异或 ChaCha20 密钥流，计数器基址 <span className="rb-mono">layer × 2048</span>，层与层之间不串流。</li>
          <li>随机 <span className="rb-mono">dek</span> 明文写入头部 64..95：<b>本容器的机密性是 0 bit</b>，防的是"被认出是什么文件"，不是"被人看到内容"。</li>
        </ol>
      </Panel>
    </>
  );
}

export function DecodeView(p: Common & { mode: JobKind; settings: Settings | null; onPatch: (patch: Partial<Settings>) => void }) {
  const s = p.settings;
  return (
    <>
      <Panel c={p.c} title="还原 · 校验并写回" hint="解码分两遍：先 HMAC，后落盘">
        <div className="col">
          <div className="row">
            <GhostButton c={p.c} title="只列 .bt3d 容器" onClick={p.onBrowseFiles}>添加容器</GhostButton>
            <GhostButton c={p.c} onClick={p.onClear}>清空待执行</GhostButton>
            <span className="pill" data-tone={p.totals.failed ? 'err' : undefined}>失败 {p.totals.failed}</span>
          </div>

          <div className="field">
            <span className="field__label">输出目录（容器里没有原文件名，必须由你给）</span>
            <div className="row">
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <PathInput c={p.c} dark value={p.outDir} onChange={(v) => p.onPatch({ outDir: v })}
                  placeholder="留空 = 与容器同目录" button="保存" />
              </div>
              <GhostButton c={p.c} onClick={p.onBrowseDir}>选择目录</GhostButton>
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <span className="field__label">输出名策略</span>
              <Select c={p.c} value={s?.decodeStrategy ?? 'strip'} placeholder="输出名"
                onChange={(v) => p.onPatch({ decodeStrategy: v as Settings['decodeStrategy'] })}
                options={[{ value: 'strip', label: '去掉 .bt3d', tag: '默认' }, { value: 'suffix', label: '追加 .restored' }]} />
            </div>
            <div className="field">
              <span className="field__label">目标已存在时</span>
              <Select c={p.c} value={s?.collision ?? 'rename'} placeholder="冲突"
                onChange={(v) => p.onPatch({ collision: v as Settings['collision'] })}
                options={[{ value: 'rename', label: '自动改名 (1)(2)', tag: '安全' }, { value: 'overwrite', label: '直接覆盖' }]} />
            </div>
          </div>

          <div className="row">
            <Execute c={p.c} disabled={!p.totals.queued} onHold={p.onExecute} label="按住执行还原" done="已提交" />
          </div>
        </div>
      </Panel>

      <Panel c={p.c} title="为什么状态会先停在“校验中”" hint="payload_tag 是 HMAC-SHA256">
        <div className="col">
          <div>第一遍只把「tag 置零的头部 ‖ payload」喂进 HMAC，一个字节都不写；只有 tag 对上，才用 <span className="rb-mono">'w'</span> 打开输出文件。于是一次失败的还原不会截断你已有的同名文件。</div>
          <div className="row">
            <span className="pill">E5 38,797,313 B → 38,797,441 B / 297 层（实测）</span>
            <span className="pill" data-tone="ok">{p.totals.done} 已还原</span>
          </div>
        </div>
      </Panel>
    </>
  );
}

export function InspectView(p: {
  c: Colors; path: string; onPath: (v: string) => void; result: InspectResult | null;
  onBrowse: () => void; onRun: () => void; message: string;
}) {
  const r = p.result;
  return (
    <>
      <Panel c={p.c} title="容器检查" hint="只读 128 字节头部，不解 payload">
        <div className="col">
          <div className="field">
            <span className="field__label">容器路径</span>
            <PathInput c={p.c} dark value={p.path} onChange={p.onPath} onCommit={p.onRun} placeholder="选一个 .bt3d 文件" button="解析" />
          </div>
          <div className="row">
            <GhostButton c={p.c} onClick={p.onBrowse}>浏览容器</GhostButton>
            <GhostButton c={p.c} title="逐字段跑头部九项校验" onClick={p.onRun}>解析</GhostButton>
            {r && <GhostButton c={p.c} onClick={() => void navigator.clipboard.writeText(JSON.stringify(r, null, 2))}>复制结果</GhostButton>}
          </div>
        </div>
      </Panel>

      {r ? (
        <Panel c={p.c} title="头部字段" hint="格式规格 §4.1 的十二个字段">
          <div className="col">
            <dl className="kv">
              <dt>文件大小</dt><dd>{r.fileSize.toLocaleString('en-US')} B</dd>
              <dt>origSize</dt><dd>{r.origSize.toLocaleString('en-US')} B（{fmtBytes(r.origSize)}）</dd>
              <dt>layerCount</dt><dd>{r.layerCount}（满层 {r.fullLayers}{r.tailBytes ? `，末层 ${r.tailBytes.toLocaleString('en-US')} B` : '，无末层'}）</dd>
              <dt>几何</dt><dd>{r.dimX} × {r.dimY}，每层 {LAYER_BYTES.toLocaleString('en-US')} B</dd>
              <dt>flags</dt><dd>{r.flags}</dd>
              <dt>体积开销</dt><dd>{r.overhead} B（规范值 128）</dd>
              <dt>file_nonce</dt><dd>{r.nonceHex}</dd>
              <dt>dek</dt><dd>{r.dekHex}</dd>
              <dt>payload_tag</dt><dd>{r.tagHex}</dd>
              <dt>容器 sha256</dt><dd>{r.sha256}</dd>
            </dl>
            <div className="grid-2">
              <div className="col"><span className="field__label">层数</span><Stat c={p.c} value={r.layerCount} /></div>
              <div className="col"><span className="field__label">还原后字节</span><Stat c={p.c} value={r.origSize} suffix=" B" /></div>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel c={p.c} title="尚未解析">
          <div className="muted">选一个容器后点"解析"。魔数不对会报 <span className="rb-mono">BAD_MAGIC</span>，flags 不对报 <span className="rb-mono">BAD_PROFILE</span>，长度不等于 origSize+128 报 <span className="rb-mono">BAD_LENGTH</span>。</div>
        </Panel>
      )}
    </>
  );
}

export function SettingsView(p: { c: Colors; settings: Settings | null; info: AppInfo | null; onPatch: (patch: Partial<Settings>) => void; onBrowseDir: () => void; outDir: string }) {
  const s = p.settings;
  if (!s) return <Panel c={p.c} title="设置">正在读取 settings.json…</Panel>;
  return (
    <>
      <Panel c={p.c} title="界面" hint="深色为主，可切浅色">
        <div className="col">
          <div className="field">
            <span className="field__label">明暗（跟随系统 = 主进程 nativeTheme.themeSource='system'）</span>
            <Select c={p.c} value={s.theme} placeholder="主题" wide
              onChange={(v) => p.onPatch({ theme: v as Settings['theme'] })}
              options={[{ value: 'system', label: '跟随系统' }, { value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }]} />
          </div>
          <div className="row">
            <Toggle c={p.c} label="容器检查里显示完整 DEK" checked={s.revealDek} onChange={(v) => p.onPatch({ revealDek: v })} />
            <Toggle c={p.c} label="保留任务日志" checked={s.keepLog} onChange={(v) => p.onPatch({ keepLog: v })} />
          </div>
        </div>
      </Panel>

      <Panel c={p.c} title="还原默认值" hint="写进 userData/settings.json，不写工程目录">
        <div className="col">
          <div className="field">
            <span className="field__label">默认输出目录</span>
            <div className="row">
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <PathInput c={p.c} dark value={p.outDir} onChange={(v) => { p.onPatch({ outDir: v }); }} onCommit={(v) => p.onPatch({ outDir: v })}
                  placeholder="留空 = 与容器同目录" button="保存" />
              </div>
              <GhostButton c={p.c} onClick={p.onBrowseDir}>浏览</GhostButton>
            </div>
          </div>
          <div className="muted">配置文件：<span className="rb-mono">{p.info?.userData}</span></div>
        </div>
      </Panel>
    </>
  );
}

export function AboutView(p: { c: Colors; info: AppInfo | null }) {
  const i = p.info;
  return (
    <Panel c={p.c} title="关于" hint="运行时与实现来源">
      <div className="col">
        <dl className="kv">
          <dt>应用</dt><dd><AccentText c={p.c}>{i?.app ?? 'BT3D Box'}</AccentText></dd>
          <dt>版本</dt><dd>{i?.version ?? '—'}</dd>
          <dt>Electron / Chromium / Node</dt><dd>{i ? `${i.electron} / ${i.chrome} / ${i.node}` : '—'}</dd>
          <dt>平台</dt><dd>{i?.platform ?? '—'}</dd>
          <dt>格式</dt><dd>BT3D v1，profile <span className="rb-mono">{i ? `0x${(28).toString(16).padStart(2, '0')}` : '0x1c'}</span>，头部 {i?.sdkHeader ?? 128} B，每层 {(i?.sdkLayerBytes ?? LAYER_BYTES).toLocaleString('en-US')} B</dd>
          <dt>加解密实现</dt><dd>sdk/bt3d-encode.js + sdk/bt3d-decode.js（逐字节拷贝进 electron/vendor，构建期哈希核对）</dd>
          <dt>组件</dt><dd>ReactBits（vendored 于 src/reactbits，lock.json 记哈希）</dd>
          <dt>上限</dt><dd>payload ≤ {fmtBytes(MAX_PAYLOAD)}（32 位块计数器）</dd>
        </dl>
        <div className="muted">
          加密强度口径：外观混淆 + 无损还原 + 完整性拒绝。机密性为 0 bit（DEK 明文存放），这是既定设计决策，不是缺陷。
        </div>
      </div>
    </Panel>
  );
}
