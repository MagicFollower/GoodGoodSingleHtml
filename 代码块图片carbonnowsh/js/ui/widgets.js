/* js/ui/widgets.js — 自绘基础控件（对齐上游 Dropdown/Slider/Toggle/ListSetting/ColorPicker/Popout 的行为与数值） */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util
  const ui = {}

  /* ------------------------------------------------------------------ toast */

  ui.toast = function (message, opts) {
    const o = opts || {}
    const host = util.byId('toast-host')
    const node = util.el('div', { class: 'toast' + (o.error ? ' is-error' : ''), text: message })
    host.appendChild(node)
    setTimeout(() => {
      node.remove()
    }, o.timeout || 2600)
    return node
  }

  /* ------------------------------------------------------------------ popout */

  const openPopouts = []

  function closeOthers(except) {
    for (const p of openPopouts) if (p !== except) p.close()
  }

  ui.popout = function (opts) {
    const o = opts || {}
    const wrap = util.el('div', { class: 'popout' + (o.class ? ' ' + o.class : ''), hidden: true })
    if (o.color) wrap.style.setProperty('--popout-color', o.color)
    if (o.width) wrap.style.width = o.width
    if (o.pointerLeft) wrap.style.setProperty('--pointer-left', o.pointerLeft)
    const pointer = util.el('div', { class: 'window-pointer' })
    if (o.pointerLeft) pointer.style.left = o.pointerLeft
    if (o.pointerRight) pointer.style.right = o.pointerRight
    wrap.appendChild(pointer)
    const body = util.el('div', { class: 'popout-body' })
    wrap.appendChild(body)

    const api = {
      el: wrap,
      body,
      anchorEl: o.anchor || null,
      isOpen: false,
      toggle() {
        api.isOpen ? api.close() : api.open()
      },
      open() {
        closeOthers(api)
        api.isOpen = true
        wrap.hidden = false
        if (o.onOpen) o.onOpen()
      },
      close() {
        api.isOpen = false
        wrap.hidden = true
        if (o.onClose) o.onClose()
      },
    }

    openPopouts.push(api)
    if (o.anchor) o.anchor.addEventListener('click', e => (e.preventDefault(), api.toggle()))
    return api
  }

  g.document.addEventListener('mousedown', e => {
    for (const p of openPopouts.slice()) {
      if (!p.isOpen) continue
      if (p.el.contains(e.target)) continue
      if (p.anchorEl && p.anchorEl.contains(e.target)) continue
      p.close()
    }
  })
  g.document.addEventListener('keydown', e => {
    if (e.key === 'Escape') for (const p of openPopouts.slice()) p.close()
  })

  /* ------------------------------------------------------------------ 按钮 */

  ui.button = function (label, opts) {
    const o = opts || {}
    const cls = ['btn']
    if (o.border) cls.push('is-border')
    if (o.center) cls.push('is-center')
    if (o.large) cls.push('is-large')
    if (o.selected) cls.push('is-selected')
    if (o.class) cls.push(o.class)
    const node = util.el(o.href ? 'a' : 'button', { class: cls.join(' '), type: o.href ? null : 'button' })
    if (o.href) node.setAttribute('href', o.href)
    if (o.download) node.setAttribute('download', o.download)
    if (o.title) node.title = o.title
    if (o.id) node.id = o.id
    if (label != null) node.appendChild(g.document.createTextNode(label))
    if (o.onClick) node.addEventListener('click', o.onClick)
    if (o.color) node.style.setProperty('--btn-color', o.color)
    if (o.style) Object.assign(node.style, o.style)
    node.setDisabled = v => (node.disabled = !!v)
    node.setSelected = v => node.classList.toggle('is-selected', !!v)
    return node
  }

  /* ------------------------------------------------------------------ slider */

  ui.slider = function (opts) {
    const minValue = opts.minValue != null ? opts.minValue : 0
    const maxValue = opts.maxValue != null ? opts.maxValue : 100
    const step = 'step' in opts ? opts.step : 1
    const unit = opts.unit || 'px'
    const el = util.el('div', { class: 'slider settings-row' + (opts.dimmed ? ' is-dimmed' : '') })
    const bg = util.el('div', { class: 'slider-bg' })
    const label = util.el('label', { text: opts.label })
    const input = util.el('input', { type: 'range', min: minValue, max: maxValue, step: step === null ? '' : step })
    el.appendChild(bg)
    el.appendChild(label)
    el.appendChild(input)

    function sync(value) {
      const num = parseFloat(String(value)) || 0
      if (g.document.activeElement !== input) input.value = String(num)
      const pct = ((num - minValue) * 1.0) / (maxValue - minValue) || 0
      bg.style.transform = 'translate3d(' + pct * 100 + '%, 0px, 0px)'
      if (opts.dimmedOn) el.classList.toggle('is-dimmed', !!opts.dimmedOn())
    }

    input.addEventListener('input', () => {
      const v = Number(input.value)
      sync(v)
      opts.onChange(v + unit)
    })
    input.addEventListener('mousedown', () => opts.onMouseDown && opts.onMouseDown())
    input.addEventListener('mouseup', () => opts.onMouseUp && opts.onMouseUp())
    sync(opts.value)
    return { el, sync }
  }

  /* ------------------------------------------------------------------ toggle */

  ui.toggle = function (opts) {
    const el = util.el('div', { class: 'toggle' })
    const label = util.el('label', { class: 'label', text: opts.label })
    const input = util.el('input', { type: 'checkbox', 'aria-checked': String(!!opts.enabled) })
    const mark = util.el('span')
    el.appendChild(label)
    el.appendChild(input)
    el.appendChild(mark)

    function paint(enabled) {
      input.checked = !!enabled
      input.setAttribute('aria-checked', String(!!enabled))
      mark.className = enabled ? 'checkmark' : 'checkmark-disabled'
      mark.innerHTML = enabled ? CARBON.SVG.icons.checkmark : ''
    }

    input.addEventListener('change', () => {
      paint(input.checked)
      opts.onChange(input.checked)
    })
    paint(opts.enabled)
    return { el, sync: paint }
  }

  /* ------------------------------------------------------------------ 数字/文本行 */

  ui.inputRow = function (opts) {
    const wrap = util.el('div', { class: 'settings-row row' })
    const label = util.el('label', { text: opts.label })
    const input = util.el('input', {
      class: 'plain-input',
      type: opts.type || 'text',
      min: opts.min,
      max: opts.max,
      placeholder: opts.placeholder,
    })
    wrap.appendChild(label)
    wrap.appendChild(input)
    function sync(v) {
      if (g.document.activeElement !== input) input.value = v == null ? '' : v
    }
    input.addEventListener('input', () => opts.onChange(opts.type === 'number' ? Number(input.value) : input.value))
    sync(opts.value)
    return { el: wrap, sync, input }
  }

  /* ------------------------------------------------------------------ ListSetting（字体那种内嵌列表） */

  ui.listSetting = function (opts) {
    const container = util.el('div', { class: 'list-select-container' })
    const display = util.el('div', { class: 'display', role: 'button', tabindex: '0' })
    const title = util.el('span', { text: opts.title })
    const current = util.el('span', { class: 'list-current' })
    display.appendChild(title)
    display.appendChild(current)
    const list = util.el('div', { class: 'list' })
    container.appendChild(display)
    container.appendChild(list)

    let open = false
    // items 允许是数组或函数：字体上传、自定义主题这些会在运行时长出来
    const getItems = () => (typeof opts.items === 'function' ? opts.items() : opts.items)

    function paint() {
      const items = getItems()
      const selected = items.find(i => i.id === opts.getSelected()) || {}
      current.innerHTML = ''
      current.appendChild(opts.renderItem ? opts.renderItem(selected) : g.document.createTextNode(selected.name || ''))
      list.innerHTML = ''
      for (const item of items) {
        const row = util.el('div', { class: 'list-item', role: 'button', tabindex: '0' })
        row.appendChild(opts.renderItem ? opts.renderItem(item) : g.document.createTextNode(item.name))
        if (item.id === opts.getSelected()) {
          const check = util.el('span', { class: 'checkmark' })
          check.innerHTML = CARBON.SVG.icons.checkmark
          row.appendChild(check)
        }
        row.addEventListener('click', () => {
          open = false
          container.classList.remove('is-open')
          if (opts.getSelected() !== item.id) opts.onChange(item.id)
          else paint()
        })
        list.appendChild(row)
      }
    }

    display.addEventListener('click', () => {
      open = !open
      container.classList.toggle('is-open', open)
      if (open && opts.onOpen) opts.onOpen()
    })
    paint()
    return { el: container, sync: paint, close: () => ((open = false), container.classList.remove('is-open')) }
  }

  /* ------------------------------------------------------------------ 取色器（替代 react-color SketchPicker） */

  ui.colorPicker = function (opts) {
    const o = opts || {}
    const alphaEnabled = !o.disableAlpha
    const el = util.el('div', { class: 'color-picker' })
    const sv = util.el('div', { class: 'sv-area' })
    const svWhite = util.el('div', { class: 'sv-white' })
    const svBlack = util.el('div', { class: 'sv-black' })
    const svKnob = util.el('div', { class: 'sv-knob' })
    sv.appendChild(svWhite)
    sv.appendChild(svBlack)
    sv.appendChild(svKnob)

    const hueRow = util.el('div', { class: 'hue-row' })
    const hueBar = util.el('div', { class: 'hue-bar' })
    const hueKnob = util.el('div', { class: 'hue-knob' })
    hueBar.appendChild(hueKnob)
    hueRow.appendChild(hueBar)

    const alphaRow = util.el('div', { class: 'alpha-row' })
    const alphaBar = util.el('div', { class: 'alpha-bar' })
    const alphaFill = util.el('div', { class: 'alpha-fill' })
    const alphaKnob = util.el('div', { class: 'alpha-knob' })
    alphaBar.appendChild(alphaFill)
    alphaBar.appendChild(alphaKnob)
    alphaRow.appendChild(alphaBar)

    const fields = util.el('div', { class: 'color-fields' })
    const hex = field('hex')
    const r = field('r')
    const gr = field('g')
    const b = field('b')
    const a = field('a')
    fields.appendChild(hex.wrap)
    fields.appendChild(r.wrap)
    fields.appendChild(gr.wrap)
    fields.appendChild(b.wrap)
    if (alphaEnabled) fields.appendChild(a.wrap)

    const presets = util.el('div', { class: 'preset-colors' })
    for (const c of o.presets || []) {
      presets.appendChild(
        util.el('button', {
          type: 'button',
          style: { background: c },
          title: c,
          onclick: () => {
            const parsed = util.parseColor(c)
            if (parsed) emit(parsed)
          },
        })
      )
    }

    el.appendChild(sv)
    el.appendChild(hueRow)
    if (alphaEnabled) el.appendChild(alphaRow)
    el.appendChild(fields)
    if ((o.presets || []).length) el.appendChild(presets)

    let hsva = { h: 0, s: 0, v: 1, a: 1 }
    let silent = false

    function field(name) {
      const input = util.el('input', { type: 'text', spellcheck: 'false', 'aria-label': name })
      const wrap = util.el('label', {})
      wrap.appendChild(util.el('span', { class: 'field-name', text: name }))
      wrap.appendChild(input)
      input.addEventListener('change', () => {
        if (name === 'hex') {
          const parsed = util.parseColor(input.value)
          if (parsed) emit(Object.assign({}, parsed, { a: hsva.a }))
          else paint()
        } else {
          const next = Object.assign({}, hsvaToRgba())
          if (name === 'r') next.r = clampByte(input.value)
          if (name === 'g') next.g = clampByte(input.value)
          if (name === 'b') next.b = clampByte(input.value)
          if (name === 'a') next.a = util.clamp(parseFloat(input.value), 0, 1)
          emit(next)
        }
      })
      return { wrap, input }
    }

    const clampByte = v => util.clamp(Math.round(Number(v) || 0), 0, 255)

    function hsvaToRgba() {
      const rgb = util.hsvToRgb(hsva)
      return { r: rgb.r, g: rgb.g, b: rgb.b, a: hsva.a }
    }

    function emit(rgba) {
      const parsed = util.parseColor({ r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a == null ? 1 : rgba.a })
      const from = util.rgbToHsv(parsed)
      hsva = { h: from.h, s: from.s, v: from.v, a: parsed.a }
      paint()
      if (silent) return
      if (o.onChange)
        o.onChange({
          rgb: { r: parsed.r, g: parsed.g, b: parsed.b, a: hsva.a },
          hex: util.colorToHex(parsed).toUpperCase(),
          rgba: util.colorToRgbaString({ r: parsed.r, g: parsed.g, b: parsed.b, a: hsva.a }),
        })
    }

    function paint() {
      const pure = util.hsvToRgb({ h: hsva.h, s: 1, v: 1 })
      const cur = util.hsvToRgb(hsva)
      sv.style.background = 'rgb(' + pure.r + ',' + pure.g + ',' + pure.b + ')'
      svKnob.style.left = hsva.s * 100 + '%'
      svKnob.style.top = (1 - hsva.v) * 100 + '%'
      hueKnob.style.left = (hsva.h / 360) * 100 + '%'
      alphaFill.style.background =
        'linear-gradient(to right, rgba(' + cur.r + ',' + cur.g + ',' + cur.b + ',0), rgb(' + cur.r + ',' + cur.g + ',' + cur.b + '))'
      alphaKnob.style.left = hsva.a * 100 + '%'
      const hexStr = util.colorToHex(cur).toUpperCase()
      if (g.document.activeElement !== hex.input) hex.input.value = hexStr
      if (g.document.activeElement !== r.input) r.input.value = cur.r
      if (g.document.activeElement !== gr.input) gr.input.value = cur.g
      if (g.document.activeElement !== b.input) b.input.value = cur.b
      if (g.document.activeElement !== a.input) a.input.value = Math.round(hsva.a * 100) / 100
    }

    drag(sv, (x, y) => {
      hsva.s = util.clamp(x, 0, 1)
      hsva.v = util.clamp(1 - y, 0, 1)
      paint()
      emitCurrent()
    })
    drag(hueBar, x => {
      hsva.h = util.clamp(x, 0, 1) * 360
      paint()
      emitCurrent()
    })
    drag(alphaBar, x => {
      hsva.a = util.clamp(x, 0, 1)
      paint()
      emitCurrent()
    })

    function emitCurrent() {
      if (o.onChange)
        o.onChange({
          rgb: hsvaToRgba(),
          hex: util.colorToHex(hsvaToRgba()).toUpperCase(),
          rgba: util.colorToRgbaString(hsvaToRgba()),
        })
    }

    /* 指针拖动：按下即跟手，抬起结束（不依赖 setPointerCapture，file:// 与老内核同样可用） */
    function drag(area, onMove) {
      let active = false
      function pos(e) {
        const rect = area.getBoundingClientRect()
        const point = e.touches ? e.touches[0] : e
        return { x: (point.clientX - rect.left) / rect.width, y: (point.clientY - rect.top) / rect.height }
      }
      function down(e) {
        active = true
        e.preventDefault()
        const p = pos(e)
        onMove(p.x, p.y)
      }
      function move(e) {
        if (!active) return
        const p = pos(e)
        onMove(p.x, p.y)
      }
      function up() {
        active = false
      }
      area.addEventListener('mousedown', down)
      area.addEventListener('touchstart', down, { passive: false })
      g.document.addEventListener('mousemove', move)
      g.document.addEventListener('touchmove', move, { passive: false })
      g.document.addEventListener('mouseup', up)
      g.document.addEventListener('touchend', up)
    }

    /* 外部值 → 内部（不触发 onChange，避免回环） */
    function setValue(color) {
      const parsed = util.parseColor(color)
      if (!parsed) return paint()
      silent = true
      emit(parsed)
      silent = false
    }

    setValue(o.color)
    return { el, sync: setValue }
  }

  CARBON.ui = ui
})(typeof window !== 'undefined' ? window : globalThis)
