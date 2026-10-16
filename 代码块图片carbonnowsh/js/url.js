/* js/url.js — 与上游 lib/routing.js 同构的参数映射（morphmorph 缩写键）
 * 目标：carbon.now.sh 生成的分享链接在本页能原样解析回来（含 ?state=base64(JSON) 通路）。 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util

  const URL_LIMIT = 4e3

  const types = {
    bool: v => {
      if (v == null) return undefined
      if (v === 'false') return false
      return Boolean(v)
    },
    int: v => {
      const integer = parseInt(v, 10)
      return isNaN(integer) ? undefined : integer
    },
    intArray: v => {
      if (v == null) return undefined
      return String(v)
        .split(',')
        .filter(i => !isNaN(i) && String(i).trim() !== '')
        .map(i => parseInt(i, 10))
    },
    parse: v => {
      try {
        return JSON.parse(v)
      } catch (e) {
        return v
      }
    },
    decode: v => {
      if (v == null) return undefined
      try {
        return decodeURIComponent(v)
      } catch (e) {
        return v
      }
    },
    encode: v => {
      if (v == null) return undefined
      try {
        const encoded = encodeURIComponent(v)
        // 软上限：超长链接直接截半，避免浏览器/服务器 URL 长度报错（上游 issue #829）
        if (encoded.length > URL_LIMIT) return encodeURIComponent(String(v).slice(0, URL_LIMIT / 2))
        return encoded
      } catch (e) {
        return v
      }
    },
    identity: v => v,
  }

  /* 上游 readMappings 原表；type 省略时 = 字符串 */
  const readMappings = [
    { field: 'bg:backgroundColor' },
    { field: 't:theme' },
    { field: 'wt:windowTheme' },
    { field: 'l:language' },
    { field: 'width' },
    { field: 'ds:dropShadow', type: 'bool' },
    { field: 'dsyoff:dropShadowOffsetY' },
    { field: 'dsblur:dropShadowBlurRadius' },
    { field: 'wc:windowControls', type: 'bool' },
    { field: 'wa:widthAdjustment', type: 'bool' },
    { field: 'pv:paddingVertical' },
    { field: 'ph:paddingHorizontal' },
    { field: 'ln:lineNumbers', type: 'bool' },
    { field: 'fl:firstLineNumber', type: 'int' },
    { field: 'fm:fontFamily' },
    { field: 'fs:fontSize' },
    { field: 'lh:lineHeight' },
    { field: 'si:squaredImage', type: 'bool' },
    { field: 'es:exportSize' },
    { field: 'wm:watermark', type: 'bool' },
    { field: 'sl:selectedLines', type: 'intArray' },
    { field: 'copy', type: 'bool' },
    { field: 'readonly', type: 'bool' },
    { field: 'id' },
    { field: 'highlights', type: 'parse' },
    { field: 'code', type: 'decode' },
    { field: 'tb:titleBar', type: 'decode' },
  ]

  const writeMappings = [
    { field: 'backgroundColor:bg' },
    { field: 'theme:t' },
    { field: 'windowTheme:wt' },
    { field: 'language:l' },
    { field: 'width' },
    { field: 'dropShadow:ds', type: 'bool' },
    { field: 'dropShadowOffsetY:dsyoff' },
    { field: 'dropShadowBlurRadius:dsblur' },
    { field: 'windowControls:wc', type: 'bool' },
    { field: 'widthAdjustment:wa', type: 'bool' },
    { field: 'paddingVertical:pv' },
    { field: 'paddingHorizontal:ph' },
    { field: 'lineNumbers:ln', type: 'bool' },
    { field: 'firstLineNumber:fl', type: 'int' },
    { field: 'fontFamily:fm' },
    { field: 'fontSize:fs' },
    { field: 'lineHeight:lh' },
    { field: 'squaredImage:si', type: 'bool' },
    { field: 'exportSize:es' },
    { field: 'watermark:wm', type: 'bool' },
    { field: 'code', type: 'encode' },
    { field: 'titleBar:tb', type: 'encode' },
  ]

  function split(field) {
    const parts = field.split(':')
    const a = parts[0]
    const b = parts.length > 1 ? parts.slice(1).join(':') : a
    return { key: a, path: b }
  }

  function mapRead(query) {
    const out = {}
    for (const m of readMappings) {
      const { key, path } = split(m.field)
      if (!(key in query)) continue
      const raw = query[key]
      const value = (types[m.type] || types.identity)(raw)
      if (value === undefined) continue
      if (value === '') continue
      out[path] = value
    }
    return out
  }

  /* morphmorph 的 field 语义在读写两个方向是同一套：'a:b' 里 a 永远是**源**键、b 是**目标**路径。
   * readMappings 写成 'bg:backgroundColor'（query 的 bg → state 的 backgroundColor），
   * writeMappings 写成 'backgroundColor:bg'（state 的 backgroundColor → query 的 bg）。 */
  function mapWrite(state) {
    const out = {}
    for (const m of writeMappings) {
      const { key, path } = split(m.field)
      const raw = state[key]
      if (raw === undefined || raw === null) continue
      let value = raw
      switch (m.type) {
        case 'bool':
          value = types.bool(value)
          value = value === false ? 'false' : 'true'
          break
        case 'int':
          value = String(Math.round(Number(value) || 0))
          break
        case 'intArray':
          value = Array.isArray(value) ? value.join(',') : String(value)
          break
        case 'parse':
          value = typeof value === 'string' ? value : JSON.stringify(value)
          break
        case 'encode':
          value = types.encode(value)
          break
        default:
          value = String(value)
      }
      out[path] = value
    }
    return out
  }

  /* location.search → 参数表：这里只解一次码（与 qs 行为一致），
   * code/tb 的 type:'decode' 会再解一次 —— 与上游「写两次、读两次」严格对称。 */
  function parseSearch(search) {
    const out = {}
    const s = String(search || '').replace(/^[?#&]/, '')
    if (!s) return out
    for (const pair of s.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const k = eq < 0 ? pair : pair.slice(0, eq)
      const v = eq < 0 ? '' : pair.slice(eq + 1)
      let decodedKey = k
      try {
        decodedKey = decodeURIComponent(k)
      } catch (e) {
        /* 保留原样 */
      }
      let decodedValue = v
      try {
        decodedValue = decodeURIComponent(v.replace(/\+/g, ' '))
      } catch (e) {
        decodedValue = v
      }
      if (!(decodedKey in out)) out[decodedKey] = decodedValue
    }
    return out
  }

  function toQueryString(obj) {
    return Object.keys(obj)
      .filter(k => obj[k] !== undefined && obj[k] !== null)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
      .join('&')
  }

  CARBON.serializeState = function (state) {
    const stateString = encodeURIComponent(JSON.stringify(state))
    return encodeURIComponent(g.btoa(ucBase64(stateString)))
  }

  CARBON.deserializeState = function (serialized) {
    const stateString = atobSafe(String(serialized))
    return JSON.parse(decodeURIComponent(stateString))
  }

  /* btoa 不吃 >0xFF 的字符：先按 UTF-8 展开（encodeURIComponent 的结果再逐字符转义） */
  function ucBase64(str) {
    let out = ''
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code > 0xff) {
        const c = str.codePointAt(i)
        const bytes = new TextEncoder().encode(String.fromCodePoint(c))
        for (const b of bytes) out += String.fromCharCode(b)
        if (code > 0xffff) i++
      } else out += str[i]
    }
    return out
  }

  function atobSafe(b64) {
    const bin = g.atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }

  const url = {
    URL_LIMIT,
    readMappings,
    writeMappings,
    mapRead,
    mapWrite,
    parseSearch,
    toQueryString,

    /* 当前页面 URL 上的状态（file:// 也能读 location.search） */
    readFromLocation(loc) {
      const query = parseSearch(loc.search)
      if (query.state != null) {
        try {
          return { queryState: CARBON.deserializeState(query.state), parameter: null }
        } catch (e) {
          /* 落回普通参数解析 */
        }
      }
      const state = mapRead(query)
      // 上游把空串统一当 undefined 处理
      for (const k of Object.keys(state)) if (state[k] === '') delete state[k]
      const pathName = decodeURIComponent(String(loc.pathname || '').replace(/\/$/, '').split('/').pop() || '')
      const parameter = pathName.length >= 19 && pathName.indexOf('.') < 0 ? pathName : null
      return { queryState: state, parameter }
    },

    /* 分享链接：file:// 下 history.replaceState 常被浏览器拒绝，所以主路径是「生成字符串给你复制」 */
    buildShareUrl(state) {
      const qs = toQueryString(mapWrite(publicShareState(state)))
      const base = g.location.href.split('?')[0].split('#')[0]
      return qs ? base + '?' + qs : base
    },

    tryReplaceState(state) {
      const qs = toQueryString(mapWrite(publicShareState(state)))
      const target = g.location.pathname + (qs ? '?' + qs : '')
      try {
        g.history.replaceState({ t: Date.now() }, '', target)
        return true
      } catch (e) {
        return false
      }
    },
  }

  function publicShareState(state) {
    // 上游 writeMappings 不含 backgroundImage/fontUrl：dataURL 不进 URL
    const out = {}
    for (const k of Object.keys(state)) {
      if (k === 'backgroundImage' || k === 'backgroundImageSelection' || k === 'fontUrl') continue
      out[k] = state[k]
    }
    return out
  }

  CARBON.url = url
})(typeof window !== 'undefined' ? window : globalThis)
