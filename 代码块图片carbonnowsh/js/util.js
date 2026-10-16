/* js/util.js — 通用小工具（classic script，挂 window.CARBON.util） */
;(function (g) {
  'use strict'
  g.CARBON = g.CARBON || {}

  const util = {}

  util.clamp = (v, min, max) => (v < min ? min : v > max ? max : v)

  util.debounce = function (fn, wait, opts) {
    let timer = null
    let lastArgs = null
    const leading = !!(opts && opts.leading)
    const trailing = !(opts && opts.trailing === false)
    const wrapped = function () {
      lastArgs = arguments
      const self = this
      if (leading && timer === null) {
        fn.apply(self, lastArgs)
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(function () {
        timer = null
        if (trailing && lastArgs) fn.apply(self, lastArgs)
      }, wait)
    }
    wrapped.cancel = function () {
      if (timer) clearTimeout(timer)
      timer = null
    }
    return wrapped
  }

  /* 上游 lib/util.js escapeHtml 也转义斜杠；unescapeHtml 走 escape-goat，这里手写等价子集 */
  util.escapeHtml = function (s) {
    if (typeof s !== 'string') return s
    return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\//g, '&#x2F;')
  }

  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  util.unescapeHtml = function (s) {
    if (typeof s !== 'string') return s
    return s
      .replace(/&#x2F;/g, '/')
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] || m)
  }

  /* 上游 tohash(arr, key) 的等价物：按某个字段建索引；无该字段的条目跳过 */
  util.hashBy = function (arr, key) {
    const out = {}
    if (!Array.isArray(arr)) return out
    for (const item of arr) {
      if (item && key in item && item[key] != null) out[item[key]] = item
    }
    return out
  }

  util.generateId = () => Math.random().toString(36).slice(2)

  util.fileToDataURL = blob =>
    new Promise(res => {
      const r = new FileReader()
      r.onload = e => res(e.target.result)
      r.readAsDataURL(blob)
    })

  util.fileToText = blob =>
    new Promise(res => {
      const r = new FileReader()
      r.onload = e => res(e.target.result)
      r.readAsText(blob)
    })

  util.fileToJSON = blob =>
    util.fileToText(blob).then(t => {
      try {
        return JSON.parse(t)
      } catch (e) {
        return null
      }
    })

  /* ------- 颜色：上游用 react-color 的 {r,g,b,a} 对象 + stringifyColor(rgba(...)) ------- */

  util.parseColor = function (input) {
    if (input == null) return null
    if (typeof input === 'object') {
      const a = input.a == null ? 1 : Number(input.a)
      return { r: Number(input.r) || 0, g: Number(input.g) || 0, b: Number(input.b) || 0, a: a }
    }
    const s = String(input).trim().toLowerCase()
    let m = /^#([0-9a-f]{3})$/.exec(s)
    if (m) {
      const h = m[1]
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: 1,
      }
    }
    m = /^#([0-9a-f]{6})$/.exec(s)
    if (m) {
      const h = m[1]
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
    }
    m = /^rgba?\(([^)]*)\)$/.exec(s)
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(x => x !== '')
      const num = parts.map(p => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)))
      return {
        r: clampByte(num[0]),
        g: clampByte(num[1]),
        b: clampByte(num[2]),
        a: parts.length > 3 ? clamp01(parseFloat(parts[3])) : 1,
      }
    }
    const named = util.NAMED_COLORS[s]
    return named ? util.parseColor(named) : null
  }

  const clampByte = v => Math.round(util.clamp(Number(v) || 0, 0, 255))
  const clamp01 = v => util.clamp(Number.isFinite(v) ? v : 1, 0, 1)

  util.stringifyColor = obj => `rgba(${obj.rgb ? obj.rgb.r : obj.r},${obj.rgb ? obj.rgb.g : obj.g},${obj.rgb ? obj.rgb.b : obj.b},${obj.rgb ? obj.rgb.a : obj.a})`

  util.colorToRgbaString = c => `rgba(${clampByte(c.r)},${clampByte(c.g)},${clampByte(c.b)},${round4(util.clamp(c.a, 0, 1))})`

  util.colorToHex = c =>
    '#' +
    [c.r, c.g, c.b]
      .map(v => clampByte(v).toString(16).padStart(2, '0'))
      .join('')

  const round4 = v => Math.round(v * 10000) / 10000

  util.NAMED_COLORS = {
    white: '#ffffff',
    black: '#000000',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    transparent: 'rgba(0,0,0,0)',
  }

  /* ------- hsv <-> rgb（自绘取色器需要，替代 react-color 内部的 color 库） ------- */
  util.rgbToHsv = function (c) {
    const r = c.r / 255,
      gg = c.g / 255,
      b = c.b / 255
    const max = Math.max(r, gg, b),
      min = Math.min(r, gg, b)
    const d = max - min
    let h = 0
    if (d !== 0) {
      if (max === r) h = ((gg - b) / d) % 6
      else if (max === gg) h = (b - r) / d + 2
      else h = (r - gg) / d + 4
      h *= 60
      if (h < 0) h += 360
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max }
  }

  util.hsvToRgb = function (hsv) {
    const h = ((hsv.h % 360) + 360) % 360,
      s = util.clamp(hsv.s, 0, 1),
      v = util.clamp(hsv.v, 0, 1)
    const c = v * s,
      x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
      m = v - c
    let r = 0,
      g2 = 0,
      b = 0
    if (h < 60) [r, g2, b] = [c, x, 0]
    else if (h < 120) [r, g2, b] = [x, c, 0]
    else if (h < 180) [r, g2, b] = [0, c, x]
    else if (h < 240) [r, g2, b] = [0, x, c]
    else if (h < 300) [r, g2, b] = [x, 0, c]
    else [r, g2, b] = [c, 0, x]
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g2 + m) * 255),
      b: Math.round((b + m) * 255),
    }
  }

  /* ------- 极简 hyperscript ------- */
  util.el = function (tag, attrs, children) {
    const ns = tag === 'svg' || String(tag).indexOf('svg:') === 0 ? 'http://www.w3.org/2000/svg' : null
    const node = ns ? document.createElementNS(ns, String(tag).replace('svg:', '')) : document.createElement(tag)
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k]
        if (v == null || v === false) continue
        if (k === 'class') node.setAttribute('class', v)
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v)
        else if (k === 'html') node.innerHTML = v
        else if (k === 'text') node.textContent = v
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
        else if (k === 'dataset') Object.assign(node.dataset, v)
        else node.setAttribute(k, v === true ? '' : v)
      }
    }
    if (children != null) append(node, children)
    return node
  }

  function append(node, children) {
    const list = Array.isArray(children) ? children : [children]
    for (const c of list) {
      if (c == null || c === false) continue
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c)
    }
  }

  util.slot = name => document.querySelector(`[data-slot="${name}"]`)
  util.byId = id => document.getElementById(id)

  util.on = (node, type, fn, opts) => {
    node.addEventListener(type, fn, opts)
    return () => node.removeEventListener(type, fn, opts)
  }

  /* 键盘组合：上游 actionsack 用 '⌘-⇧-e' 这种写法；本地按 Ctrl/Cmd 自适应 */
  util.matchesShortcut = function (spec, e) {
    const parts = spec.toLowerCase().split('-').filter(Boolean)
    const key = parts[parts.length - 1]
    const needCmd = parts.indexOf('⌘') >= 0 || parts.indexOf('cmd') >= 0 || parts.indexOf('ctrl') >= 0
    const needShift = parts.indexOf('⇧') >= 0 || parts.indexOf('shift') >= 0
    const needAlt = parts.indexOf('⌥') >= 0 || parts.indexOf('alt') >= 0
    const meta = e.ctrlKey || e.metaKey
    const gotKey = (e.key || '').toLowerCase()
    const sameKey = gotKey === key || (key === '\\' && gotKey === '\\') || gotKey === key.replace('enter', 'enter')
    return (!needCmd || meta) && (!needShift || e.shiftKey) && (!needAlt || e.altKey) && sameKey
  }

  util.isMac = () => /Mac|iPhone|iPad/i.test(g.navigator ? g.navigator.platform : '')

  g.CARBON.util = util
})(typeof window !== 'undefined' ? window : globalThis)
