/* js/ui/panels.js — 工具栏各面板：主题/语言下拉、背景、Settings 三页签、复制、导出
 * 控件行为对齐上游同名组件（数值见 css/app.css 与 data/settings.js）。 */
;(function (g) {
  'use strict'
  const CARBON = (g.CARBON = g.CARBON || {})
  const util = CARBON.util
  const ui = CARBON.ui
  const store = () => CARBON.store

  /* ------------------------------------------------------------------ 通用下拉 */

  function dropdown(opts) {
    const container = util.el('div', { class: 'dropdown-container' })
    if (opts.icon) {
      const icon = util.el('div', { class: 'dropdown-icon' })
      icon.innerHTML = opts.icon
      container.appendChild(icon)
    }
    const display = util.el('div', { class: 'dropdown-display', tabindex: '0', role: 'button' })
    if (opts.color) display.style.setProperty('--dropdown-color', opts.color)
    const input = util.el('input', {
      class: 'dropdown-display-text',
      type: 'text',
      spellcheck: 'false',
      'aria-label': opts.title,
    })
    const arrow = util.el('span', { class: 'dropdown-arrow' })
    arrow.innerHTML = CARBON.SVG.icons.arrows.down
    display.appendChild(input)
    display.appendChild(arrow)
    container.appendChild(display)

    const list = util.el('ul', { class: 'dropdown-list', role: 'listbox' })
    list.hidden = true
    if (opts.color) list.style.setProperty('--dropdown-color', opts.color)
    container.appendChild(list)

    let items = opts.list
    let highlighted = -1
    let open = false

    function selectedItem() {
      return opts.getSelected()
    }

    function paintInput() {
      const s = selectedItem()
      const label = s ? s.name : opts.placeholder || ''
      if (g.document.activeElement !== input) input.value = label
    }

    function filterItems(term) {
      const q = String(term || '').trim().toLowerCase()
      if (!q) return opts.list
      const starts = []
      const contains = []
      for (const item of opts.list) {
        const name = String(item.name || '').toLowerCase()
        if (name.indexOf(q) === 0) starts.push(item)
        else if (name.indexOf(q) >= 0) contains.push(item)
      }
      return starts.concat(contains)
    }

    function paintList() {
      list.innerHTML = ''
      items.forEach((item, index) => {
        const row = util.el('li', {
          class: 'dropdown-list-item' + (index === highlighted ? ' is-highlighted' : ''),
          role: 'option',
        })
        if (opts.color) row.style.setProperty('--dropdown-color', opts.color)
        const selected = selectedItem()
        const isSelected = selected && selected.id === item.id
        const content = util.el('span', { class: 'dropdown-list-item-text' })
        if (opts.itemWrapper) content.appendChild(opts.itemWrapper(item, isSelected))
        else content.appendChild(g.document.createTextNode(item.name))
        row.appendChild(content)
        if (isSelected && !item.isAction) {
          const check = util.el('span', { class: 'checkmark' })
          check.innerHTML = CARBON.SVG.icons.checkmark
          row.appendChild(check)
        }
        row.addEventListener('click', e => {
          e.stopPropagation()
          choose(item)
        })
        list.appendChild(row)
      })
    }

    function choose(item) {
      close()
      opts.onChange(item)
    }

    function openList() {
      open = true
      list.hidden = false
      display.classList.add('is-open')
      const iconEl = container.querySelector('.dropdown-icon')
      if (iconEl) iconEl.style.left = '-38px'
      items = filterItems('')
      highlighted = items.findIndex(i => selectedItem() && i.id === selectedItem().id)
      input.value = ''
      paintList()
      if (opts.onOpen) opts.onOpen()
    }

    function close() {
      open = false
      list.hidden = true
      display.classList.remove('is-open')
      const iconEl = container.querySelector('.dropdown-icon')
      if (iconEl) iconEl.style.left = '-39px'
      paintInput()
    }

    display.addEventListener('click', () => (open ? close() : openList()))
    // 点别处要收起（上游 Downshift 的 click-outside 行为）
    g.document.addEventListener('mousedown', e => {
      if (open && !container.contains(e.target)) close()
    })
    input.addEventListener('input', () => {
      items = filterItems(input.value)
      highlighted = -1
      if (!open) openList()
      paintList()
    })
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!open) return openList()
        highlighted = util.clamp(highlighted + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1)
        paintList()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (open && items[highlighted]) choose(items[highlighted])
        else openList()
      } else if (e.key === 'Escape') {
        close()
      }
    })

    paintInput()
    return {
      el: container,
      sync: paintInput,
      close,
      setItems(next) {
        opts.list = next
        items = filterItems(input.value)
        paintList()
      },
      repaint: paintList,
    }
  }

  ui.dropdown = dropdown

  /* ------------------------------------------------------------------ 主题下拉 + 自建主题 */

  function themeDropdown() {
    const slot = (ui.themeSlot = dropdown({
      title: '主题',
      icon: CARBON.SVG.icons.theme,
      list: [],
      getSelected: () => store().library.theme(),
      onChange: item => {
        if (item.id === 'create') return openCreate()
        store().set({ theme: item.id, highlights: null })
        ui.themeSlot.sync()
        if (ui.themeCreate) ui.themeCreate.refresh()
      },
      itemWrapper: (item, isSelected) => {
        const frag = g.document.createDocumentFragment()
        const sw = util.el('span', { class: 'theme-swatch' })
        sw.style.background = (item.highlights && item.highlights.background) || (item.id === 'create' ? '#393939' : '#000')
        frag.appendChild(sw)
        frag.appendChild(g.document.createTextNode(item.name))
        if (item.custom) {
          const rm = util.el('button', {
            class: 'preset-remove',
            type: 'button',
            title: '删除该自定义主题',
            style: { position: 'static', marginLeft: '8px', background: 'transparent', boxShadow: 'inset 0 0 0 1px #fff' },
          })
          rm.innerHTML = CARBON.SVG.icons.remove
          rm.addEventListener('click', e => {
            e.stopPropagation()
            store().library.removeTheme(item.id)
            ui.themeSlot.sync()
            paintThemeList()
          })
          frag.appendChild(rm)
        }
        return frag
      },
      onOpen: () => paintThemeList(),
    }))

    function paintThemeList() {
      const list = store().library.themes.map(t => t)
      slot.setItems([{ id: 'create', name: 'Create +', isAction: true }].concat(list))
    }

    slot.sync()
    paintThemeList()
    ui.themeSlotEl = slot.el
    g.document.addEventListener('carbon:themes-changed', paintThemeList)
    return slot.el
  }

  function themeCreatePanel() {
    const pop = ui.popout({ class: 'theme-create-popout', width: 'auto' })
    const root = util.el('div', { class: 'theme-settings' })

    const nameRow = util.el('div', { class: 'field name-field' })
    const nameInput = util.el('input', { type: 'text', placeholder: 'Custom Theme', maxlength: '32', 'aria-label': '主题名' })
    nameRow.appendChild(util.el('span', { text: '名称' }))
    nameRow.appendChild(nameInput)

    const presetPick = ui.listSetting({
      title: '预设',
      items: () => store().library.themes,
      getSelected: () => (store().library.theme() || {}).id,
      onOpen: () => closePicker(),
      renderItem: item => g.document.createTextNode(item.name),
      onChange: id => {
        const t = store().library.themeById[id]
        if (t) {
          working = Object.assign({}, t.highlights)
          paintSwatches()
        }
      },
    })

    const colors = util.el('div', { class: 'theme-colors' })
    const pickerCol = util.el('div', { class: 'highlight-picker' })
    const pickerHeader = util.el('div', { class: 'picker-header', text: '' })
    const pickerHost = util.el('div')
    pickerCol.appendChild(pickerHeader)
    pickerCol.appendChild(pickerHost)

    const createBtn = ui.button('Create +', {
      center: true,
      border: false,
      style: { background: '#fff', color: '#121212', padding: '8px 0' },
    })
    createBtn.addEventListener('click', () => {
      const name = nameInput.value.trim()
      if (!name) return
      store().library.createTheme(name, working)
      g.document.dispatchEvent(new CustomEvent('carbon:themes-changed'))
      pop.close()
      ui.themeSlot.sync()
      toast('已创建主题 ' + name)
    })

    /* 上游是 disabled={!name}：改名要实时决定按钮可点，不能只在重画色位时补 */
    nameInput.addEventListener('input', () => {
      createBtn.disabled = !nameInput.value.trim()
    })

    root.appendChild(nameRow)
    root.appendChild(presetPick.el)
    root.appendChild(colors)
    root.appendChild(createBtn)
    pop.body.appendChild(root)
    pop.body.appendChild(pickerCol)

    let working = {}
    let activeKey = null
    let picker = null

    function paintColors() {
      colors.innerHTML = ''
      /* 上游 ThemeCreate 只列 HIGHLIGHT_KEYS 这 12 行：variable2/3 不在这里编辑，
       * 它们随预设一起进 working，由 theme.js 的 `variable2 || variable` 兜底渲染。 */
      for (const key of CARBON.HIGHLIGHT_KEYS) {
        const row = util.el('div', { class: 'field' })
        const btn = util.el('button', { type: 'button', class: activeKey === key ? 'is-active' : '' })
        btn.appendChild(util.el('span', { text: key }))
        const sq = util.el('span', { class: 'color-square' + (activeKey === key ? ' is-active' : '') })
        sq.style.background = working[key] || '#000'
        btn.appendChild(sq)
        btn.addEventListener('click', () => selectKey(key))
        row.appendChild(btn)
        colors.appendChild(row)
      }
    }

    function paintSwatches() {
      paintColors()
      if (activeKey) selectKey(activeKey)
      createBtn.disabled = !nameInput.value.trim()
    }

    function selectKey(key) {
      activeKey = key
      pickerHeader.textContent = key
      if (!picker) {
        picker = ui.colorPicker({
          color: working[key] || '#000000',
          disableAlpha: key === 'background' || key === 'text',
          presets: [],
          onChange: c => {
            working[key] = c.rgba
            if (key !== 'background' && key !== 'text' && c.rgb.a >= 1) working[key] = c.hex
            paintColors()
          },
        })
        pickerHost.appendChild(picker.el)
      } else {
        picker.sync(working[key] || '#000000')
      }
      paintColors()
    }

    function closePicker() {
      activeKey = null
      pickerHeader.textContent = ''
      if (picker) pickerHost.innerHTML = ''
      picker = null
      paintColors()
    }

    const api = {
      refresh() {
        const t = store().library.theme()
        working = Object.assign({}, t ? t.highlights : {})
        presetPick.sync()
        paintSwatches()
      },
      open() {
        api.refresh()
        pop.open()
      },
      close: () => pop.close(),
      pop,
    }
    return api
  }

  function openCreate() {
    if (!ui.themeCreate) {
      ui.themeCreate = themeCreatePanel()
      // 面板挂在主题下拉的相对定位容器里，才能像上游那样从下拉下方浮出
      ui.themeSlotEl.appendChild(ui.themeCreate.pop.el)
    }
    ui.themeCreate.open()
  }

  /* ------------------------------------------------------------------ 语言下拉 */

  function languageDropdown() {
    const bySpec = {
      short: util.hashBy(CARBON.LANGUAGES, 'short'),
      mode: util.hashBy(CARBON.LANGUAGES, 'mode'),
      mime: util.hashBy(CARBON.LANGUAGES, 'mime'),
    }
    function current() {
      const l = store().state.language || 'auto'
      return bySpec.short[l] || bySpec.mode[l] || bySpec.mime[l] || bySpec.mode.auto
    }
    const d = dropdown({
      title: '语言',
      icon: CARBON.SVG.icons.language,
      list: CARBON.LANGUAGES,
      getSelected: current,
      onChange: item => store().set({ language: item.mime || item.mode }),
    })
    ui.languageSlot = d
    return d.el
  }

  /* ------------------------------------------------------------------ 背景选择 */

  function backgroundSelect() {
    const wrap = util.el('div', { class: 'bg-select-container' })
    const display = util.el('button', { class: 'bg-select-display', type: 'button', title: '背景菜单' })
    display.innerHTML = '<span class="bg-color-alpha"></span><span class="bg-color"></span>'
    wrap.appendChild(display)

    const pop = ui.popout({ class: 'bg-pickers', width: '222px', pointerLeft: '15px', anchor: display })
    const tabs = util.el('div', { class: 'picker-tabs' })
    const tabColor = ui.button('颜色', { center: true })
    const tabImage = ui.button('图片', { center: true })
    tabs.appendChild(tabColor)
    tabs.appendChild(tabImage)

    const colorHost = util.el('div')
    const imageHost = util.el('div', { class: 'bg-image-row' })
    const picker = ui.colorPicker({
      color: store().state.backgroundColor,
      presets: CARBON.BG_PRESETS,
      onChange: c => store().set({ backgroundColor: c.rgba }),
    })
    colorHost.appendChild(picker.el)

    const preview = util.el('div', { class: 'preview' })
    const fileBtn = util.el('label', { class: 'file-btn', text: '选择本地图片…' })
    const file = util.el('input', {
      type: 'file',
      accept: 'image/*',
      style: { display: 'none' },
      onchange: async e => {
        const f = e.target.files && e.target.files[0]
        if (!f) return
        const url = await util.fileToDataURL(f)
        store().set({ backgroundImage: url, backgroundImageSelection: null, backgroundMode: 'image' })
        paintTabs()
        toast('已载入背景图')
      },
    })
    const clearBtn = ui.button('清除背景图', { center: true, border: true })
    clearBtn.addEventListener('click', () => {
      store().set({ backgroundImage: null, backgroundImageSelection: null, backgroundMode: 'color' })
      paintTabs()
    })
    fileBtn.appendChild(file)
    imageHost.appendChild(preview)
    imageHost.appendChild(fileBtn)
    imageHost.appendChild(clearBtn)

    pop.body.appendChild(tabs)
    pop.body.appendChild(colorHost)
    pop.body.appendChild(imageHost)

    tabColor.addEventListener('click', () => {
      if (store().state.backgroundMode !== 'color') store().set({ backgroundMode: 'color' })
      paintTabs()
    })
    tabImage.addEventListener('click', () => {
      if (store().state.backgroundMode !== 'image') store().set({ backgroundMode: 'image' })
      paintTabs()
    })

    function paintTabs() {
      const mode = store().state.backgroundMode
      tabColor.classList.toggle('is-active', mode === 'color')
      tabImage.classList.toggle('is-active', mode === 'image')
      colorHost.hidden = mode !== 'color'
      imageHost.hidden = mode !== 'image'
      const s = store().state
      const image = s.backgroundImage && s.backgroundImageSelection ? s.backgroundImageSelection : s.backgroundImage
      if (mode === 'image' && image) {
        display.querySelector('.bg-color').style.background = 'url("' + image + '") center / cover no-repeat'
      } else {
        display.querySelector('.bg-color').style.background = s.backgroundColor || CARBON.DEFAULT_BG_COLOR
      }
      preview.style.backgroundImage = image ? 'url("' + image + '")' : ''
      picker.sync(mode === 'color' ? s.backgroundColor : '#ffffff')
    }

    wrap.appendChild(pop.el)

    ui.backgroundPaint = paintTabs
    paintTabs()
    return wrap
  }

  /* ------------------------------------------------------------------ Presets 区块 */

  function presetsBlock() {
    const root = util.el('div', { class: 'settings-presets' })
    const header = util.el('div', { class: 'settings-presets-header' })
    header.appendChild(util.el('span', { text: '预设' }))
    const createBtn = ui.button('create +', { class: 'create', color: CARBON.COLORS.GRAY })
    const toggleBtn = ui.button('', { class: 'settings-presets-toggle', center: true })
    toggleBtn.innerHTML = CARBON.SVG.icons.arrows.up
    header.appendChild(createBtn)
    header.appendChild(toggleBtn)

    const content = util.el('div', { class: 'settings-presets-content' })
    const appliedBar = util.el('div', { class: 'settings-presets-applied', hidden: true })
    appliedBar.appendChild(util.el('span', { text: '已应用预设' }))
    const undoBtn = util.el('button', { type: 'button' })
    undoBtn.innerHTML = '撤销 ↩'
    appliedBar.appendChild(undoBtn)

    root.appendChild(header)
    root.appendChild(content)
    root.appendChild(appliedBar)

    let show = true
    let previous = null

    function thumbnail(preset) {
      if (preset.icon && String(preset.icon).indexOf('data:') === 0) {
        const img = util.el('span')
        img.style.cssText =
          "position:absolute;inset:0;background:url('" +
          preset.icon +
          "') center/contain no-repeat;border-radius:3px"
        return img
      }
      const theme = store().library.themeById[preset.theme]
      const mini = util.el('span', { class: 'preset-mini' })
      mini.style.background = (theme && theme.highlights.background) || '#222'
      if (preset.windowControls !== false) mini.appendChild(util.el('span', { class: 'mini-dots' }))
      return mini
    }

    function paint() {
      content.innerHTML = ''
      const list = store().library.presets
      const selected = store().state.preset
      let sawCustom = false
      for (const p of list) {
        if (!p.custom && sawCustom) {
          content.appendChild(util.el('div', { class: 'settings-presets-divider' }))
        }
        if (p.custom) sawCustom = true
        const holder = util.el('div', { class: 'preset-container' })
        const btn = util.el('button', {
          type: 'button',
          class: 'preset-btn' + (p.id === selected ? ' is-selected' : ''),
          title: p.name || p.id,
        })
        btn.style.background = p.backgroundColor || 'transparent'
        btn.appendChild(thumbnail(p))
        btn.addEventListener('click', () => apply(p))
        holder.appendChild(btn)
        if (p.custom) {
          const rm = util.el('button', { type: 'button', class: 'preset-remove', title: '删除预设' })
          rm.innerHTML = CARBON.SVG.icons.remove
          rm.addEventListener('click', e => {
            e.stopPropagation()
            store().library.removePreset(p.id)
            paint()
          })
          holder.appendChild(rm)
        }
        content.appendChild(holder)
      }
      content.hidden = !show
      createBtn.disabled = !!selected
      appliedBar.hidden = !previous
    }

    function apply(preset) {
      previous = Object.assign({}, store().state)
      store().library.applyPreset(preset)
      paint()
    }

    undoBtn.addEventListener('click', () => {
      if (!previous) return
      const { preset, ...rest } = previous
      store().replace(Object.assign({}, rest, { preset: null }))
      previous = null
      paint()
    })

    toggleBtn.addEventListener('click', () => {
      show = !show
      toggleBtn.innerHTML = show ? CARBON.SVG.icons.arrows.up : CARBON.SVG.icons.arrows.down
      paint()
    })

    createBtn.addEventListener('click', async () => {
      const s = store().state
      let icon = null
      try {
        icon = await CARBON.exporter.thumbnail()
      } catch (e) {
        toast('缩略图生成失败：' + e.message, { error: true })
      }
      const preset = store().library.createPreset(Object.assign({}, s, { icon }))
      store().set({ preset: preset.id })
      paint()
      toast('已保存当前配置为预设')
    })

    ui.presetsPaint = paint
    paint()
    return root
  }

  /* ------------------------------------------------------------------ Settings 面板 */

  function settingsPanel() {
    const wrap = util.el('div', { class: 'settings-container' })
    const btn = ui.button('', { border: true, center: true, class: 'btn-square-icon', title: '设置菜单' })
    btn.innerHTML = CARBON.SVG.icons.settings
    wrap.appendChild(btn)

    const pop = ui.popout({ class: 'settings-popout', width: '316px', pointerLeft: '15px', anchor: btn })
    pop.body.appendChild(presetsBlock())

    const bottom = util.el('div', { class: 'settings-bottom' })
    const menu = util.el('div', { class: 'settings-menu' })
    const content = util.el('div', { class: 'settings-pane' })
    bottom.appendChild(menu)
    bottom.appendChild(content)
    pop.body.appendChild(bottom)

    const tabs = ['窗口', '编辑器', '其它']
    const tabButtons = {}
    for (const name of tabs) {
      const item = util.el('div', { class: 'menu-button' })
      const b = ui.button(name, { center: false })
      b.style.justifyContent = 'flex-start'
      const arrow = util.el('span', { class: 'arrow-icon' })
      arrow.innerHTML = CARBON.SVG.icons.arrows.right
      b.appendChild(arrow)
      item.appendChild(b)
      menu.appendChild(item)
      tabButtons[name] = b
      b.addEventListener('click', () => select(name))
    }

    let current = tabs[0]
    const controls = {}

    function select(name) {
      const changed = current !== name
      current = name
      for (const t of tabs) tabButtons[t].classList.toggle('is-active', t === name)
      // 只在真的换页签时才搬 DOM：每次通知都重建会让正在输入的框掉焦点
      if (changed || content.firstChild !== controls[name]) {
        content.innerHTML = ''
        for (const [key, pane] of Object.entries(controls)) if (key === name) content.appendChild(pane)
      }
    }

    /* --- 窗口页签 --- */
    const windowPane = util.el('div', { class: 'settings-content' })
    const wcToggle = ui.toggle({
      label: '窗口控件',
      enabled: store().state.windowControls,
      onChange: v => store().set({ windowControls: v }),
    })
    windowPane.appendChild(wcToggle.el)

    const themeRow = util.el('div', { class: 'window-theme-themes', role: 'radiogroup' })
    const radios = {}
    for (const id of ['none', 'sharp', 'bw', 'boxy']) {
      const r = util.el('div', { role: 'radio', tabindex: id === store().state.windowTheme ? '0' : '-1', value: id })
      r.innerHTML = CARBON.SVG.windowThemeIcons[id]
      r.addEventListener('click', () => store().set({ windowTheme: id }))
      radios[id] = r
      themeRow.appendChild(r)
    }
    const themeWrap = util.el('div')
    themeWrap.appendChild(themeRow)
    themeWrap.hidden = !store().state.windowControls
    windowPane.appendChild(themeWrap)

    const padRow = util.el('div', { class: 'row' })
    const padV = ui.slider({
      label: '内边距（纵向）',
      value: store().state.paddingVertical,
      maxValue: 200,
      onChange: v => store().set({ paddingVertical: v }),
    })
    const padH = ui.slider({
      label: '内边距（横向）',
      value: store().state.paddingHorizontal,
      onChange: v => store().set({ paddingHorizontal: v }),
    })
    padRow.appendChild(padV.el)
    padRow.appendChild(padH.el)
    windowPane.appendChild(padRow)

    const shadowToggle = ui.toggle({
      label: '投影',
      enabled: store().state.dropShadow,
      onChange: v => store().set({ dropShadow: v }),
    })
    windowPane.appendChild(shadowToggle.el)
    const shadowRow = util.el('div', { class: 'row drop-shadow-options' })
    const shadowY = ui.slider({
      label: '(offset-y)',
      value: store().state.dropShadowOffsetY,
      onChange: v => store().set({ dropShadowOffsetY: v }),
    })
    const shadowBlur = ui.slider({
      label: '(blur-radius)',
      value: store().state.dropShadowBlurRadius,
      onChange: v => store().set({ dropShadowBlurRadius: v }),
    })
    shadowRow.appendChild(shadowY.el)
    shadowRow.appendChild(shadowBlur.el)
    windowPane.appendChild(shadowRow)

    const widthToggle = ui.toggle({
      label: '自动调整宽度',
      enabled: store().state.widthAdjustment,
      onChange: v => store().set({ widthAdjustment: v }),
    })
    windowPane.appendChild(widthToggle.el)
    const widthRow = util.el('div', { class: 'settings-row row' })
    const widthInput = util.el('input', {
      class: 'plain-input',
      type: 'number',
      min: CARBON.DEFAULT_WIDTHS.minWidth,
      max: CARBON.DEFAULT_WIDTHS.maxWidth,
    })
    widthRow.appendChild(util.el('label', { text: '宽度' }))
    widthRow.appendChild(widthInput)
    windowPane.appendChild(widthRow)
    widthInput.addEventListener('input', () => {
      const n = util.clamp(Math.round(Number(widthInput.value) || 0), CARBON.DEFAULT_WIDTHS.minWidth, CARBON.DEFAULT_WIDTHS.maxWidth)
      store().set({ width: n })
    })

    const watermarkToggle = ui.toggle({
      label: '水印',
      enabled: store().state.watermark,
      onChange: v => store().set({ watermark: v }),
    })
    windowPane.appendChild(watermarkToggle.el)

    /* --- 编辑器页签 --- */
    const editorPane = util.el('div', { class: 'settings-content' })
    const fontPicker = fontSelect()
    editorPane.appendChild(fontPicker.el)
    const sizeSlider = ui.slider({
      label: '字号',
      value: store().state.fontSize,
      minValue: 10,
      maxValue: 18,
      step: 0.5,
      onChange: v => store().set({ fontSize: v }),
    })
    editorPane.appendChild(sizeSlider.el)
    const lhSlider = ui.slider({
      label: '行高',
      value: store().state.lineHeight,
      minValue: 90,
      maxValue: 250,
      unit: '%',
      onChange: v => store().set({ lineHeight: v }),
    })
    editorPane.appendChild(lhSlider.el)
    const lnToggle = ui.toggle({
      label: '行号',
      enabled: store().state.lineNumbers,
      onChange: v => store().set({ lineNumbers: v }),
    })
    editorPane.appendChild(lnToggle.el)
    const firstLineRow = util.el('div', { class: 'settings-row row' })
    const firstLineInput = util.el('input', { class: 'plain-input', type: 'number', min: '0' })
    firstLineRow.appendChild(util.el('label', { text: '起始行号' }))
    firstLineRow.appendChild(firstLineInput)
    editorPane.appendChild(firstLineRow)
    firstLineInput.addEventListener('input', () => store().set({ firstLineNumber: Math.max(0, Number(firstLineInput.value) || 0) }))
    const hiddenToggle = ui.toggle({
      label: '显示隐形字符',
      enabled: store().state.hiddenCharacters,
      onChange: v => store().set({ hiddenCharacters: v }),
    })
    editorPane.appendChild(hiddenToggle.el)

    /* --- 其它页签 --- */
    const miscPane = util.el('div', { class: 'settings-content' })
    const ioRow = util.el('div', { class: 'misc-row' })
    const fileInput = util.el('input', {
      type: 'file',
      accept: '.json',
      style: { display: 'none' },
      onchange: async e => {
        const json = await util.fileToJSON(e.target.files && e.target.files[0])
        if (!json) return toast('配置文件无法解析', { error: true })
        const { code, ...rest } = json
        store().replace(rest)
        select(tabs[2])
        toast('已导入配置')
      },
    })
    const importBtn = ui.button('导入配置', { center: true })
    importBtn.addEventListener('click', () => fileInput.click())
    const exportBtn = ui.button('导出配置', { center: true })
    exportBtn.addEventListener('click', () => {
      const settings = configForExport(store().state)
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
      const url = g.URL.createObjectURL(blob)
      const a = util.el('a', { href: url, download: 'carbon-config.json' })
      g.document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => g.URL.revokeObjectURL(url), 30000)
    })
    ioRow.appendChild(importBtn)
    ioRow.appendChild(exportBtn)
    miscPane.appendChild(ioRow)
    miscPane.appendChild(fileInput)

    const squaredToggle = ui.toggle({
      label: '导出为正方形',
      enabled: store().state.squaredImage,
      onChange: v => store().set({ squaredImage: v }),
    })
    miscPane.appendChild(squaredToggle.el)

    const resetBtn = ui.button('重置设置', { center: true, color: CARBON.COLORS.RED })
    resetBtn.addEventListener('click', () => {
      store().resetSettings()
      toast('已重置为默认设置')
    })
    miscPane.appendChild(resetBtn)

    const copyLinkBtn = ui.button('复制分享链接', { center: true })
    copyLinkBtn.addEventListener('click', () => copyText(CARBON.url.buildShareUrl(store().state)))
    miscPane.appendChild(copyLinkBtn)

    controls['窗口'] = windowPane
    controls['编辑器'] = editorPane
    controls['其它'] = miscPane

    function syncAll(s) {
      wcToggle.sync(s.windowControls)
      themeWrap.hidden = !s.windowControls
      for (const id of Object.keys(radios)) {
        const on = s.windowTheme === id
        radios[id].setAttribute('aria-checked', String(on))
        radios[id].setAttribute('tabindex', on ? '0' : '-1')
      }
      padV.sync(s.paddingVertical)
      padH.sync(s.paddingHorizontal)
      shadowToggle.sync(s.dropShadow)
      shadowRow.hidden = !s.dropShadow
      shadowY.sync(parseFloat(s.dropShadowOffsetY) || 0)
      shadowBlur.sync(parseFloat(s.dropShadowBlurRadius) || 0)
      widthToggle.sync(s.widthAdjustment)
      widthRow.hidden = !!s.widthAdjustment
      if (g.document.activeElement !== widthInput) widthInput.value = Math.round(s.width)
      watermarkToggle.sync(s.watermark)
      fontPicker.sync(s.fontFamily)
      sizeSlider.sync(parseFloat(s.fontSize))
      lhSlider.sync(parseFloat(s.lineHeight))
      lnToggle.sync(s.lineNumbers)
      firstLineRow.hidden = !s.lineNumbers
      if (g.document.activeElement !== firstLineInput) firstLineInput.value = s.firstLineNumber
      hiddenToggle.sync(s.hiddenCharacters)
      squaredToggle.sync(s.squaredImage)
      select(current)
    }

    select(current)
    wrap.appendChild(pop.el)
    return { el: wrap, pop, syncAll, open: () => pop.open(), anchor: btn }
  }

  function configForExport(s) {
    const out = {}
    for (const k of Object.keys(CARBON.DEFAULT_SETTINGS)) out[k] = s[k]
    return out
  }

  /* --- 字体选择（含本地上传） --- */
  function fontSelect() {
    const picker = ui.listSetting({
      title: '字体',
      items: () =>
        [{ id: 'upload', name: 'Upload +' }].concat(
          CARBON.FONTS.map(f => ({ id: f.id, name: f.name })),
          Object.keys(ui.uploadedFonts || {}).map(id => ({ id, name: id + '（已上传）' }))
        ),
      getSelected: () => store().state.fontFamily,
      renderItem: item => {
        const span = util.el('span', { text: item.name })
        if (item.id !== 'upload') span.style.fontFamily = CARBON.FONT_FALLBACKS[item.id] || item.id
        return span
      },
      onChange: id => {
        if (id !== 'upload') return store().set({ fontFamily: id })
        file.click()
      },
    })
    const file = util.el('input', {
      type: 'file',
      accept: '.otf,.ttf,.woff,.woff2',
      style: { display: 'none' },
      onchange: async e => {
        const f = e.target.files && e.target.files[0]
        if (!f) return
        const url = await util.fileToDataURL(f)
        const name = f.name.split('.')[0]
        try {
          const face = new FontFace(name, 'url(' + url + ')')
          await face.load()
          g.document.fonts.add(face)
          ui.uploadedFonts = ui.uploadedFonts || {}
          ui.uploadedFonts[name] = url
          store().set({ fontFamily: name, fontUrl: url })
          toast('已加载字体 ' + name)
        } catch (err) {
          toast('字体加载失败：' + err.message, { error: true })
        }
        picker.sync()
      },
    })
    const wrap = util.el('div')
    wrap.appendChild(picker.el)
    wrap.appendChild(file)
    return { el: wrap, sync: () => picker.sync() }
  }

  /* ------------------------------------------------------------------ 复制菜单 */

  function copyMenu() {
    const wrap = util.el('div', { class: 'copy-menu-container' })
    const btn = ui.button('', {
      border: true,
      center: true,
      large: true,
      class: 'btn-square-icon',
      title: '复制菜单',
      padding: '0 16px',
    })
    btn.innerHTML = CARBON.SVG.icons.copy
    wrap.appendChild(btn)

    const pop = ui.popout({ class: 'copy-popout', width: '160px', pointerRight: '24px', anchor: btn })
    const row = util.el('div', { class: 'copy-row' })
    row.appendChild(util.el('span', { text: '复制到剪贴板' }))
    const imageBtn = ui.button('图片', { center: true })
    const linkBtn = ui.button('分享链接', { center: true })
    row.appendChild(imageBtn)
    row.appendChild(linkBtn)
    pop.body.appendChild(row)

    imageBtn.addEventListener('click', async () => {
      if (!CARBON.exporter.supportsClipboard()) return toast('此浏览器不支持写入剪贴板图片', { error: true })
      imageBtn.disabled = true
      imageBtn.textContent = '复制中…'
      try {
        await CARBON.exporter.copyImage()
        toast('图片已复制')
      } catch (e) {
        toast('复制失败：' + e.message, { error: true })
      } finally {
        imageBtn.disabled = false
        imageBtn.textContent = '图片'
      }
    })
    linkBtn.addEventListener('click', () => copyText(CARBON.url.buildShareUrl(store().state)))
    pop.el.style.right = '0'
    wrap.appendChild(pop.el)
    return wrap
  }

  async function copyText(text) {
    try {
      await g.navigator.clipboard.writeText(text)
      toast('已复制：' + (text.length > 40 ? text.slice(0, 40) + '…' : text))
    } catch (e) {
      // file:// 或非安全上下文下 clipboard API 可能不可用 → 退回选中文本让用户 Ctrl+C
      const tmp = util.el('textarea', { style: { position: 'fixed', top: '-1000px' }, value: text })
      g.document.body.appendChild(tmp)
      tmp.select()
      let ok = false
      try {
        ok = g.document.execCommand('copy')
      } catch (e2) {
        ok = false
      }
      tmp.remove()
      toast(ok ? '已复制' : '复制失败，请手动复制（链接已在控制台打印）', { error: !ok })
      if (!ok) console.log(text)
    }
  }

  /* ------------------------------------------------------------------ 导出菜单 */

  function exportMenu() {
    const wrap = util.el('div', { class: 'export-menu-container' })
    const pair = util.el('div', { class: 'export-pair' })
    const quick = ui.button('导出', {
      border: true,
      center: true,
      large: true,
      class: 'quick',
      color: CARBON.COLORS.PURPLE,
      title: '快速导出 PNG',
    })
    const caret = ui.button('', {
      border: true,
      center: true,
      large: true,
      class: 'caret',
      color: CARBON.COLORS.PURPLE,
      title: '导出菜单',
    })
    caret.innerHTML = CARBON.SVG.icons.arrows.down
    pair.appendChild(quick)
    pair.appendChild(caret)
    wrap.appendChild(pair)

    const pop = ui.popout({ class: 'export-popout', width: '256px', color: CARBON.COLORS.PURPLE, pointerRight: '6px', anchor: caret })
    const rowName = util.el('div', { class: 'export-row' })
    rowName.appendChild(util.el('span', { class: 'filename', text: '文件名' }))
    const nameInput = util.el('input', { type: 'text', placeholder: 'carbon', title: 'filename' })
    rowName.appendChild(nameInput)
    const rowSize = util.el('div', { class: 'export-row' })
    rowSize.appendChild(util.el('span', { text: '倍率' }))
    const sizeGroup = util.el('div', { class: 'size-group' })
    const sizeButtons = {}
    for (const s of CARBON.EXPORT_SIZES) {
      const b = ui.button(s.name, { center: true, color: CARBON.COLORS.DARK_PURPLE })
      b.addEventListener('click', () => store().set({ exportSize: s.name }))
      sizeButtons[s.name] = b
      sizeGroup.appendChild(b)
    }
    rowSize.appendChild(sizeGroup)

    const rowActions = util.el('div', { class: 'export-row' })
    const openBtn = ui.button('新标签打开', { center: true, color: CARBON.COLORS.PURPLE })
    const saveBox = util.el('div', { class: 'save-container' })
    saveBox.appendChild(util.el('span', { text: '下载' }))
    const btns = util.el('div')
    const pngBtn = ui.button('PNG', { center: true, color: CARBON.COLORS.DARK_PURPLE, id: 'export-png' })
    const svgBtn = ui.button('SVG', { center: true, color: CARBON.COLORS.DARK_PURPLE, id: 'export-svg' })
    btns.appendChild(pngBtn)
    btns.appendChild(svgBtn)
    saveBox.appendChild(btns)
    rowActions.appendChild(openBtn)
    rowActions.appendChild(saveBox)

    pop.body.appendChild(rowName)
    pop.body.appendChild(rowSize)
    pop.body.appendChild(rowActions)

    function filename() {
      return nameInput.value || store().state.name || 'carbon'
    }

    function busy(node, on, label) {
      if (node.dataset.label == null) node.dataset.label = node.textContent
      node.disabled = !!on
      node.textContent = on ? label : node.dataset.label
    }

    async function run(node, format, options) {
      busy(node, true, '导出中…')
      try {
        await CARBON.exporter.exportImage(format, Object.assign({ filename: filename() }, options))
      } catch (e) {
        toast('导出失败：' + e.message, { error: true })
      } finally {
        busy(node, false)
      }
    }

    quick.addEventListener('click', () => run(quick, 'blob'))
    pngBtn.addEventListener('click', () => run(pngBtn, 'blob'))
    svgBtn.addEventListener('click', () => run(svgBtn, 'svg'))
    openBtn.addEventListener('click', () => run(openBtn, 'blob', { open: true }))

    nameInput.addEventListener('input', () => store().set({ name: nameInput.value }))
    wrap.appendChild(pop.el)

    function sync(s) {
      for (const k of Object.keys(sizeButtons)) sizeButtons[k].classList.toggle('is-active', k === s.exportSize)
      if (g.document.activeElement !== nameInput) nameInput.value = s.name || ''
    }

    return { el: wrap, sync, quick, svgBtn, pngBtn, openBtn }
  }

  /* ------------------------------------------------------------------ 文本复制兜底 */

  function toast(message, opts) {
    return ui.toast(message, opts)
  }

  CARBON.panels = {
    themeDropdown,
    languageDropdown,
    backgroundSelect,
    settingsPanel,
    copyMenu,
    exportMenu,
    toast,
    copyText,
  }
})(typeof window !== 'undefined' ? window : globalThis)
