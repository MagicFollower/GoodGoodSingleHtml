/* js/export.js — 与上游 components/Editor.js 的 getCarbonImage/exportImage/copyImage 同构
 * 依赖 vendor/dom-to-image.js（window.domtoimage，Carbon 自带的那份副本）。 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util

  const EXPORT_SIZES_HASH = util.hashBy(CARBON.EXPORT_SIZES, 'id')

  function node() {
    return util.byId('export-container')
  }

  function filter(node) {
    if (node.className) {
      const cls = String(node.className)
      // 白色层与棋盘 alpha 层只服务屏幕预览；光标不参与成图
      if (cls.indexOf('eliminateOnRender') >= 0) return false
      if (cls.indexOf('CodeMirror-cursors') >= 0) return false
    }
    return true
  }

  function baseConfig(s, exportSize, squared) {
    const el = node()
    const width = el.offsetWidth * exportSize
    const height = (squared ? el.offsetWidth : el.offsetHeight) * exportSize
    return {
      style: {
        transform: 'scale(' + exportSize + ')',
        transformOrigin: 'top left',
        background: squared ? s.backgroundColor : 'none',
        alignItems: 'start',
        justifyContent: 'start',
      },
      filter: filter,
      width: width,
      height: height,
    }
  }

  /* 上游对 SVG 结果做的 5 处后处理，逐条照搬 */
  function postProcessSvg(dataURL, fontFamily) {
    return dataURL
      .replace(/&nbsp;/g, '&#160;')
      .replace(/%23/g, '#')
      .replace(/%0A/g, '\n')
      .replace(/&(?!#?[a-z0-9]+;)/g, '&amp;')
      .replace(new RegExp('@font-face\\s+{\\s+font-family: (?!"*' + escapeRegExp(fontFamily) + ').*?}', 'g'), '')
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /* 成图吃不吃所选字体，取决于 dom-to-image 能不能读到 @font-face —— 它扫的是 document.styleSheets[].cssRules，
   * 而 file:// 下**外链**样式表的 cssRules 一律抛 SecurityError（实测 tools/probe/verify5-facecss.html：
   * css/fonts.css → SecurityError，同一文档的内联表 → ok）。读不到的后果不是报错，是导出的图用系统回退字体
   * 画字（实测 tools/probe/verify4-exportfont.html：修复前导出 SVG 里 @font-face 段数 0，三个不同族名光栅化后
   * 墨迹宽度全等于 monospace）。所以 file:// 下把 data/fonts.js 那份 data: URI 字体表挂成内联 <style>；
   * http:// 下外链本来就读得到，继续走 dom-to-image 自己的抓取+内联（与线上同构），不重复挂。 */
  function linkedFontFacesReadable() {
    const sheets = g.document && g.document.styleSheets
    if (!sheets) return false
    for (const sh of Array.prototype.slice.call(sheets)) {
      if (!sh.href) continue
      try {
        const rules = sh.cssRules
        for (const r of rules) {
          if (r.type === g.CSSRule.FONT_FACE_RULE) return true
        }
      } catch (e) {
        /* file:// 下外链样式表抛 SecurityError，继续看下一张 */
      }
    }
    return false
  }

  function ensureFontFaceStyle() {
    if (!g.document || g.document.getElementById('carbon-font-faces')) return
    if (linkedFontFacesReadable()) return
    const css = CARBON.FONT_FACES_CSS
    if (!css) return
    const st = g.document.createElement('style')
    st.id = 'carbon-font-faces'
    st.appendChild(g.document.createTextNode(css))
    ;(g.document.head || g.document.documentElement).appendChild(st)
  }

  const exporter = {
    supportsClipboard: function () {
      return !!(g.navigator && g.navigator.clipboard && g.navigator.clipboard.write && g.ClipboardItem)
    },

    /* format: 'png' | 'svg' | 'blob'（blob 即 PNG 的 Blob 形态，与上游一致） */
    getImage(opts) {
      ensureFontFaceStyle()
      const o = opts || {}
      const s = CARBON.store.state
      const format = o.format || 'png'
      const squared = o.squared != null ? o.squared : !!s.squaredImage
      const exportSize =
        o.exportSize != null
          ? o.exportSize
          : (EXPORT_SIZES_HASH[s.exportSize] || EXPORT_SIZES_HASH['2x']).value

      const config = baseConfig(s, exportSize, squared)

      if (format === 'svg') {
        return domtoimage
          .toSvg(node(), config)
          .then(uri => postProcessSvg(uri, s.fontFamily))
          .then(uri => uri.slice(uri.indexOf(',') + 1))
          .then(data => new Blob([data], { type: 'image/svg+xml' }))
      }
      if (format === 'blob') return domtoimage.toBlob(node(), config)
      return domtoimage.toPng(node(), config)
    },

    exportImage(format, options) {
      const o = options || {}
      const s = CARBON.store.state
      const link = g.document.createElement('a')
      const prefix = o.filename || s.name || 'carbon'
      const isSvg = format === 'svg'

      return exporter
        .getImage({ format: isSvg ? 'svg' : 'blob' })
        .then(blob => g.URL.createObjectURL(blob))
        .then(url => {
          if (!o.open) link.download = prefix + '.' + (isSvg ? 'svg' : 'png')
          const isFirefox = /Firefox/i.test(g.navigator.userAgent) && !/Chrome/i.test(g.navigator.userAgent)
          if (isFirefox) link.target = '_blank'
          link.href = url
          g.document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => g.URL.revokeObjectURL(url), 30000)
          return url
        })
    },

    copyImage() {
      if (!exporter.supportsClipboard()) {
        return Promise.reject(new Error('此浏览器不支持写入剪贴板图片'))
      }
      return exporter
        .getImage({ format: 'blob' })
        .then(blob => g.navigator.clipboard.write([new g.ClipboardItem({ [blob.type]: blob })]))
    },

    /* 供预设缩略图用：单倍方形 PNG dataURL */
    thumbnail() {
      return exporter.getImage({ format: 'png', squared: true, exportSize: 1 })
    },

    dataUrlToBlob(dataUrl) {
      const [head, body] = String(dataUrl).split(',')
      const mime = (/:(.*?);/.exec(head) || [])[1] || 'image/png'
      const bin = g.atob(body)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      return new Blob([arr], { type: mime })
    },
  }

  CARBON.exporter = exporter
})(typeof window !== 'undefined' ? window : globalThis)
