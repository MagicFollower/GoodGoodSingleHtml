/* js/invisibles.js — 隐形字符显示（上游用 npm 包 cm-show-invisibles，本工程自绘等价物）
 * 用 markText + replacedWith 把空格/制表/行尾渲染成可见符号；关闭时精确清除自己打下的标记。 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})

  const MARK_ATTR = 'data-carbon-invisible'

  /* 自己记账：CM5 的 TextMarker 不暴露 replacedWith 节点，靠 getAllMarks 反查节点属性清不掉 */
  const registry = new WeakMap()

  function makeSymbol(text, extraClass, title) {
    const span = document.createElement('span')
    span.className = 'cm-invisible' + (extraClass ? ' ' + extraClass : '')
    span.setAttribute(MARK_ATTR, '1')
    span.title = title
    span.textContent = text
    return span
  }

  function clear(editor) {
    const marks = registry.get(editor)
    if (!marks || !marks.length) return
    registry.set(editor, [])
    editor.operation(() => marks.forEach(m => m.clear()))
  }

  function refresh(editor, enabled) {
    if (!editor) return
    clear(editor)
    if (!enabled) return
    const marks = []
    editor.operation(() => {
      const lineCount = editor.lineCount()
      for (let line = 0; line < lineCount; line++) {
        const text = editor.getLine(line)
        for (let ch = 0; ch < text.length; ch++) {
          const c = text[ch]
          if (c !== ' ' && c !== '\t') continue
          const from = { line, ch }
          const to = { line, ch: ch + 1 }
          const node =
            c === ' '
              ? makeSymbol('·', 'cm-space', 'space')
              : makeSymbol('→', 'cm-tab', 'tab')
          marks.push(editor.markText(from, to, { replacedWith: node, clearOnEnter: true }))
        }
        /* 行尾 ¬ 必须走 setBookmark：markText 的 from==to 会被 CM5 直接丢弃（实测 getAllMarks 为 0），
         * 而跨行界 markText 虽然也画得出来，但会把 \n 折进 widget、影响光标与下一行的制表位。 */
        if (text.length) {
          marks.push(
            editor.setBookmark({ line, ch: text.length }, {
              widget: makeSymbol('¬', 'cm-newline', 'newline'),
              insertLeft: true,
            })
          )
        }
      }
    })
    registry.set(editor, marks)
  }

  CARBON.invisibles = { refresh, clear, MARK_ATTR }
})(typeof window !== 'undefined' ? window : globalThis)
