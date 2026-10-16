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

  const exporter = {
    supportsClipboard: function () {
      return !!(g.navigator && g.navigator.clipboard && g.navigator.clipboard.write && g.ClipboardItem)
    },

    /* format: 'png' | 'svg' | 'blob'（blob 即 PNG 的 Blob 形态，与上游一致） */
    getImage(opts) {
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
