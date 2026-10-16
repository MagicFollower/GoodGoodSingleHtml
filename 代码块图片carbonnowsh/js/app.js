/* js/app.js — 装配层：状态订阅、拖拽导入、快捷键、首屏 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util
  const byId = util.byId

  const app = { ready: false }
  const ui = CARBON.ui
  let settingsPanel = null
  let exportMenu = null

  /* ------------------------------------------------------------------ 首屏 */

  function boot() {
    const logoSlot = document.querySelector('[data-slot="logo"]')
    if (logoSlot) logoSlot.innerHTML = CARBON.SVG.icons.logo

    const state = CARBON.store.init()
    CARBON.render.init()
    CARBON.editor.mount(byId('editor-host'))

    /* 工具栏 */
    document.querySelector('[data-slot="theme-dropdown"]').appendChild(CARBON.panels.themeDropdown())
    document.querySelector('[data-slot="language-dropdown"]').appendChild(CARBON.panels.languageDropdown())
    document.querySelector('[data-slot="background-select"]').appendChild(CARBON.panels.backgroundSelect())
    settingsPanel = CARBON.panels.settingsPanel()
    document.querySelector('[data-slot="settings"]').appendChild(settingsPanel.el)
    document.querySelector('[data-slot="copy-menu"]').appendChild(CARBON.panels.copyMenu())
    exportMenu = CARBON.panels.exportMenu()
    document.querySelector('[data-slot="export-menu"]').appendChild(exportMenu.el)

    CARBON.store.subscribe(onState)
    applyAll(state, Object.keys(state))

    installDropzone()
    installShortcuts()

    /* URL 参数：?copy 直接复制成图；?readonly 只读；路径里的 snippet id 已随云端功能移除 */
    const { parameter, queryState } = CARBON.url.readFromLocation(g.location)
    if (parameter) CARBON.panels.toast('云端片段功能已移除，忽略 id ' + parameter)
    if (queryState.copy) setTimeout(() => copyImage(), 400)
    if (!state.fontFamily) CARBON.store.set({ fontFamily: CARBON.DEFAULT_SETTINGS.fontFamily })

    app.ready = true
    document.dispatchEvent(new CustomEvent('carbon:ready', { detail: { state } }))
  }

  function onState(state, keys) {
    applyAll(state, keys)
  }

  function applyAll(state, keys) {
    CARBON.render.apply(state, keys)
    if (ui.backgroundPaint) ui.backgroundPaint()
    if (settingsPanel) settingsPanel.syncAll(state)
    if (exportMenu) exportMenu.sync(state)
    if (CARBON.ui.themeSlot) CARBON.ui.themeSlot.sync()
    if (CARBON.ui.languageSlot) CARBON.ui.languageSlot.sync()
  }

  /* ------------------------------------------------------------------ 拖拽导入 */

  function installDropzone() {
    const area = byId('canvas-area')
    const overlay = byId('drop-overlay')
    let depth = 0

    area.addEventListener('dragenter', e => {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return
      depth++
      overlay.hidden = false
      overlay.textContent = '松手即导入文件'
    })
    area.addEventListener('dragover', e => {
      if (e.dataTransfer && e.dataTransfer.dropEffect !== 'none') e.preventDefault()
    })
    area.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1)
      if (!depth) overlay.hidden = true
    })
    area.addEventListener('drop', async e => {
      e.preventDefault()
      depth = 0
      overlay.hidden = true
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      if (!file) return
      await ingest(file)
    })
    // 也接住「拖进窗口任意位置」，避免浏览器把文本文件当导航打开
    g.addEventListener('dragover', e => e.preventDefault())
    g.addEventListener('drop', e => e.preventDefault())
  }

  async function ingest(file) {
    const kind = String(file.type || '').split('/')[0]
    if (kind === 'image') {
      const url = await util.fileToDataURL(file)
      CARBON.store.set({
        backgroundImage: url,
        backgroundImageSelection: null,
        backgroundMode: 'image',
        preset: null,
      })
      CARBON.panels.toast('已设为背景：' + file.name)
      return
    }
    const text = await util.fileToText(file)
    CARBON.store.set({ code: text, language: 'auto' })
    CARBON.panels.toast('已导入代码：' + file.name)
  }

  /* ------------------------------------------------------------------ 快捷键 */

  function installShortcuts() {
    g.document.addEventListener('keydown', async e => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = (e.key || '').toLowerCase()
      if (e.shiftKey && key === 'e') {
        e.preventDefault()
        return runExport(exportMenu.quick, 'blob')
      }
      if (e.shiftKey && key === 's') {
        e.preventDefault()
        return runExport(exportMenu.svgBtn, 'svg')
      }
      if (e.shiftKey && key === 'c') {
        e.preventDefault()
        return copyImage()
      }
      if (e.shiftKey && key === '\\') {
        e.preventDefault()
        CARBON.store.resetSettings()
        return CARBON.panels.toast('已重置为默认设置')
      }
      if (!e.shiftKey && key === '/') {
        e.preventDefault()
        settingsPanel.open()
      }
    })
  }

  async function runExport(node, format) {
    if (!node) return
    node.disabled = true
    const label = node.dataset.label || node.textContent
    node.dataset.label = label
    node.textContent = '导出中…'
    try {
      await CARBON.exporter.exportImage(format, {})
    } catch (err) {
      CARBON.panels.toast('导出失败：' + err.message, { error: true })
    } finally {
      node.disabled = false
      node.textContent = label
    }
  }

  async function copyImage() {
    if (!CARBON.exporter.supportsClipboard()) return CARBON.panels.toast('此浏览器不支持写入剪贴板图片', { error: true })
    try {
      await CARBON.exporter.copyImage()
      CARBON.panels.toast('图片已复制')
    } catch (err) {
      CARBON.panels.toast('复制失败：' + err.message, { error: true })
    }
  }

  CARBON.app = app
  if (g.document.readyState === 'loading') g.document.addEventListener('DOMContentLoaded', boot)
  else boot()
})(typeof window !== 'undefined' ? window : globalThis)
