// ReactBits 取件器。
//
//   node bin/fetch-reactbits.mjs --report          只列候选件的真实依赖（看 import 行，不看 registry 的 dependencies 字段）
//   node bin/fetch-reactbits.mjs --write A B C     取这些件并落盘 src/reactbits/，写 lock.json
//   node bin/fetch-reactbits.mjs --check           按 lock.json 校验落盘内容未被改动（哈希逐条比）
//
// registry 端点：https://www.reactbits.dev/r/<Name>-<TS|JS>-<CSS|TW>
// 不带 www 的 reactbits.dev/r/... 在本机实测返回 000（连接失败），所以域名钉死。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// registry 端点实测：官方站 www.reactbits.dev/r/<Name>-TS-CSS 单请求 17~25s 且 3 次里 2 次超时，
// 而同一份内容也躺在仓库的 public/r/*.json 里，走 jsDelivr / raw 只花 0.5~1.4s。
// 所以主源取仓库 raw，备源 jsDelivr，最后才回官方站。不带 www 的 reactbits.dev 本机返回 000。
const HOST = 'https://www.reactbits.dev/r/';
const SOURCES = (name) => [
  `https://raw.githubusercontent.com/DavidHDev/react-bits/main/public/r/${name}-${VARIANT}.json`,
  `https://cdn.jsdelivr.net/gh/DavidHDev/react-bits@main/public/r/${name}-${VARIANT}.json`,
  `${HOST}${name}-${VARIANT}`
];
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src', 'reactbits');
const LOCK = path.join(OUT, 'lock.json');
const VARIANT = process.env.RB_VARIANT || 'TS-CSS';

// 候选清单：按"文件加解密工具"的界面位取，宁多勿漏，选完再砍
export const CANDIDATES = [
  'DarkVeil', 'DotGrid', 'GridScan', 'Silk', 'LightRays', 'Particles', 'Iridescence', 'SoftAurora',
  'SplitText', 'DecryptedText', 'ScrambledText', 'GradientText', 'ShinyText', 'BlurText', 'TextType', 'CountUp', 'TechText', 'MaskedHeading',
  'GlassSurface', 'BorderGlow', 'SpotlightCard', 'TiltedCard', 'GlassIcons', 'AnimatedList', 'Stepper', 'Counter',
  'CurvedInput', 'Dock', 'LineSidebar', 'Stack', 'Masonry', 'MagicBento', 'ReflectiveCard', 'AccordionGallery', 'FluidGlass',
  'SquishSwitch', 'JellyRadio', 'SpringCheck', 'BellToggle', 'GlideSelect', 'RubberSegment', 'WakeSlider',
  'CometDial', 'SloshGauge', 'LatticeLoader', 'PaperCrumple', 'Shredder', 'StatusMark', 'SwipeRow', 'SwipeToast',
  'HoldButton', 'FlyingButton', 'SpecularButton', 'FuseButton', 'ScrubField', 'WarmTooltip', 'CallChip',
  'AnimatedContent', 'FadeContent', 'Magnet', 'ClickSpark', 'GlareHover', 'StarBorder', 'GradualBlur', 'Crosshair'
];

const sha = (s) => createHash('sha256').update(s).digest('hex');
const thirdParty = (code) =>
  [...code.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith('.') && !s.startsWith('@/'))
    .map((s) => s.split('/')[0] === '@' ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);

async function getJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'bt3d-box/fetch-reactbits' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(await r.text());
  } finally { clearTimeout(t); }
}

async function fetchOne(name) {
  let lastErr = '无源可达';
  for (const url of SOURCES(name)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const j = await getJson(url);
        if (!Array.isArray(j.files) || !j.files.length) throw new Error('响应里没有 files');
        const files = j.files.map((f) => ({ name: path.basename(f.path), content: f.content, ext: path.extname(f.path) }));
        const code = files.filter((f) => /\.(tsx|ts|jsx|js)$/.test(f.ext)).map((f) => f.content).join('\n');
        return { name, via: new URL(url).host, declared: j.dependencies || [], imported: [...new Set(thirdParty(code))], files };
      } catch (e) { lastErr = `${new URL(url).host}: ${e.name === 'AbortError' ? '超时' : String(e.message).slice(0, 60)}`; }
    }
  }
  throw new Error(lastErr);
}

const args = process.argv.slice(2);
const mode = args[0] || '--report';

if (mode === '--report') {
  const only = args.slice(1);
  const list = only.length ? only : CANDIDATES;
  const rows = [];
  for (let i = 0; i < list.length; i += 6) {
    const got = await Promise.all(list.slice(i, i + 6).map((n) => fetchOne(n).catch((e) => ({ name: n, error: String(e.message) }))));
    for (const g of got) rows.push(g);
  }
  for (const g of rows) {
    if (g.error) { console.log(`${g.name}\tFAIL ${g.error}`); continue; }
    const css = g.files.filter((f) => f.ext === '.css').length;
    console.log(`${g.name}\timport=[${g.imported.join(',') || '无'}]\tdeclared=[${g.declared.join(',')}]\tfiles=${g.files.length}(css ${css})\t${g.files.map(f => `${f.name}:${f.content.length}B`).join(' ')}`);
  }
  const need = new Set();
  for (const g of rows) (g.imported || []).forEach((d) => need.add(d));
  console.log(`\n合计 ${rows.length} 件，需要的第三方包：[${[...need].join(', ')}]`);
  process.exit(0);
}

if (mode === '--write') {
  const list = args.slice(1);
  if (!list.length) { console.log('用法：node bin/fetch-reactbits.mjs --write <Name> ...'); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { host: HOST, variant: VARIANT, fetchedAt: '', components: {} };
  lock.variant = VARIANT;
  lock.host = HOST;
  for (const g of await Promise.all(list.map((n) => fetchOne(n)))) {
    for (const f of g.files) writeFileSync(path.join(OUT, `${g.name}.${f.name.split('.').pop()}`), f.content, 'utf8');
    lock.components[g.name] = {
      variant: VARIANT,
      imported: g.imported,
      files: Object.fromEntries(g.files.map((f) => [`${g.name}.${f.ext.slice(1)}`, sha(f.content)]))
    };
    console.log(`写入 ${g.name}：${g.files.map((f) => `${g.name}${f.ext}`).join(' ')}  import=[${g.imported.join(',')}]`);
  }
  lock.fetchedAt = new Date().toISOString();
  lock.componentCount = Object.keys(lock.components).length;
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  console.log(`lock.json：${lock.componentCount} 个组件`);
  process.exit(0);
}

if (mode === '--check') {
  if (!existsSync(LOCK)) { console.log('缺 lock.json'); process.exit(1); }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  let bad = 0, files = 0;
  for (const [name, rec] of Object.entries(lock.components)) {
    for (const [file, hash] of Object.entries(rec.files)) {
      const p = path.join(OUT, file);
      files++;
      if (!existsSync(p)) { console.log(`缺失 ${file}`); bad++; continue; }
      const now = sha(readFileSync(p, 'utf8'));
      if (now !== hash) { console.log(`内容被改动 ${file}\n  lock ${hash.slice(0, 16)}\n  现在 ${now.slice(0, 16)}`); bad++; }
    }
  }
  console.log(`rb:check ${Object.keys(lock.components).length} 件 / ${files} 文件，改动或缺失 ${bad} 处`);
  process.exit(bad ? 1 : 0);
}

console.log(`未知模式 ${mode}`);
process.exit(1);
