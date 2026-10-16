#!/usr/bin/env node
/*
 * tools/build-data.js — 从 tools/upstream/ 里的 carbon-app/carbon v4.9.10 原始源码
 * 重新生成 data/*.js（classic script，挂 window.CARBON，file:// 下可直接 <script src> 加载）。
 *
 * 为什么是 .js 而不是 .json：file:// 协议下 fetch/XHR 会被 CORS 拦，
 * 所以数据必须以「脚本赋值全局变量」的形式落位，不能运行时读取 JSON。
 *
 * 用法：
 *   node tools/build-data.js          # 生成/覆盖 data/*.js（幂等：内容不变则不动盘）
 *   node tools/build-data.js --check  # 只校验现有 data/*.js 与上游是否一致，不写盘
 *
 * 任何字段缺失、SVG 标签不配平、数据里出现 `</script>` 都会非零退出。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const UP = path.join(ROOT, 'tools', 'upstream')
const OUT = path.join(ROOT, 'data')

const CHECK_ONLY = process.argv.includes('--check')
const problems = []
const die = m => problems.push(m)

const read = f => fs.readFileSync(path.join(UP, f), 'utf8')
const sha8 = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)

/* ---------------------------------------------------------------- 数据源 */

const upstream = JSON.parse(read('extracted.json'))
const {
  THEMES,
  LANGUAGES,
  FONTS,
  HIGHLIGHT_KEYS,
  COLORS,
  EXPORT_SIZES,
  DEFAULT_SETTINGS,
  DEFAULT_WIDTHS,
  DEFAULT_CODE,
  DEFAULT_PRESETS,
  DEFAULT_BG_COLOR,
} = upstream

if (THEMES.length !== 29) die(`THEMES 应为 29，实际 ${THEMES.length}`)
if (LANGUAGES.length !== 78) die(`LANGUAGES 应为 78，实际 ${LANGUAGES.length}`)
if (FONTS.length !== 13) die(`FONTS 应为 13，实际 ${FONTS.length}`)
if (DEFAULT_PRESETS.length !== 8) die(`DEFAULT_PRESETS 应为 8，实际 ${DEFAULT_PRESETS.length}`)

/* 主题：variable2/variable3 是上游 themes 里的可选键，GlobalHighlights 用 `|| variable` 兜底；
   builtin 上游只有个别主题有，缺失时保持 undefined（不编造颜色）。 */
const themes = THEMES.map(t => {
  const h = { ...t.highlights }
  if (h.variable2 == null && h.variable != null) h.variable2 = h.variable
  if (h.variable3 == null && h.variable != null) h.variable3 = h.variable
  const missing = HIGHLIGHT_KEYS.filter(k => h[k] == null)
  if (missing.length) die(`主题 ${t.id} 缺 HIGHLIGHT_KEYS: ${missing.join(',')}`)
  const out = { id: t.id, name: t.name, highlights: h }
  if (t.light) out.light = true
  if (t.link) out.link = t.link
  return out
})

/* 语言：原样保留上游字段，额外附一个 CM5 mode 可用性标记（vendor 里没有的 mode 会退化成纯文本） */
const MODES_UNAVAILABLE = ['graphql'] // codemirror-graphql 无 classic-script 产物，见 vendor/README.md
const languages = LANGUAGES.map(l => {
  const out = { ...l }
  if (l.mode && MODES_UNAVAILABLE.includes(l.mode)) out.modeAvailable = false
  return out
})

/* 预设：icon 指向上游 /static/presets/N.png（离线无该资产），改用 CSS 生成的色块缩略图 */
const presets = DEFAULT_PRESETS.map((p, i) => {
  const out = { ...p }
  delete out.icon
  out.icon = null
  out.index = i
  return out
})

/* react-color SketchPicker 未传 presetColors 时的内置 15 色（Carbon 背景选择器用的就是这套） */
const BG_PRESETS = [
  '#D0021B',
  '#F5A623',
  '#F8E71C',
  '#8B572A',
  '#7ED321',
  '#417505',
  '#BD10E0',
  '#9013FE',
  '#4A90E2',
  '#50E3C2',
  '#B8E986',
  '#000000',
  '#4A4A4A',
  '#9B9B9B',
  '#FFFFFF',
]

/* 字体：上游 13 个 family 全靠 CDN webfont（components/style/Font.js）。
   本工程零网络，故每个 family 后面挂本机可能存在的回退；未安装时按 monospace 落。 */
const FONT_FALLBACKS = {
  'Anonymous Pro': "'Anonymous Pro', Consolas, monospace",
  'Cascadia Code': "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  'Droid Sans Mono': "'Droid Sans Mono', Consolas, monospace",
  'Fantasque Sans Mono': "'Fantasque Sans Mono', Consolas, monospace",
  'Fira Code': "'Fira Code', Consolas, monospace",
  Hack: "Hack, 'JetBrains Mono', Consolas, monospace",
  'IBM Plex Mono': "'IBM Plex Mono', Consolas, monospace",
  Inconsolata: "Inconsolata, Consolas, monospace",
  'JetBrains Mono': "'JetBrains Mono', Consolas, monospace",
  Monoid: "Monoid, Consolas, monospace",
  'Source Code Pro': "'Source Code Pro', Consolas, monospace",
  'Space Mono': "'Space Mono', Consolas, monospace",
  'Ubuntu Mono': "'Ubuntu Mono', Consolas, monospace",
}

/* ---------------------------------------------------------------- JSX → SVG 字符串 */

const ATTR_MAP = {
  className: 'class',
  fillRule: 'fill-rule',
  clipRule: 'clip-rule',
  fillOpacity: 'fill-opacity',
  strokeWidth: 'stroke-width',
  strokeOpacity: 'stroke-opacity',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray',
  strokeMiterlimit: 'stroke-miterlimit',
  textAnchor: 'text-anchor',
  xmlnsXlink: 'xmlns:xlink',
  xlinkHref: 'xlink:href',
}

function jsxToSvg(block) {
  let s = block
  for (const [from, to] of Object.entries(ATTR_MAP)) {
    s = s.split(`${from}=`).join(`${to}=`)
  }
  // 表达式属性：width={width} height={height} fill={color} stroke={color} → currentColor / 保留上游默认值
  s = s.replace(/(fill|stroke)=\{color\}/g, '$1="currentColor"')
  s = s.replace(/(fill|stroke)=\{props\.color\}/g, '$1="currentColor"')
  s = s.replace(/\sstyle=\{style\}/g, '')
  // 数字表达式（Copy 的 size*RATIO、Checkmark 的 width/height）
  s = s.replace(/width=\{width\}/g, 'width="__W__"').replace(/height=\{height\}/g, 'height="__H__"')
  s = s.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ')
  return s.trim()
}

function extractSvgBlocks(file, label) {
  const src = read(file)
  const blocks = []
  const re = /<svg[\s\S]*?<\/svg>/g
  let m
  while ((m = re.exec(src))) blocks.push(m[0])
  if (!blocks.length) die(`${label}: 没有抽到任何 <svg> 块`)
  return blocks.map(b => {
    const out = jsxToSvg(b)
    const open = (out.match(/<svg/g) || []).length
    const close = (out.match(/<\/svg>/g) || []).length
    if (open !== 1 || close !== 1) die(`${label}: svg 标签不配平 open=${open} close=${close}`)
    const g = (out.match(/<g[\s>]/g) || []).length
    const gc = (out.match(/<\/g>/g) || []).length
    if (g !== gc) die(`${label}: <g> 不配平 ${g}/${gc}`)
    if (/<\/script/i.test(out)) die(`${label}: 含 </script>，会截断 HTML`)
    return out
  })
}

/* 上游 Controls.js 顺序 = [none(macOS 三色点), bw, boxy]；sharp 复用 none 的三点（Carbon.js 的映射表） */
const controlsBlocks = extractSvgBlocks('Controls.js', 'Controls')
if (controlsBlocks.length !== 3) die(`Controls 应为 3 段，实际 ${controlsBlocks.length}`)
const CONTROLS = { none: controlsBlocks[0], sharp: controlsBlocks[0], bw: controlsBlocks[1], boxy: controlsBlocks[2] }

/* WindowThemes.js 导出顺序 = Sharp, BW, None, Boxy（60×60 设置面板单选图标） */
const wtBlocks = extractSvgBlocks('components_svg_WindowThemes.js', 'WindowThemes')
if (wtBlocks.length !== 4) die(`WindowThemes 应为 4 段，实际 ${wtBlocks.length}`)
const WINDOW_THEME_ICONS = { sharp: wtBlocks[0], bw: wtBlocks[1], none: wtBlocks[2], boxy: wtBlocks[3] }

/* Watermark：fill={light ? A : B} 需要出明暗两版 */
const [wmRaw] = extractSvgBlocks('components_svg_Watermark.js', 'Watermark')
/* 上游有一处 light 色写成 '9e9e9e'（缺 #，CSS 非法值 → 浏览器回落黑色）。这里补 # 并记为已修正的上游缺陷。 */
const normalizeColor = v => (/^[0-9a-fA-F]{3,8}$/.test(v) ? '#' + v : v)
const wmExpr = /fill=\{light \? '?([^'"}]+)'? : '?([^'"}]+)'?\}/g
const fixedUpstreamColors = []
const wmPairs = [...read('components_svg_Watermark.js').matchAll(wmExpr)].map(m => {
  const light = normalizeColor(m[1])
  const dark = normalizeColor(m[2])
  if (light !== m[1]) fixedUpstreamColors.push(`light '${m[1]}' → '${light}'`)
  return { light, dark }
})
if (!wmPairs.length) die('Watermark: 没解析到 light/dark 配色对')
const wmVariant = want =>
  wmRaw.replace(wmExpr, (_, l, d) => `fill="${want === 'light' ? normalizeColor(l) : normalizeColor(d)}"`)
const watermarkDark = wmVariant('dark')
const watermarkLight = wmVariant('light')
if (/fill=\{/.test(watermarkDark) || /fill=\{/.test(watermarkLight))
  die('Watermark: 仍有未替换的 fill={...} 表达式')
if (watermarkDark === watermarkLight) die('Watermark: 明暗两版完全相同，替换未生效')
// 上游 className 已被映射为 class；svg 尺寸 55×23 保留
if (!/class="watermark"/.test(watermarkDark)) die('Watermark: 缺 class="watermark"')

const single = (file, label) => {
  const b = extractSvgBlocks(file, label)
  if (b.length !== 1) die(`${label}: 期望 1 段 svg，实际 ${b.length}`)
  return b[0]
}

const ICONS = {
  theme: single('components_svg_Theme.js', 'Theme'),
  language: single('components_svg_Language.js', 'Language'),
  settings: single('components_svg_Settings.js', 'Settings(gear)'),
  logo: single('components_svg_Logo.js', 'Logo'),
}

/* Arrows: Up/Down/Right 三段，按源码顺序 */
const arrowBlocks = extractSvgBlocks('components_svg_Arrows.js', 'Arrows')
if (arrowBlocks.length !== 3) die(`Arrows 应为 3 段，实际 ${arrowBlocks.length}`)
const ARROWS = { up: arrowBlocks[0], down: arrowBlocks[1], right: arrowBlocks[2] }

/* Copy: width=size*0.81, height=size, defaultProps.size=16 → 12.96×16 */
const copyBlock = single('components_svg_Copy.js', 'Copy')
const COPY = copyBlock.replace('__W__', '12.96').replace('__H__', '16')
if (/__W__|__H__/.test(COPY)) die('Copy: 尺寸占位符未替换')

/* Checkmark: width/height 默认 18；Remove: 5×5 固定 */
const checkmarkBlock = single('components_svg_Checkmark.js', 'Checkmark')
const CHECKMARK = checkmarkBlock.replace(/width="__W__"/, 'width="18"').replace(/height="__H__"/, 'height="18"')
if (/__W__|__H__/.test(CHECKMARK)) die('Checkmark: 尺寸占位符未替换')
const REMOVE = single('components_svg_Remove.js', 'Remove')

/* ---------------------------------------------------------------- 产物 */

const banner = (title, lines) =>
  ['/*!', ` * ${title}`, ...lines.map(l => ` * ${l}`), ' */'].join('\n') + '\n'

const head = (name, lines) =>
  banner(`data/${name}.js — 由 node tools/build-data.js 生成，请勿手改`, [
    '上游: github.com/carbon-app/carbon @ main (v4.9.10, MIT) — lib/constants.js 与 components/svg/*.js 原样数值',
    ...lines,
  ]) + '\n'

const bundle = `window.CARBON = window.CARBON || {}\n`

const files = {
  'settings.js':
    head('settings', ['字段与上游 DEFAULT_SETTINGS/DEFAULT_WIDTHS/COLORS/EXPORT_SIZES 一一对应。']) +
    bundle +
    'CARBON.DEFAULT_SETTINGS = ' +
    JSON.stringify(DEFAULT_SETTINGS, null, 2) +
    ';\n' +
    'CARBON.DEFAULT_WIDTHS = ' +
    JSON.stringify(DEFAULT_WIDTHS) +
    ';\n' +
    'CARBON.COLORS = ' +
    JSON.stringify(COLORS, null, 2) +
    ';\n' +
    'CARBON.EXPORT_SIZES = ' +
    JSON.stringify(EXPORT_SIZES) +
    ';\n' +
    'CARBON.HIGHLIGHT_KEYS = ' +
    JSON.stringify(HIGHLIGHT_KEYS) +
    ';\n' +
    'CARBON.DEFAULT_BG_COLOR = ' +
    JSON.stringify(DEFAULT_BG_COLOR) +
    ';\n' +
    'CARBON.BG_PRESETS = ' +
    JSON.stringify(BG_PRESETS) +
    ';\n' +
    'CARBON.FONTS = ' +
    JSON.stringify(FONTS, null, 2) +
    ';\n' +
    'CARBON.FONT_FALLBACKS = ' +
    JSON.stringify(FONT_FALLBACKS, null, 2) +
    ';\n' +
    'CARBON.DEFAULT_CODE = ' +
    JSON.stringify(DEFAULT_CODE) +
    ';\n',
  'themes.js':
    head('themes', [
      `29 个主题的 CM5 token 色表（键名即 .cm-* 类名，见 js/theme.js 的选择器表）。`,
      'variable2/variable3 缺失时已按上游 GlobalHighlights 的规则回填为 variable。',
    ]) +
    bundle +
    'CARBON.THEMES = ' +
    JSON.stringify(themes, null, 2) +
    ';\n',
  'languages.js':
    head('languages', [
      `78 条语言（含 Auto / Plain Text）。mode=mime 交给 CodeMirror 的 spec；`,
      `highlight:true 的条目参与 hljs 自动检测（short||mode 即 hljs 语言名）。`,
      `modeAvailable:false 标记 vendor/modes.js 里没有对应 mode 的条目（渲染时退化为纯文本，不抛错）。`,
    ]) +
    bundle +
    'CARBON.LANGUAGES = ' +
    JSON.stringify(languages, null, 2) +
    ';\n',
  'presets.js':
    head('presets', [
      '8 个内置预设（上游 DEFAULT_PRESETS 原样）。',
      '上游 icon 字段指向 /static/presets/N.png；离线无该资产，这里置 null，',
      '由 js/ui/presets.js 用 backgroundColor + 主题底色生成 CSS 色块。',
    ]) +
    bundle +
    'CARBON.DEFAULT_PRESETS = ' +
    JSON.stringify(presets, null, 2) +
    ';\n',
  'svg.js':
    head('svg', [
      'JSX 组件转成的 SVG 字符串（属性名已 kebab-case 化，{color} → currentColor，尺寸取上游默认值）。',
      'watermark 出明暗两版；controls 是画布里的窗口控件，windowThemeIcons 是设置面板的单选图标。',
    ]) +
    bundle +
    'CARBON.SVG = {\n' +
    '  controls: ' +
    JSON.stringify(CONTROLS, null, 2) +
    ',\n' +
    '  windowThemeIcons: ' +
    JSON.stringify(WINDOW_THEME_ICONS, null, 2) +
    ',\n' +
    '  watermark: { dark: ' +
    JSON.stringify(watermarkDark) +
    ', light: ' +
    JSON.stringify(watermarkLight) +
    ', pairs: ' +
    JSON.stringify(wmPairs) +
    ' },\n' +
    '  icons: ' +
    JSON.stringify({ ...ICONS, arrows: ARROWS, copy: COPY, checkmark: CHECKMARK, remove: REMOVE }, null, 2) +
    '\n};\n',
}

/* 写盘 + 回读校验 */
fs.mkdirSync(OUT, { recursive: true })
const report = []
for (const [name, content] of Object.entries(files)) {
  const dest = path.join(OUT, name)
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null
  const st = 'ok'
  if (prev !== content) {
    if (CHECK_ONLY) die(`--check: data/${name} 与上游不一致，需要重新生成`)
    else fs.writeFileSync(dest, Buffer.from(content, 'utf8'))
  }
  const bytes = fs.existsSync(dest) ? fs.readFileSync(dest).length : Buffer.byteLength(content)
  if (/<\/script/i.test(content)) die(`data/${name}: 含 </script>`)
  // 语法可解析（classic script）
  try {
    new Function(content)
  } catch (e) {
    die(`data/${name}: 语法不可解析 → ${e.message}`)
  }
  report.push({ name, bytes, sha1: sha8(Buffer.from(content, 'utf8')), changed: prev !== content })
}

/* 回读：把产物当脚本跑一遍，确认全局真的挂上了（防"写了但没导出"）
   window 必须就是全局对象本身，否则 `window.CARBON={}` 之后的裸 `CARBON.x=` 在 vm 里找不到绑定 */
const sandbox = {}
sandbox.window = sandbox
const vm = require('vm')
const ctx = vm.createContext(sandbox)
for (const name of Object.keys(files)) {
  const src = fs.readFileSync(path.join(OUT, name), 'utf8')
  try {
    vm.runInContext(src, ctx, { filename: `data/${name}` })
  } catch (e) {
    die(`data/${name} 执行失败: ${e.message}`)
  }
}
const C = sandbox.CARBON || {}
const expect = {
  'CARBON.THEMES': [29, (C.THEMES || []).length],
  'CARBON.LANGUAGES': [78, (C.LANGUAGES || []).length],
  'CARBON.DEFAULT_PRESETS': [8, (C.DEFAULT_PRESETS || []).length],
  'CARBON.FONTS': [13, (C.FONTS || []).length],
  'CARBON.BG_PRESETS': [15, (C.BG_PRESETS || []).length],
  'CARBON.HIGHLIGHT_KEYS': [12, (C.HIGHLIGHT_KEYS || []).length],
  'CARBON.SVG.controls': [4, Object.keys((C.SVG || {}).controls || {}).length],
  'CARBON.SVG.windowThemeIcons': [4, Object.keys((C.SVG || {}).windowThemeIcons || {}).length],
}
for (const [k, [want, got]] of Object.entries(expect)) {
  if (want !== got) die(`回读计数不符 ${k}: 期望 ${want} 实际 ${got}`)
}
for (const t of C.THEMES || []) {
  for (const key of C.HIGHLIGHT_KEYS || []) {
    if (!/^#|^[a-z]+\.?\d*$|rgba?\(/.test(String(t.highlights[key] || '')))
      die(`主题 ${t.id}.${key} 颜色不像 CSS 颜色值: ${t.highlights[key]}`)
  }
}

console.log('[data] 生成/校验完成')
for (const r of report) {
  console.log(
    `  data/${r.name.padEnd(14)} ${String(r.bytes).padStart(7)}B  sha1 ${r.sha1}  ${
      r.changed ? 'CHANGED' : 'unchanged'
    }`
  )
}
const size = a => (Array.isArray(a) ? a.length : a ? Object.keys(a).length : 'n/a')
console.log(
  `  回读：主题 ${size(C.THEMES)} × ${size(C.HIGHLIGHT_KEYS)} keys，语言 ${size(C.LANGUAGES)}，` +
    `预设 ${size(C.DEFAULT_PRESETS)}，字体 ${size(C.FONTS)}，色板 ${size(C.BG_PRESETS)}，` +
    `窗口控件 ${size(C.SVG && C.SVG.controls)} 型 + 单选图标 ${size(C.SVG && C.SVG.windowThemeIcons)} 型`
)

if (fixedUpstreamColors.length)
  console.log('  已修正上游缺陷: ' + fixedUpstreamColors.join(', '))

if (problems.length) {
  console.error('\n[FAIL] data/ 构建校验未通过:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('[OK] data/ 全部产物就位并通过 vm 回读校验')
