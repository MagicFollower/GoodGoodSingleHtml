import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, InspectResult, JobKind, Settings, Theme } from './lib/api';
import { baseName, fmtBytes, isContainer } from './lib/api';
import { prefersReducedMotion, resolvedDark, useElapsed, useTheme, useTokens } from './lib/theme';
import type { Colors } from './components/rb';
import {
  AppTitle, Badge, Busy, Dot, DropFrame, Dial, Execute, Fade, FileGlyphs, FolderButton, GhostButton,
  Nav, Panel, Queue, Select, StatusLine, Veil, Stat
} from './components/rb';
import { AboutView, DecodeView, EncodeView, InspectView, SettingsView } from './views';

export type Job = {
  id: string;
  kind: JobKind;
  inPath: string;
  name: string;
  size: number;
  outPath: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  phase?: string;
  done: number;
  total: number;
  pct: number;
  bps: number;
  ms?: number;
  error?: string;
};

const VIEWS = ['加密', '解密', '容器检查', '设置', '关于'];

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState(0);
  const [message, setMessage] = useState('准备就绪 · 拖入文件即可开始');
  const [busy, setBusy] = useState<null | 'working' | 'done' | 'error'>(null);
  const [running, setRunning] = useState(false);
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [inspectPath, setInspectPath] = useState('');
  const [outDir, setOutDir] = useState('');
  const [over, setOver] = useState(false);
  const dragDepth = useRef(0);

  const mode: JobKind = view === 1 ? 'decode' : 'encode';
  const { dark } = useTheme(settings?.theme ?? 'system');
  const t = useTokens([dark, settings?.theme]);
  const c: Colors = {
    bg: t.bg, surface: t.surface, surface2: t['surface-2'], ink: t.ink, ink2: t['ink-2'], ink3: t['ink-3'],
    line: t.line, accent: t.accent, accentInk: t['accent-ink'], accentSoft: t['accent-soft'],
    ok: t.ok, warn: t.warn, err: t.err, run: t.run
  };
  const motionOk = useMemo(() => !prefersReducedMotion(), []);
  const elapsed = useElapsed(running);

  useEffect(() => {
    void (async () => {
      const [i, s] = await Promise.all([window.api.appInfo(), window.api.getSettings()]);
      setInfo(i);
      setSettings(s);
      setOutDir(s.outDir);
      document.body.setAttribute('data-ipc', 'ok');
      if (new URLSearchParams(window.location.search).get('demo')) {
        const got = await window.api.pickDemo();
        const seeded: { path: string; size: number }[] = [];
        for (const f of got) seeded.push({ path: f.path, size: f.size });
        setJobs((list) => [...list, ...seeded.map((o, n) => ({
          id: `demo-${n}-${baseName(o.path)}`, kind: 'encode' as const, inPath: o.path, name: baseName(o.path),
          size: o.size, outPath: `${o.path}.bt3d`, status: 'queued' as const, done: 0, total: o.size, pct: 0, bps: 0
        }))]);
        setMessage(`演示队列：${seeded.length} 个真实临时文件待混淆（截图模式）`);
      }
    })();
  }, []);

  useEffect(() => {
    window.api.onThemeChanged(() => setSettings((prev) => (prev ? { ...prev } : prev)));
    window.api.onJobPhase((p) => {
      setJobs((list) => list.map((j) => (j.id === p.id ? { ...j, phase: p.phase, total: p.total } : j)));
      if (p.phase === 'verifying') setMessage('正在校验 payload_tag —— 第一遍只算 HMAC，不产出任何数据');
    });
    window.api.onJobProgress((p) => {
      setJobs((list) => list.map((j) => (j.id === p.id ? { ...j, done: p.done, total: p.total, pct: p.pct, bps: p.bps, phase: 'writing' } : j)));
    });
    return () => window.api.offAll();
  }, []);

  const enqueue = useCallback(async (paths: string[], sizes: number[]) => {
    const kept: { p: string; size: number }[] = [];
    let skipped = 0;
    paths.forEach((p, i) => {
      if (mode === 'encode' ? isContainer(p) : !isContainer(p)) { skipped += 1; return; }
      kept.push({ p, size: sizes[i] ?? 0 });
    });
    if (!kept.length) {
      setMessage(skipped ? `跳过 ${skipped} 个与当前挡位后缀不符的项（${mode === 'encode' ? '加密不收 .bt3d' : '解密只收 .bt3d'}）` : '没有可加入的文件');
      return;
    }
    let seq = 0;
    for (const k of kept) {
      const out = await window.api.defaultOut(k.p, mode);
      seq += 1;
      setJobs((list) => [...list, {
        id: `${Date.now()}-${seq}-${baseName(k.p)}`, kind: mode, inPath: k.p, name: baseName(k.p), size: k.size,
        outPath: out, status: 'queued', done: 0, total: k.size, pct: 0, bps: 0
      }]);
    }
    setMessage(`已加入 ${kept.length} 个${mode === 'encode' ? '待混淆' : '待还原'}项${skipped ? `，跳过 ${skipped} 项` : ''}（共 ${fmtBytes(kept.reduce((a, b) => a + b.size, 0))}）`);
  }, [mode]);

  // 整窗拖放：Electron 32 起 File.path 已移除，只能经 preload 的 webUtils.getPathForFile 取路径
  useEffect(() => {
    const filesFrom = (e: DragEvent) => {
      const list = Array.from(e.dataTransfer?.files ?? []);
      return { paths: list.map((f) => window.api.pathForFile(f)), sizes: list.map((f) => f.size) };
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onEnter = (e: DragEvent) => { e.preventDefault(); dragDepth.current += 1; setOver(true); };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setOver(false);
    };
    const onDropEvent = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setOver(false);
      const { paths, sizes } = filesFrom(e);
      if (paths.length) void enqueue(paths.filter(Boolean), sizes);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropEvent);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDropEvent);
    };
  }, [enqueue]);

  const browse = useCallback(async () => {
    const got = await window.api.pickFiles(mode);
    if (!got.length) return;
    await enqueue(got.map((g) => g.path), got.map((g) => g.size));
  }, [enqueue, mode]);

  const runAll = useCallback(async () => {
    const queue = jobs.filter((j) => j.status === 'queued');
    if (!queue.length) { setMessage('队列里没有待执行的任务'); return; }
    setRunning(true);
    setBusy('working');
    let okCount = 0;
    let failCount = 0;
    for (const j of queue) {
      setJobs((list) => list.map((x) => (x.id === j.id ? { ...x, status: 'running' as const, phase: 'writing' } : x)));
      const r = await window.api.runJob({ id: j.id, kind: j.kind, inPath: j.inPath, outPath: j.outPath });
      if (r.ok) {
        okCount += 1;
        setJobs((list) => list.map((x) => (x.id === j.id ? { ...x, status: 'done' as const, pct: 1, done: r.origSize ?? x.total, ms: r.ms } : x)));
        setMessage(`${j.name} 完成：${fmtBytes(r.origSize ?? 0)}，${Math.round(r.ms)} ms，${j.kind === 'encode' ? '层数 ' + (r.layerCount ?? 0) : '写出 ' + fmtBytes(r.written ?? 0)}`);
      } else {
        failCount += 1;
        setJobs((list) => list.map((x) => (x.id === j.id ? { ...x, status: 'failed' as const, ms: r.ms, error: `${r.code}` } : x)));
        setMessage(`${j.name} 失败：${r.code} —— ${r.message.slice(0, 90)}`);
      }
    }
    setBusy(failCount ? 'error' : 'done');
    setRunning(false);
    setTimeout(() => setBusy(null), 1600);
  }, [jobs]);

  const clearQueued = useCallback(() => {
    setJobs((list) => list.filter((j) => j.status !== 'queued'));
    setMessage('已清空待执行队列');
  }, []);

  const patch = useCallback(async (p: Partial<Settings>) => {
    const next = await window.api.setSettings(p);
    setSettings(next);
    if (p.outDir !== undefined) setOutDir(next.outDir);
    if (p.theme) setMessage(`主题挡位：${next.theme}（当前实际${resolvedDark(next.theme) ? '深色' : '浅色'}）`);
  }, []);

  const totals = useMemo(() => {
    const done = jobs.filter((j) => j.status === 'done');
    return {
      queued: jobs.filter((j) => j.status === 'queued').length,
      done: done.length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      bytes: done.reduce((a, b) => a + (b.done || b.size), 0),
      ms: done.reduce((a, b) => a + (b.ms ?? 0), 0)
    };
  }, [jobs]);

  const active = jobs.find((j) => j.id === selected) ?? jobs.find((j) => j.status === 'running') ?? null;

  return (
    <div className="app">
      <Veil c={c} motionOk={motionOk} />

      <header className="topbar">
        <div className="topbar__brand">
          <AppTitle text="比特3维化 · BT3D Box" c={c} replayKey={info?.version ?? 'boot'} />
          <span className="topbar__sub">
            <Badge text={`${info?.version ?? '·'} · Electron ${info?.electron?.split('.')[0] ?? '·'} · profile 0x1C`} c={c} />
          </span>
        </div>
        <div className="topbar__spacer" />
        {busy && <Busy status={busy} elapsed={elapsed} c={c} />}
        <Select c={c} placeholder="主题" value={settings?.theme ?? 'system'} wide
          onChange={(v) => void patch({ theme: v as Theme })}
          options={[
            { value: 'system', label: '跟随系统', tag: resolvedDark('system') ? '暗' : '亮' },
            { value: 'dark', label: '深色' },
            { value: 'light', label: '浅色' }
          ]} />
      </header>

      <div className="layout">
        <nav className="nav">
          <Panel c={c} dense>
            <Nav items={VIEWS} active={view} onSelect={setView} c={c} />
          </Panel>
        </nav>

        <main className="main">
          <Fade replayKey={String(view)}>
            {view === 0 && <EncodeView c={c} mode="encode" info={info} totals={totals} active={active} outDir={outDir} message={message}
              onBrowseDir={() => void pickDir()} onBrowseFiles={() => void browse()} onDrop={(p) => void enqueue(p, p.map(() => 0))}
              onExecute={() => void runAll()} onClear={clearQueued} />}
            {view === 1 && <DecodeView c={c} mode="decode" info={info} totals={totals} active={active} outDir={outDir} message={message}
              settings={settings} onPatch={(p) => void patch(p)}
              onBrowseDir={() => void pickDir()} onBrowseFiles={() => void browse()} onDrop={(p) => void enqueue(p, p.map(() => 0))}
              onExecute={() => void runAll()} onClear={clearQueued} />}
            {view === 2 && <InspectView c={c} path={inspectPath} onPath={setInspectPath} result={inspect}
              onBrowse={async () => {
                const got = await window.api.pickFiles('decode');
                if (!got[0]) return;
                setInspectPath(got[0].path);
                setInspect(await window.api.inspect(got[0].path));
              }}
              onRun={async () => {
                if (!inspectPath) { setMessage('先选一个 .bt3d 容器'); return; }
                try {
                  setInspect(await window.api.inspect(inspectPath));
                  setMessage('头部九项校验全部通过');
                } catch (e) {
                  const err = e as { code?: string; message?: string };
                  setInspect(null);
                  setMessage(`解析被拒：${err.code ?? ''} ${String(err.message ?? e).slice(0, 70)}`);
                }
              }}
              message={message} />}
            {view === 3 && <SettingsView c={c} settings={settings} info={info} outDir={outDir}
              onPatch={(p) => void patch(p)} onBrowseDir={() => void pickDir()} />}
            {view === 4 && <AboutView c={c} info={info} />}
          </Fade>
        </main>

        <aside className="side">
          <Panel c={c} title="任务队列" hint={`${totals.queued} 待执行 · ${totals.done} 完成 · ${totals.failed} 失败`}>
            <Queue c={c} dark={dark} height={250} selected={selected} onSelect={setSelected}
              items={jobs.map((j) => ({ id: j.id, title: j.name, description: baseName(j.outPath), meta: fmtBytes(j.size) }))}
              renderItem={(item, _i, isSel) => {
                const j = jobs.find((x) => x.id === String((item as { id?: string | number }).id ?? ''));
                if (!j) return null;
                return (
                  <div className="job" data-selected={isSel ? '1' : '0'} data-status={j.status} onClick={() => setSelected(j.id)}>
                    <Dot c={c} status={j.status === 'queued' ? 'pending' : j.status === 'running' ? 'running' : j.status === 'done' ? 'done' : 'failed'} />
                    <div style={{ minWidth: 0 }}>
                      <div className="job__name" title={j.inPath}>{j.name}</div>
                      <div className="job__meta">
                        {j.kind === 'encode' ? '混淆' : '还原'} ·{' '}
                        {j.status === 'running'
                          ? `${j.phase === 'verifying' ? '校验中' : Math.round(j.pct * 100) + '%'} ${fmtBytes(j.done)}/${fmtBytes(j.total || j.size)}`
                          : j.status === 'done'
                            ? `→ ${baseName(j.outPath)}　${Math.round(j.ms ?? 0)} ms`
                            : j.status === 'failed'
                              ? j.error ?? '失败'
                              : `待执行 → ${baseName(j.outPath)}`}
                      </div>
                      <div className="job__bar"><i style={{ width: `${Math.round(j.pct * 100)}%` }} /></div>
                    </div>
                    <div className="row row--tight">
                      <span className="pill" data-tone={j.status === 'done' ? 'ok' : j.status === 'failed' ? 'err' : j.status === 'running' ? 'run' : undefined}>
                        {j.status === 'queued' ? '排队' : j.status === 'running' ? (j.phase === 'verifying' ? '校验中' : '写入中') : j.status === 'done' ? '完成' : '失败'}
                      </span>
                      {j.status === 'done' && (
                        <GhostButton c={c} title="在资源管理器中显示输出文件" onClick={() => void window.api.reveal(j.outPath)}>显示</GhostButton>
                      )}
                    </div>
                  </div>
                );
              }} />

            <DropFrame over={over} c={c}>
              <div className="dropzone" data-over={over ? '1' : '0'}>
                <div className="dropzone__title">{over ? '松手就加入队列' : '把文件拖到这里'}</div>
                <div className="dropzone__sub">
                  {view <= 1
                    ? `当前挡位「${VIEWS[view]}」收${mode === 'encode' ? '非 .bt3d 文件' : ' .bt3d 容器'}；整窗任意位置都能拖入`
                    : '切到「加密」或「解密」挡位后，拖入即入队'}
                </div>
                {jobs.length > 0 && <FileGlyphs dark={dark} items={jobs.slice(0, 8).map((j) => ({
                  icon: (j.name.replace(/^.*\./, '') || '·').slice(0, 3).toUpperCase(),
                  label: j.name,
                  color: j.status === 'failed' ? c.err : j.status === 'done' ? c.ok : c.accent
                }))} />}
              </div>
            </DropFrame>

            <div className="row" style={{ marginTop: 10 }}>
              <GhostButton c={c} title="多选，也可以直接拖进窗口" onClick={() => void browse()}>添加文件</GhostButton>
              <GhostButton c={c} onClick={clearQueued}>清空待执行</GhostButton>
              <div style={{ flex: '1 1 auto' }} />
              <Execute c={c} disabled={!totals.queued} onHold={() => void runAll()} label="按住执行队列" done="已提交" />
            </div>
          </Panel>

          <Panel c={c} title="进度与统计" hint={active ? baseName(active.name) : '没有进行中的任务'}>
            <div className="col">
              {active ? (
                <div className="col" style={{ alignItems: 'center', gap: 6 }}>
                  <Dial c={c} pct={Math.round(active.pct * 100)} label={active.status === 'done' ? '完成' : active.status === 'failed' ? '失败' : '进度'} />
                  <span className="muted rb-mono">{fmtBytes(active.done)} / {fmtBytes(active.total || active.size)}</span>
                  {active.bps > 0 && <span className="muted">{fmtBytes(active.bps)}/s</span>}
                </div>
              ) : (
                <span className="muted">队列空闲。执行时这里显示单层写入进度；解码在校验 tag 期间进度会停在 0，那是第一遍不产出数据的正常表现。</span>
              )}
              <div className="grid-2">
                <div className="col"><span className="field__label">已处理字节</span><Stat c={c} value={totals.bytes} suffix=" B" /></div>
                <div className="col"><span className="field__label">累计耗时</span><Stat c={c} value={Math.round(totals.ms)} suffix=" ms" /></div>
              </div>
            </div>
          </Panel>
        </aside>
      </div>

      <footer className="statusbar">
        <span className="statusbar__msg"><StatusLine text={message} c={c} dark={dark} /></span>
        <span className="muted">{info ? `${VIEWS[view]} · ${fmtBytes(totals.bytes)}` : '加载中'}</span>
        {running
          ? <span className="pill" data-tone="run">执行中 {Math.round(elapsed / 100) / 10}s</span>
          : <FolderButton c={c} onClick={() => void window.api.openFolder(outDir || info?.userData || '')}>打开输出目录</FolderButton>}
      </footer>
    </div>
  );

  async function pickDir() {
    const d = await window.api.pickDir();
    if (!d) return;
    setOutDir(d);
    await patch({ outDir: d });
    setMessage(`输出目录：${d}`);
  }
}
