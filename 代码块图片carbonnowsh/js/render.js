/* js/render.js — 画布（导出节点）几何与外观，数值逐条对齐上游 components/Carbon.js 的 styled-jsx 段 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util

  let nodes = null
  let dragging = null

  function collect() {
    return {
      exportContainer: util.byId('export-container'),
      container: util.byId('canvas-container'),
      windowControls: util.byId('window-controls'),
      editorHost: util.byId('editor-host'),
      watermark: util.byId('watermark-host'),
      bg: util.byId('canvas-bg'),
      handler: util.byId('width-handler'),
    }
  }

  function setTitleBar(input, value) {
    if (!input) return
    if (g.document.activeElement !== input) input.value = value || ''
  }

  function buildWindowControls(s, light) {
    const wc = nodes.windowControls
    wc.hidden = !s.windowControls
    wc.className = 'window-controls theme-' + s.windowTheme + (light ? ' is-light' : '')
    const svg = CARBON.SVG.controls[s.windowTheme] || CARBON.SVG.controls.none
    let wrap = wc.querySelector('.title-bar-wrap')
    if (wc.dataset.theme !== s.windowTheme || !wc.querySelector('.controls-svg')) {
      wc.innerHTML = '<span class="controls-svg">' + svg + '</span>'
      wrap = util.el('div', { class: 'title-bar-wrap' })
      const input = util.el('input', {
        class: 'title-bar',
        type: 'text',
        spellcheck: 'false',
        'aria-label': '图片标题',
        oninput: e => CARBON.store.set({ titleBar: e.target.value }),
        placeholder: '',
      })
      wrap.appendChild(input)
      wc.appendChild(wrap)
      wc.dataset.theme = s.windowTheme
    }
    setTitleBar(wc.querySelector('.title-bar'), s.titleBar)
    // 拖拽手柄位置：bw 主题上游 top 36 / margin-left 16，其余 34 / 14
    wc.style.top = s.windowTheme === 'bw' ? '36px' : '34px'
    wc.style.marginLeft = s.windowTheme === 'bw' ? '16px' : '14px'
  }

  function applyWatermark(s, light) {
    const host = nodes.watermark
    host.hidden = !s.watermark
    if (!s.watermark) {
      host.innerHTML = ''
      return
    }
    const want = light ? 'light' : 'dark'
    if (host.dataset.variant !== want) {
      host.innerHTML = CARBON.SVG.watermark[want]
      host.dataset.variant = want
    }
    host.style.bottom = 'calc(' + s.paddingVertical + ' + 16px)'
    host.style.right = 'calc(' + s.paddingHorizontal + ' + 16px)'
  }

  const render = {
    init() {
      nodes = collect()
      installWidthDrag(nodes)
      return nodes
    },

    apply(s, keys) {
      if (!nodes) nodes = collect()
      CARBON.theme.apply()
      const theme = CARBON.store.library.theme()
      const light = !!(theme && theme.light)

      /* .container：padding + 宽度模式（上游 min-width 90 / max-width 1024 只在 auto-adjust 时给） */
      const c = nodes.container.style
      c.padding = s.paddingVertical + ' ' + s.paddingHorizontal
      if (s.widthAdjustment) {
        c.minWidth = '90px'
        c.maxWidth = '1024px'
        c.width = ''
      } else {
        c.minWidth = ''
        c.maxWidth = ''
        c.width = Math.round(s.width) + 'px'
      }

      /* 背景层：颜色 or 图片（图片只有本地上传这一条路，上游的 Unsplash/裁剪已移除） */
      const bg = nodes.bg
      const image = s.backgroundImage && s.backgroundImageSelection ? s.backgroundImageSelection : s.backgroundImage
      if (s.backgroundMode === 'image' && image) {
        bg.style.backgroundImage = 'url("' + image + '")'
        bg.style.backgroundColor = 'transparent'
        bg.style.backgroundSize = 'cover'
        bg.style.backgroundRepeat = 'no-repeat'
        bg.classList.add('is-image')
      } else {
        const color = s.backgroundColor || CARBON.DEFAULT_BG_COLOR
        bg.style.backgroundImage = 'none'
        bg.style.background = color
        bg.style.backgroundSize = 'auto'
        bg.style.backgroundRepeat = 'repeat'
        bg.classList.remove('is-image')
      }

      buildWindowControls(s, light)
      applyWatermark(s, light)

      /* 编辑器外观：字号/行高/字体族 —— 上游写在 CSS 里，这里等价地写内联 */
      const host = nodes.editorHost
      host.className = 'CodeMirror__container window-theme__' + s.windowTheme
      const cmEl = host.querySelector('.CodeMirror')
      const family = s.fontUrl
        ? '"' + s.fontFamily + '", monospace'
        : CARBON.FONT_FALLBACKS[s.fontFamily] || s.fontFamily + ', monospace'
      const target = cmEl || host
      target.style.fontFamily = family
      target.style.fontSize = s.fontSize
      target.style.lineHeight = s.lineHeight

      /* 阴影：上游固定 rgba(0,0,0,.55)，只有 offsetY / blurRadius 可调，无 spread */
      host.style.boxShadow = s.dropShadow
        ? '0 ' + s.dropShadowOffsetY + ' ' + s.dropShadowBlurRadius + ' rgba(0, 0, 0, 0.55)'
        : 'none'

      /* 拖宽把手：上游始终渲染（靠 opacity:0 隐藏，hover 才 0.4），位置 = padding 内侧 */
      nodes.handler.hidden = false
      const h = nodes.handler.style
      h.top = s.paddingVertical
      h.bottom = s.paddingVertical
      h.right = s.paddingHorizontal

      CARBON.editor.sync(s, keys)
    },
  }

  /* 拖拽改宽：公式与上游一致（含 devicePixelRatio 放大，DPI≠100% 时手感会偏快，属上游行为） */
  function installWidthDrag(n) {
    const { minWidth, maxWidth } = CARBON.DEFAULT_WIDTHS
    n.handler.addEventListener('mousedown', e => {
      dragging = {
        startX: e.pageX,
        startWidth: n.exportContainer.clientWidth,
      }
      e.preventDefault()
    })
    g.document.addEventListener('mousemove', e => {
      if (!dragging) return
      const delta = e.pageX - dragging.startX
      const next = util.clamp(dragging.startWidth + delta * g.devicePixelRatio, minWidth, maxWidth)
      CARBON.store.set({ widthAdjustment: false, width: Math.round(next) })
    })
    g.document.addEventListener('mouseup', () => {
      if (!dragging) return
      dragging = null
      CARBON.store.touch()
    })
  }

  CARBON.render = render
})(typeof window !== 'undefined' ? window : globalThis)
