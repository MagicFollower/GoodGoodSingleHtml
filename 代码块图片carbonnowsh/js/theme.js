/* js/theme.js — 上游 components/Themes/GlobalHighlights.js 的等价实现
 * 把 29 套 CM5 token 色表注入一个 <style>，选择器与上游一一对应。 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util

  /* 上游 HIGHLIGHT_KEYS + 可选 variable2/variable3/builtin */
  const SELECTORS = [
    ['.cm-string,.cm-string-2', 'string'],
    ['.cm-comment', 'comment'],
    ['.cm-variable', 'variable'],
    ['.cm-variable-2', 'variable2', 'variable'],
    ['.cm-variable-3', 'variable3', 'variable'],
    ['.cm-number', 'number'],
    ['.cm-keyword', 'keyword'],
    ['.cm-property', 'property'],
    ['.cm-def', 'definition'],
    ['.cm-meta', 'meta'],
    ['.cm-operator', 'operator'],
    ['.cm-attribute', 'attribute'],
    ['.cm-tag', 'tag'],
    ['.cm-builtin', 'builtin'],
  ]

  /* 上游还加载了 CM5 官方 theme css（cdnjs）。本工程离线不带那些文件，
   * 因此这里补齐 theme css 才会给的三类派生色：行号/选中/光标。
   * 取值规则：行号 = comment，选中 = text 25% alpha，光标 = text。 */
  function derived(highlights, themeId) {
    const text = highlights.text
    const bg = highlights.background
    const line = highlights.comment || text
    const selRgba = withAlpha(text, 0.25)
    const cursorRules =
      themeId === 'dracula'
        ? `.cm-s-dracula .CodeMirror-cursor{border-left:solid 2px #159588 !important;}`
        : themeId === 'vscode'
        ? `.cm-s-vscode .CodeMirror-cursor{border-left:solid 2px #bebebe !important;}`
        : `.CodeMirror__container .CodeMirror-cursor{border-left:solid 1px ${text} !important;}`

    return [
      `.CodeMirror__container .CodeMirror-linenumber,.CodeMirror__container .CodeMirror-gutters{color:${line};}`,
      `.CodeMirror__container .CodeMirror-gutters{background-color:unset;border-right:none;}`,
      `.CodeMirror__container .CodeMirror-linenumber{background-color:${bg};}`,
      selRgba
        ? `.CodeMirror__container .CodeMirror-selected,.CodeMirror__container .CodeMirror-focused .CodeMirror-selected{background:${selRgba} !important;}`
        : '',
      cursorRules,
    ].join('\n')
  }

  function withAlpha(color, alpha) {
    const c = util.parseColor(color)
    if (!c) return null
    return util.colorToRgbaString({ r: c.r, g: c.g, b: c.b, a: alpha })
  }

  function css(highlights, themeId) {
    const lines = []
    lines.push(
      `.CodeMirror__container .CodeMirror{color:${highlights.text};background-color:${highlights.background};}`
    )
    for (const [selector, key, fallback] of SELECTORS) {
      const value = highlights[key] != null ? highlights[key] : fallback ? highlights[fallback] : undefined
      if (value == null) continue
      lines.push(`.CodeMirror__container ${selector}{color:${value} !important;}`)
    }
    /* 上游 GlobalHighlights 里 dracula / vscode / solarized 的特例，原样保留 */
    lines.push('.cm-s-solarized{box-shadow:none !important;}')
    lines.push('.cm-s-solarized.cm-s-light{text-shadow:#eee8d5 0 1px !important;}')
    lines.push(
      '.cm-s-solarized.cm-s-light .CodeMirror-linenumber,.cm-s-solarized.cm-s-light .CodeMirror-linenumbers{background-color:#fdf6e3 !important;}'
    )
    lines.push(
      '.cm-s-solarized.cm-s-dark .CodeMirror-linenumber,.cm-s-solarized.cm-s-dark .CodeMirror-linenumbers{background-color:#002b36 !important;}'
    )
    lines.push(derived(highlights, themeId))
    return lines.filter(Boolean).join('\n')
  }

  const theme = {
    styleId: 'carbon-theme-style',
    current: null,

    apply() {
      const highlights = CARBON.store.library.effectiveHighlights()
      const themeId = CARBON.store.library.theme() ? CARBON.store.library.theme().id : 'seti'
      const text = css(highlights, themeId)
      if (text === theme.current) return highlights
      theme.current = text
      let node = document.getElementById(theme.styleId)
      if (!node) {
        node = util.el('style', { id: theme.styleId })
        document.head.appendChild(node)
      }
      node.textContent = text
      return highlights
    },
  }

  CARBON.theme = theme
})(typeof window !== 'undefined' ? window : globalThis)
