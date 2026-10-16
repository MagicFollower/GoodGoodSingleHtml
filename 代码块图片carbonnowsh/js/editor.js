/* js/editor.js — CodeMirror 5.65.5 接线（options 与上游 components/Carbon.js 一致）
 * 含：语言解析（mime||mode）、auto 检测（hljs，300ms debounce）、行号点击淡化、隐形字符。 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util

  let cm = null
  let applyingFromState = false
  let prevGutterLine = null
  let lastResolvedMode = null
  let lastDetectedCode = null

  const NAME_HASH = util.hashBy(CARBON.LANGUAGES, 'short')
  const MODE_HASH = util.hashBy(CARBON.LANGUAGES, 'mode')
  const MIME_HASH = util.hashBy(CARBON.LANGUAGES, 'mime')

  function searchLanguage(v) {
    if (!v) return undefined
    return NAME_HASH[v] || MODE_HASH[v] || MIME_HASH[v]
  }

  function detect(code) {
    try {
      const r = hljs.highlightAuto(String(code || ''))
      const lang = r && r.language
      const found = searchLanguage(lang)
      return found ? found.mime || found.mode : null
    } catch (e) {
      return null
    }
  }

  function resolveMode(language, code) {
    const l = String(language || 'auto').toLowerCase()
    if (l === 'auto' || !l) {
      return detect(code) || 'plaintext'
    }
    const found = searchLanguage(l)
    return found ? found.mime || found.mode : l
  }

  /* 检测必须读「当下」的 state：把 code/language 作为 debounce 的闭包参数传进去，
   * 尾部那次延迟调用会拿旧代码把用户刚显式选好的语言又盖回去。 */
  const runDetect = util.debounce(function () {
    const s = CARBON.store.state
    if (String(s.language || 'auto').toLowerCase() !== 'auto') return
    const mode = resolveMode('auto', s.code)
    if (!mode || mode === lastResolvedMode) return
    lastResolvedMode = mode
    lastDetectedCode = s.code
    if (cm) cm.setOption('mode', mode)
  }, 300, { leading: true, trailing: true })

  /* 上游只把 LANGUAGES 里 highlight:true 的语言注册进 hljs（57 个）；
   * 这里用完整 core（36）+ 扩展（34）= 70，多出来的候选会改变 highlightAuto 的排名，
   * 所以启动时按同一份白名单退订，保证检测结果与线上同构。 */
  function restrictHljs() {
    if (typeof hljs === 'undefined') return null
    const allowed = new Set(
      CARBON.LANGUAGES.filter(l => l.highlight).map(l => l.short || l.mode)
    )
    const removed = hljs.listLanguages().filter(n => !allowed.has(n))
    removed.forEach(n => {
      try {
        hljs.unregisterLanguage(n)
      } catch (e) {
        /* ignore */
      }
    })
    return { allowed: allowed.size, registered: hljs.listLanguages().length, removed }
  }

  const editor = {
    get cm() {
      return cm
    },

    mount(host) {
      if (cm) return cm
      editor.detection = restrictHljs()
      const s = CARBON.store.state
      lastResolvedMode = resolveMode(s.language, s.code)
      cm = g.CodeMirror(host, {
        value: s.code,
        screenReaderLabel: '代码编辑器',
        lineNumbers: s.lineNumbers,
        firstLineNumber: s.firstLineNumber,
        mode: lastResolvedMode,
        theme: s.theme,
        scrollbarStyle: null,
        viewportMargin: Infinity,
        lineWrapping: true,
        smartIndent: true,
        extraKeys: { 'Shift-Tab': 'indentLess' },
        readOnly: !!s.readonly,
        showInvisibles: !!s.hiddenCharacters,
        autoCloseBrackets: true,
        indentUnit: 2,
        tabSize: 2,
      })

      cm.on('change', (instance, changeObj) => {
        applyDim(instance)
        if (CARBON.store.state.hiddenCharacters) CARBON.invisibles.refresh(instance, true)
        if (changeObj.origin === 'setValue') return
        const code = instance.getValue()
        if (code !== CARBON.store.state.code) CARBON.store.set({ code })
        if (String(CARBON.store.state.language || 'auto').toLowerCase() === 'auto') runDetect()
      })

      cm.on('viewportChange', instance => applyDim(instance))
      cm.on('refresh', instance => applyDim(instance))
      /* 'update' 是 CM 在 display.view 重建完成之后发的：selectedLines 属于 LAYOUT 键会触发
       * cm.refresh()，重建把好几种内联 opacity 冲掉，只有这个时点补才留得住 */
      cm.on('update', instance => applyDim(instance))
      cm.on('gutterClick', (instance, line, gutter, event) => {
        if (String(gutter) !== 'CodeMirror-linenumbers') return
        const num = line + 1
        const current = (CARBON.store.state.selectedLines || []).slice()
        const at = current.indexOf(num)
        if (event && event.shiftKey && prevGutterLine != null) {
          const lo = Math.min(prevGutterLine, num)
          const hi = Math.max(prevGutterLine, num)
          const keep = at < 0
          for (let i = lo; i <= hi; i++) {
            const idx = current.indexOf(i)
            if (keep && idx < 0) current.push(i)
            if (!keep && idx >= 0) current.splice(idx, 1)
          }
        } else {
          if (at < 0) current.push(num)
          else current.splice(at, 1)
        }
        prevGutterLine = num
        CARBON.store.set({ selectedLines: current.sort((a, b) => a - b) })
      })

      CARBON.invisibles.refresh(cm, s.hiddenCharacters)
      runDetect()
      return cm
    },

    /* state → CM options（只 setOption 真正变了的，避免整棵重排）
     * 只有影响测量的键才 cm.refresh()：打字时每键都 refresh 会明显掉帧 */
    sync(s, keys) {
      if (!cm) return
      const set = (k, v) => {
        if (cm.getOption(k) !== v) cm.setOption(k, v)
      }
      set('lineNumbers', !!s.lineNumbers)
      if (s.firstLineNumber != null) set('firstLineNumber', Number(s.firstLineNumber) || 1)
      set('readOnly', !!s.readonly)
      set('theme', String(s.theme))
      if (s.code !== cm.getValue()) cm.setValue(s.code == null ? '' : s.code)
      /* auto 时绝不在这里同步跑 highlightAuto：那等于每次按键全量重扫，
       * 交给 300ms debounce 的 runDetect；显式语言则直接解析 mode。 */
      if (String(s.language || 'auto').toLowerCase() === 'auto') {
        if (s.code !== lastDetectedCode) runDetect()
      } else {
        const mode = resolveMode(s.language, s.code)
        if (mode !== lastResolvedMode) {
          lastResolvedMode = mode
          cm.setOption('mode', mode)
        }
      }
      if (s.hiddenCharacters) CARBON.invisibles.refresh(cm, true)
      else CARBON.invisibles.clear(cm)
      applyDim(cm)
      const LAYOUT = [
        'lineNumbers',
        'firstLineNumber',
        'fontFamily',
        'fontSize',
        'lineHeight',
        'theme',
        'windowControls',
        'windowTheme',
        'paddingHorizontal',
        'paddingVertical',
        'hiddenCharacters',
        'selectedLines',
        'width',
        'widthAdjustment',
        'code',
        'language',
        'readonly',
      ]
      if (!keys || keys.some(k => LAYOUT.indexOf(k) >= 0)) cm.refresh()
    },

    getCode() {
      return cm ? cm.getValue() : CARBON.store.state.code
    },

    focus() {
      if (cm) cm.focus()
    },
  }

  /* 选中行高亮：非选中行 opacity .5（上游直接改 display.view 的 text/gutter 样式）
   * 上游按 view 下标 i 判定，滚动后下标会漂移；这里按文档行号判定，等价但更稳。 */
  let dimApplied = false
  function applyDim(instance) {
    if (!instance) return
    const selected = (CARBON.store.state.selectedLines || []).map(n => n - 1)
    if (!selected.length) {
      if (!dimApplied) return
      dimApplied = false
      for (const view of instance.display.view) {
        if (view.text) view.text.style.opacity = ''
        if (view.gutter) view.gutter.style.opacity = ''
      }
      return
    }
    dimApplied = true
    const set = new Set(selected)
    for (const view of instance.display.view) {
      if (!view) continue
      const n = view.line ? view.line.lineNo() : -1
      const on = set.has(n)
      if (view.text) view.text.style.opacity = on ? '1' : '0.5'
      if (view.gutter) view.gutter.style.opacity = on ? '1' : '0.5'
    }
  }

  CARBON.editor = editor
})(typeof window !== 'undefined' ? window : globalThis)
