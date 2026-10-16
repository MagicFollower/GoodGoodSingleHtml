/* js/state.js — 单一状态源 + 上游同名 localStorage 键 + 主题/预设库
 * 上游对应：components/Editor.js 的 state、lib/util.js 的 save/get 系列、EditorContainer.js 的 themes/presets。 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util
  const D = CARBON.DEFAULT_SETTINGS

  const SETTINGS_KEY = 'CARBON_STATE'
  const PRESETS_KEY = 'CARBON_PRESETS'
  const THEMES_KEY = 'CARBON_THEMES'

  /* 上游 saveSettings 排除的字段（dataURL / 大对象 / 不进持久化） */
  const SAVE_OMIT = [
    'code',
    'backgroundImage',
    'backgroundImageSelection',
    'themes',
    'highlights',
    'fontUrl',
    'selectedLines',
    'name',
  ]

  /* 这几个设置项的取值必须带单位，否则下游 calc()/padding 整条声明失效 */
  const PX_KEYS = [
    'paddingVertical',
    'paddingHorizontal',
    'dropShadowOffsetY',
    'dropShadowBlurRadius',
    'fontSize',
  ]

  const store = {
    SETTINGS_KEY,
    PRESETS_KEY,
    THEMES_KEY,
    state: null,
    urlWritable: false,
    _subs: [],
  }

  /* ---------------------------------------------------------------- 读写 */

  function readJson(key) {
    try {
      const raw = g.localStorage.getItem(key)
      if (!raw) return null
      return JSON.parse(raw)
    } catch (e) {
      return null
    }
  }

  function writeJson(key, value) {
    try {
      g.localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch (e) {
      // file:// 下配额可能更紧；背景图 dataURL 是最大嫌疑，剥掉后重试一次
      if (key === SETTINGS_KEY) {
        try {
          const light = {}
          for (const k of Object.keys(value)) if (k !== 'backgroundImage') light[k] = value[k]
          g.localStorage.setItem(key, JSON.stringify(light))
          return true
        } catch (e2) {
          return false
        }
      }
      return false
    }
  }

  const saveSettings = util.debounce(function (state) {
    const out = {}
    for (const k of Object.keys(state)) if (SAVE_OMIT.indexOf(k) < 0) out[k] = state[k]
    writeJson(SETTINGS_KEY, out)
    store.urlWritable = CARBON.url.tryReplaceState(state)
  }, 750, { leading: true, trailing: true })

  /* ---------------------------------------------------------------- 初始化 */

  store.init = function () {
    const base = Object.assign({}, D, {
      code: CARBON.DEFAULT_CODE,
      titleBar: '',
      highlights: null,
      preset: null,
      selectedLines: null,
      backgroundImage: null,
      backgroundImageSelection: null,
      fontUrl: null,
      name: '',
      copy: false,
      readonly: false,
    })

    const saved = readJson(SETTINGS_KEY) || {}
    const { queryState } = CARBON.url.readFromLocation(g.location)

    const state = Object.assign({}, base, sanitize(saved), sanitize(queryState))

    // 上游：'application/json' 这类语言在 URL 里被转义过斜杠，读回来要还原
    if (state.language) state.language = util.unescapeHtml(state.language)
    // 上游：不在 FONTS 白名单里的字体退回默认；这里额外承认「上传字体」(带 fontUrl) 的情形
    const fontIds = CARBON.FONTS.map(f => f.id)
    if (state.fontFamily && fontIds.indexOf(state.fontFamily) < 0 && !saved.fontUrl) {
      state.fontFamily = D.fontFamily
    }
    if (state.fontUrl && typeof state.fontUrl === 'string' && state.fontUrl.indexOf('data:') !== 0) {
      state.fontUrl = null
    }
    if (state.backgroundImage && typeof state.backgroundImage !== 'string') state.backgroundImage = null
    if (state.code == null) state.code = CARBON.DEFAULT_CODE

    store.state = state
    store.urlWritable = CARBON.url.tryReplaceState(state)
    return state
  }

  function sanitize(obj) {
    const out = {}
    if (!obj || typeof obj !== 'object') return out
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (v === undefined) continue
      if (k === 'width' && v !== null && v !== '') {
        const n = Math.round(Number(v))
        if (Number.isFinite(n)) out.width = util.clamp(n, CARBON.DEFAULT_WIDTHS.minWidth, CARBON.DEFAULT_WIDTHS.maxWidth)
        continue
      }
      if (k === 'firstLineNumber') {
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && n >= 0) out.firstLineNumber = n
        continue
      }
      if (PX_KEYS.indexOf(k) >= 0) {
        /* 上游这几个键的 URL 映射是无类型的原样透传，所以 ?pv=40 会拼出 calc(40 + 16px) 这种
         * 非法值、整条声明被浏览器丢掉。手改分享链接是这条链路的正常入口，这里补上单位。 */
        const s = String(v).trim()
        out[k] = /^[-+]?\d*\.?\d+$/.test(s) ? s + 'px' : s
        continue
      }
      out[k] = v
    }
    return out
  }

  /* ---------------------------------------------------------------- 订阅 */

  store.subscribe = function (fn) {
    store._subs.push(fn)
    return () => {
      store._subs = store._subs.filter(f => f !== fn)
    }
  }

  store.set = function (partial) {
    const keys = []
    for (const k of Object.keys(partial)) {
      if (store.state[k] === partial[k]) continue
      store.state[k] = partial[k]
      keys.push(k)
    }
    if (!keys.length) return
    // 上游：改任何 DEFAULT_SETTINGS 里的字段都会取消 preset 选中态
    if (!partial.preset && !partial.code && keys.some(k => k in D) && store.state.preset != null) {
      store.state.preset = null
      keys.push('preset')
    }
    saveSettings(store.state)
    notify(keys)
  }

  store.replace = function (next) {
    const prev = store.state
    store.state = Object.assign({}, prev, next)
    const keys = Object.keys(store.state).filter(k => store.state[k] !== prev[k])
    saveSettings(store.state)
    notify(keys)
  }

  function notify(keys) {
    for (const fn of store._subs.slice()) {
      try {
        fn(store.state, keys)
      } catch (e) {
        console.error('[state] subscriber failed', e)
      }
    }
  }

  store.touch = function () {
    saveSettings(store.state)
  }

  store.resetSettings = function () {
    try {
      g.localStorage.removeItem(SETTINGS_KEY)
    } catch (e) {
      /* ignore */
    }
    store.replace(Object.assign({}, D, { preset: null, highlights: null, backgroundImage: null, backgroundImageSelection: null }))
  }

  /* ---------------------------------------------------------------- 主题库 */

  const builtinThemes = CARBON.THEMES
  const library = {
    themes: builtinThemes.slice(),
    customThemes: readJson(THEMES_KEY) || [],
    presets: CARBON.DEFAULT_PRESETS.slice(),
    customPresets: readJson(PRESETS_KEY) || [],
    themeById: {},
  }

  function rebuildThemeIndex() {
    library.themes = library.customThemes.concat(builtinThemes)
    library.themeById = util.hashBy(library.themes, 'id')
  }

  function rebuildPresetList() {
    library.presets = library.customPresets.concat(CARBON.DEFAULT_PRESETS)
  }

  rebuildThemeIndex()
  rebuildPresetList()

  library.theme = () => library.themeById[store.state.theme] || library.themeById.seti
  library.effectiveHighlights = function () {
    const t = library.theme()
    return Object.assign({}, t ? t.highlights : {}, store.state.highlights || {})
  }

  library.createTheme = function (name, highlights) {
    const theme = {
      id: 'theme:' + util.generateId(),
      name: name || 'Custom Theme',
      highlights: Object.assign({}, highlights),
      custom: true,
    }
    library.customThemes = [theme].concat(library.customThemes)
    writeJson(THEMES_KEY, library.customThemes)
    rebuildThemeIndex()
    store.set({ theme: theme.id, highlights: null })
    return theme
  }

  library.removeTheme = function (id) {
    library.customThemes = library.customThemes.filter(t => t.id !== id)
    writeJson(THEMES_KEY, library.customThemes)
    rebuildThemeIndex()
    if (store.state.theme === id) store.set({ theme: 'seti', highlights: null })
    notify(['theme'])
  }

  library.customThemeCount = function () {
    return library.customThemes.length
  }

  library.createPreset = function (settings) {
    const preset = Object.assign({}, settings)
    preset.id = 'preset:' + util.generateId()
    preset.custom = true
    delete preset.code
    delete preset.titleBar
    delete preset.highlights
    delete preset.preset
    delete preset.backgroundImage
    library.customPresets = [preset].concat(library.customPresets)
    writeJson(PRESETS_KEY, library.customPresets)
    rebuildPresetList()
    return preset
  }

  library.removePreset = function (id) {
    library.customPresets = library.customPresets.filter(p => p.id !== id)
    writeJson(PRESETS_KEY, library.customPresets)
    rebuildPresetList()
    if (store.state.preset === id) store.set({ preset: null })
    notify(['preset'])
  }

  library.applyPreset = function (preset) {
    const { id: presetId, ...settings } = preset
    store.replace(Object.assign({ preset: presetId || null }, settings))
  }

  store.library = library
  CARBON.store = store
})(typeof window !== 'undefined' ? window : globalThis)
