#!/usr/bin/env node
/*
 * tools/build-vendor.js — 离线 "代码转图片"(复刻 carbon.now.sh v4.9.10) 的 vendor/ 构建器
 *
 * 职责（全部代码固化，可重复执行、幂等、断点可续）：
 *   1. 下载 CodeMirror 5.65.5 core(js/css) + 全部 mode/addon（cdnjs），解析每个文件 UMD 三段式的
 *      AMD 数组 / require 列表，做递归依赖闭包 + 拓扑排序。
 *   2. 拼出 vendor/{codemirror.min.js,codemirror.min.css,addons.js,modes.js,custom-modes.js,
 *      hljs-languages.js,dom-to-image.js}。
 *   3. 用 node 真实执行校验注册结果（假 CodeMirror 注册表 + 真 core 双轨；hljs 逐语言隔离注册 +
 *      合并注册 + highlightAuto 实测）。
 *   4. 由构建数据生成 vendor/README.md（来源/版本/字节/sha1(8)/校验方式/license）。
 *
 * 用法：
 *   node tools/build-vendor.js              # 下载(命中缓存则跳过) + 拼接 + 校验 + 写 README
 *   node tools/build-vendor.js --force      # 忽略缓存重新下载
 *   node tools/build-vendor.js --offline    # 只用缓存，不联网（缺则失败）
 *   node tools/build-vendor.js --verify-only# 不重新生成，只跑校验
 *
 * 任何缺失 / 小于阈值 / 依赖未满足 / 注册失败 → 非零退出并打印缺哪个。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const cp = require('child_process')
const vm = require('vm')

/* ------------------------------------------------------------------ 常量 */

const ROOT = path.resolve(__dirname, '..')
const VENDOR = path.join(ROOT, 'vendor')
const TOOLS = path.join(ROOT, 'tools')
const CACHE = path.join(TOOLS, '.cache')
const PROBE = path.join(ROOT, 'tools', 'upstream')
const REF = path.join(ROOT, 'tools', 'upstream')

const CM_VERSION = '5.65.5'
const HLJS_VERSION = '10.7.2'
const CDN_CM = `https://cdnjs.cloudflare.com/ajax/libs/codemirror/${CM_VERSION}`
const CDN_HLJS = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HLJS_VERSION}`
const NPM_MIRROR = 'https://registry.npmmirror.com'

// 上游 license 实测结论（见 tools/build-vendor.js 里 --provenance 探针对应的 URL）
const LICENSES = {
  codemirror: 'MIT (LICENSE: https://cdn.jsdelivr.net/npm/codemirror@5.65.5/LICENSE, "MIT License / Copyright (C) 2017 by Marijn Haverbeke <marijnh@gmail.com> and others")',
  hljs: 'BSD-3-Clause (核心文件头注释自带 "License: BSD-3-Clause")',
  'dom-to-image':
    'MIT (npm dom-to-image@2.6.0 LICENSE: "The MIT License (MIT) / Copyright 2015 Anatolii Saienko / Copyright 2012 Paul Bakaus")',
  carbon: 'MIT (carbon-app/carbon@main LICENSE: "MIT License / Copyright (c) 2022 Carbon") —— 不是 Apache-2.0',
  'codemirror-mode-elixir': 'MIT (npm codemirror-mode-elixir@1.1.2 LICENSE: "MIT License / Copyright (c) 2016 Ian Walter")',
}

// CM mode 种子：来自 tools/upstream/extracted.json LANGUAGES[].mode 去重
// 'auto' 不是 CM mode（Carbon 用它做 hljs 自动检测开关）；'text' 见 TEXT_MODE_NOTE；
// custom:true 的 6 条（apache/elixir/graphql/nim/riscv/solidity）走 vendor/custom-modes.js，
// 它们在 cdnjs 的 CM5 mode 目录里根本不存在（实测 apache → jsdelivr/unpkg 404）。
const CM_MODES_EXCLUDED = {
  auto: 'Carbon 的 Auto 选项，非 CM mode，由 hljs.highlightAuto 实现',
  text: 'cdnjs 无 mode/text/text.min.js（实测 404）；CM5 core 只内置 defineMode("null") + defineMIME("text/plain","null")。实测 CodeMirror.getMode({}, "text") 不抛错、返回 null mode，因此无需下载',
}

// 我们自己确实要用 / 运行时必需的 addon（判断依据见 ADDON_EVIDENCE）
const ADDON_SEEDS = []

const ADDON_EVIDENCE = `addon/edit/matchbrackets 与 addon/selection/mark-selection 未塞入：
  - tools/upstream/Carbon.js 第 156-172 行是 Carbon 传给 CodeMirror 的完整 options 对象
    (screenReaderLabel/lineNumbers/firstLineNumber/mode/theme/scrollbarStyle/viewportMargin/
     lineWrapping/smartIndent/extraKeys/readOnly/showInvisibles/autoCloseBrackets)，
    既无 matchBrackets 也无 styleSelectedText；
  - 对 tools/upstream/*.js 与 tools/upstream/src_*.txt 全量 grep "matchBrackets|styleSelectedText|mark-selection"
    命中 0 处。
  塞进 addon/edit/autoCloseBrackets 的替代品：Carbon 自带打过补丁的副本
  tools/upstream/autoCloseBrackets.js（Carbon.js 第 390 行 require('../lib/custom/autoCloseBrackets')），
  它自己调用 CodeMirror.defineOption('autoCloseBrackets', ...)，是 option 生效的唯一途径，
  上游 addon/edit/closebrackets 不需要重复加载。`

// hljs：v11 里 CDN 全站无产物，v10（=上游 pin 的版本）有；所以只在 v11 时按此表跳过
const HLJS_KNOWN_UNRESOLVED = HLJS_VERSION.startsWith('11')
  ? {
      'c-like':
        'cdnjs languages/c-like.min.js → 404；jsdelivr @highlightjs/cdn-assets@11.9.0 文件清单 192 个 languages/ 里无 c?like 任何拼写；npm highlight.js@11.9.0/lib/languages/c-like.js → jsdelivr 与 unpkg 均 404。c-like 是 hljs 的内部基语法，各 CDN 语言文件在编译期已把它内联；且 LANGUAGES 里 short="c-like" 的那条显示名是 "C++"，其 hljs 覆盖由 core 内置的 cpp/c 承担，自动检测不受影响。',
    }
  : {}

// 无法转成 classic script 的自定义 mode（附证据与影响）
const CUSTOM_MODE_DROPPED = {
  elixir: null, // 已用 npm UMD 产物解决，见 buildCustomModes()
  graphql:
    'codemirror-graphql@2.2.9 无 UMD/global 产物：main=index.js(CJS)+esm/index.js(ESM)，mode.js → utils/mode-factory.js → require("graphql-language-service")（本身又依赖 graphql parser 与 vscode-languageserver-types）。要当 classic script 用必须打包 graphql-js，超出 vendor 范畴。影响显示名：GraphQL（LANGUAGES 中 {name:"GraphQL",mode:"graphql"}，无 short、无 highlight → 只丢 CM 着色，不丢 hljs 自动检测）。CM5 对未知 mode 不抛错，实测 getMode({},"graphql") 返回 null mode → 该语言显示为无高亮纯文本。',
}

const OUT_FILES = {
  'codemirror.min.js': 150000,
  'codemirror.min.css': 5000,
  'addons.js': 2000,
  'modes.js': 60000,
  'custom-modes.js': 20000,
  'hljs.min.js': 100000,
  'hljs-languages.js': 40000,
  'dom-to-image.js': 22000,
}

/* ------------------------------------------------------------------ 小工具 */

const argv = new Set(process.argv.slice(2))
const OPT = {
  force: argv.has('--force'),
  offline: argv.has('--offline'),
  verifyOnly: argv.has('--verify-only'),
  quiet: argv.has('--quiet'),
}
const log = (...a) => {
  if (!OPT.quiet) console.log(...a)
}
const die = msg => {
  console.error('\n[FAIL] ' + msg)
  process.exitCode = 1
  throw new Error(msg)
}
const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex')
const sha8 = buf => sha1(buf).slice(0, 8)
const sleep = ms => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch (_) {}
}
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/')

function findCurl() {
  const cand = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe'),
    'curl.exe',
    'curl',
  ]
  for (const c of cand) {
    try {
      const r = cp.spawnSync(c, ['--version'], { encoding: 'utf8', shell: false })
      if (r.status === 0) return c
    } catch (_) {}
  }
  die('找不到 curl，无法执行下载')
}
const CURL = findCurl()

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/* ------------------------------------------------------------------ 下载缓存 */

const CACHE_INDEX_FILE = path.join(CACHE, 'index.json')
let cacheIndex = {}
try {
  cacheIndex = readJson(CACHE_INDEX_FILE)
} catch (_) {}
let cacheDirty = false

function cachePathFor(url) {
  return path.join(CACHE, sha1(url).slice(0, 20) + '.bin')
}

/** 用 curl 抓一个 URL；带 node 层重试（cdnjs 偶发 Connection reset / 卡死） */
function curlFetch(url, dest, tries = 4) {
  let lastErr = ''
  for (let i = 1; i <= tries; i++) {
    const tmp = dest + '.part'
    const r = cp.spawnSync(
      CURL,
      [
        '-sS',
        '--fail',
        '-L',
        '--retry',
        '2',
        '--retry-delay',
        '1',
        '--retry-all-errors',
        '--connect-timeout',
        '15',
        '--max-time',
        '60',
        // 低于 2KB/s 持续 20s 判定为卡死，主动断掉换镜像（cdnjs 在本机会 hang 住连接）
        '--speed-limit',
        '2048',
        '--speed-time',
        '20',
        '-o',
        tmp,
        url,
      ],
      { encoding: 'utf8', shell: false }
    )
    if (r.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
      fs.renameSync(tmp, dest)
      return fs.readFileSync(dest)
    }
    lastErr = `curl exit ${r.status}: ` + (r.stderr || 'http/size 失败').toString().trim().slice(0, 140)
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch (_) {}
    sleep(300 * i)
  }
  throw new Error(`下载失败(${tries} 次): ${url} — ${lastErr}`)
}

/**
 * 按镜像顺序取第一个成功的。
 * 注意：cdnjs 的 codemirror 文件是 cdnjs 自己再压缩的（同一 mode 与 npm 自带 .min.js 字节数不同，
 * 实测 xml.min.js cdnjs=5981B / jsdelivr=6375B），所以走镜像时 sha1/字节会不同，
 * 产物注释里会写明实际来源，README 的表同样按实际来源记录。
 */
function ensureAny(urls, minBytes = 1) {
  const errs = []
  for (const u of urls) {
    try {
      return ensure(u, minBytes)
    } catch (e) {
      errs.push('    ' + String(e.message).split('\n')[0])
    }
  }
  throw new Error(`所有镜像都拿不到（阈值 ${minBytes}B）:\n` + errs.join('\n'))
}

/**
 * 取一个 URL 的内容（幂等 / 断点可续）。
 * minBytes 为 0 表示只要求非空。返回 {buf, sha1, bytes, url, cached}
 */
function ensure(url, minBytes = 1) {
  const file = cachePathFor(url)
  const hit = cacheIndex[url]
  if (!OPT.force && fs.existsSync(file)) {
    const buf = fs.readFileSync(file)
    if (buf.length >= Math.max(minBytes, 1) && (!hit || sha1(buf) === hit.sha1)) {
      return { buf, sha1: sha1(buf), bytes: buf.length, url, cached: true }
    }
  }
  if (OPT.offline) throw new Error(`--offline 且缓存缺失: ${url}`)
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true })
  const buf = curlFetch(url, file)
  const s = sha1(buf)
  if (buf.length < Math.max(minBytes, 1)) {
    fs.unlinkSync(file)
    throw new Error(`内容小于阈值 ${minBytes}: ${url} (${buf.length} 字节)`)
  }
  cacheIndex[url] = { file: rel(file), sha1: s, bytes: buf.length, when: new Date().toISOString() }
  cacheDirty = true
  return { buf, sha1: s, bytes: buf.length, url, cached: false }
}

function flushCacheIndex() {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true })
  if (cacheDirty) fs.writeFileSync(CACHE_INDEX_FILE, JSON.stringify(cacheIndex, null, 1))
}

/* ------------------------------------------------------------------ 纯 JS tar 读取（npm .tgz） */

function tarEntries(gzBuf) {
  const buf = gzBuf.subarray(0, 2) && gzBuf[0] === 0x1f && gzBuf[1] === 0x8b ? zlib.gunzipSync(gzBuf) : gzBuf
  const out = {}
  let off = 0
  const str = (start, len) => {
    let s = buf.toString('utf8', start, start + len)
    const n = s.indexOf('\0')
    return n >= 0 ? s.slice(0, n) : s
  }
  while (off + 512 <= buf.length) {
    const hdr = buf.subarray(off, off + 512)
    if (hdr.every(b => b === 0)) break
    let name = str(off, 100)
    const size = parseInt(str(off + 124, 12).trim(), 8) || 0
    const typeFlag = String.fromCharCode(buf[off + 156])
    const prefix = str(off + 345, 155)
    const typeflag2 = str(off + 345, 1) // placeholder
    off += 512
    const full = prefix ? prefix + '/' + name : name
    if (typeFlag === 'L') {
      // GNU 长名：下一个 header 的 name 用这块内容
      name = buf.toString('utf8', off, off + size).replace(/\0.*$/, '')
      off += Math.ceil(size / 512) * 512
      continue
    }
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '7') {
      if (full !== typeflag2) out[full] = buf.subarray(off, off + size)
    }
    off += Math.ceil(size / 512) * 512
  }
  return out
}

/** 从 npmmirror 取 npm 包并读出包内某个文件（缓存 tgz 里的单个条目） */
function npmFile(pkg, version, innerPath, minBytes = 1) {
  const url = `${NPM_MIRROR}/${pkg}/-/${pkg}-${version}.tgz`
  const key = `${url}#${innerPath}`
  const cacheFile = path.join(CACHE, sha1(key).slice(0, 20) + '.entry')
  const hit = cacheIndex[key]
  if (!OPT.force && fs.existsSync(cacheFile)) {
    const buf = fs.readFileSync(cacheFile)
    if (buf.length >= minBytes && (!hit || sha1(buf) === hit.sha1)) {
      return { buf, sha1: sha1(buf), bytes: buf.length, url: key, cached: true }
    }
  }
  if (OPT.offline) throw new Error(`--offline 且缓存缺失: ${key}`)
  const tgz = ensure(url, 100)
  const entries = tarEntries(tgz.buf)
  const full = 'package/' + innerPath
  if (!entries[full]) {
    throw new Error(
      `${pkg}@${version} 里找不到 ${innerPath}；可用条目: ${Object.keys(entries)
        .filter(k => !k.endsWith('.map'))
        .slice(0, 40)
        .join(', ')}`
    )
  }
  const buf = Buffer.from(entries[full])
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(cacheFile, buf)
  const s = sha1(buf)
  cacheIndex[key] = { file: rel(cacheFile), sha1: s, bytes: buf.length, when: new Date().toISOString() }
  cacheDirty = true
  return { buf, sha1: s, bytes: buf.length, url: key, cached: false }
}

/* ------------------------------------------------------------------ UMD 依赖解析 */

/**
 * 解析 CM5 文件头三段式 UMD：
 *   !function(e){ "object"==typeof exports&&"object"==typeof module ? e(require("a"),require("b"))
 *     : "function"==typeof define&&define.amd ? define(["a","b"],e) : e(CodeMirror) }(function(m){...})
 * 返回 {deps:[...], browserGlobal:'CodeMirror'}；require 列表与 AMD 列表必须一致，否则报错。
 */
function parseUmd(text, label) {
  const head = text.slice(0, 6000)
  const m = head.match(/define\.amd\s*\?\s*define\(\[([^\]]*)\]/) || head.match(/define\(\[([^\]]*)\]/)
  const reqs = [...head.matchAll(/require\((["'])([^"']+)\1\)/g)].map(x => x[2])
  const amd = m ? [...m[1].matchAll(/(["'])([^"']+)\1/g)].map(x => x[2]) : null
  if (!amd && !reqs.length) {
    // 没有 UMD 包装 —— 说明这不是 CM5 标准 mode 文件
    return { deps: null, amd: null, require: reqs, bare: /CodeMirror/.test(head) }
  }
  if (amd && reqs.length && amd.join('|') !== reqs.join('|')) {
    die(
      `${label}: AMD 数组与 require 列表不一致（AMD=${JSON.stringify(amd)} require=${JSON.stringify(
        reqs
      )}）—— 必须人工确认依赖顺序，不能自动拓扑`
    )
  }
  const deps = amd && amd.length ? amd : reqs
  const browserBranch = head.match(/:\s*[a-zA-Z$_]+\((CodeMirror)[^)]*\)/)
  return { deps, amd, require: reqs, browserGlobal: browserBranch ? browserBranch[1] : null }
}

/**
 * 把 UMD 依赖路径映射成条目描述符。
 * 先剥掉所有前导 `./` `../`（cdnjs 上 CM5 的相对深度固定：mode 文件里 core 写作
 * ../../lib/codemirror、同辈 mode 写作 ../xml/xml、addon 写作 ../../addon/mode/overlay），
 * 剩下的尾部即可无歧义判定类型。
 */
function depToItem(dep, owner) {
  const raw = dep.replace(/\\/g, '/')
  const p = raw.replace(/^(?:\.\.?\/)+/, '').replace(/\.js$/, '')
  if (p === 'codemirror' || p === 'lib/codemirror') return { kind: 'core' }
  let m = p.match(/^addon\/([^/]+)\/([^/.]+)$/)
  if (m) return { kind: 'addon', name: `${m[1]}/${m[2]}` }
  m = p.match(/^mode\/([^/]+)\/([^/.]+)$/)
  if (m) return { kind: 'mode', name: m[1] }
  m = p.match(/^([^/]+)\/([^/.]+)$/)
  if (m) {
    if (m[1] === m[2]) return { kind: 'mode', name: m[1] }
    if (!/^(addon|mode|lib|src)$/.test(m[1]))
      // 目录名与文件名不同（例如 ../sass/scss）：按下载单位=目录处理，并记录待人工确认
      return { kind: 'mode', name: m[1], note: `文件 ${m[2]} 与目录 ${m[1]} 不同名` }
    if (m[1] === 'addon') return { kind: 'addon', name: `${m[2]}/x`, note: 'addon 路径缺少一层' }
  }
  if (/^[^/.]+$/.test(p) && owner) return { kind: 'self', note: p } // 同目录兄弟文件
  return { kind: 'unknown', raw }
}

const modeUrls = name => [
  `${CDN_CM}/mode/${name}/${name}.min.js`, // 首选，任务指定
  `https://cdn.jsdelivr.net/npm/codemirror@${CM_VERSION}/mode/${name}/${name}.min.js`,
  `https://unpkg.com/codemirror@${CM_VERSION}/mode/${name}/${name}.min.js`,
]
const addonUrls = name => [
  `${CDN_CM}/addon/${name}.min.js`,
  `https://cdn.jsdelivr.net/npm/codemirror@${CM_VERSION}/addon/${name}.min.js`,
  `https://unpkg.com/codemirror@${CM_VERSION}/addon/${name}.min.js`,
]
const hljsUrls = file => [
  `${CDN_HLJS}/languages/${file}`,
  `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${HLJS_VERSION}/languages/${file}`,
  `https://unpkg.com/@highlightjs/cdn-assets@${HLJS_VERSION}/languages/${file}`,
]
const MIRROR_NOTE = u => (u.startsWith(CDN_CM) || u.startsWith(CDN_HLJS) ? '' : '（非 cdnjs 镜像，字节数与 cdnjs 再压缩版不同）')

/* ------------------------------------------------------------------ 递归闭包 + 拓扑排序 */

function buildCmGraph(seedModes) {
  const items = new Map() // key 'mode:x' | 'addon:a/b' → {kind,name,deps,text,bytes,sha1,url,order}
  const unknownDeps = []
  const notes = []

  function keyOf(it) {
    return it.kind + ':' + it.name
  }

  function fetchItem(kind, name) {
    const k = kind + ':' + name
    if (items.has(k)) return items.get(k)
    const urls = kind === 'mode' ? modeUrls(name) : addonUrls(name)
    const got = ensureAny(urls, 200)
    const text = got.buf.toString('utf8')
    const parsed = parseUmd(text, `${kind}/${name}`)
    const it = {
      kind,
      name,
      url: got.url,
      mirror: got.url !== urls[0],
      bytes: got.bytes,
      sha1: got.sha1,
      text,
      deps: [],
      browserGlobal: parsed.browserGlobal,
    }
    items.set(k, it)
    if (!parsed.deps) {
      notes.push(`${kind}/${name}: 未找到 UMD 依赖数组（裸引 CodeMirror？），按无依赖处理`)
    } else {
      for (const d of parsed.deps) {
        const it2 = depToItem(d, { kind, name })
        if (it2.kind === 'core' || it2.kind === 'self') continue
        if (it2.kind === 'unknown') {
          unknownDeps.push({ from: `${kind}/${name}`, dep: d })
          continue
        }
        if (it2.note) notes.push(`${kind}/${name} → ${d}: ${it2.note}`)
        it.deps.push(it2)
        fetchItem(it2.kind, it2.name)
      }
    }
    return it
  }

  for (const m of seedModes) fetchItem('mode', m)

  // 拓扑（DFS 后序），带环检测。始终用 items 里的规范对象，避免把轻量依赖描述符推进 order。
  const order = []
  const state = new Map()
  const stack = []
  function visit(desc) {
    const k = desc.kind + ':' + desc.name
    const cur = items.get(k)
    if (!cur) throw new Error(`拓扑时发现未登记的条目 ${k}（抓取阶段漏了？）`)
    const s = state.get(k)
    if (s === 'done') return
    if (s === 'open') die(`依赖环: ${stack.slice(stack.indexOf(k)).concat(k).join(' -> ')}`)
    state.set(k, 'open')
    stack.push(k)
    for (const d of cur.deps) visit(d)
    stack.pop()
    state.set(k, 'done')
    cur.index = order.length
    order.push(cur)
  }
  // 遍历起点按 kind+name 排序，保证同一输入产出逐字节相同的 order（幂等）
  const starts = [...items.values()].sort((a, b) =>
    a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === 'addon' ? -1 : 1
  )
  for (const it of starts) visit(it)
  order.forEach((it, i) => (it.order = i))

  // 文件级依赖满足性：被依赖者必须排在前面（addons.js 整体先于 modes.js 加载）
  const unmet = []
  for (const it of order)
    for (const d of it.deps) {
      const t = items.get(d.kind + ':' + d.name)
      if (!t) unmet.push(`${it.kind}:${it.name} 缺文件 ${d.kind}:${d.name}`)
      else if (t.order > it.order) unmet.push(`${it.name}(#${it.order}) 排在其依赖 ${d.name}(#${t.order}) 之后`)
    }
  if (unmet.length) die('依赖拓扑未满足:\n' + unmet.map(u => '  - ' + u).join('\n'))

  return { items, order, unknownDeps, notes, unmet }
}

/* ------------------------------------------------------------------ 生成物写入 */

function banner(title, lines) {
  return [
    '/*!' + '\n',
    ` * ${title}\n`,
    ...lines.map(l => ` * ${l}\n`),
    ' */\n',
  ].join('')
}

function writeFileIdempotent(dest, content) {
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest) : null
  // Buffer 必须原样落盘：任何 toString('latin1')/toString() 往返都会把非 ASCII 字节双编码（UTF-8→latin1→UTF-8），
  // 对 codemirror.min.js 这类含裸 Unicode 字面量的压缩包就是实质损坏（实测 169899B → 169944B）。
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
  if (prev && prev.equals(buf)) return { dest, bytes: buf.length, sha1: sha1(buf), changed: false }
  fs.writeFileSync(dest, buf)
  return { dest, bytes: buf.length, sha1: sha1(buf), changed: true }
}

/* ------------------------------------------------------------------ CodeMirror 产物 */

const cmRecords = []

function buildCore() {
  const js = ensureAny(
    [`${CDN_CM}/codemirror.min.js`, `https://cdn.jsdelivr.net/npm/codemirror@${CM_VERSION}/lib/codemirror.js`],
    150000
  )
  const css = ensureAny(
    [
      `${CDN_CM}/codemirror.min.css`,
      `https://cdn.jsdelivr.net/npm/codemirror@${CM_VERSION}/lib/codemirror.css`,
      `https://unpkg.com/codemirror@${CM_VERSION}/lib/codemirror.css`,
    ],
    4000
  )
  writeFileIdempotent(path.join(VENDOR, 'codemirror.min.js'), js.buf)
  writeFileIdempotent(path.join(VENDOR, 'codemirror.min.css'), css.buf)
  cmRecords.push(
    rec('vendor/codemirror.min.js', js.url, CM_VERSION, js.bytes, js.sha1, 'CodeMirror 5 core（UMD，浏览器走 global 分支；实测含 defineMode("null")+defineMIME("text/plain","null")）', LICENSES.codemirror),
    rec('vendor/codemirror.min.css', `${CDN_CM}/codemirror.min.css`, CM_VERSION, css.bytes, css.sha1, 'CodeMirror 5 基础样式', LICENSES.codemirror)
  )
  return js
}

function rec(file, source, version, bytes, sha, verify, license, note) {
  return { file, source, version, bytes, sha8: sha.slice(0, 8), verify, license, note: note || '' }
}

/** Carbon 用 ESM 写法 require 的自定义 addon：剥掉 import，包进 IIFE 注入全局 CodeMirror */
function classicifyEsmImport(text, label) {
  const before = text
  const placeholder =
    "/* (tools/build-vendor.js) 已剥掉原第 3 行的 ESM 静态引入（codemirror → 全局），classic script 下无需改写变量名 */\n"
  let out = text.replace(
    /^[ \t]*import\s+(?:\*\s+as\s+)?(\w+)\s+from\s+['"]codemirror['"];?[ \t]*\r?\n/m,
    placeholder
  )
  if (out === before) die(`${label}: 没找到预期的 import ... from 'codemirror'，需要人工改造`)
  const codeOnly = out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (/(?:^|[^.\w])(?:import|export)[\s(]/.test(codeOnly)) die(`${label}: 剥掉首行后仍残留 import/export，需要人工改造`)
  if (/\brequire\s*\(\s*['"]/.test(codeOnly)) die(`${label}: 存在 require()，需要人工改造`)
  return '(function (CodeMirror) {\n' + out.trim() + '\n})(CodeMirror)\n'
}

function buildAddonsAndModes(graph, seedModes) {
  const addons = graph.order.filter(i => i.kind === 'addon')
  const modes = graph.order.filter(i => i.kind === 'mode')

  // 不变式：addons.js 先于 modes.js 加载，所以任何 addon 都不能依赖 mode
  for (const a of addons)
    for (const d of a.deps)
      if (d.kind === 'mode')
        die(`addon ${a.name} 依赖 mode ${d.name}，但 addon 在 modes.js 之前加载 —— 需要人工处理`)

  // 运行时必需：Carbon 打过补丁的 autoCloseBrackets（Carbon.js:171 设了 autoCloseBrackets:true，
  // Carbon.js:390 require('../lib/custom/autoCloseBrackets')）。不加载它这个 option 无人处理。
  const customAddons = []
  const capSrc = path.join(REF, 'autoCloseBrackets.js')
  if (!fs.existsSync(capSrc)) die(`缺少 ${rel(capSrc)}（Carbon 打过补丁的 autoCloseBrackets addon）`)
  const capBuf = fs.readFileSync(capSrc)
  customAddons.push({
    name: 'edit/autoCloseBrackets (Carbon 补丁副本)',
    header:
      `/*!-- addon autoCloseBrackets | 原文件 ${rel(capSrc)}（carbon-app/carbon lib/custom/autoCloseBrackets.js，` +
      `文件头保留 "CodeMirror, copyright (c) by Marijn Haverbeke and others / MIT license"） | ${capBuf.length}B | sha1 ${sha8(
        capBuf
      )} | 改造：剥掉 import CodeMirror from 'codemirror' → IIFE 形参注入全局。不加载上游 addon/edit/closebrackets，` +
      `因为本副本自己 CodeMirror.defineOption('autoCloseBrackets', ...) --*/\n`,
    text: classicifyEsmImport(capBuf.toString('utf8'), 'autoCloseBrackets.js'),
  })

  const addonsText =
    banner('vendor/addons.js — CodeMirror ' + CM_VERSION + ' addons，按依赖拓扑序拼接（classic script）', [
      '本文件必须紧接 vendor/codemirror.min.js 之后、vendor/modes.js 之前加载。',
      '每个源文件是 CM5 三段式 UMD：浏览器下 typeof exports / typeof define 都不成立，',
      '因此只会命中最后的 else 分支 e(CodeMirror)，引用全局 CodeMirror。',
      '生成器: node tools/build-vendor.js（列表 = mode 递归发现的 addon + 运行时必需的 addon）',
      ADDON_EVIDENCE,
    ]) +
    '\n' +
    addons
      .map(
        a =>
          `/*!-- addon ${a.name} | ${a.url} | ${CM_VERSION} | ${a.bytes}B | sha1 ${a.sha1.slice(0, 8)}${MIRROR_NOTE(
            a.url
          )} | deps=[${a.deps.map(d => d.kind + ':' + d.name).join(',')}] --*/\n` +
          a.text.replace(/\n?\/\/# sourceMappingURL=.*$/m, '').trim() +
          '\n'
      )
      .join('\n;\n') +
    '\n;\n' +
    customAddons.map(c => c.header + c.text).join('\n;\n')

  const modesText =
    banner('vendor/modes.js — CodeMirror ' + CM_VERSION + ' modes，按依赖拓扑序拼接（classic script）', [
      '加载顺序要求：codemirror.min.js → addons.js → modes.js（本文件可单独加载，addon 依赖已在前面）。',
      '依赖取自每个文件 UMD 头部的 define([...]) 数组（与 require(...) 列表逐字节比对一致）。',
      `种子 ${seedModes.length} 个（来源 tools/upstream/extracted.json LANGUAGES[].mode 去重，剔除 ${Object.keys(
        CM_MODES_EXCLUDED
      ).join('/')}），闭包后 ${modes.length} 个，额外引入 ${modes
        .filter(m => !seedModes.includes(m.name))
        .map(m => m.name)
        .join(', ')}`,
      '生成器: node tools/build-vendor.js',
    ]) +
    '\n' +
    modes
      .map(
        m =>
          `/*!-- mode ${m.name} | ${m.url} | ${CM_VERSION} | ${m.bytes}B | sha1 ${m.sha1.slice(0, 8)}${MIRROR_NOTE(
            m.url
          )} | deps=[${m.deps.map(d => d.kind + ':' + d.name).join(',')}] --*/\n` +
          m.text.replace(/\n?\/\/# sourceMappingURL=.*$/m, '').trim() +
          '\n'
      )
      .join('\n;\n')

  const w1 = writeFileIdempotent(path.join(VENDOR, 'addons.js'), addonsText)
  const w2 = writeFileIdempotent(path.join(VENDOR, 'modes.js'), modesText)
  cmRecords.push(
    rec(
      'vendor/addons.js',
      `${CDN_CM}/addon/<dir>/<name>.min.js + ${rel(capSrc)}`,
      CM_VERSION,
      w1.bytes,
      w1.sha1,
      `假 CodeMirror + 真 core 双轨 vm 执行；addon 数=${addons.length + customAddons.length} (${addons
        .map(a => a.name)
        .concat('edit/autoCloseBrackets(Carbon 补丁)').join(', ')})`,
      LICENSES.codemirror + ' + ' + LICENSES.carbon
    ),
    rec(
      'vendor/modes.js',
      `${CDN_CM}/mode/<m>/<m>.min.js`,
      CM_VERSION,
      w2.bytes,
      w2.sha1,
      `假 CodeMirror + 真 core 双轨 vm 执行；mode 数=${modes.length}，依赖闭包全满足`,
      LICENSES.codemirror
    )
  )
  return { addons, modes, graph, customAddons }
}

/* ------------------------------------------------------------------ 自定义 mode */

const ElixirPatch = {
  find: 't(e.codemirror)',
  replace: 't(e.CodeMirror)',
}

function classicifyCjsMode(text, label) {
  // Carbon 的自定义 mode 是 `const CodeMirror = require('codemirror')` 的 CJS 文件，
  // 剥掉 require 行、整体包进 IIFE 并把全局 CodeMirror 作为形参注入。
  const before = text
  let stripped = text.replace(
    /^[ \t]*(?:const|let|var)[ \t]+CodeMirror[ \t]*=[ \t]*require\(\s*['"]codemirror['"]\s*\)[ \t]*;?[ \t]*\r?\n/m,
    ''
  )
  if (stripped === before) {
    // 容错：没有 CodeMirror 的 require 行（也许直接依赖全局）
    stripped = text
  }
  const rest = [...stripped.matchAll(/\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g)]
  if (rest.length) die(`${label}: 仍残留 require() 调用 ${rest.map(r => r[0]).join(', ')} —— 不能当 classic script`)
  return '(function (CodeMirror) {\n' + stripped.trim() + '\n})(CodeMirror)\n'
}

function buildCustomModes() {
  const chunks = []
  const detail = []
  const local = [
    ['apache', 'apache.js', 'CodeMirror Apache mode (作者 gloony，文件头 "Distributed under an MIT license")'],
    ['nim', 'nim.js', 'CodeMirror Nim mode'],
    ['riscv', 'riscv.js', 'RISC-V mode，源自 kvvakil/venus（文件头注明 fork by matthewnielsen27）'],
    ['solidity', 'solidity.js', 'codemirror-solidity by alincode（文件头 "Distributed under MIT"）'],
  ]
  for (const [name, file, note] of local) {
    const p = path.join(REF, file)
    if (!fs.existsSync(p)) die(`缺少 ${rel(p)}（Carbon 自定义 mode 源文件）`)
    const buf = fs.readFileSync(p)
    const text = buf.toString('utf8')
    // solidity.js 里有关键字表项 `import: true,`，所以 ESM 判定必须要求关键字后跟空白或 ( * {
    if (/^[ \t]*(?:import|export)(?:[ \t]+|[({*])/m.test(text)) die(`${file}: 仍是 ESM，需要额外改造`)
    const cjs = classicifyCjsMode(text, file)
    chunks.push(
      `/*!-- custom mode ${name} | 原文件 ${file}（carbon-app/carbon lib/custom/modes） | ${buf.length}B | sha1 ${sha8(
        buf
      )} | ${note} | 改造：剥离 require('codemirror') → IIFE 形参注入全局 CodeMirror --*/\n` + cjs
    )
    detail.push({ name, bytes: buf.length, sha1: sha8(buf), via: 'Carbon 仓库自带文件' })
  }

  // elixir：npm 包 codemirror-mode-elixir 的 UMD 产物
  const elixirVersion = (() => {
    const meta = ensure(`${NPM_MIRROR}/codemirror-mode-elixir`, 1000)
    const j = JSON.parse(meta.buf.toString('utf8'))
    return j['dist-tags'].latest
  })()
  const el = npmFile('codemirror-mode-elixir', elixirVersion, 'dist/codemirror-mode-elixir.umd.js', 1000)
  let elText = el.buf.toString('utf8')
  if (!elText.includes(ElixirPatch.find)) {
    die(
      `codemirror-mode-elixir UMD 头变了，浏览器分支不再是 t(e.codemirror)，需要人工适配。头部: ${elText.slice(
        0,
        200
      )}`
    )
  }
  elText = elText.replace(ElixirPatch.find, ElixirPatch.replace).replace(/\n?\/\/# sourceMappingURL=.*$/m, '')
  chunks.push(
    `/*!-- custom mode elixir | https://registry.npmmirror.com/codemirror-mode-elixir/-/codemirror-mode-elixir-${elixirVersion}.tgz 内 dist/codemirror-mode-elixir.umd.js | v${elixirVersion} | ${el.bytes}B | sha1 ${el.sha1.slice(
      0,
      8
    )} | ${LICENSES['codemirror-mode-elixir']} | 改造：UMD 浏览器分支 t(e.codemirror) → t(e.CodeMirror)（原产物取 window.codemirror 小写，classic 下为 undefined 会 TypeError），并删掉 sourceMappingURL 注释 --*/\n` +
      elText.trim() +
      '\n'
  )
  detail.push({
    name: 'elixir',
    bytes: el.bytes,
    sha1: el.sha1.slice(0, 8),
    via: `npm UMD codemirror-mode-elixir@${elixirVersion}（打 1 处 URL 补丁）`,
  })

  const text =
    banner('vendor/custom-modes.js — Carbon 自带 / npm 补充的 CodeMirror 自定义 mode（classic script）', [
      '加载顺序：codemirror.min.js → addons.js → modes.js → custom-modes.js（本文件）。',
      '这些 mode 只用到 core 的 defineMode/defineMIME（vm 实测无 addon 依赖，见 vendor/README.md 的 API 调用记录）。',
      Object.entries(CUSTOM_MODE_DROPPED)
        .filter(([, v]) => v)
        .map(([k, v]) => `剔除 ${k}: ${v}`)
        .join('\n'),
      '生成器: node tools/build-vendor.js',
    ]) +
    '\n' +
    chunks.join('\n;\n')

  const w = writeFileIdempotent(path.join(VENDOR, 'custom-modes.js'), text)
  cmRecords.push(
    rec(
      'vendor/custom-modes.js',
      `${rel(REF)}/*.js + ${NPM_MIRROR}/codemirror-mode-elixir`,
      `carbon@main + elixir@${elixirVersion}`,
      w.bytes,
      w.sha1,
      `vm 执行；mode=${detail.map(d => d.name).join('/')}；graphql 已剔除`,
      `${LICENSES.carbon} + ${LICENSES.codemirror} + ${LICENSES['codemirror-mode-elixir']}`
    )
  )
  return detail
}

/* ------------------------------------------------------------------ hljs 语言 */

function hljsCandidateNames(name) {
  const out = [name]
  const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  if (camel !== name) out.push(camel)
  if (/-/.test(name)) out.push(name.replace(/-/g, ''))
  return [...new Set(out)]
}

/** 逐语言隔离注册：证明 CDN 文件真的自带全部依赖、不挑加载顺序 */
function solveHljsOrder(corePath, files) {
  const loadCore = () => {
    delete require.cache[require.resolve(corePath)]
    return require(corePath)
  }
  const results = []
  for (const f of files) {
    const core = loadCore()
    const before = new Set(core.listLanguages())
    const sb = { hljs: core, window: { hljs: core }, console, module: undefined, exports: undefined, define: undefined }
    vm.createContext(sb)
    let err = null
    try {
      vm.runInContext(f.text, sb, { filename: f.name })
    } catch (e) {
      err = e
    }
    const added = core.listLanguages().filter(l => !before.has(l))
    results.push({ ...f, err, added })
  }
  return results
}

function buildHljsLanguages() {
  const corePath = path.join(PROBE, 'highlight.min.js')
  /* 核心按 HLJS_VERSION 现取（cdnjs 优先，jsdelivr 兜底），原样字节落进 tools/upstream/，
   * 这样「上游 pin 的 hljs 版本」是脚本说了算，而不是靠手工放一个文件。 */
  const coreGot = ensureAny(
    [
      `${CDN_HLJS}/highlight.min.js`,
      `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${HLJS_VERSION}/highlight.min.js`,
    ],
    100000
  )
  const stale = fs.existsSync(corePath) ? fs.readFileSync(corePath) : null
  if (!stale || !stale.equals(coreGot.buf)) fs.writeFileSync(corePath, coreGot.buf)
  delete require.cache[require.resolve(corePath)]
  const coreBuf = coreGot.buf
  const core = require(corePath)
  const builtin = new Set(core.listLanguages())
  const wanted = readJson(path.join(PROBE, 'extracted.json')).LANGUAGES.filter(l => l.highlight).map(l => l.short || l.mode)
  const missing = [...new Set(wanted)].filter(w => !builtin.has(w))

  const downloaded = []
  const skipped = []
  for (const name of missing) {
    if (HLJS_KNOWN_UNRESOLVED[name]) {
      skipped.push({ name, why: HLJS_KNOWN_UNRESOLVED[name] })
      continue
    }
    let got = null
    const tried = []
    for (const cand of hljsCandidateNames(name)) {
      tried.push(cand)
      try {
        got = ensureAny(hljsUrls(`${cand}.min.js`), 100)
        if (cand !== name) log(`  · hljs "${name}" → 实际文件名 ${cand}.min.js`)
        break
      } catch (e) {
        /* 换下一个拼写 */
      }
    }
    if (!got) {
      skipped.push({ name, why: `cdnjs languages/{${tried.join(',')}}.min.js 全部 404/过小` })
      continue
    }
    downloaded.push({
      name,
      file: `${got.url.split('/').slice(-1)[0]}`,
      url: got.url,
      bytes: got.bytes,
      sha1: got.sha1,
      text: got.buf.toString('utf8').replace(/\n?\/\/# sourceMappingURL=.*$/m, '').trim(),
    })
  }

  // 隔离注册校验（同时拿到「实际注册名」用于别名核对）
  const iso = solveHljsOrder(corePath, downloaded)
  const failed = iso.filter(r => r.err || !r.added.length)
  if (failed.length) {
    die(
      'hljs 语言隔离注册失败：\n' +
        failed.map(f => `  ${f.name}: ${f.err ? f.err.message : '注册后 listLanguages 无新增'}`).join('\n')
    )
  }
  const inlined = iso.filter(r => r.added.length > 1)

  // 稳定顺序：按注册名排序（隔离校验已证明两两无先后依赖）
  downloaded.sort((a, b) => (a.name < b.name ? -1 : 1))

  const text =
    banner(`vendor/hljs-languages.js — highlight.js ${HLJS_VERSION} 语言扩展，classic script 拼接`, [
      '必须在 hljs 核心之后加载：每个文件末尾是 `hljs.registerLanguage("x",e)`，裸引用全局 hljs',
      `（核心由 ${rel(path.join(PROBE, 'highlight.min.js'))} 提供，var hljs=... 在 classic 下即 window.hljs）。`,
      `清单来源：tools/upstream/extracted.json 中 highlight:true 的语言（short||mode 共 ${[...new Set(wanted)].length} 个），`,
      `剔除核心已内置 ${[...new Set(wanted)].filter(w => builtin.has(w)).length} 个，实际下载 ${downloaded.length} 个。`,
      '依赖：cdnjs 的每个语言文件在编译期已把自己依赖的基语法内联，实测逐个单独注册到「干净核心」都能成功',
      inlined.length ? `（其中 ${inlined.map(r => `${r.name}→[${r.added.join(',')}]`).join(' ')} 会一次注册多个名字）` : '',
      '顺序因此按名字排序即可，非拓扑必需。',
      Object.entries(skipped.length ? {} : {}).length ? '' : '',
      '生成器: node tools/build-vendor.js',
    ]).replace(/\n \n/g, '\n') +
    '\n' +
    downloaded
      .map(d => `/*!-- hljs ${d.name} | ${d.url} | ${HLJS_VERSION} | ${d.bytes}B | sha1 ${d.sha1.slice(0, 8)} --*/\n` + d.text + '\n')
      .join('\n;\n')

  // hljs 核心原样字节落进 vendor/，交付体不依赖任何抓取中间目录
  const wc = writeFileIdempotent(path.join(VENDOR, 'hljs.min.js'), coreBuf)
  hljsRecords.unshift(
    rec(
      'vendor/hljs.min.js',
      `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${HLJS_VERSION}/highlight.min.js`,
      HLJS_VERSION,
      wc.bytes,
      wc.sha1,
      `与 ${rel(corePath)} 逐字节相同（Buffer 原样复制）+ node require 取得 hljs + listLanguages=${builtin.size}`,
      LICENSES.hljs
    )
  )

  const w = writeFileIdempotent(path.join(VENDOR, 'hljs-languages.js'), text)
  hljsRecords.push(
    rec(
      'vendor/hljs-languages.js',
      `${CDN_HLJS}/languages/<name>.min.js`,
      HLJS_VERSION,
      w.bytes,
      w.sha1,
      `逐语言隔离注册(${downloaded.length}/${missing.length} 通过) + 合并后 listLanguages 复核 + highlightAuto 实测`,
      LICENSES.hljs,
      `核心内置 ${[...new Set(wanted)].filter(w2 => builtin.has(w2)).length} 个无需下载；跳过 ${
        skipped.map(s => s.name).join('/') || '无'
      }`
    )
  )
  return { wanted, builtin: [...builtin], missing, downloaded, skipped, inlined, iso }
}
const hljsRecords = []

/* ------------------------------------------------------------------ dom-to-image */

function buildDomToImage() {
  const src = path.join(REF, 'dom-to-image.js')
  if (!fs.existsSync(src)) die(`缺少 ${rel(src)}`)
  const buf = fs.readFileSync(src)
  const original = buf.toString('utf8').replace(/\r\n/g, '\n')

  // 关键结构断言：改造只允许「追加」，原实现逐字节保留
  const bridge = [
    '\n/* ---- 由 tools/build-vendor.js 追加的 classic-script 桥接 ---------------',
    " * 上游结尾是 '})(this)'，内部第 36-37 行：",
    ' *     if (typeof module !== "undefined") module.exports = domtoimage',
    ' *     else global.domtoimage = domtoimage',
    ' * 在 file:// 双击的页面里既没有 module 也没有 define，走 else 分支，',
    ' * 顶层 this === window，所以 window.domtoimage 本来就会被赋值。这里只是兜底：',
    ' * 万一站点里存在别处定义的 window.module（某些 polyfill / 旧 bundle），',
    ' * 上游会走 module.exports 分支而不挂全局，本段把它补回全局，',
    ' * 让 <script src="vendor/dom-to-image.js"></script> 之后 window.domtoimage 一定可用。',
    ' * 未改动原实现任何一个字节（校验：产物以 tools/upstream/dom-to-image.js 为严格前缀）。',
    ' */',
    ';(function (g) {',
    "  'use strict'",
    '  if (g && !g.domtoimage && typeof module !== "undefined" && module.exports) {',
    '    g.domtoimage = module.exports',
    '  }',
    '})(typeof window !== "undefined" ? window : globalThis)',
    '',
  ].join('\n')
  const text = original + bridge
  const w = writeFileIdempotent(path.join(VENDOR, 'dom-to-image.js'), text)
  if (!fs.readFileSync(w.dest, 'utf8').startsWith(original)) die('dom-to-image.js 原实现被改动了（应为严格前缀）')

  // 加载期结构检查（不依赖 DOM）：应挂出 domtoimage 且 5 个公开方法齐全
  const sb = { console, setTimeout, module: undefined, exports: undefined, define: undefined }
  vm.createContext(sb)
  vm.runInContext(text, sb, { filename: 'dom-to-image.js' })
  const api = sb.domtoimage
  const need = ['toSvg', 'toPng', 'toJpeg', 'toBlob', 'toPixelData', 'impl']
  if (!api) die('dom-to-image.js 执行后未挂出全局 domtoimage')
  for (const k of need) if (typeof api[k] !== 'function' && k !== 'impl') die(`dom-toimage.${k} 不是函数`)

  // file:// 风险点静态扫描（结论写进 README）
  const scan = {
    XMLHttpRequest: (original.match(/new XMLHttpRequest\(\)/g) || []).length,
    fetch: (original.match(/\bfetch\(/g) || []).length,
    imageSrc: (original.match(/image\.src = uri/) || []).length,
    styleSheets: (original.match(/document\.styleSheets/g) || []).length,
    isDataUrlGates: (original.match(/util\.isDataUrl/g) || []).length,
    fontEmbedCSS: /fontEmbedCSS/.test(original),
    skipFonts: /skipFonts/.test(original),
    ignoreFonts: /ignoreFonts/.test(original),
    imagePlaceholder: /imagePlaceholder/.test(original),
    cacheBust: /cacheBust/.test(original),
    failResolveEmpty: /function fail\(message\)/.test(original),
  }
  domToImageInfo = { bytes: buf.length, sha1: sha8(buf), outBytes: w.bytes, outSha1: w.sha1, scan }
  dmiRecords.push(
    rec(
      'vendor/dom-to-image.js',
      `本地 ${rel(src)}（carbon-app/carbon lib/dom-to-image.js，源自 tsayen/dom-to-image master）`,
      'dom-to-image 2.x (fork, 22770B)',
      w.bytes,
      w.sha1,
      'vm 加载断言 5 个导出方法齐全 + 前缀比对证明原实现零改动 + file:// 风险点静态扫描',
      `${LICENSES['dom-to-image']}；载体文件来自 ${LICENSES.carbon}`
    )
  )
  return domToImageInfo
}
let domToImageInfo = null
const dmiRecords = []

/* ------------------------------------------------------------------ 注册校验（CodeMirror） */

function fakeCodeMirror() {
  const reg = {
    modes: {},
    mimes: {},
    simpleModes: {},
    overlays: [],
    extended: {},
    options: [],
    unknownApis: new Map(),
    calls: [],
  }
  const modes = {}
  const api = {
    modes,
    mimes: {},
    modeExtensions: {},
    mimeModes: {},
    version: 'fake',
    Pos: (line, ch) => ({ line, ch: ch == null ? 0 : ch }),
    defineMode(name, factory, ext) {
      modes[name] = factory
      reg.modes[name] = {
        factory: typeof factory === 'function',
        extKeys: ext ? Object.keys(ext) : [],
        depend: (ext && ext.depend) || null,
        mime: (ext && ext.mime) || null,
        alias: (ext && ext.alias) || null,
        group: (ext && ext.group) || null,
        file: name,
      }
      reg.calls.push(['defineMode', name, ext ? JSON.stringify(Object.keys(ext)) : ''])
    },
    defineMIME(mime, spec) {
      reg.mimes[mime] = spec
      reg.calls.push(['defineMIME', mime, typeof spec === 'string' ? spec : JSON.stringify(Object.keys(spec))])
    },
    defineSimpleMode(name, spec) {
      modes[name] = () => {}
      const deps = new Set()
      const walk = o => {
        if (!o || typeof o !== 'object') return
        for (const k of Object.keys(o)) {
          if (k === 'mode' && typeof o[k] === 'string') deps.add(o[k])
          else if (k === 'indent' && typeof o[k] === 'string') deps.add(o[k])
          else walk(o[k])
        }
      }
      walk(spec)
      reg.simpleModes[name] = [...deps]
      reg.calls.push(['defineSimpleMode', name, JSON.stringify([...deps])])
    },
    defineOverlay(spec) {
      reg.overlays.push(spec && spec.name)
      reg.calls.push(['defineOverlay', String(spec && spec.name), ''])
    },
    extendMode(name, obj) {
      reg.extended[name] = Object.keys(obj || {})
      reg.calls.push(['extendMode', name, JSON.stringify(Object.keys(obj || {}))])
    },
    defineExtension(name, val) {
      reg.options.push(name)
      reg.calls.push(['defineExtension', String(name), ''])
    },
    defineOption(name, defaultValue, fn) {
      reg.options.push(name)
      reg.calls.push(['defineOption', String(name), ''])
    },
    registerHelper(name, mode, fn) {
      reg.calls.push(['registerHelper', String(name), String(mode)])
    },
    getMode(config, spec) {
      const n = typeof spec === 'string' ? spec : spec && spec.name
      if (n && !modes[n]) reg.missingRuntimeModes.add(n)
      return { name: n || 'null', token: () => null, indent: () => 0, blankLine: () => {}, copyState: s => s, compare: () => true }
    },
    copyState: (m, s) => s,
    startState: m => (m && m.startState ? m.startState() : {}),
    overlayMode: (a, b) => ({ token: () => null }),
    multiplexingMode: (...ms) => ({ token: () => null }),
    innerMode: () => ({ mode: null, state: null }),
    newFoldFunction: () => () => {},
    foldCode: () => {},
    continueLines: f => f,
    commands: { newlineAndIndent: () => {} },
    keyMap: {},
    normalizeKeyMap: k => k,
    isModifier: () => false,
    keyName: () => '',
    lookupKey: () => undefined,
    runMode: () => {},
    modesCache: {},
    mimeModesCache: {},
    modeInfo: [],
  }
  reg.missingRuntimeModes = new Set()
  return {
    reg,
    cm: new Proxy(api, {
      get(t, k) {
        if (typeof k === 'symbol') return t[k]
        if (!(k in t)) {
          reg.unknownApis.set(String(k), (reg.unknownApis.get(String(k)) || 0) + 1)
          return function () {
            return undefined
          }
        }
        return t[k]
      },
      set(t, k, v) {
        t[k] = v
        return true
      },
    }),
  }
}

function runCmVerification() {
  const read = f => fs.readFileSync(path.join(VENDOR, f), 'utf8')

  /* —— 轨道 A：假 CodeMirror，记录注册表与未知 API —— */
  const fake = fakeCodeMirror()
  const reg = fake.reg
  const sb = { CodeMirror: fake.cm, console, module: undefined, exports: undefined, define: undefined }
  // 实测：cdnjs 的 mode/powershell 浏览器分支写作 e(window.CodeMirror) 而不是 e(CodeMirror)，
  // 所以沙箱里必须同时提供 window（真实浏览器两者都在）
  sb.window = sb
  sb.window.CodeMirror = fake.cm
  vm.createContext(sb)
  const seq = []
  for (const f of ['addons.js', 'modes.js', 'custom-modes.js']) {
    vm.runInContext(read(f), sb, { filename: f })
    seq.push(f)
  }

  /* —— 轨道 B：真 codemirror.min.js（DOM 打桩）+ 同一批文件 —— */
  const mkEl = () => ({
    style: { setProperty() {}, getPropertyValue: () => '' },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    removeChild() {},
    insertBefore() {},
    addEventListener() {},
    removeEventListener() {},
    firstChild: null,
    lastChild: null,
    childNodes: [],
    children: [],
    ownerDocument: null,
    innerHTML: '',
    textContent: '',
    parentNode: null,
    offsetWidth: 0,
    offsetHeight: 0,
    cloneNode: mkEl,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {},
    contains: () => false,
  })
  const doc = {
    documentElement: mkEl(),
    body: mkEl(),
    head: mkEl(),
    createElement: mkEl,
    createTextNode: mkEl,
    createDocumentFragment: mkEl,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByClassName: () => [],
    activeElement: null,
    implementation: { createHTMLDocument: () => doc },
  }
  const real = {
    console,
    navigator: { userAgent: 'node', platform: 'Win', appVersion: '5.0' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    module: undefined,
    exports: undefined,
    define: undefined,
  }
  real.window = real
  real.document = doc
  doc.defaultView = real
  real.globalThis = real
  vm.createContext(real)
  vm.runInContext(read('codemirror.min.js'), real, { filename: 'codemirror.min.js' })
  const CM = real.CodeMirror
  if (typeof CM !== 'function') die('真 core 未挂出 window.CodeMirror')
  const coreModes = Object.keys(CM.modes)
  const realSeq = ['codemirror.min.js']
  for (const f of ['addons.js', 'modes.js', 'custom-modes.js']) {
    try {
      vm.runInContext(read(f), real, { filename: f })
    } catch (e) {
      die(`真 core 下加载 ${f} 抛错: ${e.message}\n${String(e.stack).split('\n').slice(0, 3).join('\n')}`)
    }
    realSeq.push(f)
  }
  const realModes = Object.keys(CM.modes)

  // Carbon 传给 CM 的是 language.mime || language.mode（src_Editor.txt/Carbon.js:67,74），
  // 所以必须验证每个 LANGUAGES 条目能解析到真实 mode 而不是 null。
  const coverage = []
  const langs = readJson(path.join(PROBE, 'extracted.json')).LANGUAGES
  for (const l of langs) {
    const spec = l.mime || l.mode
    let name = null
    let err = null
    try {
      name = CM.getMode({ indentUnit: 2 }, spec).name
    } catch (e) {
      err = String(e.message).slice(0, 60)
    }
    coverage.push({ display: l.name, spec, resolved: name, nullish: !name || name === 'null', err })
  }

  return { reg, CM, coreModes, realModes, seq, realSeq, coverage }
}

/* ------------------------------------------------------------------ hljs 合并校验 */

function runHljsVerification(expectedNames) {
  const corePath = path.join(PROBE, 'highlight.min.js')
  delete require.cache[require.resolve(corePath)]
  const core = require(corePath)
  const before = core.listLanguages().length
  const sb = { hljs: core, window: { hljs: core }, console, module: undefined, exports: undefined, define: undefined }
  vm.createContext(sb)
  vm.runInContext(fs.readFileSync(path.join(VENDOR, 'hljs-languages.js'), 'utf8'), sb, {
    filename: 'hljs-languages.js',
  })
  const list = core.listLanguages()
  const missingFromBundle = expectedNames.filter(n => !core.getLanguage(n) && !list.includes(n))
  const samples = {
    javascript: 'function add(a,b){const c=a+b;return c>0?c:Math.max(a,b)} // js\nexport default add',
    python: 'def fib(n):\n    if n < 2:\n        return n\n    return [x for x in range(10) if x % 2]\n',
    mixed:
      'function greet(name) {\n  const msg = "hi"\n  return msg + name\n}\n\ndef fib(n):\n    if n < 2:\n        return n\n    return fib(n-1) + fib(n-2)\n\nclass Point:\n    public int X { get; set; }\n',
    cpp: '#include <vector>\nstruct S { int a; };\nint main(){ std::vector<int> v; for(auto&x:v) x+=1; return 0; }\n',
  }
  const auto = {}
  for (const [k, code] of Object.entries(samples)) {
    const r = core.highlightAuto(code)
    auto[k] = { language: r.language, relevance: r.relevance }
  }
  return { core, before, list, missingFromBundle, auto, samples }
}

/* ------------------------------------------------------------------ README 生成 */

function buildReadme(data) {
  const rows = [...cmRecords, ...hljsRecords, ...dmiRecords]
  const L = []
  L.push('# vendor/ — 离线依赖清单（由 `tools/build-vendor.js` 生成，请勿手改）\n')
  L.push(
    '目标：双击 `index.html`（file://）即可用，零运行时网络。所有文件都是 **classic script**（`<script src>`），无 ES module、无 `fetch`/`XHR` 依赖（dom-to-image 内部有 XHR，见 §4）。\n'
  )
  L.push('## 1. 加载顺序（index.html 必须照此）\n')
  L.push('```html')
  L.push('<link rel="stylesheet" href="vendor/codemirror.min.css">')
  L.push('<script src="vendor/codemirror.min.js"></script>      <!-- 全局 CodeMirror，内置 mode "null" -->')
  L.push('<script src="vendor/addons.js"></script>              <!-- 只依赖 core，必须早于 modes.js -->')
  L.push('<script src="vendor/modes.js"></script>               <!-- 依赖拓扑序拼接 -->')
  L.push('<script src="vendor/custom-modes.js"></script>        <!-- apache/nim/riscv/solidity/elixir -->')
  L.push('<script src="vendor/hljs.min.js"></script>             <!-- 核心，var hljs=... → window.hljs -->')
  L.push('<script src="vendor/hljs-languages.js"></script>      <!-- 裸引全局 hljs，核心必须在前面 -->')
  L.push('<script src="vendor/dom-to-image.js"></script>        <!-- 挂 window.domtoimage -->')
  L.push('```')
  L.push(
    `\n> hljs 核心由本脚本从 ${rel(path.join(PROBE, 'highlight.min.js'))} **原样字节**复制为 vendor/hljs.min.js` +
      `（${data.hljsCore.bytes} B, sha1 ${data.hljsCore.sha8}，与 https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${HLJS_VERSION}/highlight.min.js 同字节），` +
      `所以删掉任何抓取中间目录都不影响交付体。\n`
  )
  L.push('## 2. 文件表\n')
  L.push('| 文件 | 来源 URL / 上游版本 | 字节 | sha1(8) | 校验方式 |')
  L.push('| --- | --- | ---: | --- | --- |')
  for (const r of rows) {
    L.push(
      `| \`${r.file}\` | ${r.source}<br>_v${r.version}_${r.note ? '_<br>' + r.note : ''} | ${r.bytes} | \`${
        r.sha8
      }\` | ${r.verify} |`
    )
  }
  L.push('')
  L.push(`实测合计：modes ${data.modes.length} 个 / addons ${data.addons.length} 个 / hljs 扩展 ${data.hljs.downloaded.length} 个。\n`)

  L.push('## 3. CodeMirror 依赖闭包\n')
  L.push('| # | mode（拓扑序=拼接序） | 上游字节 | sha1(8) | 文件级依赖（UMD 数组） | 注册名 |')
  L.push('| ---: | --- | ---: | --- | --- | --- |')
  data.modes.forEach((m, i) =>
    L.push(
      `| ${i} | \`${m.name}\` | ${m.bytes} | \`${m.sha1.slice(0, 8)}\`${m.mirror ? ' _(镜像)_' : ''} | ${
        m.deps.length ? m.deps.map(d => `\`${d.kind}:${d.name}\``).join(' ') : '—'
      } | \`${m.name}\` |`
    )
  )
  L.push('')
  L.push('| # | addon | 上游字节 | sha1(8) | 文件级依赖 | 被谁需要 |')
  L.push('| ---: | --- | ---: | --- | --- | --- |')
  data.rawAddons.forEach((a, i) =>
    L.push(
      `| ${i} | \`${a.name}\` | ${a.bytes} | \`${a.sha1.slice(0, 8)}\`${a.mirror ? ' _(镜像)_' : ''} | ${
        a.deps.length ? a.deps.map(d => `\`${d.kind}:${d.name}\``).join(' ') : '—'
      } | ${data.addons[i].requiredBy.map(x => '`' + x + '`').join(', ') || '—'} |`
    )
  )
  L.push('')

  L.push(`- 种子（${data.seedModes.length}）：\`${data.seedModes.join(' `, `')}\``)
  L.push(
    `- 递归额外引入的 mode（${data.extraModes.length}）：${
      data.extraModes.length
        ? data.extraModes
            .map(
              m =>
                `\`${m.name}\`（被 ${m.requiredBy
                  .map(x => `\`${x}\``)
                  .join(', ')} 依赖）`
            )
            .join('、')
        : '无'
    }`
  )
  L.push(
    `- 递归引入 + 手工确认的 addon（${data.addons.length}）：${data.addons
      .map(a => `\`${a.name}\`（被 ${a.requiredBy.map(x => '`' + x + '`').join(', ') || 'Carbon 运行时 option'} 依赖）`)
      .join('、')}`
  )
  L.push(`- 拓扑序前 8：\`${data.modes.slice(0, 8).map(m => m.name).join(' → ')} …\``)
  L.push(`- 种子剔除：${Object.entries(CM_MODES_EXCLUDED).map(([k, v]) => `\`${k}\`：${v}`).join('；')}`)
  L.push(
    `- 实测（真 core）：\`CodeMirror.getMode({}, "text"/"plaintext"/"auto"/"graphql")\` 全部返回 \`null\` mode、不抛错 → 未注册的 mode 自动降级为纯文本，不会崩。`
  )
  L.push(`\n### 假 CodeMirror 注册结果（轨道 A）\n`)
  L.push(
    `- defineMode 注册名 ${data.fake.registeredModes.length} 个；defineMIME ${data.fake.mimeCount} 条；defineSimpleMode ${data.fake.simple.length} 个；extendMode ${data.fake.extend.length} 个；defineOption/defineExtension ${data.fake.options.length} 个。`
  )
  L.push(`- 真 core 注册后 \`CodeMirror.modes\` 数量：${data.real.modeCount}（core 自带 ${data.real.coreModes.join(', ')}）。`)
  L.push(
    `- 未被满足的文件级依赖：**${data.unmet.length ? data.unmet.length + ' 个' : '0 个'}**${
      data.unmet.length ? ' → ' + data.unmet.join('; ') + '（视为失败）' : ''
    }`
  )
  L.push(
    `- mode 名级依赖（\`ext.depend\` / simple-mode 的 \`mode:\` 字段）未注册项：**${
      data.unmetNames.length ? data.unmetNames.join(', ') : '0 个'
    }**`
  )
  L.push(
    `- 假对象被访问到、但我没预置的 API（Proxy 记录）：${
      data.unknownApis.length ? '`' + data.unknownApis.join('`, `') + '`（已按需补齐或确认无害）' : '无'
    }`
  )
  L.push(`- 真 core 下自定义 mode 的 API 面：apache/nim/riscv/solidity/elixir 只用到 \`defineMode\`+\`defineMIME\`，无 addon 依赖（轨道 B 无抛错 + 注册名 ${data.custom.registered.join('/')}）。`)
  const cov = data.real.coverage
  const covOk = cov.filter(c => !c.nullish)
  L.push('')
  L.push(
    `### mime||mode → mode 解析覆盖（Carbon 把 \`language.mime || language.mode\` 直接喂给 CM，实测 ${covOk.length}/${cov.length} 条能解析到真实 mode）`
  )
  L.push('')
  L.push('| 显示名 | 传给 CM 的 spec | 解析到的 mode |')
  L.push('| --- | --- | --- |')
  for (const c of cov)
    if (c.nullish) L.push(`| ${c.display} | \`${c.spec}\` | **${c.resolved}**（无高亮，见 §6） |`)
  L.push(`其余 ${covOk.length} 条全部解析到具名 mode（完整清单见构建日志 / 本次运行输出）。`)

  L.push('\n## 4. dom-to-image 在 file:// 下的调用结论\n')
  L.push(
    `改造方式：产物 = \`tools/upstream/dom-to-image.js\`（${data.dmi.bytes} B, sha1 ${data.dmi.sha1}）**逐字节原样** + 末尾追加一段桥接（见文件尾注释），因此产物以原文件为严格前缀（脚本内断言）。上游第 36-37 行 \`if (typeof module!=='undefined') module.exports=domtoimage; else global.domtoimage=domtoimage\` 配 \`;})(this)\`，classic script 下 \`module\` 不存在、\`this\`===window → 天然挂出 \`window.domtoimage\`；追加段只是防 \`window.module\` 被别处污染时兜底。`
  )
  L.push('\n网络出口点（静态扫描实测）：')
  L.push(`- \`new XMLHttpRequest()\`：${data.dmi.scan.XMLHttpRequest} 处，全在 \`util.getAndEncode()\`（唯一的取字节通道）。`)
  L.push(`- \`fetch(\`：${data.dmi.scan.fetch} 处（本 fork 不使用 fetch）。`)
  L.push(`- \`document.styleSheets\`：${data.dmi.scan.styleSheets} 处，\`fontFaces.readAll()\` 遍历 \`cssRules\` 抓 \`@font-face\`。`)
  L.push(`- \`new Image(); image.src = uri\`：${data.dmi.scan.imageSrc} 处（\`util.makeImage\`），uri 恒为 data: URL，不产生请求。`)
  L.push(`- \`util.isDataUrl\` 闸门：${data.dmi.scan.isDataUrlGates} 处 —— 这是本库唯一的「跳过网络」开关。`)
  L.push('\n结论（调用时必须传什么）：')
  L.push('1. **本 fork 没有 \`fontEmbedCSS\`/ \`skipFonts\`/ \`ignoreFonts\` 选项**（实测扫描：' + `${data.dmi.scan.fontEmbedCSS}/${data.dmi.scan.skipFonts}/${data.dmi.scan.ignoreFonts}` + '）；只有 \`filter, bgcolor, width, height, style, quality, imagePlaceholder, cacheBust, escapePercentSign\`。所以「跳过字体」不能靠参数，只能靠**让 \`@font-face\` 的 \`src\` 里的 \`url()\` 已经是 \`data:\` 字体**：\`inliner.readUrls()\` 会 \`filter(!isDataUrl)\` 把 data URL 全部滤掉 → \`getAndEncode\` 根本不会被调用。\`<img>\` 与内联 \`background\` 同理（\`newImage().inline()\` 第一行 \`if (util.isDataUrl(element.src)) return Promise.resolve()\`）。')
  L.push('2. \`embedFonts\` 无条件执行（\`toSvg\` 第 61 行 \`.then(embedFonts)\`，\`toPng/toBlob/toJpeg\` 经 \`draw()\` 走同一条链）。字体规则来源是 `document.styleSheets`：file:// 下 Chrome 把每个本地文件当独立 opaque origin，外链 `<link>` 样式表（如 `vendor/codemirror.min.css`）读 `cssRules` 抛 SecurityError —— 被 `getCssRules` 的 try/catch 吞掉并 `console.log`，**不会中断导出**，只是那条表里的 @font-face 不进 SVG。所以：**应用自己的 @font-face 要写在 index.html 的内联 `<style>` 里**（同源同文档，一定能读到），字体文件本身用 base64/data URL。')
  L.push(
    "3. 万一有非 data 的 `url(...)` 漏进来：file:// 下 XHR 得到 `status===0` → 走 `fail()`，而 `fail(){ console.error(msg); resolve('') }` **resolve 空串而不是 reject** → 结果是 `data:<mime>;base64,`（空 body），图仍然生成，只是那个字体/背景图缺失。想让缺图有占位，传 `imagePlaceholder: \"image/png;base64,iVBOR…\"`（注意它按 `split(/,/)[1]` 取第 2 段，即不带 `data:` 前缀的写法）。"
  )
  L.push('4. \`cacheBust\` 保持默认 \`false\`（true 会给 URL 追加 \`?<timestamp>\`，离线场景无意义）。')
  L.push("5. Carbon 的调用参数照抄自 tools/upstream/src_Editor.txt 的 getCarbonImage：config 对象含 style（transform / transformOrigin / background / alignItems / justifyContent）、filter（排除 className 含 eliminateOnRender 与 CodeMirror-cursors 的节点）、width、height；SVG 导出后还要做五步正则替换 —— &nbsp; 转 &#160;、%23 转 #、%0A 转换行、裸 & 转 &amp;、按当前 fontFamily 删掉其它 @font-face 块；最后 slice(uri.indexOf(逗号)+1) 取 base64 段并拼 Blob（type=image/svg+xml）。")

  L.push('\n## 5. hljs\n')
  L.push(`- 核心：${rel(path.join(PROBE, 'highlight.min.js'))}（v${HLJS_VERSION} default build，内置 ${data.hljs.builtin.length} 个语言：\`${data.hljs.builtin.join(' ` ')}\`）。`)
  L.push(`- \`highlight:true\` 的语言（short||mode 去重）共 ${data.hljs.wantedCount} 个；核心已内置 ${data.hljs.alreadyBuiltin} 个 → 需下载 ${data.hljs.needDownload} 个 → 实际拿到 ${data.hljs.downloaded.length} 个。`)
  L.push(
    `- 逐个「干净核心」隔离注册全部通过 → 证明 cdnjs 的每个语言文件把依赖在编译期内联了（不需要拓扑）。一次注册多个名字的：${
      data.hljs.inlined.length ? data.hljs.inlined.map(r => `\`${r.name}\`→[${r.added.join(',')}]`).join('、') : '无'
    }。`
  )
  L.push(
    `- 名字不一致：${
      Object.keys(data.hljs.renamed).length
        ? Object.entries(data.hljs.renamed).map(([k, v]) => `\`${k}\`→\`${v}\``).join('、')
        : '无（本清单里 cdnjs 文件名与 short 名全部一致）'
    }。`
  )
  L.push(
    `- 被剔除的 hljs 语言及原因：${
      data.hljs.skipped.length
        ? data.hljs.skipped.map(s => `\`${s.name}\`：${s.why}`).join('\n  ')
        : '无'
    }`
  )
  L.push('- 合并加载后 `hljs.listLanguages()`：')
  L.push('```')
  L.push(`长度 ${data.hljsVer.list.length}（核心 ${data.hljsVer.before} + 新增 ${data.hljsVer.list.length - data.hljsVer.before}）`)
  L.push(data.hljsVer.list.join(' '))
  L.push('```')
  L.push('- `highlightAuto` 实测（证明自动检测通路真的通）：')
  L.push('| 输入 | .language | .relevance |')
  L.push('| --- | --- | ---: |')
  for (const [k, v] of Object.entries(data.hljsVer.auto)) L.push(`| ${k} | \`${String(v.language)}\` | ${v.relevance} |`)
  L.push('')
  L.push('| hljs 名（LANGUAGES.short） | 上游文件 | 字节 | sha1(8) | 隔离注册到干净核心 |')
  L.push('| --- | --- | ---: | --- | --- |')
  for (const d of data.hljs.downloaded) {
    const iso = data.hljs.iso.find(r => r.name === d.name)
    L.push(
      `| \`${d.name}\` | \`${d.file}\`${d.url.startsWith(CDN_HLJS) ? '' : ' _(镜像)_'} | ${d.bytes} | \`${d.sha1.slice(
        0,
        8
      )}\` | ${iso && !iso.err ? 'OK → [' + iso.added.join(',') + ']' : 'FAIL ' + (iso && iso.err ? iso.err.message : '?')} |`
    )
  }

  L.push('\n## 6. 被剔除的显示名（不静默降级）\n')
  L.push('| 显示名（LANGUAGES.name） | mode | 原因 |')
  L.push('| --- | --- | --- |')
  /* 行由两张"确实不可用"表现推，不写死：换 hljs 大版本时 c-like 那条会自己消失，
   * 写死会把 undefined 印进交付文档（实测踩过）。 */
  const DROP_LABELS = { graphql: 'GraphQL', 'c-like': 'C++（仅 hljs 侧）' }
  const dropRows = [
    ...Object.entries(CUSTOM_MODE_DROPPED)
      .filter(([, why]) => !!why)
      .map(([mode, why]) => `| ${DROP_LABELS[mode] || mode} | \`${mode}\` | ${why} |`),
    ...Object.entries(HLJS_KNOWN_UNRESOLVED).map(
      ([name, why]) => `| ${DROP_LABELS[name] || name} | \`${name}\` | ${why} |`
    ),
  ]
  L.push(dropRows.length ? dropRows.join('\n') : '| 无 | — | 本版每个显示名都有落点 |')
  L.push('')

  L.push('## 7. License（逐条）\n')
  for (const [k, v] of Object.entries(LICENSES)) L.push(`- **${k}** — ${v}`)
  L.push('- 每个第三方文件的来源 URL/版本/字节/sha1(8) 都写在了拼接处的 `/*!-- … --*/` 注释里（可直接 grep 复核），本 README 的表由同一份构建数据生成，不存在手写漂移。')
  L.push('\n## 8. 复现 / 自检\n')
  L.push('```bash')
  L.push('node tools/build-vendor.js            # 下载(可断点续) + 拼接 + 校验 + 生成本文件')
  L.push('node tools/build-vendor.js --verify-only   # 只跑校验')
  L.push('node tools/build-vendor.js --offline        # 只用 tools/.cache 里的缓存（CI 无网）')
  L.push('```')
  L.push(`\n缓存在 \`tools/.cache/\`（\`index.json\` 记 url→sha1/字节/时间）。产物阈值：${Object.entries(OUT_FILES).map(([k, v]) => `${k}≥${v}`).join(', ')}。`)
  L.push(`\n生成时间：${new Date().toISOString()}（node ${process.version}, ${os.platform()} ${os.release()}）`)
  fs.writeFileSync(path.join(VENDOR, 'README.md'), L.join('\n') + '\n')
}

/* ------------------------------------------------------------------ 主流程 */

function main() {
  for (const d of [VENDOR, CACHE]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

  /* 1. 种子 */
  const extractedFile = path.join(PROBE, 'extracted.json')
  if (!fs.existsSync(extractedFile)) die(`缺少 ${rel(extractedFile)}（LANGUAGES/THEMES 数据源）`)
  const extracted = readJson(extractedFile)
  const languages = extracted.LANGUAGES
  const allModes = [...new Set(languages.map(l => l.mode))]
  const customModeNames = [...new Set(languages.filter(l => l.custom).map(l => l.mode))]
  const seedModes = allModes.filter(m => !CM_MODES_EXCLUDED[m] && !customModeNames.includes(m))
  log(
    `[seed] LANGUAGES ${languages.length} 条 → mode 去重 ${allModes.length} → ` +
      `剔除 auto/text(非 CM mode) ${Object.keys(CM_MODES_EXCLUDED).length} 个、custom ${customModeNames.length} 个(${customModeNames.join('/')}) → 种子 ${seedModes.length}`
  )

  const hljsCoreBuf = fs.readFileSync(path.join(PROBE, 'highlight.min.js'))
  const data = {
    seedModes,
    hljsCore: { bytes: hljsCoreBuf.length, sha8: sha8(hljsCoreBuf) },
  }

  if (!OPT.verifyOnly) {
    /* 2. core */
    log('[1/6] CodeMirror core')
    buildCore()

    /* 3. mode + addon 闭包（ADDON_SEEDS 为空：Carbon 没用到额外上游 addon，见 ADDON_EVIDENCE） */
    log('[2/6] 解析 UMD 依赖 → 递归闭包 → 拓扑排序')
    const graph = buildCmGraph(seedModes.slice().sort())
    if (graph.unknownDeps.length) {
      die('无法识别的依赖路径:\n' + graph.unknownDeps.map(u => `  ${u.from} → ${u.dep}`).join('\n'))
    }
    for (const n of graph.notes) log('  · ' + n)
    const extraModes = [...graph.items.values()].filter(i => i.kind === 'mode' && !seedModes.includes(i.name))
    log(
      `  闭包：mode ${[...graph.items.values()].filter(i => i.kind === 'mode').length} / addon ${
        [...graph.items.values()].filter(i => i.kind === 'addon').length
      }；额外 mode: ${extraModes.map(m => m.name).join(', ') || '无'}`
    )

    /* 4. addons.js / modes.js */
    log('[3/6] 写 vendor/addons.js + vendor/modes.js')
    const built = buildAddonsAndModes(graph, seedModes)
    const requiredBy = (kind, name) =>
      uniqueStrings(
        [...graph.items.values()]
          .filter(i => i.deps.some(d => d.kind === kind && d.name === name))
          .map(i => i.name)
      )
    data.modes = built.modes
    data.rawAddons = built.addons
    data.addons = built.addons.map(a => ({ name: a.name, requiredBy: requiredBy('addon', a.name) }))
    data.extraModes = built.modes
      .filter(m => !seedModes.includes(m.name))
      .map(m => ({ name: m.name, requiredBy: requiredBy('mode', m.name) }))

    /* 5. custom modes */
    log('[4/6] 写 vendor/custom-modes.js')
    data.custom = { detail: buildCustomModes() }

    /* 6. hljs */
    log('[5/6] 写 vendor/hljs-languages.js')
    const h = buildHljsLanguages()
    data.hljs = {
      wanted: h.wanted,
      wantedCount: new Set(h.wanted).size,
      builtin: h.builtin,
      alreadyBuiltin: new Set(h.wanted).size - h.missing.length,
      needDownload: h.missing.length,
      downloaded: h.downloaded,
      skipped: h.skipped,
      inlined: h.inlined,
      iso: h.iso,
      renamed: Object.fromEntries(
        h.downloaded.filter(d => d.file !== `${d.name}.min.js`).map(d => [d.name, d.file])
      ),
    }

    /* 7. dom-to-image */
    log('[6/6] 写 vendor/dom-to-image.js')
    data.dmi = buildDomToImage()
    data.custom.registered = data.custom.detail.map(d => d.name)
  }

  /* 8. 校验 */
  log('[verify] CodeMirror 双轨 vm 执行')
  const v = runCmVerification()
  data.fake = {
    registeredModes: Object.keys(v.reg.modes),
    mimeCount: Object.keys(v.reg.mimes).length,
    simple: Object.keys(v.reg.simpleModes),
    extend: Object.keys(v.reg.extended),
    options: v.reg.options,
  }
  data.real = {
    modeCount: v.realModes.length,
    coreModes: v.coreModes,
    coverage: v.coverage,
  }
  data.unknownApis = [...v.reg.unknownApis.entries()].map(([k, n]) => `${k}×${n}`)

  // 文件级依赖满足性在 buildCmGraph() 里已按拓扑索引断言过（不满足直接 die），
  // 这里只复核「拼接进文件的条目」与「图里的条目」一致。
  const unmet = []
  if (!OPT.verifyOnly) {
    const included = new Set(data.modes.map(m => 'mode:' + m.name).concat(data.addons.map(a => 'addon:' + a.name)))
    for (const it of data.modes.concat(data.rawAddons || []))
      for (const d of it.deps) if (!included.has(d.kind + ':' + d.name)) unmet.push(`${it.name} → ${d.kind}:${d.name} 未被拼接`)
  }
  data.unmet = unmet

  // 名字级依赖（ext.depend / simple-mode mode:）是否已注册
  const registeredNames = new Set([...v.realModes, ...Object.keys(v.reg.modes)])
  const unmetNames = []
  for (const [name, info] of Object.entries(v.reg.modes)) {
    for (const depName of info.depend || []) if (!registeredNames.has(depName)) unmetNames.push(`${name}.depend→${depName}`)
  }
  for (const [name, deps] of Object.entries(v.reg.simpleModes)) {
    for (const dn of deps) {
      const clean = String(dn).replace(/^@/, '').split(' ')
      for (const c of clean) if (c && !registeredNames.has(c) && c !== 'null' && !c.includes('/'))
        unmetNames.push(`${name}.simple→${c}`)
    }
  }
  data.unmetNames = [...new Set(unmetNames)]

  log(`  假 CM: modes=${data.fake.registeredModes.length} mimes=${data.fake.mimeCount}`)
  log(`  真 CM: CodeMirror.modes=${data.real.modeCount}`)
  const missingSeedModes = data.seedModes.filter(m => !v.realModes.includes(m))
  if (missingSeedModes.length) die(`真 core 下这些种子 mode 没注册上: ${missingSeedModes.join(', ')}`)
  if (!OPT.verifyOnly) {
    console.log('  注册的 mode 名集合（真 core，含 core 自带 null）：')
    console.log('    ' + v.realModes.join(' '))
    console.log('  每个 mode 的上游字节数：')
    for (const m of data.modes)
      console.log(
        `    #${String(m.order).padStart(2)} ${m.name.padEnd(14)} ${String(m.bytes).padStart(6)}B  sha1 ${m.sha1.slice(
          0,
          8
        )}  deps=[${m.deps.map(d => d.name).join(',')}]`
      )
    console.log('  每个 addon 的字节数：')
    for (const a of data.rawAddons)
      console.log(`    #${String(a.order).padStart(2)} ${a.name.padEnd(18)} ${String(a.bytes).padStart(6)}B  sha1 ${a.sha1.slice(0, 8)}`)
    console.log('  mime||mode 解析未命中的条目：' + (v.coverage.filter(c => c.nullish).map(c => `${c.display}(${c.spec})`).join(', ') || '无'))
    // 浏览器分支写法：cdnjs 个别文件写 e(window.CodeMirror) 而非 e(CodeMirror)，两者在浏览器里都成立
    const windowStyle = data.modes.concat(data.rawAddons).filter(m => /:\s*\w+\(window\.CodeMirror\)/.test(m.text.slice(0, 400)))
    console.log(
      '  浏览器分支用 window.CodeMirror 的文件：' + (windowStyle.map(m => m.name).join(', ') || '无') + '（其余用裸 CodeMirror；两者在浏览器里都成立）'
    )
  }

  log('[verify] hljs 合并加载 + highlightAuto')
  const hv = runHljsVerification(
    OPT.verifyOnly ? [] : data.hljs ? data.hljs.downloaded.map(d => d.name) : []
  )
  data.hljsVer = hv
  if (hv.missingFromBundle.length) die(`hljs 加载后仍缺语言: ${hv.missingFromBundle.join(', ')}`)
  log(`  listLanguages: ${hv.list.length}（核心 ${hv.before}）`)
  for (const [k, r] of Object.entries(hv.auto)) log(`  highlightAuto(${k}) → ${r.language} (rel ${r.relevance})`)
  if (!hv.auto.javascript || !hv.auto.python) die('highlightAuto 对 JS/Python 样本没给出语言 → 检测通路不通')

  if (!OPT.verifyOnly && !data.dmi) die('dom-to-image 信息缺失')

  /* 9. 阈值 + 缺失检查 */
  const problems = []
  for (const [f, min] of Object.entries(OUT_FILES)) {
    const p = path.join(VENDOR, f)
    if (!fs.existsSync(p)) {
      problems.push(`缺失文件 vendor/${f}`)
      continue
    }
    const s = fs.statSync(p).size
    if (s < min) problems.push(`vendor/${f} 只有 ${s} 字节，低于阈值 ${min}`)
  }
  if (unmet.length) problems.push('依赖未满足: ' + unmet.join('; '))
  // mime||mode → 真实 mode 的解析覆盖：只允许 Auto / Plain Text / 已剔除的自定义 mode 解析不到
  const droppedSpecs = new Set(['auto', 'text', ...Object.keys(CUSTOM_MODE_DROPPED).filter(k => CUSTOM_MODE_DROPPED[k])])
  const unexpectedNullish = data.real.coverage.filter(
    c => c.nullish && !droppedSpecs.has(c.spec.split('/').pop()) && !droppedSpecs.has(c.spec)
  )
  if (unexpectedNullish.length)
    problems.push(
      '这些 LANGUAGES 条目的 mime||mode 解析成了 null mode（没有高亮）: ' +
        unexpectedNullish.map(c => `${c.display}(${c.spec})`).join(', ')
    )
  if (data.unmetNames.length) problems.push('mode 名级依赖未满足: ' + data.unmetNames.join(', '))
  if (data.unknownApis.length) problems.push('假 CM 里被访问但未定义的 API: ' + data.unknownApis.join(', ') + ' —— 请补进 fakeCodeMirror() 或确认无害后在注释里说明')

  /* 10. README */
  if (!OPT.verifyOnly) buildReadme(data)
  flushCacheIndex()

  if (problems.length) {
    console.error('\n[FAIL] vendor 构建校验未通过:')
    for (const p of problems) console.error('  - ' + p)
    process.exit(1)
  }
  console.log('\n[OK] vendor/ 全部产物就位并通过 node 实测校验')
  for (const [f, min] of Object.entries(OUT_FILES)) {
    const b = fs.readFileSync(path.join(VENDOR, f))
    console.log(`  vendor/${f}  ${b.length}B  sha1 ${sha8(b)}  (阈值 ${min})`)
  }
}

function uniqueStrings(a) {
  return [...new Set(a)]
}

try {
  main()
} catch (e) {
  if (!OPT.quiet) console.error('\n' + (e && e.stack ? e.stack : e))
  process.exitCode = 1
  process.exit(1)
}
