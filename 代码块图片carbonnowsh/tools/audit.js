#!/usr/bin/env node
/*
 * tools/audit.js — 交付前的静态审计 + 可离线复算的判据
 *
 * 只做「不需要浏览器就能判真伪」的事；需要渲染/交互的项一律进「未验证」表，不假装通过。
 * 用法：
 *   node tools/audit.js            # 全量审计（含调用 build-vendor --verify-only 与 build-data --check）
 *   node tools/audit.js --quick    # 跳过两个构建器的复核，只跑本页判据
 */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const cp = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const QUICK = process.argv.includes('--quick')
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/')

const passed = []
const failed = []
const unchecked = []

function check(name, fn) {
  try {
    const detail = fn()
    passed.push(name + (detail ? ' — ' + detail : ''))
  } catch (e) {
    failed.push(name + ' — ' + e.message)
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

/* ---------------------------------------------------------------- 页面实际加载的文件 */

const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const scriptSrcs = [...HTML.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1])
const linkHrefs = [...HTML.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1])
const loaded = scriptSrcs.concat(linkHrefs)

const pageFiles = []
function walk(dir) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return
  for (const name of fs.readdirSync(abs)) {
    const p = path.join(abs, name)
    const r = rel(p)
    if (fs.statSync(p).isDirectory()) walk(r)
    else if (/\.(js|css|html)$/.test(name)) pageFiles.push(r)
  }
}
;['js', 'data', 'vendor', 'css'].forEach(walk)
pageFiles.push('index.html')

/* ---------------------------------------------------------------- 零网络判据
 * 为什么不选「把注释抹平再搜 http」：那要求正确分词，而 hljs/CM 的压缩包里就有 /"' 这类
 * 字符类，词法器一走神会把真注释留在代码里（本机实测漏判 59 处出处 URL）。
 * 换成更硬的等价判据：**能变成请求目标的 URL 一定是带引号的字符串**
 * （img.src、XHR.open、new URL、@import、url() 最终都吃字符串），
 * 而出处注释里的 URL 永远不会紧邻引号。下面自带反向自测：合成串必须被抓到、注释串必须放过。 */

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

const ALLOW_HOSTS = ['http://www.w3.org', 'https://www.w3.org'] // XML 命名空间声明，不发请求

function findNetworkRefs(file, raw) {
  const hits = []
  if (/\.css$/.test(file)) {
    stripCssComments(raw)
      .split('\n')
      .forEach((line, i) => {
        if (/url\(\s*['"]?https?:/i.test(line)) hits.push(`${file}:${i + 1} url(http`)
        if (/@import\s+url/i.test(line) && /https?:/.test(line)) hits.push(`${file}:${i + 1} @import http`)
      })
    return hits
  }
  // 引号紧邻的 http(s)：唯一能变成请求目标的形态
  for (const m of raw.matchAll(/(['"`])\s*https?:\/\/[^\s'"`]*/g)) {
    const url = m[0].slice(1).trim()
    if (ALLOW_HOSTS.some(a => url.startsWith(a))) continue
    hits.push(`${file} 字符串里的 ${url.slice(0, 64)}`)
  }
  // 引号紧邻的协议相对串 //host.tld/
  for (const m of raw.matchAll(/(['"`])\s*\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\//gi)) {
    hits.push(`${file} 协议相对串 ${m[0].slice(0, 48)}`)
  }
  // 明确的联网 API
  raw
    .split('\n')
    .forEach((line, i) => {
      const ln = line
      const isCommentish = /^\s*(\/\/|\*|\/\*)/.test(ln)
      if (isCommentish) return
      if (/\bfetch\s*\(/.test(ln)) hits.push(`${file}:${i + 1} fetch(`)
      if (/new\s+XMLHttpRequest/.test(ln)) hits.push(`${file}:${i + 1} XMLHttpRequest`)
      if (/\bimport\s*\(/.test(ln)) hits.push(`${file}:${i + 1} 动态 import(`)
      if (/document\.write\s*\(/.test(ln)) hits.push(`${file}:${i + 1} document.write(`)
    })
  return hits
}

check('零网络判据自身的反向自测', () => {
  const bad = findNetworkRefs(
    'synthetic.js',
    'const u = "https://evil.example/x.js";\nfetch(u);\nnew XMLHttpRequest();\n'
  )
  assert(bad.length >= 3, '判据没抓到合成违规样本，说明它是假绿：' + JSON.stringify(bad))
  const ok = findNetworkRefs('synthetic2.js', '/* 来源 https://cdnjs.example/a.js */\nvar x = 1 // see https://upstream.example/doc\n')
  assert(ok.length === 0, '判据把注释里的出处 URL 误报为联网引用：' + JSON.stringify(ok))
  const ns = findNetworkRefs('synthetic3.svg.js', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  assert(ns.length === 0, '判据把 XML 命名空间当网络引用：' + JSON.stringify(ns))
  return `抓到 ${bad.length} 处合成违规 / 放过注释与命名空间`
})

/* 上游代码里确实存在、但本页不会触发的网络原语 / 上游字符串与注释里的文档链接：
 * 逐条点名，不静默放过；运行时到底有没有发请求，由浏览器 netprobe 判（见「未验证」表）。 */
const NETWORK_EXCEPTIONS = [
  {
    file: 'vendor/dom-to-image.js',
    api: 'XMLHttpRequest',
    why:
      'domtoimage 的 embedResources/embedWebFonts 用 XHR 内联 url() 与 @font-face。本画布内没有 <img>、没有远程 @font-face、背景图是 dataURL。',
  },
]

/* 只豁免这些**具体**的文档链接（上游把 URL 写进了告警字符串/注释），其余一律算违规 */
const EXEMPT_URLS = [
  'github.com/highlightjs/highlight.js/wiki/security', // hljs 的 illegal-language 告警文案
  'github.com/highlightjs/highlight.js/issues/2277', // hljs 的版本注记
]

function isExcepted(file, hit) {
  if (NETWORK_EXCEPTIONS.some(x => x.file === file && hit.indexOf(x.api) >= 0)) return true
  return file.startsWith('vendor/') && EXEMPT_URLS.some(u => hit.indexOf(u) >= 0)
}

check('零运行时网络引用', () => {
  const offenders = []
  const excepted = []
  for (const file of pageFiles) {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8')
    for (const hit of findNetworkRefs(file, raw)) {
      if (isExcepted(file, hit)) excepted.push(hit)
      else offenders.push(hit)
    }
  }
  assert(
    offenders.length === 0,
    offenders.slice(0, 8).join(' | ') + (offenders.length > 8 ? ` …共 ${offenders.length} 处` : '')
  )
  return `扫描 ${pageFiles.length} 个文件；点名豁免 ${excepted.length} 处（上游 XHR）`
})

/* ---------------------------------------------------------------- 加载形态 */

check('无 ES module / 无绝对路径', () => {
  assert(!/<script[^>]+type=["']module["']/.test(HTML), 'index.html 里有 type="module"')
  const bad = loaded.filter(p => p.startsWith('/') || /^[a-z]+:\/\//i.test(p))
  assert(bad.length === 0, '非相对路径: ' + bad.join(','))
  assert(!/<script[^>]+src=[^>]*>[\s\S]*?<\/script>\s*<script[^>]+src="vendor\/codemirror\.min\.js/.test(HTML), 'app 脚本排在 codemirror 之前')
  return `${loaded.length} 个引用全部为相对路径 classic script/css`
})

check('依赖加载顺序', () => {
  const at = p => scriptSrcs.indexOf(p)
  const need = (a, b, why) => assert(at(a) >= 0 && at(b) >= 0 && at(a) < at(b), `${a} 必须早于 ${b}（${why}）`)
  need('vendor/codemirror.min.js', 'vendor/addons.js', 'addon 引用全局 CodeMirror')
  need('vendor/addons.js', 'vendor/modes.js', 'mode 可能依赖 overlay/multiplex/simple')
  need('vendor/modes.js', 'vendor/custom-modes.js', '自定义 mode 依赖 core 注册表')
  need('vendor/hljs.min.js', 'vendor/hljs-languages.js', '语言扩展裸引全局 hljs')
  need('data/settings.js', 'js/state.js', 'store 读 DEFAULT_SETTINGS')
  need('data/themes.js', 'js/state.js', 'store 建主题索引')
  need('vendor/dom-to-image.js', 'js/export.js', 'exporter 用 window.domtoimage')
  assert(at('js/app.js') === scriptSrcs.length - 1, 'js/app.js 必须最后加载')
  const missing = loaded.filter(p => !fs.existsSync(path.join(ROOT, p)))
  assert(missing.length === 0, '引用了不存在的文件: ' + missing.join(','))
  return `script ${scriptSrcs.length} 个 + css ${linkHrefs.length} 个，顺序约束全通过`
})

check('每个页面 JS 都能过语法关', () => {
  const bad = []
  let n = 0
  for (const file of pageFiles) {
    if (!/\.js$/.test(file)) continue
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    n++
    try {
      new vm.Script(src, { filename: file })
    } catch (e) {
      bad.push(`${file}: ${e.message}`)
    }
  }
  assert(bad.length === 0, bad.join(' | '))
  return `${n} 个 js 文件语法全通过（含 vendor 与 data）`
})

/* ---------------------------------------------------------------- 数据契约 */

const sandbox = {}
sandbox.window = sandbox
sandbox.TextEncoder = TextEncoder
sandbox.TextDecoder = TextDecoder
vm.createContext(sandbox)
for (const f of ['data/settings.js', 'data/themes.js', 'data/languages.js', 'data/presets.js', 'data/svg.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f })
}
const C = sandbox.CARBON

check('数据全局契约', () => {
  assert(C && C.THEMES && C.LANGUAGES, 'CARBON.THEMES / CARBON.LANGUAGES 未挂出')
  assert(C.THEMES.length === 29, `主题数应为 29，实际 ${C.THEMES.length}`)
  assert(C.LANGUAGES.length === 78, `语言数应为 78，实际 ${C.LANGUAGES.length}`)
  assert(C.DEFAULT_PRESETS.length === 8, `预设数应为 8，实际 ${C.DEFAULT_PRESETS.length}`)
  assert(C.FONTS.length === 13 && C.BG_PRESETS.length === 15, '字体 13 / 色板 15')
  assert(C.HIGHLIGHT_KEYS.length === 12, 'HIGHLIGHT_KEYS 应为 12')
  for (const t of C.THEMES) for (const k of C.HIGHLIGHT_KEYS) assert(t.highlights[k], `主题 ${t.id} 缺 ${k}`)
  for (const f of C.FONTS) assert(C.FONT_FALLBACKS[f.id], `字体 ${f.id} 没有离线回退栈`)
  const ids = C.THEMES.map(t => t.id)
  assert(new Set(ids).size === ids.length, '主题 id 有重复')
  assert(Object.keys(C.DEFAULT_SETTINGS).length === 25, 'DEFAULT_SETTINGS 键数与上游不符')
  return '29 主题 × 12 键配平，13 字体均有回退栈，25 个默认设置项'
})

check('SVG 资产契约', () => {
  const need = [
    'SVG.controls.none',
    'SVG.controls.sharp',
    'SVG.controls.bw',
    'SVG.controls.boxy',
    'SVG.windowThemeIcons.none',
    'SVG.windowThemeIcons.sharp',
    'SVG.windowThemeIcons.bw',
    'SVG.windowThemeIcons.boxy',
    'SVG.watermark.dark',
    'SVG.watermark.light',
    'SVG.icons.logo',
    'SVG.icons.theme',
    'SVG.icons.language',
    'SVG.icons.settings',
    'SVG.icons.copy',
    'SVG.icons.checkmark',
    'SVG.icons.remove',
    'SVG.icons.arrows.up',
    'SVG.icons.arrows.down',
    'SVG.icons.arrows.right',
  ]
  for (const dotted of need) {
    const v = dotted.split('.').reduce((o, k) => (o ? o[k] : undefined), C)
    assert(typeof v === 'string' && v.startsWith('<svg'), `${dotted} 缺失或不是 svg 字符串`)
    const open = (v.match(/<svg/g) || []).length
    const close = (v.match(/<\/svg>/g) || []).length
    assert(open === 1 && close === 1, `${dotted} svg 标签不配平 ${open}/${close}`)
    assert(!/fill=\{|stroke=\{|className=|xmlnsXlink|xlinkHref/.test(v), `${dotted} 残留 JSX`)
  }
  assert(C.SVG.watermark.dark !== C.SVG.watermark.light, '水印明暗两版不应相同')
  assert(!/fill="(?!#|none|currentColor|url)[0-9a-f]{6}"/i.test(C.SVG.watermark.light), '水印存在缺 # 的非法色值')
  return `${need.length} 段 svg 可用、无 JSX 残留、色值合法`
})

/* ---------------------------------------------------------------- URL 参数回环 */

function loadUrlModule() {
  const sb = {}
  sb.window = sb
  sb.location = { pathname: '/index.html', search: '', href: 'file:///x/index.html' }
  sb.history = { replaceState: () => true }
  sb.btoa = s => Buffer.from(s, 'binary').toString('base64')
  sb.atob = s => Buffer.from(s, 'base64').toString('binary')
  sb.TextEncoder = TextEncoder
  sb.TextDecoder = TextDecoder
  vm.createContext(sb)
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/util.js'), 'utf8'), sb, { filename: 'js/util.js' })
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/url.js'), 'utf8'), sb, { filename: 'js/url.js' })
  return sb.CARBON.url
}

check('URL 参数编解码回环', () => {
  const url = loadUrlModule()
  const samples = [
    {
      backgroundColor: 'rgba(171, 184, 195, 1)',
      theme: 'seti',
      windowTheme: 'none',
      language: 'auto',
      width: 680,
      dropShadow: true,
      dropShadowOffsetY: '20px',
      dropShadowBlurRadius: '68px',
      windowControls: true,
      widthAdjustment: true,
      paddingVertical: '56px',
      paddingHorizontal: '100px',
      lineNumbers: false,
      firstLineNumber: 3,
      fontFamily: 'Hack',
      fontSize: '14px',
      lineHeight: '133%',
      squaredImage: false,
      exportSize: '2x',
      watermark: false,
      code: 'const a = 1\nlet b = "<x>&"',
      titleBar: '标题 <a> & "b"',
    },
    {
      theme: 'solarized light',
      language: 'text/x-python',
      dropShadow: false,
      lineNumbers: true,
      watermark: true,
      width: 320,
      paddingVertical: '0px',
      paddingHorizontal: '0px',
      firstLineNumber: 0,
      code: '\n\n',
      windowControls: false,
    },
  ]
  for (const s of samples) {
    const qs = url.toQueryString(url.mapWrite(s))
    const back = url.mapRead(url.parseSearch(qs))
    for (const k of Object.keys(s)) {
      if (s[k] === '') continue // 上游语义：空串丢弃
      const got = k === 'width' ? Number(back[k]) : back[k]
      assert(JSON.stringify(s[k]) === JSON.stringify(got), `${k}: 写前 ${JSON.stringify(s[k])} 读回 ${JSON.stringify(got)}`)
    }
  }
  const sl = url.mapRead(url.parseSearch(url.toQueryString(url.mapWrite({ selectedLines: [2, 5, 9] }))))
  void sl
  const back2 = url.mapRead({ sl: '2,5,9' })
  assert(JSON.stringify(back2.selectedLines) === '[2,5,9]', 'intArray(sl) 回环失败：' + JSON.stringify(back2.selectedLines))
  const b3 = url.mapRead({ ds: 'false', wc: 'true', fl: '7' })
  assert(b3.dropShadow === false && b3.windowControls === true && b3.firstLineNumber === 7, 'bool/int 型别回环失败')
  const long = 'x'.repeat(6000)
  const enc = url.mapWrite({ code: long })
  assert(enc.code.length <= 4100, 'code 软上限未生效：' + enc.code.length)
  return `${samples.length} 组样本 × ${Object.keys(samples[0]).length} 键全等；sl/ds/fl 型别正确；>4000 字符软截断生效（${enc.code.length}）`
})

/* ---------------------------------------------------------------- 设置项覆盖 */

check('设置项都有落点', () => {
  const files = fs
    .readdirSync(path.join(ROOT, 'js'), { recursive: true })
    .filter(f => /\.js$/.test(String(f)))
    .map(f => path.join(ROOT, 'js', String(f)))
  const jsAll = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
  const notFound = Object.keys(C.DEFAULT_SETTINGS).filter(k => !new RegExp("['\".]" + k + '\\b').test(jsAll))
  assert(notFound.length === 0, '这些 DEFAULT_SETTINGS 字段没有任何代码引用: ' + notFound.join(','))
  const urlKeys = [...urlWriteKeys()].sort().join(',')
  const expect = ['bg', 'code', 'ds', 'dsblur', 'dsyoff', 'es', 'fl', 'fm', 'fs', 'l', 'lh', 'ln', 'ph', 'pv', 'si', 't', 'tb', 'wa', 'wc', 'width', 'wm', 'wt'].sort().join(',')
  assert(urlKeys === expect, `URL 键集合与上游 writeMappings 不一致：\n 实际 ${urlKeys}\n 期望 ${expect}`)
  return `${notFound.length === 0 ? Object.keys(C.DEFAULT_SETTINGS).length : 0} 个设置项有落点；URL 键 ${urlKeys.split(',').length} 个与上游一致`
})

check('带 px 单位的设置项都在 PX_KEYS 归一化清单里', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'state.js'), 'utf8')
  const m = src.match(/const PX_KEYS = \[([\s\S]*?)\]/)
  assert(m, 'js/state.js 里找不到 PX_KEYS 清单')
  const listed = (m[1].match(/'[^']+'/g) || []).map(s => s.slice(1, -1))
  const pxKeys = Object.keys(C.DEFAULT_SETTINGS).filter(
    k => typeof C.DEFAULT_SETTINGS[k] === 'string' && /px$/.test(C.DEFAULT_SETTINGS[k])
  )
  const missing = pxKeys.filter(k => listed.indexOf(k) < 0)
  assert(missing.length === 0, '这些带 px 的设置没进归一化清单: ' + missing.join(','))
  const extra = listed.filter(k => pxKeys.indexOf(k) < 0)
  assert(extra.length === 0, '清单里含不带 px 的键，口径已变请更正: ' + extra.join(','))
  return `px 型设置 ${pxKeys.length} 个（${pxKeys.join(', ')}）与清单双向对齐`
})

function urlWriteKeys() {
  const url = loadUrlModule()
  const all = {}
  for (const k of Object.keys(C.DEFAULT_SETTINGS)) all[k] = C.DEFAULT_SETTINGS[k]
  all.code = 'x'
  all.titleBar = 'y'
  return Object.keys(url.mapWrite(all))
}

/* ---------------------------------------------------------------- DOM slot 契约 */

check('data-slot 契约', () => {
  const inHtml = [...HTML.matchAll(/data-slot="([a-z0-9-]+)"/g)].map(m => m[1])
  const jsDir = path.join(ROOT, 'js')
  const inJs = fs
    .readdirSync(jsDir, { recursive: true })
    .filter(f => /\.js$/.test(String(f)))
    .flatMap(f => [...fs.readFileSync(path.join(jsDir, String(f)), 'utf8').matchAll(/data-slot="([a-z0-9-]+)"/g)].map(m => m[1]))
  const uniq = a => [...new Set(a)]
  const orphanQuery = uniq(inJs).filter(q => inHtml.indexOf(q) < 0)
  assert(orphanQuery.length === 0, 'JS 查询了 HTML 里不存在的 slot: ' + orphanQuery.join(','))
  const unusedSlots = uniq(inHtml).filter(s => inJs.indexOf(s) < 0)
  assert(unusedSlots.length === 0, 'HTML 里有从未被填充的 slot: ' + unusedSlots.join(','))
  return `${uniq(inHtml).length} 个 slot 双向对齐：${uniq(inHtml).join(',')}`
})

check('每个 popout 都被挂进文档', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'ui', 'panels.js'), 'utf8')
  const made = [...src.matchAll(/=\s*ui\.popout\(/g)].length
  const mounted = [...src.matchAll(/appendChild\((?:[\w.]*\.)?pop\.el\)/g)].length
  assert(made > 0, '一个 popout 都没创建，判据本身失效')
  assert(made === mounted, `创建了 ${made} 个 popout 但只挂进文档 ${mounted} 个 → 点了不会弹`)
  return `${made} 个 popout 全部 appendChild 到位`
})

/* ---------------------------------------------------------------- CSS 结构 */

check('CSS 结构', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8')
  const body = stripCssComments(css)
  const open = (body.match(/\{/g) || []).length
  const close = (body.match(/\}/g) || []).length
  assert(open === close, `花括号不配平 ${open}/${close}`)
  const defined = new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]))
  const uses = [...body.matchAll(/var\((--[a-z0-9-]+)(\s*,[^()]*)?\)/g)]
  const noFallback = uses.filter(m => !defined.has(m[1]) && !m[2]).map(m => m[1])
  assert(noFallback.length === 0, '用了未定义且无兜底的 CSS 变量: ' + [...new Set(noFallback)].join(','))
  const jsInjected = [...new Set(uses.filter(m => !defined.has(m[1]) && m[2]).map(m => m[1]))]
  return `规则块 ${open} 配平；变量定义 ${defined.size}，引用 ${uses.length}，其中 JS 现设 ${jsInjected.length}（${jsInjected.join(',') || '无'}）`
})

check('hidden 真隐藏（作者层 display 盖不掉它）', () => {
  const css = stripCssComments(fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8'))
  /* 按"选择器 → 声明块"扫，要求其中一条的选择器就是裸 [hidden]，
   * 而不是只匹配到 .popout[hidden] 那种带类名的（那种救不了 .row{display:flex}） */
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  const hiddenRules = rules.filter(m =>
    m[1].split(',').some(s => s.trim().replace(/\s+/g, ' ') === '[hidden]')
  )
  assert(hiddenRules.length, 'css/app.css 缺裸 [hidden] 兜底规则：JS 大量用 el.hidden = bool 切行/切区块')
  assert(
    hiddenRules.some(m => /display\s*:\s*none\s*!important/.test(m[2])),
    '[hidden] 必须是 display:none !important —— 同特异性的 .row{display:flex} 之类会盖掉不带 !important 的写法'
  )
  /* 暴露面统计：CSS 里定了 display 的类，有多少同时被 JS 当元素类名用（这些就是靠全局兜底压住的） */
  const displayClasses = new Set(
    [...css.matchAll(/\.([a-z][a-z0-9_-]+)[^{}]*\{[^}]*display\s*:/g)].map(m => m[1])
  )
  const jsFiles = fs
    .readdirSync(path.join(ROOT, 'js'), { recursive: true })
    .filter(f => /\.js$/.test(String(f)))
    .map(f => fs.readFileSync(path.join(ROOT, 'js', String(f)), 'utf8'))
    .join('\n')
  const shared = [...displayClasses].filter(c => new RegExp("['\" ]" + c + "['\" ]").test(jsFiles))
  return `[hidden]{display:none !important} 就位；带作者层 display 且被 JS 当类名用的有 ${shared.length} 个（全靠这条兜底）`
})

/* ---------------------------------------------------------------- 成图字体链路 */

check('成图字体链路（预览外链 + 成图内联表）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const exp = fs.readFileSync(path.join(ROOT, 'js', 'export.js'), 'utf8')
  const face = fs.readFileSync(path.join(ROOT, 'data', 'fonts.js'), 'utf8')
  assert(/href="css\/fonts\.css"/.test(html), 'index.html 没引 css/fonts.css → 预览没有字体')
  assert(/src="data\/fonts\.js"/.test(html), 'index.html 没引 data/fonts.js → 成图没有字体（file:// 下外链表的 cssRules 读不到）')

  /* 挂载必须真的发生在调 domtoimage 之前。找"调用点"而不是函数名：
   * 函数定义行 `function ensureFontFaceStyle() {` 也含 `ensureFontFaceStyle()`，
   * 直接 indexOf('ensureFontFaceStyle()') 会先命中定义，判据就永远是绿的（假绿）。 */
  const callAt = [...exp.matchAll(/(?<!function )ensureFontFaceStyle\(\)/g)].map(m => m.index)
  assert(callAt.length, 'js/export.js 里 ensureFontFaceStyle 只有定义、没有调用')
  const useAt = exp.indexOf('domtoimage.to')
  assert(useAt > 0, 'js/export.js 里找不到 domtoimage.to* 调用')
  assert(Math.min(...callAt) < useAt, `ensureFontFaceStyle() 的调用点(${Math.min(...callAt)})晚于 domtoimage.to(${useAt})，字体表来不及挂上`)

  const fams = [...face.matchAll(/font-family:'([^']+)'/g)].map(m => m[1])
  assert(fams.length === C.FONTS.length, `data/fonts.js 有 ${fams.length} 段 @font-face，CARBON.FONTS 有 ${C.FONTS.length} 个族`)
  const missing = C.FONTS.map(f => f.id).filter(id => fams.indexOf(id) < 0)
  assert(!missing.length, 'data/fonts.js 缺族（下拉里这些选项切了能看但导不出）：' + missing.join(','))
  const extra = fams.filter(f => !C.FONTS.some(x => x.id === f))
  assert(!extra.length, 'data/fonts.js 有多余族：' + extra.join(','))
  const b64 = (face.match(/src:url\(data:font\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}\) format\('(woff2|woff|truetype)'\)/g) || []).length
  assert(b64 === C.FONTS.length, `data/fonts.js 里带闭合的 data: URI 只有 ${b64} 条，应为 ${C.FONTS.length} 条`)
  return `${fams.length} 族双向对齐；挂载调用点 ${Math.min(...callAt)} 早于 domtoimage.to ${useAt}`
})

/* ---------------------------------------------------------------- 上游副本完整性 */

check('dom-to-image 保留上游前缀', () => {
  const up = path.join(ROOT, 'tools', 'upstream', 'dom-to-image.js')
  assert(fs.existsSync(up), '缺少 tools/upstream/dom-to-image.js')
  const a = fs.readFileSync(up)
  const b = fs.readFileSync(path.join(ROOT, 'vendor', 'dom-to-image.js'))
  assert(b.slice(0, a.length).equals(a), 'vendor/dom-to-image.js 前段与上游副本不一致')
  return `上游 ${a.length}B 为严格前缀，追加 ${b.length - a.length}B 全局桥接`
})

check('vendor 核心与上游字节一致', () => {
  const pairs = [['codemirror.min.js', 'vendor/codemirror.min.js'], ['codemirror.min.css', 'vendor/codemirror.min.css']]
  const done = []
  for (const [upName, vend] of pairs) {
    const up = path.join(ROOT, 'tools', 'upstream', upName)
    if (!fs.existsSync(up)) {
      unchecked.push(`${vend} 与上游逐字节比对 — tools/upstream/${upName} 未存档，需跑 node tools/build-vendor.js 重新拉取`)
      continue
    }
    const a = fs.readFileSync(up)
    const b = fs.readFileSync(path.join(ROOT, vend))
    assert(a.equals(b), `${vend} 与上游不一致：upstream ${a.length}B vs vendor ${b.length}B`)
    done.push(`${upName} ${b.length}B`)
  }
  return done.join(' / ')
})

check('hljs 检测面与上游同构', () => {
  const allowed = new Set(C.LANGUAGES.filter(l => l.highlight).map(l => l.short || l.mode))
  const core = path.join(ROOT, 'vendor', 'hljs.min.js')
  const sb = { window: {}, self: {}, console, TextEncoder, TextDecoder }
  sb.globalThis = sb
  vm.createContext(sb)
  vm.runInContext(fs.readFileSync(core, 'utf8'), sb, { filename: core })
  const hljs = sb.hljs || sb.window.hljs
  assert(hljs, 'hljs 未在 vm 里挂出')
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'hljs-languages.js'), 'utf8'), sb, { filename: 'vendor/hljs-languages.js' })
  const registered = hljs.listLanguages()
  const extra = registered.filter(n => !allowed.has(n)).sort()
  // 应用启动时会按同一张白名单退订（js/editor.js restrictHljs），这里模拟那一步
  extra.forEach(n => hljs.unregisterLanguage(n))
  const left = hljs.listLanguages().filter(n => !allowed.has(n))
  assert(left.length === 0, '退订后仍有白名单外语言：' + left.join(','))
  /* 行为判据：上游 pin 的 hljs 10.7.2 对 DEFAULT_CODE 判成 javascript；
   * 实测 11.9.0 判成 coffeescript（同白名单、只换版本），所以这里锁 10.7.2 并以此为准 */
  const detected = hljs.highlightAuto(C.DEFAULT_CODE).language
  assert(detected === 'javascript', `DEFAULT_CODE 应检测为 javascript（上游行为），实际 ${detected}`)
  const py = hljs.highlightAuto('def f(x):\n    return x * 2\n').language
  assert(py === 'python', `python 自检失败：${py}`)
  return `注册 ${registered.length} → 白名单内 ${hljs.listLanguages().length}（退订 ${extra.length}：${extra.join(',')}）；DEFAULT_CODE→${detected}，python→${py}`
})

/* ---------------------------------------------------------------- mode 覆盖 */

check('语言到 CM mode 的覆盖', () => {
  const built = new Set(
    [...fs.readFileSync(path.join(ROOT, 'vendor', 'modes.js'), 'utf8').matchAll(/\/\*!\s*--\s*(?:mode\s+)?([a-z0-9+._-]+)/g)].map(m => m[1])
  )
  const custom = new Set(
    [...fs.readFileSync(path.join(ROOT, 'vendor', 'custom-modes.js'), 'utf8').matchAll(/custom mode ([a-z0-9]+)/g)].map(m => m[1])
  )
  const missing = []
  for (const l of C.LANGUAGES) {
    if (!l.mode || l.mode === 'auto' || l.mode === 'text') continue
    if (built.has(l.mode) || custom.has(l.mode)) continue
    missing.push(`${l.name}(${l.mode})`)
  }
  const declared = C.LANGUAGES.filter(l => l.modeAvailable === false).map(l => `${l.name}(${l.mode})`)
  assert(missing.sort().join(',') === declared.sort().join(','), `实际缺失 ${missing.join(',') || '无'} ≠ 数据声明 ${declared.join(',') || '无'}`)
  return `mode ${built.size} + 自定义 ${custom.size}；声明且确实不可用：${missing.join(',') || '无'}`
})

/* ---------------------------------------------------------------- 两个构建器的复核 */

if (!QUICK) {
  check('build-vendor --verify-only', () => {
    const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-vendor.js'), '--verify-only'], {
      encoding: 'utf8',
      cwd: ROOT,
    })
    assert(r.status === 0, '退出码 ' + r.status + '\n' + String(r.stderr || '').split('\n').slice(0, 10).join('\n'))
    return String(r.stdout || '').trim().split('\n').slice(-1)[0]
  })
  check('build-data --check', () => {
    const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-data.js'), '--check'], {
      encoding: 'utf8',
      cwd: ROOT,
    })
    assert(r.status === 0, '退出码 ' + r.status + '\n' + String(r.stderr || '').split('\n').slice(0, 10).join('\n'))
    return 'data/ 与上游一致'
  })
  check('build-fonts --check', () => {
    const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-fonts.js'), '--check'], {
      encoding: 'utf8',
      cwd: ROOT,
    })
    assert(r.status === 0, '退出码 ' + r.status + '\n' + String(r.stdout || '').split('\n').slice(0, 4).join('\n') + '\n' + String(r.stderr || '').split('\n').slice(0, 6).join('\n'))
    const first = String(r.stdout || '').split('\n')[0]
    /* 13 个族必须和 CARBON.FONTS 逐字对齐，少一个就是下拉里有个选项切了没反应 */
    const listed = (String(r.stdout || '').match(/^[ \t]+\S+\.woff2?\b|^[ \t]+\S+\.ttf\b/gm) || []).length
    assert(
      listed === C.FONTS.length,
      `fonts/ 只报了 ${listed} 个字体，CARBON.FONTS 有 ${C.FONTS.length} 个`
    )
    return first + `（族数与 CARBON.FONTS 的 ${C.FONTS.length} 对齐）`
  })
} else {
  unchecked.push('build-vendor --verify-only / build-data --check / build-fonts --check — 本次用了 --quick')
}

/* ---------------------------------------------------------------- 需浏览器才能判的项 */

/* 本脚本不启动浏览器，所以渲染/交互类的判据一律不进「已核」。
 * 分成两栏是为了不撒谎：下面这些已由 tools/probe/ 在无头 Edge 里跑过，
 * 数值写在 doc/运行与构建（T0Level）.md 第 3 节；本脚本只是不重复证明它们。 */
const probed = [
  '导出 PNG/SVG 的字节与所见即所得 — tools/probe/verify.html 的 png/png1x/squared/svg 四步',
  '运行时 0 网络请求 — 同上 net 步（XHR/fetch/Image.src/a.href 钩子 + performance 条目，file:// 与 http:// 两口径）',
  'file:// 下 localStorage 读写 — 同上 storageProbe 与 persist 两步（含 CARBON_STATE 的排除字段）',
  '隐形字符开/关 — 同上 afterInvisibles / afterInvisiblesOff',
  '选中行淡化 — tools/probe/verify2.html「非选中行被淡化」',
  '自定义主题创建 / 预设应用与撤销 / 三页签设置 / hidden 兜底 — tools/probe/verify2.html 共 50 项',
  '13 个字体族是否各自解析到自己的 face（预览面）— tools/probe/verify3-font.html',
  '成图里到底嵌没嵌字体 + 光栅化环境能否吃到嵌入 face — tools/probe/verify4-exportfont.html',
  'file:// 下外链样式表 cssRules 抛 SecurityError、内联表可读（根因）— tools/probe/verify5-facecss.html',
  '预设落哪个键 / 内置 8 个不落盘 / 配额写不进时静默 — tools/probe/verify6-presetstore.html（全程点真 UI）',
]

unchecked.push('真实渲染：125% 系统 DPI 下预览与导出图是否一致 — 无头跑固定 deviceScaleFactor=1，量不到系统缩放；需人眼对照 doc/截图-*.png')
unchecked.push('剪贴板写入图片（ClipboardItem）— 无头环境无剪贴板权限，且用户手势（Ctrl+C）不可合成')
unchecked.push('字体上传 new FontFace().load() 成功路径 — 需真实挑选一个本机 ttf/woff 并等异步 load')
unchecked.push('上传的字体能不能进成图 — fontUrl 走运行时 new FontFace() 注册，不在任何样式表里，dom-to-image 的 cssRules 扫描拿不到它；内置 13 族已证能进图（verify4），这一半没测')
unchecked.push('拖文件导入（drop 事件带 DataTransfer 文件）— 无头合成 dragenter/drop 拿不到真实 File')
unchecked.push('PNG/SVG 导出后浏览器另存与「打开」按钮 — 需要真实下载/新标签行为')

/* ---------------------------------------------------------------- 产物清单 */

const manifest = []
for (const dir of ['vendor', 'data', 'js', 'js/ui', 'css']) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) continue
  for (const name of fs.readdirSync(abs).sort()) {
    const p = path.join(abs, name)
    if (!fs.statSync(p).isFile()) continue
    const buf = fs.readFileSync(p)
    manifest.push(
      `${rel(p)}  ${String(buf.length).padStart(8)}B  sha1 ${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)}`
    )
  }
}

console.log('\n=== audit: ' + (rel(ROOT) || '.') + ' ===\n')
console.log('[已核 ' + passed.length + ']')
for (const p of passed) console.log('  ✓ ' + p)
if (failed.length) {
  console.log('\n[未通过 ' + failed.length + ']')
  for (const f of failed) console.log('  ✗ ' + f)
}
console.log('\n[探针已覆盖 ' + probed.length + ']（本脚本不重复证明，跑法与数值见 doc 第 3 节）')
for (const p of probed) console.log('  · ' + p)
console.log('\n[未验证 ' + unchecked.length + ']（需实机，不假装通过）')
for (const u of unchecked) console.log('  ? ' + u)
console.log('\n[产物清单]')
for (const m of manifest) console.log('  ' + m)

process.exitCode = failed.length ? 1 : 0
if (!failed.length) console.log('\n[OK] 静态判据全部通过')
