#!/usr/bin/env node
/*
 * tools/build-fonts.js — 抓 13 个编辑器字体进 fonts/，并生成 css/fonts.css
 *
 * 为什么要这个脚本：本工程零网络，上游那 13 个字体本来是运行时从 Google Fonts 拉的。
 * 不带字体的后果不是报错，而是"切换没反应"——12 个选项全部回退到同一个本机字体，
 * 实测同一段文字只有两种宽度（见 tools/probe/verify3-font.html 的 distinctTextWidths）。
 *
 * 三挡命令：
 *   node tools/build-fonts.js            抓取 + 落盘 + 生成 css/fonts.css + fonts/manifest.json
 *   node tools/build-fonts.js --verify   不联网：只验文件在不在、魔数对不对、字节数过阈值
 *   node tools/build-fonts.js --check    不联网：把盘上字节与 manifest 逐条比，漂了就红
 *
 * 子集口径：fontsource 的 latin-400-normal 与上游 Google Fonts 的 latin 子集同范围，
 * 所以中日韩字符仍然回退到系统字体——这和线上 carbon.now.sh 一样，不是本工程的退化。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const TOOLS = path.join(ROOT, 'tools')
const FONT_DIR = path.join(ROOT, 'fonts')
const CSS_OUT = path.join(ROOT, 'css', 'fonts.css')
const DATA_OUT = path.join(ROOT, 'data', 'fonts.js')
const MANIFEST_OUT = path.join(FONT_DIR, 'manifest.json')
const CACHE = path.join(TOOLS, '.cache')
const CACHE_INDEX_FILE = path.join(CACHE, 'index.json')

const argv = process.argv.slice(2)
const OPT = {
  verify: argv.includes('--verify'),
  check: argv.includes('--check'),
  force: argv.includes('--force'),
  offline: argv.includes('--offline'),
}

/* 13 个族名必须与 data/settings.js 的 CARBON.FONTS[].id 逐字相同：
 * @font-face 的 family 名靠的就是这个字符串匹配，写错一个字母就是静默不生效。 */
const SOURCES = [
  {
    id: 'Anonymous Pro',
    slug: 'anonymous-pro',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/anonymous-pro@5.3.0/files/anonymous-pro-latin-400-normal.woff2',
    minBytes: 8000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'Cascadia Code',
    slug: 'cascadia-code',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/cascadia-code@5.3.0/files/cascadia-code-latin-400-normal.woff2',
    minBytes: 8000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'Droid Sans Mono',
    slug: 'droid-sans-mono',
    url: 'https://fonts.gstatic.com/s/droidsansmono/v21/6NUO8FuJNQ2MbkrZ5-J8lKFrp7pRef2u.ttf',
    minBytes: 8000,
    note: 'fontsource/typeface 都没有这个族（Google 已下架该族），只能取 gstatic 的钉版 TTF',
  },
  {
    id: 'Fantasque Sans Mono',
    slug: 'fantasque-sans-mono',
    url: 'https://cdn.jsdelivr.net/npm/@typopro/web-fantasque-sans-mono@3.7.5/TypoPRO-FantasqueSansMono-Regular.woff',
    minBytes: 8000,
    note: 'fontsource 无此族，取 @typopro 的 woff（Chrome 全支持 woff1）',
  },
  {
    id: 'Fira Code',
    slug: 'fira-code',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/fira-code@5.3.0/files/fira-code-latin-400-normal.woff2',
    minBytes: 8000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'Hack',
    slug: 'hack',
    url: 'https://cdn.jsdelivr.net/npm/hack-font@3.3.0/build/web/fonts/hack-regular-subset.woff2',
    minBytes: 8000,
    note: 'fontsource 无此族，取 Source Foundry 官方 npm hack-font 的 subset 版（全量版 106 KB）',
  },
  {
    id: 'IBM Plex Mono',
    slug: 'ibm-plex-mono',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.3.0/files/ibm-plex-mono-latin-400-normal.woff2',
    minBytes: 5000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'Inconsolata',
    slug: 'inconsolata',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/inconsolata@5.3.0/files/inconsolata-latin-400-normal.woff2',
    minBytes: 5000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'JetBrains Mono',
    slug: 'jetbrains-mono',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-400-normal.woff2',
    minBytes: 5000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'Monoid',
    slug: 'monoid',
    url: 'https://cdn.jsdelivr.net/npm/@typopro/web-monoid@3.7.5/TypoPRO-Monoid-Regular.woff',
    minBytes: 5000,
    note: 'fontsource 无此族（Google 已下架），取 @typopro 的 woff',
  },
  {
    id: 'Source Code Pro',
    slug: 'source-code-pro',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/source-code-pro@5.3.1/files/source-code-pro-latin-400-normal.woff2',
    minBytes: 5000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'Space Mono',
    slug: 'space-mono',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/space-mono@5.3.0/files/space-mono-latin-400-normal.woff2',
    minBytes: 5000,
    note: 'fontsource 官方打包，latin 子集',
  },
  {
    id: 'Ubuntu Mono',
    slug: 'ubuntu-mono',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/ubuntu-mono@5.3.0/files/ubuntu-mono-latin-400-normal.woff2',
    minBytes: 8000,
    note: 'fontsource 官方打包，latin 子集',
  },
]

const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex')
const rel = p => path.relative(ROOT, p).split(path.sep).join('/')
const extOf = buf => {
  const head = buf.slice(0, 4).toString('latin1')
  if (head === 'wOF2') return 'woff2'
  if (head === 'wOFF') return 'woff'
  /* TrueType 的 sfnt version 是大端 0x00010000 → 字节序 00 01 00 00 */
  if (head === '\u0000\u0001\u0000\u0000' || head === 'true' || head === 'ttcf') return 'ttf'
  if (head === 'OTTO') return 'otf'
  return null
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/* ---------------------------------------------------------------- 缓存与下载 */

let cacheIndex = {}
if (fs.existsSync(CACHE_INDEX_FILE)) {
  try {
    cacheIndex = JSON.parse(fs.readFileSync(CACHE_INDEX_FILE, 'utf8'))
  } catch (e) {
    cacheIndex = {}
  }
}
let cacheDirty = false

function curl(url) {
  const tmp = path.join(os.tmpdir(), `carbon-font-${crypto.randomBytes(6).toString('hex')}.bin`)
  try {
    execFileSync(
      'curl',
      [
        '-sS', '-L', '--fail',
        '--connect-timeout', '20',
        '--max-time', '180',
        '--speed-limit', '2048', '--speed-time', '30',
        '--retry', '3', '--retry-delay', '2',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        '-o', tmp, url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 200000 }
    )
    return fs.readFileSync(tmp)
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  }
}

function ensure(url, minBytes) {
  const cacheFile = path.join(CACHE, sha1(url).slice(0, 20) + '.font')
  const hit = cacheIndex[url]
  if (!OPT.force && fs.existsSync(cacheFile)) {
    const buf = fs.readFileSync(cacheFile)
    if (buf.length >= minBytes && (!hit || sha1(buf) === hit.sha1)) {
      return { buf, cached: true }
    }
  }
  if (OPT.offline) throw new Error(`--offline 且缓存缺失: ${url}`)
  let last = null
  for (let i = 0; i < 3; i++) {
    try {
      const buf = curl(url)
      if (buf.length < minBytes) throw new Error(`字节过小 ${buf.length} < ${minBytes}`)
      if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true })
      fs.writeFileSync(cacheFile, buf)
      cacheIndex[url] = { file: rel(cacheFile), sha1: sha1(buf), bytes: buf.length, when: new Date().toISOString() }
      cacheDirty = true
      return { buf, cached: false }
    } catch (e) {
      last = e
    }
  }
  throw new Error(`抓取失败 ${url} — ${last && last.message}`)
}

function writeIdempotent(file, content) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (prev === content) return 'unchanged'
  fs.writeFileSync(file, content)
  return 'written'
}

/* ---------------------------------------------------------------- --check / --verify */

function fileFor(src) {
  /* 扩展名以文件魔数为准，不信 URL 尾巴 */
  for (const ext of ['woff2', 'woff', 'ttf', 'otf']) {
    const p = path.join(FONT_DIR, `${src.slug}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

function verifyOne(src, manifestEntry) {
  const p = fileFor(src)
  assert(p, `${src.id}: fonts/ 下没有 ${src.slug}.*`)
  const buf = fs.readFileSync(p)
  const fmt = extOf(buf)
  assert(fmt, `${src.id}: ${rel(p)} 魔数不是 woff/woff2/ttf/otf（前 4 字节 ${buf.slice(0, 4).toString('hex')}）`)
  assert(buf.length >= src.minBytes, `${src.id}: 字节 ${buf.length} < 阈值 ${src.minBytes}`)
  if (manifestEntry) {
    assert(
      manifestEntry.sha1 === sha1(buf),
      `${src.id}: 盘上 sha1 ${sha1(buf).slice(0, 8)} 与 manifest 的 ${String(manifestEntry.sha1).slice(0, 8)} 不一致`
    )
    assert(manifestEntry.bytes === buf.length, `${src.id}: 盘上字节 ${buf.length} 与 manifest 的 ${manifestEntry.bytes} 不一致`)
    assert(manifestEntry.format === fmt, `${src.id}: 格式 ${fmt} 与 manifest 的 ${manifestEntry.format} 不一致`)
  }
  return { id: src.id, path: p, file: path.basename(p), bytes: buf.length, sha1: sha1(buf), format: fmt }
}

function verifyCss(entries) {
  assert(fs.existsSync(CSS_OUT), '缺少 css/fonts.css')
  const css = fs.readFileSync(CSS_OUT, 'utf8')
  for (const e of entries) {
    const re = new RegExp("font-family:\\s*'" + e.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'")
    assert(re.test(css), `css/fonts.css 里没有 ${e.id} 的 @font-face`)
    assert(css.includes(`../fonts/${e.file}`), `css/fonts.css 里 ${e.id} 的 src 没指到 ../fonts/${e.file}`)
    assert(fs.existsSync(path.join(ROOT, 'fonts', e.file)), `fonts/${e.file} 不存在`)
  }
  /* 头部注释里也写了 "@font-face" 这个词，不先剥注释会多算一段 */
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = (body.match(/@font-face/g) || []).length
  assert(blocks === entries.length, `css/fonts.css 有 ${blocks} 段 @font-face，应为 ${entries.length} 段`)
  return blocks
}

/* ------------------------------------------------------------------ data/fonts.js（导出用的内联字体表） */

/**
 * dom-to-image 是扫 `document.styleSheets[].cssRules` 找 @font-face 的，
 * 而 file:// 下**外链**样式表的 cssRules 一律抛 SecurityError（实测 tools/probe/verify5-facecss.html：
 * css/fonts.css → SecurityError，同一文档的内联表 → ok）。扫不到就嵌不进图，
 * 导出的 PNG/SVG 只能拿系统回退字体画字（实测 tools/probe/verify4-exportfont.html：
 * 导出 SVG 里 @font-face 段数 = 0，且三个族名光栅化后墨迹宽度全等于 monospace）。
 * 所以同一批字体字节再出一份 **data: URI** 的内联表，让导出链路读得到。
 */
function dataFontsJs(entries) {
  const lines = entries.map(e => {
    const buf = fs.readFileSync(path.join(ROOT, 'fonts', e.file))
    const fmt = mimeOf(e.format)
    return (
      `    "@font-face{font-family:'${e.id}';font-style:normal;font-weight:400;` +
      `src:url(data:${fmt};base64,${buf.toString('base64')}) format('${formatHintOf(e.format)}')}"`
    )
  })
  return [
    '/*',
    ' * data/fonts.js — 由 tools/build-fonts.js 生成，请勿手改（改了会被下次重算覆盖）。',
    ' * 这份是**导出链路**用的内联 @font-face：src 全是 data: URI，挂在同一文档的 <style> 上，',
    ' * dom-to-image 才扫得到（外链 css/fonts.css 在 file:// 下读 cssRules 会抛 SecurityError）。',
    ' * 预览仍走 css/fonts.css + fonts/*.woff2；两份字节同源，`node tools/build-fonts.js --check` 逐族比 sha1。',
    ' */',
    ";(function (g) {",
    "  'use strict'",
    '  const CARBON = (g.CARBON = g.CARBON || {})',
    '  CARBON.FONT_FACES_CSS = [',
    lines.join(',\n'),
    '  ].join("\\n")',
    '})(typeof window !== "undefined" ? window : globalThis)',
    '',
  ].join('\n')
}

function mimeOf(fmt) {
  return fmt === 'woff2' || fmt === 'woff' ? 'font/' + fmt : 'font/ttf'
}

function formatHintOf(fmt) {
  return fmt === 'woff2' ? 'woff2' : fmt === 'woff' ? 'woff' : 'truetype'
}

/** 验 data/fonts.js：段数、族名、以及每个 base64 解出来是否与 fonts/ 里那个字节一致（防双份漂移） */
function verifyDataJs(entries) {
  assert(fs.existsSync(DATA_OUT), '缺少 data/fonts.js（跑 node tools/build-fonts.js 重算）')
  const txt = fs.readFileSync(DATA_OUT, 'utf8')
  /* 逐条按整条规则的完整形状取（末尾的 format('woff2') 必须在）：
   * 上一版生成器把 format('woff2) 的单引号漏了，整条 @font-face 是坏 CSS，浏览器直接丢掉这条规则，
   * 而旧的宽松正则照样匹配得上 → --check 一片绿但成图仍然没字体。所以判据必须咬住闭合。 */
  const lines = txt
    .split('\n')
    .filter(l => /^\s{4}"@font-face/.test(l))
    .map(l => l.trim().replace(/^"/, '').replace(/",?$/, ''))
  assert(lines.length === entries.length, `data/fonts.js 有 ${lines.length} 段 @font-face，应为 ${entries.length} 段`)
  const faces = []
  for (const rule of lines) {
    const m = rule.match(
      /^@font-face\{font-family:'([^']+)';font-style:normal;font-weight:400;src:url\(data:(font\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)\) format\('(woff2|woff|truetype)'\)\}$/
    )
    assert(m, `data/fonts.js 里有一条 @font-face 形状不对（缺 format('…') 闭合？）：${rule.slice(0, 90)}…`)
    faces.push({ id: m[1], b64: m[3] })
  }
  assert(faces.length === entries.length, `data/fonts.js 解出 ${faces.length} 段，应为 ${entries.length} 段`)
  for (const e of entries) {
    const hit = faces.find(f => f.id === e.id)
    assert(hit, `data/fonts.js 里没有 ${e.id} 的 @font-face`)
    const buf = Buffer.from(hit.b64, 'base64')
    assert(
      sha1(buf) === e.sha1,
      `data/fonts.js 里 ${e.id} 的 base64 解出来 sha1 ${sha1(buf).slice(0, 8)} ≠ fonts/${e.file} 的 ${e.sha1.slice(0, 8)}`
    )
    assert(buf.length === e.bytes, `data/fonts.js 里 ${e.id} 的 base64 解出来 ${buf.length}B ≠ fonts/${e.file} 的 ${e.bytes}B`)
  }
  return faces.length
}

/* ---------------------------------------------------------------- 主流程 */

function main() {
  const manifest = fs.existsSync(MANIFEST_OUT) ? JSON.parse(fs.readFileSync(MANIFEST_OUT, 'utf8')) : { fonts: [] }
  const byId = {}
  for (const f of manifest.fonts || []) byId[f.id] = f

  if (OPT.check || OPT.verify) {
    const rows = []
    for (const src of SOURCES) {
      const r = verifyOne(src, OPT.check ? byId[src.id] : null)
      r.file = path.basename(r.path)
      rows.push({ src, r })
    }
    const n = verifyCss(rows.map(x => x.r))
    const m = verifyDataJs(rows.map(x => x.r))
    if (OPT.check) {
      const ids = (manifest.fonts || []).map(f => f.id).sort().join(',')
      assert(ids === SOURCES.map(s => s.id).sort().join(','), 'manifest 的族清单与 SOURCES 不一致')
    }
    console.log(
      `[OK] fonts/ ${rows.length} 个字体${OPT.check ? '与 manifest 逐条一致' : '魔数与字节达标'}；css/fonts.css 含 ${n} 段 @font-face；data/fonts.js 含 ${m} 段且 base64 与 fonts/ 逐族同 sha1`
    )
    for (const { src, r } of rows) {
      console.log(`  ${r.file.padEnd(28)} ${String(r.bytes).padStart(7)}B  sha1 ${r.sha1.slice(0, 8)}  ${src.id}`)
    }
    return
  }

  if (!fs.existsSync(FONT_DIR)) fs.mkdirSync(FONT_DIR, { recursive: true })
  const entries = []
  for (const src of SOURCES) {
    const { buf, cached } = ensure(src.url, src.minBytes)
    const fmt = extOf(buf)
    assert(fmt, `${src.id} 下载回来的不是 woff/woff2/ttf/otf（前 4 字节 ${buf.slice(0, 4).toString('hex')}）`)
    const file = `${src.slug}.${fmt}`
    /* 先删同名的旧扩展名，避免 slug.ttf 与 slug.woff2 同时存在（fileFor 会挑错的那个） */
    for (const ext of ['woff2', 'woff', 'ttf', 'otf']) {
      const stale = path.join(FONT_DIR, `${src.slug}.${ext}`)
      if (ext !== fmt && fs.existsSync(stale)) fs.unlinkSync(stale)
    }
    const dest = path.join(FONT_DIR, file)
    const prev = fs.existsSync(dest) ? fs.readFileSync(dest) : null
    const changed = !prev || prev.length !== buf.length || sha1(prev) !== sha1(buf)
    if (changed) fs.writeFileSync(dest, buf)
    entries.push({
      id: src.id,
      slug: src.slug,
      file,
      format: fmt,
      bytes: buf.length,
      sha1: sha1(buf),
      url: src.url,
      note: src.note,
    })
    console.log(`  ${file.padEnd(28)} ${String(buf.length).padStart(7)}B  sha1 ${sha1(buf).slice(0, 8)}  ${cached ? '缓存' : '新抓'}  ${src.id}`)
  }

  const css = [
    '/*',
    ' * css/fonts.css — 由 tools/build-fonts.js 生成，请勿手改（改了会被下次重算覆盖）。',
    ' * 13 段 @font-face 对应 data/settings.js 里 CARBON.FONTS[].id，family 名必须逐字相同。',
    ' * 子集口径：latin（与上游 Google Fonts 的 latin 子集同范围），所以 CJK 仍回退系统字体 —— 与线上一致。',
    ' */',
    '',
  ]
  for (const e of entries) {
    const fmt = e.format === 'woff2' ? 'woff2' : e.format === 'woff' ? 'woff' : 'truetype'
    css.push(
      `@font-face {`,
      `  font-family: '${e.id}';`,
      `  font-style: normal;`,
      `  font-weight: 400;`,
      `  font-display: block;`,
      `  src: url('../fonts/${e.file}') format('${fmt}');`,
      `}`,
      ''
    )
  }
  const cssState = writeIdempotent(CSS_OUT, css.join('\n'))
  const djState = writeIdempotent(DATA_OUT, dataFontsJs(entries))
  const mfState = writeIdempotent(
    MANIFEST_OUT,
    JSON.stringify({ generatedBy: 'tools/build-fonts.js', fonts: entries }, null, 1) + '\n'
  )
  if (cacheDirty) fs.writeFileSync(CACHE_INDEX_FILE, JSON.stringify(cacheIndex, null, 1))

  const total = entries.reduce((a, e) => a + e.bytes, 0)
  console.log(`\n[OK] fonts/ 共 ${entries.length} 个字体 ${(total / 1024).toFixed(1)} KB`)
  console.log(`  css/fonts.css  ${cssState}`)
  console.log(`  data/fonts.js  ${djState}`)
  console.log(`  fonts/manifest.json  ${mfState}`)
  console.log('\n下一步：index.html 要同时有这两条，缺一条就只修好一半')
  console.log('  <link rel="stylesheet" href="css/fonts.css" />   ← 预览')
  console.log('  <script src="data/fonts.js"></script>            ← 成图（js/export.js 导出前把它挂成内联 <style>）')
  console.log('  node tools/build-fonts.js --check')
  console.log('  msedge --headless=new --dump-dom tools/probe/verify3-font.html   # 预览面')
  console.log('  msedge --headless=new --dump-dom tools/probe/verify4-exportfont.html # 成图面')
}

try {
  main()
} catch (e) {
  console.error('[FAIL] ' + (e && e.message ? e.message : String(e)))
  process.exitCode = 1
}
