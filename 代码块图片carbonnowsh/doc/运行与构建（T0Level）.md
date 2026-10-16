# 运行与构建（T0Level）

读者设定：你从没碰过这个工程。本文只写"照着做就能复现"的东西，每条命令都是本机跑过的，输出原样贴在对应小节；跑不了或没跑的，显式标 `未验证` 并说明原因，末尾有汇总。

工程是什么：carbon.now.sh 的离线复刻。入口是仓库根的 `index.html`，**没有构建步骤、没有 npm install、运行时零网络**——复杂的 JS 与数据按用户要求放在子目录（`js/`、`data/`、`vendor/`、`css/`、`fonts/`）。

---

## 0. 本文的章节映射（为什么标题和 WPF/Electron 那份不一样）

八节的**标题**是桌面工程口径。这里是纯前端静态页，硬套会写出不存在的东西（"打包成 exe""改 exe 图标"），所以按**三个不变量**移植，标题相应改名，映射理由逐条写明：

| 规范原节 | 本工程对应 | 为什么这样映射 |
| --- | --- | --- |
| 前置要求 | ① 前置要求 | 不变：装什么、什么版本、怎么核对 |
| 项目启动（首次构建） | ② 启动（无构建）与产物重算 | 本工程"启动"= 打开一个文件；真正需要构建的是 `vendor/`、`data/`、`fonts/`+`data/fonts.js`，它们已随仓库交付，所以这一节同时给"最短可跑路径"和"重算产物"两条 |
| 本地调试 | ③ 本地调试与验收判据 | 不变，但判据从"跑起来看看"换成一份静态审计 + 六套探针台（A–F，可机器检） |
| 打包与启动 | ④ 打包与启动（整目录分发） | 桌面工程要产出 dir/portable/nsis；这里的"产物"就是目录本身，所以打包=压缩目录，启动=解压后打开 |
| 修改标题 | ⑤ 改标题与文案 | 桌面=窗口标题；这里是 `<title>` + 页头文案 + 导出文件名前缀，三处都会波及用户所见 |
| 修改图标 | ⑥ 改图标与品牌资产 | 桌面=exe 图标；这里是页面 logo、水印 SVG、浏览器标签 favicon（本工程当前**没有** favicon，给了不引入网络请求的加法） |
| 发布·分发 | ⑦ 发布与分发 | 桌面=安装包/在线发布；这里两条分发面：整目录（离线）与 `?state=` 分享链接（把状态塞进 URL） |
| 注意事项 | ⑧ 注意事项与偏离清单 | 不变，且必须存在：交付面收窄到"改了会波及产物"的项 |
| （规范外，追加） | ⑨ 用户数据：localStorage 是什么、什么时候会丢、为什么不写配置文件 | 由 ⑦.4 那三条口径追出来的三连问。它不属于任何一节（既不是构建也不是打包），压进 ⑦ 会让"发布与分发"变成杂物间，压进 ⑧ 会让边界清单混进机制解释，所以另开一章并挂在这里。**编号排在 ⑧ 之后**是为了不动已有的 ⑦.4 / ⑧.3 / ⑧.4 交叉引用 |

---

## ① 前置要求

**只用来打开页面**：一个现代浏览器。不需要 Node、不需要网络、不需要管理员权限。

**要跑判据或重算产物**才需要 Node（本文实测口径 v24.21.0）。

版本核对（本机真实输出）：

```powershell
PS> node -v
v24.21.0
```

```powershell
PS> $p = Join-Path "C:\Program Files (x86)\Microsoft\Edge\Application" "msedge.exe"; $vi = (Get-Item -LiteralPath $p).VersionInfo; Write-Output ("EdgeFileVersion=" + $vi.FileVersion); Write-Output ("PSVersion=" + $PSVersionTable.PSVersion.ToString())
EdgeFileVersion=155.0.4283.45
PSVersion=5.1.26100.9711
```

坑（实测踩过）：**别用 `msedge --version` 取版本号**。这台机器上它输出的是本地化的中文句子，经 Git Bash 管道后是乱码（`??????????????Ự`），拿到的是垃圾字节而不是版本。要版本号就走上面 `VersionInfo.FileVersion` 这条路。

系统口径：win32 10.0.26300，PowerShell 5.1（不是 pwsh 7）。本文所有 PowerShell 命令按 5.1 语法写，不含 `&&`。

---

## ② 启动（无构建）与产物重算

### 2.1 最短可跑路径

1. 拿到整个目录（不要只拷 `index.html`，它靠相对路径引 27 个本地文件：24 个 script + 3 个 css）。
2. 双击 `index.html`。或在浏览器地址栏里指到它的绝对路径。

预期：黑底页面，顶部黄色 `carbon` 字样，中间是带红黄绿窗口点的代码画布，工具栏能换主题/语言/背景色，右上「导出」能出图。

`未验证`：本轮取证全程用**无头** Edge，没有真的开过一次可见窗口双击文件。可见窗口的等价验证是 2.2 的无头 `file://` 加载 + 截图，两者用的是同一个内核同一套相对路径解析。

### 2.2 用命令行确认它能起来（不需要人眼）

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --window-size=1440,1040 --virtual-time-budget=6000 --user-data-dir="D:\tmp\edge-probe-profile" --screenshot="D:\tmp\shot1.png" "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/index.html"
```

本机真实输出：命令本身无 stdout（无头模式的正常表现），退出码 0。两张图落盘后拷进了 `doc/`：

```powershell
PS> [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-ChildItem -LiteralPath ".\doc" | ForEach-Object { "{0}  {1} B" -f $_.Name, $_.Length }
截图-1-默认.png  74472 B
截图-2-状态参数.png  75069 B
运行与构建（T0Level）.md  34583 B
```

坑（实测踩过）：不加 `[Console]::OutputEncoding = UTF8` 这一句，中文文件名经 Git Bash 管道回来是 `ͼ-1-Ĭ.png` 这样的乱码——数字是对的，名字全废。本文所有 PowerShell 片段如果要回显中文，都带上这句。

（`--screenshot` 必须给**绝对路径**，给相对路径时 Edge 会静默不写文件。`--user-data-dir` 也要绝对路径，且每次换一个目录，否则会被上一轮没退干净的 profile 锁住。）

两张图已作为基线留在仓库里，见 `doc/截图-1-默认.png`、`doc/截图-2-状态参数.png`。第二张是带 URL 参数启动的：

```
index.html?t=dracula&wt=boxy&wc=true&ln=true&wm=true&pv=40px&ph=40px&bg=rgba(74,144,226,1)
```

### 2.3 重算 `vendor/`（只在升级依赖时做，需要联网）

```powershell
PS> node tools/build-vendor.js
```

本机真实输出（尾部）：

```
  highlightAuto(mixed) → csharp (rel 12)
  highlightAuto(cpp) → cpp (rel 14)

[OK] vendor/ 全部产物就位并通过 node 实测校验
  vendor/codemirror.min.js  169899B  sha1 ed863419  (阈值 150000)
  vendor/codemirror.min.css  6037B  sha1 f72a15fb  (阈值 5000)
  vendor/addons.js  16691B  sha1 89d268e5  (阈值 2000)
  vendor/modes.js  395357B  sha1 a2d42ed7  (阈值 60000)
  vendor/custom-modes.js  51252B  sha1 278be7a6  (阈值 20000)
  vendor/hljs.min.js  135556B  sha1 f4527fcc  (阈值 100000)
  vendor/hljs-languages.js  196921B  sha1 55562311  (阈值 40000)
  vendor/dom-to-image.js  23800B  sha1 c60f5cfb  (阈值 22000)
```

只校验不下载（离线可用，判据用这一条就够）：

```powershell
PS> node tools/build-vendor.js --verify-only
```

输出与上面 `[OK]` 段逐字相同，退出码 0。每个产物有**字节下限阈值**，产物被截断/下错版本会直接红，不会静默过关。

### 2.4 重算 `data/`（离线可跑，源在仓库里）

上游 v4.9.10 的原始源码文件已经固化进 `tools/upstream/`（33 文件 / 571.8 KB），`data/` 由它们生成，所以**不需要联网**：

```powershell
PS> node tools/build-data.js --check
```

本机真实输出（尾部）：

```
  data/languages.js      7183B  sha1 6dca543c  unchanged
  data/presets.js        6641B  sha1 76690ba5  unchanged
  data/svg.js          107611B  sha1 ecaf96d1  unchanged
  回读：主题 29 × 12 keys，语言 78，预设 8，字体 13，色板 15，窗口控件 4 型 + 单选图标 4 型
  已修正上游缺陷: light '9e9e9e' → '#9e9e9e'
[OK] data/ 全部产物就位并通过 vm 回读校验
```

退出码 0。`--check` 只比对不写盘；去掉 `--check` 才是重新生成。那行 `已修正上游缺陷` 是刻意的：上游 `components/svg/Watermark.js` 的浅色分支写成了 `fill={light ? '9e9e9e' : ...}`，少了 `#`，生成器补上并**报告**它补了什么，不静默改数据。

### 2.5 重算 `fonts/` 与 `data/fonts.js`（字体面，需要联网才能首次抓取）

上游那 13 个编辑器字体本来在运行时从 Google Fonts 拉。本工程零网络，所以字体字节必须在构建期落盘。这一步是**双份**：

| 产物 | 给谁用 | 为什么必须有 |
| --- | --- | --- |
| `fonts/*.woff2`（+ `fonts/manifest.json`） | 磁盘上的真字体文件 | 生成 `data/fonts.js` 的原料，也是"字体上传"之外唯一能人工核对的原件 |
| `css/fonts.css`（外链，src 指向 `../fonts/`） | **预览** | 浏览器加载 `file://` 同目录的字体文件是允许的，所以预览吃这一份 |
| `data/fonts.js`（`CARBON.FONT_FACES_CSS`，src 全是 `data:` URI） | **成图** | dom-to-image 扫 `document.styleSheets[].cssRules` 找 `@font-face`，而 `file://` 下**外链**表的 `cssRules` 一律抛 `SecurityError` → 扫不到 → 导出的图用系统回退字体画字。同一文档的内联表读得到，所以字体字节必须以 data: URI 再带一份 |

三挡命令（本机真实输出）：

```powershell
PS> node tools/build-fonts.js            # 抓取(缓存命中则不联网) + 落 fonts/ + 生成两份产物
PS> node tools/build-fonts.js --check    # 离线：盘上字节 ↔ manifest ↔ 两份产物 逐族比
PS> node tools/build-fonts.js --verify   # 离线：只验文件在不在、魔数对不对、字节过阈值
```

`--check` 的真实输出（13 行表 + 首行结论）：

```
[OK] fonts/ 13 个字体与 manifest 逐条一致；css/fonts.css 含 13 段 @font-face；data/fonts.js 含 13 段且 base64 与 fonts/ 逐族同 sha1
  anonymous-pro.woff2            17528B  sha1 4798b6f2  Anonymous Pro
  cascadia-code.woff2            29452B  sha1 5b6f5e5a  Cascadia Code
  droid-sans-mono.ttf            32944B  sha1 781658ee  Droid Sans Mono
  fantasque-sans-mono.woff       29080B  sha1 c9fd06f1  Fantasque Sans Mono
  fira-code.woff2                23312B  sha1 58f7ef12  Fira Code
  hack.woff2                     23244B  sha1 1590848b  Hack
  ibm-plex-mono.woff2            14708B  sha1 bb87500e  IBM Plex Mono
  inconsolata.woff2              17664B  sha1 2bc8e1ea  Inconsolata
  jetbrains-mono.woff2           21168B  sha1 3ae62151  JetBrains Mono
  monoid.woff                    21392B  sha1 9c735728  Monoid
  source-code-pro.woff2          11656B  sha1 ef3384bd  Source Code Pro
  space-mono.woff2               16520B  sha1 e2ee2d37  Space Mono
  ubuntu-mono.woff2              27300B  sha1 5f09ce68  Ubuntu Mono
```

`--verify` 的首行（同 13 行表，只把结论换成魔数口径）：

```
[OK] fonts/ 13 个字体魔数与字节达标；css/fonts.css 含 13 段 @font-face；data/fonts.js 含 13 段且 base64 与 fonts/ 逐族同 sha1
```

三条踩过的坑，都写进了判据里：

1. **`@font-face` 段数不能靠全文计数**。生成文件的头部注释里也出现 `@font-face` 这个词，先计数会得到 14。现在先 `replace(/\/\*[\s\S]*?\*\//g,'')` 剥注释，再断言段数 == 条目数。
2. **坏 CSS 会一路绿到底**。上一版生成器把 `format('woff2')` 的单引号漏成 `format('woff2)`，整条 `@font-face` 是坏的、浏览器直接丢掉这条规则，而宽松正则照样匹配得上 → `--check` 一片绿、`--dump-dom` 的预览也照样对（预览吃的是 `css/fonts.css`），只有成图静默没字体。现在 `--check` 按**整条规则的完整形状**（含闭合的 `format('…')`）取，并把 base64 解码回来逐族比 sha1 与字节。自证：

   ```
   PS> node tools/build-fonts.js --check
   [FAIL] data/fonts.js 里有一条 @font-face 形状不对（缺 format('…') 闭合？）：@font-face{font-family:'Anonymous Pro';font-style:normal;font-weight:400;src:url(data:font…
   exit=1
   ```
3. **族名必须与 `data/settings.js` 的 `CARBON.FONTS[].id` 逐字相同**（`font-family` 靠字符串匹配），审计里「成图字体链路」那条是双向对齐：缺族要红，多族也要红。

---

## ③ 本地调试与验收判据

改代码不需要任何构建动作：文件是 classic script，浏览器刷新即生效（`Ctrl+Shift+R` 避免缓存）。

判据一共九小节：一份静态审计（3.1，秒级）+ 六套探针台（3.2–3.5、3.7、3.9）+ 一节 HTTP 口径对照（3.6）+ 一个手工调试入口（3.8），从快到慢。**改哪一面就跑哪一挡**，不用每次全跑。

### 3.1 静态审计（秒级，离线，不需要浏览器）

```powershell
PS> node tools/audit.js
```

本机真实输出（22 条判据全绿 + 6 条显式未验证；`[产物清单]` 段略）：

```

=== audit: . ===

[已核 22]
  ✓ 零网络判据自身的反向自测 — 抓到 3 处合成违规 / 放过注释与命名空间
  ✓ 零运行时网络引用 — 扫描 28 个文件；点名豁免 1 处（上游 XHR）
  ✓ 无 ES module / 无绝对路径 — 27 个引用全部为相对路径 classic script/css
  ✓ 依赖加载顺序 — script 24 个 + css 3 个，顺序约束全通过
  ✓ 每个页面 JS 都能过语法关 — 24 个 js 文件语法全通过（含 vendor 与 data）
  ✓ 数据全局契约 — 29 主题 × 12 键配平，13 字体均有回退栈，25 个默认设置项
  ✓ SVG 资产契约 — 20 段 svg 可用、无 JSX 残留、色值合法
  ✓ URL 参数编解码回环 — 2 组样本 × 22 键全等；sl/ds/fl 型别正确；>4000 字符软截断生效（2000）
  ✓ 设置项都有落点 — 25 个设置项有落点；URL 键 22 个与上游一致
  ✓ 带 px 单位的设置项都在 PX_KEYS 归一化清单里 — px 型设置 5 个（paddingVertical, paddingHorizontal, dropShadowOffsetY, dropShadowBlurRadius, fontSize）与清单双向对齐
  ✓ data-slot 契约 — 7 个 slot 双向对齐：logo,theme-dropdown,language-dropdown,background-select,settings,copy-menu,export-menu
  ✓ 每个 popout 都被挂进文档 — 5 个 popout 全部 appendChild 到位
  ✓ CSS 结构 — 规则块 226 配平；变量定义 11，引用 119，其中 JS 现设 0（无）
  ✓ hidden 真隐藏（作者层 display 盖不掉它） — [hidden]{display:none !important} 就位；带作者层 display 且被 JS 当类名用的有 48 个（全靠这条兜底）
  ✓ 成图字体链路（预览外链 + 成图内联表） — 13 族双向对齐；挂载调用点 3284 早于 domtoimage.to 4010
  ✓ dom-to-image 保留上游前缀 — 上游 22770B 为严格前缀，追加 1030B 全局桥接
  ✓ vendor 核心与上游字节一致 — codemirror.min.js 169899B / codemirror.min.css 6037B
  ✓ hljs 检测面与上游同构 — 注册 71 → 白名单内 57（退订 14：bash,c,cpp,http,ini,less,makefile,php-template,plaintext,properties,python-repl,scss,vbnet,xml）；DEFAULT_CODE→javascript，python→python
  ✓ 语言到 CM mode 的覆盖 — mode 60 + 自定义 5；声明且确实不可用：GraphQL(graphql)
  ✓ build-vendor --verify-only —   vendor/dom-to-image.js  23800B  sha1 c60f5cfb  (阈值 22000)
  ✓ build-data --check — data/ 与上游一致
  ✓ build-fonts --check — [OK] fonts/ 13 个字体与 manifest 逐条一致；css/fonts.css 含 13 段 @font-face；data/fonts.js 含 13 段且 base64 与 fonts/ 逐族同 sha1（族数与 CARBON.FONTS 的 13 对齐）

[探针已覆盖 10]（本脚本不重复证明，跑法与数值见 doc 第 3 节）
  · 导出 PNG/SVG 的字节与所见即所得 — tools/probe/verify.html 的 png/png1x/squared/svg 四步
  · 运行时 0 网络请求 — 同上 net 步（XHR/fetch/Image.src/a.href 钩子 + performance 条目，file:// 与 http:// 两口径）
  · file:// 下 localStorage 读写 — 同上 storageProbe 与 persist 两步（含 CARBON_STATE 的排除字段）
  · 隐形字符开/关 — 同上 afterInvisibles / afterInvisiblesOff
  · 选中行淡化 — tools/probe/verify2.html「非选中行被淡化」
  · 自定义主题创建 / 预设应用与撤销 / 三页签设置 / hidden 兜底 — tools/probe/verify2.html 共 50 项
  · 13 个字体族是否各自解析到自己的 face（预览面）— tools/probe/verify3-font.html
  · 成图里到底嵌没嵌字体 + 光栅化环境能否吃到嵌入 face — tools/probe/verify4-exportfont.html
  · file:// 下外链样式表 cssRules 抛 SecurityError、内联表可读（根因）— tools/probe/verify5-facecss.html
  · 预设落哪个键 / 内置 8 个不落盘 / 配额写不进时静默 — tools/probe/verify6-presetstore.html（全程点真 UI）

[未验证 6]（需实机，不假装通过）
  ? 真实渲染：125% 系统 DPI 下预览与导出图是否一致 — 无头跑固定 deviceScaleFactor=1，量不到系统缩放；需人眼对照 doc/截图-*.png
  ? 剪贴板写入图片（ClipboardItem）— 无头环境无剪贴板权限，且用户手势（Ctrl+C）不可合成
  ? 字体上传 new FontFace().load() 成功路径 — 需真实挑选一个本机 ttf/woff 并等异步 load
  ? 上传的字体能不能进成图 — fontUrl 走运行时 new FontFace() 注册，不在任何样式表里，dom-to-image 的 cssRules 扫描拿不到它；内置 13 族已证能进图（verify4），这一半没测
  ? 拖文件导入（drop 事件带 DataTransfer 文件）— 无头合成 dragenter/drop 拿不到真实 File
  ? PNG/SVG 导出后浏览器另存与「打开」按钮 — 需要真实下载/新标签行为

[OK] 静态判据全部通过
```

退出码：`node tools/audit.js > $null; echo $LASTEXITCODE` → `0`。任何一条判据红，退出码 1。

这份审计**自己会验自己**：第 1 条「零网络判据自身的反向自测」故意造 3 处违规喂给扫描器，要求它抓到并放过注释与 XML 命名空间。不这么做的话，"扫到 0 处"和"扫描器坏了"是同一个读数。

### 3.2 探针台 A：布局 / 导出 / 网络 / 持久化

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --window-size=1440,1040 --virtual-time-budget=60000 --user-data-dir="D:\tmp\edge-pA" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify.html" > "$env:TEMP\verify.dom"
```

产物是整页 DOM，末尾有一段 `<pre id="verify-json">VERIFY_JSON{...}`，取出来即判据。本机真实数值（1440×1040 视口，`file://` 口径，**字体面修好之后**）：

```json
{ "ok": true, "hung": [],
  "layout": {
    "toolbar": [1346,40,35,83], "bgDisplay": [40,40,557,83],
    "settingsBtn": [40,40,605,83], "exportBtn": [92,40,1264,83],
    "canvasArea": [1346,391,35,139], "exportContainer": [875,391,270,139],
    "editor": [763,279,326,195], "windowControls": [749,24,340,205],
    "handler": [8,279,1082,195], "popoutMounted": 4,
    "mode": "javascript",
    "detection": { "allowed": 57, "registered": 57, "removed": 14 },
    "computed": { "containerPadding": "56px", "editorPadTop": "48px",
      "editorFont": "Hack", "editorFontSize": "14px", "editorLineHeight": "18.62px",
      "shadow": "rgba(0, 0, 0, 0.55) 0px 20px 68px 0px", "radius": "5px",
      "bg": "rgb(171, 184, 195)", "keywordColor": "rgb(230, 205, 105)" } },
  "png":  { "bytes": 205541, "type": "image/png", "head": "89 50 4e 47 0d 0a 1a 0a 00 00 00 0d" },
  "png1x":{ "bytes": 85414 }, "squared": { "bytes": 99631 }, "pngAfter": { "bytes": 31840 },
  "svg":  { "bytes": 1031971, "type": "image/svg+xml",
            "startsWith": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1750\" height=",
            "hasForeignObject": true, "hasCodeMirror": true, "hasCursors": false,
            "hasEliminate": false, "hasNbsp": false, "hasBadPct": false, "keywordCount": 7 },
  "sizeCheck": { "offset": [875,391], "expect2x": [1750,782] },
  "net":  { "scheme": "file:", "origin": "file://", "attempted": [], "resourceEntries": 0,
            "nonFile": 0, "foreignOrigin": 0, "foreignList": [], "dataOrBlob": 0 },
  "persist": { "bytes": 553, "theme": "dracula", "language": "javascript", "keys": 26,
               "hasCode": false, "hasBackgroundImage": false },
  "afterTheme": { "theme": "dracula", "bg": "rgb(40, 42, 54)", "keyword": "rgb(255, 121, 198)" },
  "afterLang":  { "mode": "python", "keyword": "rgb(255, 121, 198)", "lines": 3 },
  "afterToggles": { "gutters": 1, "watermarkBytes": 37879, "wcSvg": "58", "shadow": "none" },
  "afterInvisibles": { "state": true, "marks": 10,
                       "kinds": { "cm-space": 6, "cm-newline": 3, "cm-tab": 1 } },
  "afterInvisiblesOff": { "marks": 0 } }
```

每个数怎么读：

- `exportBtn [92,40,...]`、`bgDisplay [40,40,...]`：工具栏按钮 40px 高。曾经量到 `[92,19]` 和 `[40,2]`——那是 `.toolbar{align-items:flex-start}` 把子项压成内容高，删掉这条才有上游的 40px。
- `sizeCheck.offset [875,391]` 对 `expect2x [1750,782]`：导出图尺寸 = 画布尺寸 × 倍率，2x 恰好翻倍。
- **字体生效与否会写进几何里，这组数就是它的旁证。** 打包 13 个 woff2 之前（画布吃系统回退字体）同一批读数是 `editor [700,279,358,195]`、`svg width=1624`、`png 190322`；带上字体后 `editor` 宽 358→326、`svg` 1624→1750、`png` 190322→205541。原因是默认族 `Hack` 的 advance 与回退族不同 → 行宽变 → `autoWidth` 算出的画布宽变 → 2x 尺寸与字节全变。**换了字体而这几项一个没动，就是字体没生效**（正面判据在 ③.4）。
- `svg.hasCursors=false` / `hasEliminate=false`：`CodeMirror-cursors` 与 `eliminateOnRender`（白色/棋盘底）被 filter 掉了，不会进图。
- `svg.hasNbsp=false` / `hasBadPct=false`：SVG 后处理五步替换生效（`&nbsp;`→`&#160;`、`%23`→`#`、`%0A`→换行、裸 `&`→`&amp;`、删掉非当前族的 `@font-face`——最后这条现在才真的删得到东西，见 ③.5）。
- `png.head`：`89 50 4e 47 0d 0a 1a 0a` 是 PNG 签名，证明拿到的是真图不是空 Blob。
- `persist.keys=26` 且 `hasCode=false`：`CARBON_STATE` 落盘时排除了 code / backgroundImage / highlights / themes / fontUrl / selectedLines / name（与上游同名同口径）。
- `afterInvisiblesOff.marks=0`：关掉隐形字符要**清得干净**。这条曾经量到 7，因为 CM5 的 `getAllMarks()` 拿不到 `replacedWith` 节点，靠反查节点属性清标记是清不掉的——现在 `js/invisibles.js` 自己记账（WeakMap）。

### 3.3 探针台 B：50 项交互冒烟

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --window-size=1440,1040 --virtual-time-budget=120000 --user-data-dir="D:\tmp\edge-pB" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify2.html" > "$env:TEMP\smoke.dom"
```

本机真实读数：`{"total":50,"pass":50}`，`errors=[]`，页面 `console.error` 捕获为空。它覆盖：主题下拉 30 项（29 主题 + Create+）→ 选 Monokai 后画布底色 `rgb(39,40,34)`；语言下拉 78 项 + 输入 `py` 过滤；背景取色器拖 hue（`rgba(171, 184, 195, 1)`→`rgba(183,195,171,1)`）/ 15 预设色 / 手输 hex；设置面板三页签、4 条滑杆、窗口主题四挡、字号、行号（gutter 12 个）、隐形字符（71 个标记，关掉清到 0）；预设应用与撤销；自建主题（12 个 token 色位 → Create+ 写进 `CARBON_THEMES`，主题数 29→30，`localStorage` 370B）；点行号淡化；导出面板 1x/2x/4x 与文件名；`CARBON_STATE` 落盘；4x PNG 与 SVG 字节。

第 29–35 项是**这一轮新增的 `hidden` 扫面**（对应用户报的缺陷 2），每条都量计算样式 `display` 的真值而不是量布尔位：

| # | 项 | 读数 |
| ---: | --- | --- |
| 27 | 出现「已应用预设」条与撤销 | `{}`（只断言这条栏真的被画出来） |
| 29 | 撤销后「已应用预设」条真的不画 | `display: none` |
| 30 | 预设收起按钮把内容真隐藏 | `display: none` |
| 31 | 预设再点一次恢复展开 | `display: flex` |
| 32 | 关掉后这些行/区块真的不画 | `wc:none, shadow:none, w:none` |
| 33 | 重新打开后它们又都画出来 | `wc:flex, shadow:flex, w:flex` |
| 34 | 关行号后「起始行号」行真的不画 | `display: none` |
| 35 | 开行号后「起始行号」行又画出来 | `display: flex` |

第 34/35 两条曾经**假绿**：探针在「窗口」页签上量 `起始行号` 那一行，而那行属于「编辑器」页签，本来就是 `none` → 关着也过、开着也过。改成先 `click(tabs[1])` 再量，才拿到 `none`↔`flex` 这对真读数。

四条踩过的坑，写在这里免得下一个人重踩：

1. **点行号必须带真实坐标。** CM5 的 `gutterEvent` 按 `clientX/clientY` 命中测试，**不看 `event.target`**。合成事件写 `clientX:10, clientY:10` 时 `selectedLines` 一直是 `null`，看着像功能坏了。给出行号元素的中心坐标后才量到 `sl=[1]`、非选中行 `opacity=0.5`。
2. **`hidden` 属性不等于不画。** `.row`/`.settings-row`/`.window-controls`/`.settings-presets-content` 这些类在作者层写了 `display:flex`，与 UA 的 `[hidden]{display:none}` 特异性相同（0,1,0）→ 作者层胜出 → 点收起按钮后状态位翻了对、元素还在。修在基座层：`css/app.css` 加 `[hidden]{display:none !important}`，一条盖住全部（审计里统计到 48 个"带作者层 display 又被 JS 当类名用"的类靠这条兜底）。判据必须量**计算样式**，量 `el.hidden` 会永远绿。
3. **探针要能自己变红。** `net` 那一步在 `file://` 下 `resourceEntries=0`——Chromium 不给本地文件记资源条目，所以"0 条"既可能是"没联网"也可能是"探针瞎了"。用同一个探针跑本机 HTTP 做对照（③.6），`resourceEntries=81` 说明它看得见，`foreignOrigin=0` 才是"没出本机"的真凭据。
4. **切语言前要把过滤词清掉。** 上一项在搜索框里留下的 `py` 会让下一次打开下拉只剩 Python，"选 Rust"就选不到 → 假红。`items` 断言前先复位输入框。

### 3.4 探针台 C：预览字体面（13 个族有没有各自的 face）

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --window-size=1440,1040 --virtual-time-budget=60000 --user-data-dir="D:\tmp\edge-pC" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify3-font.html" > "$env:TEMP\font.dom"
```

本机真实读数：

```json
{ "summary": { "total": 13, "ownFaceCount": 13, "ownFaceMissing": [],
               "bogusWidth": 206.27, "distinctRenderedTextWidths": 9,
               "textWidthHistogram": { "217.09": 2, "224.8": 1, "237.17": 1, "254.39": 1,
                                        "260.58": 4, "260.64": 1, "261.48": 1, "265.83": 1, "289.52": 1 },
               "wiringOk": true, "lineInherits": true },
  "notes": ["画布里有 .CodeMirror-line = true"] }
```

每条还带 `stackOnHost` / `stackOnLine` / `textWidth` / `soloWidth` / `advancePx`，例如：

```json
{ "id": "Anonymous Pro", "stateWrote": true,
  "stackOnHost": "\"Anonymous Pro\", Consolas, monospace",
  "stackOnLine": "\"Anonymous Pro\", Consolas, monospace",
  "inheritsFromHost": true, "textWidth": 237.17, "soloWidth": 236.92,
  "resolvesToOwnFace": true, "advancePx": 7.643 }
```

四个数各自咬住一件事：

- `resolvesToOwnFace`：**该族单跑一遍的宽度 ≠ bogus 基线（206.27）**。`bogusWidth` 是一个肯定不存在的族名量出来的宽度，"没装/没打包"时所有族都等于它。13/13 不等 → 13 个族都有自己的 face。
- `wiringOk`：字体栈的**第一个**族名必须逐字等于 `CARBON.FONTS[].id`。这条曾经假红——用 `stack.indexOf(id.replace(/ /g,''))` 比，带空格的族名在栈里是带引号的，永远不中。
- `lineInherits`：`.CodeMirror-line` 上的 computed `font-family` 要等于宿主上的，中间有规则截断就会不等。
- `distinctRenderedTextWidths = 9`（不是 13）：**这是正常的**，别拿"13 个族应有 13 种宽度"当判据。等宽字体里 advance 相同是合法的——`260.58` 那 4 个都是 0.6em 一族（14px × 0.6 = 8.4px × 28 字符 = 235.2…实度量到 260.58 是因为族内 fallback 一致）。判"有没有自己的 face"只能跟 bogus 基线比，不能横向数宽度种类。
- 为什么必须 `await document.fonts.load()` 再量：字体是懒加载的，不等它 load 完就量，量到的是回退字体的宽度，读数会**假阴**（实测 4 个族挤在同一个宽度）。

### 3.5 探针台 D：成图字体面 + 根因

字体修到"预览对"只算修了一半：**导出的 PNG/SVG 用的是另一套字体解析环境**。这一步的量法与读数：

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --window-size=1440,1040 --virtual-time-budget=150000 --user-data-dir="D:\tmp\edge-pD" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify4-exportfont.html" > "$env:TEMP\expfont.dom"
```

`file://` 口径本机真实读数（两个真族 + 一个不存在的族当对照）：

```json
{ "summary": { "cases": 3, "distinctPreviewWidths": 3, "distinctRealPngHashes": 2,
               "svgFontFaceCounts": [1, 1, 0],
               "svgBytes": [350507, 349088, 326712],
               "embeddedFamilyMatches": true, "bogusHasNoFace": true,
               "previewHonorsFont": true, "exportHonorsFont": true,
               "installedFamilyResolvesBare": true, "bundledFamilyMissingBare": true,
               "embeddedFaceChangesRaster": true },
  "raster": { "anonFaceFound": true, "anonBare": 111, "bogusBare": 111, "monoBare": 111,
              "consolasBare": 121, "anonEmbedded": 118, "spaceEmbedded": 135 } }
```

- `svgFontFaceCounts [1,1,0]`：导出 SVG 里当前族那一段 `@font-face` 在（`data:font/woff2;base64,`），对照族 0 段——修之前这里是 `[0,0,0]`。
- `embeddedFaceChangesRaster`：**这才是"嵌进去就够了"的直接证据**。`inkWidth()` 把一段只有 `MMMMMMMMMM` 的 SVG 当图片光栅化、量透明底上的墨迹横向跨度：不嵌 face 时 `Anonymous Pro` 量到 111px（= 不存在的族 = `monospace`），把 `data/fonts.js` 里那条 face 塞进 SVG 后量到 118px，`Space Mono` 135px。
- `installedFamilyResolvesBare` / `bundledFamilyMissingBare`：对照组。本机注册表只装了 `Cascadia Code`、`Consolas`（`Anonymous Pro`、`Space Mono`、`Hack` 等 11 个都没装），所以 `Consolas` 不嵌也能解析（121px ≠ 111px），而打包的族不嵌就一定解析不出——这条把"为什么必须有第二份 base64"钉成了实测，而不是说法。
- `distinctRealPngHashes = 2`：两个真族的 PNG 哈希不同（`a0220bd5:29662` vs `5477837a:31527`）。**但这条单独不构成判据**：修之前三个族的哈希也互不相同（`facf51d4:29726` / `14a95be2:30310` / `a3039a92:27967`），因为画布几何是按预览字体算出来、被烘进导出尺寸的，字形却仍是回退字体。真正的判据是上面那条墨迹宽度，和"修之前 `[0,0,0]`、修之后 `[1,1,0]`"这组对照。对照组 bogus 族修前修后都是 `a3039a92:27967`——没 face 可靠它嵌，本来就动不了。

根因单独有一个只读探针，因为它跟字体本身无关，跟"外链样式表在 `file://` 下读不到"有关：

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --virtual-time-budget=8000 --user-data-dir="D:\tmp\edge-pE" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify5-facecss.html" > "$env:TEMP\facecss.dom"
```

```json
{ "sheets": [
    { "hrefGuess": "../../css/fonts.css", "state": "SecurityError: Failed to read the 'cssRules' property from 'CSSStyleSheet': Cannot access rules", "rules": null, "fontFaceRules": null },
    { "hrefGuess": "#inline-face", "state": "ok", "rules": 1, "fontFaceRules": 0 } ],
  "afterInsert": [
    { "hrefGuess": "../../css/fonts.css", "state": "SecurityError: …Cannot access rules" },
    { "hrefGuess": "#inline-face", "state": "ok", "rules": 2, "fontFaceRules": 1 } ] }
```

外链表（`css/fonts.css`）读 `cssRules` 必抛，同文档的内联表读得到、还能 `insertRule`——所以 `js/export.js` 的 `ensureFontFaceStyle()` 把 `CARBON.FONT_FACES_CSS` 挂成内联 `<style id="carbon-font-faces">`，而且**只在外链表读不到时才挂**（`linkedFontFacesReadable()` 先扫一遍，扫到 `@font-face` 就跳过），这样 `http://` 口径仍然走 dom-to-image 自己的抓取+内联（与线上同构），不会两边各嵌一份。

### 3.6 HTTP 口径对照（证明不是只会在 file:// 下活着）

```powershell
PS> node -e "const http=require('http'),fs=require('fs'),path=require('path');const root=process.cwd();const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(root,p);if(!f.startsWith(root)){s.writeHead(403).end('403');return}fs.readFile(f,(e,b)=>{if(e){s.writeHead(404).end('404 '+p);return}s.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});s.end(b)})}).listen(8123,'127.0.0.1',()=>console.log('serving '+root+' on http://127.0.0.1:8123/'))"
```

```
serving C:\Users\webtu\Desktop\代码块图片carbonnowsh on http://127.0.0.1:8123/
```

另开一个终端：

```powershell
PS> curl.exe -sS -o NUL -w "index.html HTTP=%{http_code} bytes=%{size_download}`n" http://127.0.0.1:8123/index.html
PS> curl.exe -sS -o NUL -w "css/fonts.css HTTP=%{http_code} bytes=%{size_download}`n" http://127.0.0.1:8123/css/fonts.css
PS> curl.exe -sS -o NUL -w "fonts/hack.woff2 HTTP=%{http_code} bytes=%{size_download} type=%{content_type}`n" http://127.0.0.1:8123/fonts/hack.woff2
PS> curl.exe -sS -o NUL -w "data/fonts.js HTTP=%{http_code} bytes=%{size_download}`n" http://127.0.0.1:8123/data/fonts.js
PS> curl.exe -sS -o NUL -w "missing HTTP=%{http_code}`n" http://127.0.0.1:8123/nope.js
```

```
index.html HTTP=200 bytes=3758
css/fonts.css HTTP=200 bytes=2568
fonts/hack.woff2 HTTP=200 bytes=23244 type=font/woff2
data/fonts.js HTTP=200 bytes=383612
missing HTTP=404
```

上面那台临时服务器的 mime 表要带 `.woff2 → font/woff2`、`.woff → font/woff`、`.ttf → font/ttf`，否则字体走 HTTP 口径时拿不到正确 MIME（`file://` 口径不吃这个，所以只有这一挡需要）。

再把 3.2 的探针 URL 换成 `http://127.0.0.1:8123/tools/probe/verify.html`（虚拟时间要给足，这条路上 dom-to-image 会同源 XHR 抓 13 个字体：`--virtual-time-budget=150000`），本机真实读数：

```json
{ "ok": true, "hung": [],
  "net": { "scheme": "http:", "origin": "http://127.0.0.1:8123",
           "attemptedCount": 130, "resourceEntries": 81, "nonFile": 81,
           "foreignOrigin": 0, "foreignList": [], "dataOrBlob": 0 },
  "png": 205541, "png1x": 85414, "squared": 99631, "pngAfter": 31840,
  "svg": 1032003, "persist": 553, "editor": [763,279,326,195] }
```

两口径对着读：

| 读数 | `file://` | `http://127.0.0.1` | 判读 |
| --- | ---: | ---: | --- |
| `png` / `png1x` / `squared` / `pngAfter` | 205541 / 85414 / 99631 / 31840 | 205541 / 85414 / 99631 / 31840 | **逐字相同** |
| `persist` | 553 | 553 | 逐字相同 |
| `editor` 几何 | [763,279,326,195] | [763,279,326,195] | 相同 → 字体在两个口径里都真生效 |
| `svg` | 1031971 | 1032003 | 差 32 B，成因见下 |
| `net.attempted` | 0 条 | 130 条 | 全是同源，`foreignOrigin=0` |
| `net.resourceEntries` | 0 | 81 | `file://` 下 Chromium 不记条目（③.3 坑 3） |

- **`svg` 差的 32 B 有确定成因**，两个口径各自嵌进图里的那条 `@font-face` 形状是这样（探针台 D 直接抄了整条规则）：

  ```
  file://  @font-face { font-family: "Anonymous Pro"; font-style: normal; font-weight: 400; src: url("data:font/woff2;base64,…") format("woff2"); }
  http://  @font-face { font-family: "Anonymous Pro"; font-style: normal; font-weight: 400; font-display: block; src: url("data:application/font-woff;base64,…") format("woff2"); }
  ```

  `font-display: block; ` = 21 B，`application/font-woff` 比 `font/woff2` 多 11 B，21+11=32 —— 差值算得平。两条路径嵌的是**同一份字体字节**（`build-fonts --check` 逐族比过 sha1），所以 PNG 逐字相同，只有 SVG 的文本形状不同。
- **`http://` 下多出的 130 条同源请求是 dom-to-image 自己的抓取行为**，不是页面出网：外链 `css/fonts.css` 在 HTTP 下 `cssRules` 读得到，dom-to-image 就挨个 XHR 那 13 个 woff2 再内联成 data URI。`file://` 下外链读不到（③.5 根因），改走 `data/fonts.js` 的内联表，所以一个请求都不发。两口径 `foreignOrigin` 都是 0、`foreignList` 都是空。

### 3.7 探针台 E：预设存到哪里（持久化面）

回答"保存的预设到底落在哪个键、内置的会不会被复制进盘、写不进去时会不会吭声"。**每一步都点真 UI**（`create +` / 删除），不直接调 `library.createPreset`——直调只能证明函数会写盘，证不了按钮那条路。

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --window-size=1440,1040 --virtual-time-budget=90000 --user-data-dir="D:\tmp\edge-pF" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify6-presetstore.html" > "$env:TEMP\preset.dom"
```

本机真实读数（`file://`，全新 user-data-dir，起始时三个键都不存在）：

```
✓ | 载入后无 CARBON_PRESETS（内置 8 个不落盘） → {"CARBON_STATE":{"present":false},"CARBON_PRESETS":{"present":false},"CARBON_THEMES":{"present":false}},"listCount":8,"customCount":0
✓ | 建完：盘上出现 CARBON_PRESETS 且只有 1 条 → {"CARBON_STATE":{"bytes":561},"CARBON_PRESETS":{"bytes":133513,"shape":"array","count":1,"customFlags":[true],"names":["preset:dh08bn6j1s7"]}}
✓ | 预设 id 形如 preset:* 且带 custom:true → {"idHead":"preset:","custom":true,"stripped":[false,false,false,false,false],"iconBytes":132866,"fields":31}
✓ | 当前应用的预设写在 CARBON_STATE.preset，不在 CARBON_PRESETS → {"statePreset":"preset:dh08bn6j1s7","arrayHasAppliedFlag":false}
✓ | 刷新后预设仍在（同一 origin 桶） → {"onDisk":1,"inList":9,"builtin":8}
✓ | 点删除后盘上回到 0 条（整表重写） → {"onDisk":0,"inMemory":0}
✓ | 配额打满时建预设（异步轮询） → {"inMemoryBefore":0,"inMemoryAfter":1,"onDisk":0,"silentDiverge":true,"fillerCount":39,"fillerEachBytes":131072}
```

三个数值得单独看：

- `count:1` 对 `listCount:9`：盘上只有你自建的那 1 条，界面上是 9 个格子 —— 内置 8 个来自 `data/presets.js`，**不落盘**（列表是 `customPresets.concat(DEFAULT_PRESETS)` 现拼的）。别拿"界面上有几个"去推断盘上有几条。
- `iconBytes:132866` 对整条 `133513 B`：一条预设 99.5% 是缩略图 dataURL，设置项本身只占 ~650 B。所以自建预设攒到十几条就会开始顶到配额。
- 整条字节数**每轮会差 1-2 B**，别当成抖动：id 是 `Math.random().toString(36).slice(2)`（`js/util.js:60`），长度不固定 —— 两次实测分别是 `preset:kpwoekdx4n`（10 位）与 `preset:dh08bn6j1s7`（11 位），对应 `133512` / `133513`。上面贴的是后者那一轮。
- 最后一档是**已知边界的取证**：先用 39 × 128 KB 把 origin 填到抛 `QuotaExceededError`，再点 `create +` → 内存 +1、盘上 0 条、界面上那条还在。写不进去时不吭声（详见 ⑦.4 与 ⑧.3）。这一档差点读成"功能坏了"：`create +` 是异步的（先出缩略图再落盘），第一版探针同步读拿到 `inMemoryAfter:0` —— 那是**读数无效**，改成轮询才拿到上面的数。

### 3.8 手工调试入口

浏览器控制台里可直接用：

```js
CARBON.store.state              // 全量状态
CARBON.store.set({ theme: 'nord' })
CARBON.editor.cm.getValue()     // CodeMirror 实例
CARBON.exporter.getImage({ format: 'blob', exportSize: 4 })
CARBON.url.buildShareUrl(CARBON.store.state)
localStorage.getItem('CARBON_STATE')

/* 字体两面分开查：预览吃外链表，成图吃内联表 */
getComputedStyle(document.querySelector('.CodeMirror')).fontFamily   // 栈对不对（预览的接线）
document.fonts.check('14px "Hack"')                                  // 别拿这条当"有没有 face"的判据，它会撒谎
CARBON.FONT_FACES_CSS.split('\n').length                             // 成图那份应该 = 13
document.getElementById('carbon-font-faces')                         // 内联表挂没挂（http 口径应为 null，见 ③.5）
```

### 3.9 探针台 F：localStorage 的桶 / 配额 / 文件读写面（⑨ 的取证）

`tools/probe/verify7-localstorage.html` **不加载应用本体**，只用 `?mode=` 分腿，每腿配一个独立 `--user-data-dir`（互不污染）。它里面只引一个应用文件当对照：`<script src="../../data/presets.js">` —— 同一个 URL，脚本标签能加载（`CARBON.DEFAULT_PRESETS` 读得到 8 条），`fetch` 却读不到，这样才能把"路径不对"和"策略拦的"分开。

```powershell
PS> $edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PS> $repo = "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify7-localstorage.html"
PS> New-Item -ItemType Directory -Force "$env:TEMP\p7-out","$env:TEMP\p7-twin" | Out-Null
PS> Copy-Item tools\probe\verify7-localstorage.html "$env:TEMP\p7-twin\twin.html"

# A 腿：file:// + 全新 profile，写标记 P7_MARKER，并量能力面（fetch / XHR / 两个 picker / estimate）
PS> & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=20000 --user-data-dir="D:\tmp\edge-pL1" --dump-dom "$repo?mode=all" > "$env:TEMP\p7-out\A.txt"
# B 腿：**另一个目录**里的同一份文件，**同一个 profile**，只读 P7_MARKER 并写 P7_TWIN
PS> & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=20000 --user-data-dir="D:\tmp\edge-pL1" --dump-dom "file:///C:/Users/webtu/AppData/Local/Temp/p7-twin/twin.html?mode=twin" > "$env:TEMP\p7-out\B.txt"
# C 腿：回原目录读 twin 写的那条（证明共用是双向的）
PS> & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=20000 --user-data-dir="D:\tmp\edge-pL1" --dump-dom "$repo?mode=read" > "$env:TEMP\p7-out\C.txt"
# D 腿：换全新 profile 再读（证明桶挂在 profile 上，不是挂在机器上）
PS> & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=20000 --user-data-dir="D:\tmp\edge-pL2" --dump-dom "$repo?mode=read" > "$env:TEMP\p7-out\D.txt"
# E 腿：同一 profile 换成 http://127.0.0.1:8123（临时服务器起法见 ③.6）→ 两个标记都读不到
PS> & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=20000 --user-data-dir="D:\tmp\edge-pL1" --dump-dom "http://127.0.0.1:8123/tools/probe/verify7-localstorage.html?mode=all" > "$env:TEMP\p7-out\E.txt"
# T 腿：写盘代价。**这一腿故意不加 --virtual-time-budget**（虚拟时间会改 performance.now 的含义）
PS> & $edge --headless=new --disable-gpu --no-first-run --user-data-dir="D:\tmp\edge-pL4" --dump-dom "$repo?mode=sync" > "$env:TEMP\p7-out\T.txt"
# F 腿：配额，一块 131072 B 填到抛错
PS> & $edge --headless=new --disable-gpu --no-first-run --user-data-dir="D:\tmp\edge-pL5" --dump-dom "$repo?mode=fill" > "$env:TEMP\p7-out\F.txt"
# F′ 腿：同一条 fill 换成 http://（要 ③.6 那台临时服务器），比对配额是不是协议档的差别
PS> & $edge --headless=new --disable-gpu --no-first-run --user-data-dir="D:\tmp\edge-pL7" --dump-dom "http://127.0.0.1:8123/tools/probe/verify7-localstorage.html?mode=fill" > "$env:TEMP\p7-out\F2.txt"
# 重复腿：estimate() 那一条到底会不会 resolve，同一 profile 连跑三次看分布
PS> 1..3 | ForEach-Object { & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=20000 --user-data-dir="D:\tmp\edge-pL3" --dump-dom "$repo?mode=all" > "$env:TEMP\p7-out\R$_.txt" }
# G 腿：先读一次做基线，再把 profile 里那个 leveldb 目录删掉，读第二次
PS> & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=8000 --user-data-dir="D:\tmp\edge-pL1" --dump-dom "$repo?mode=read" > "$env:TEMP\p7-out\G1.txt"
PS> Remove-Item -Recurse -Force "D:\tmp\edge-pL1\Default\Local Storage\leveldb"
PS> & $edge --headless=new --disable-gpu --no-first-run --virtual-time-budget=8000 --user-data-dir="D:\tmp\edge-pL1" --dump-dom "$repo?mode=read" > "$env:TEMP\p7-out\G2.txt"
# H 腿：file:// 加 --allow-file-access-from-files，验 fetch 那条到底是旗标位而不是死路
PS> & $edge --headless=new --disable-gpu --no-first-run --allow-file-access-from-files --virtual-time-budget=20000 --user-data-dir="D:\tmp\edge-pL8" --dump-dom "$repo?mode=all" > "$env:TEMP\p7-out\H.txt"
```

删之前先确认数据真的在那个文件里（键名以**明文**落在 leveldb 的 log 里，所以 `Select-String` 直接搜得到）：

```powershell
PS> Get-ChildItem "D:\tmp\edge-pL1\Default\Local Storage\leveldb"

Name              Length
----              ------
000003.log           480
CURRENT               16
LOCK                   0
LOG                  258
LOG.old              217
MANIFEST-000001       41

PS> (Select-String -Path "D:\tmp\edge-pL1\Default\Local Storage\leveldb\*" -Pattern 'P7_MARKER|P7_TWIN' -AllMatches).Matches.Count
2
```

`480` 是"全新 profile 只走过 A+B 两腿"那一档的数；另一个跑过 E 腿（同 profile 又往 http 桶写过一条标记）的 profile 上量到 `828`。**log 的字节数随写入历史变，不要拿它当判据**，能当判据的是"命中数 = 2"和 G 腿那个 2→0。

取读数（`--dump-dom` 会把整页打出来，锚点要钉在渲染后的 `<pre>` 上，别拿脚本源码里的 `'P7_JSON'` 字面量当锚点）：

```powershell
PS> Select-String -Path "$env:TEMP\p7-out\*.txt" -Pattern 'id="out">P7_JSON' | ForEach-Object { $_.Line -replace '^.*id="out">P7_JSON','' -replace '</pre>$','' }
```

本机 Edge 155 的真实读数，每腿都是**独立的浏览器进程**：

| 腿 | 读数（原样节选） | 判读 |
| --- | --- | --- |
| A（`file://`，全新 profile） | `"origin":"file://"`、`"isSecureContext":true`、`"ls":{"accessible":true,"length":0,"proto":true}`、`"keys":{"CARBON_STATE":"absent","CARBON_PRESETS":"absent","CARBON_THEMES":"absent"}` | `file://` 下 localStorage 可用；新桶起始为空 |
| B（另一目录，同 profile） | `"marker":{"markerBefore":"file:///C:/Users/webtu/Desktop/%E4%BB%A3%E7%A0%81%E5%9D%97%E5%9B%BE%E7%89%87carbonnowsh/tools/probe/verify7-localstorage.html?mode=all","twinBefore":null,…,"twinAfter":"file:///C:/Users/webtu/AppData/Local/Temp/p7-twin/twin.html?mode=twin"}` | **所有 `file://` 路径共用一个桶**，与所在目录无关（跨盘符没单独量） |
| C（回原目录，同 profile） | `"ls":{"accessible":true,"length":2,…}`、`twinBefore` = temp 那条 URL | 共用是双向的，不是单向看得见 |
| D（换全新 profile） | `"ls":{"length":0}`、`"marker":{"markerBefore":null,"twinBefore":null}` | 桶跟着 **profile（user-data-dir）**，不是跟着机器 |
| E（同 profile，`http://127.0.0.1:8123`） | `"origin":"http://127.0.0.1:8123"`、`"ls":{"length":0,"accessible":true}`、`markerBefore:null`，写完 `"markerAfter":"http://127.0.0.1:8123/…"` | **`file://` 与 `http://` 是两个桶**，同一 profile 也各走各的 |
| T（写盘代价，无虚拟时间） | `"timing":{"oneWrite128KB_ms":0.4,"twoHundredWrites1KB_ms":1.3,"readBack128KB_ms":0,"readBackChars":131072}` | 同步写是真的，但 128 KB 单条 0.4 ms，这个量级上没有可感代价 |
| F（配额，`file://`） | `"fill":{"filled":39,"eachBytes":131072,"approxBytes":5111808,"threwAt":39,"error":"QuotaExceededError","lengthAfter":39,"lengthAfterCleanup":0}` | 单桶实际可写 ≈ **5.1 MB**（39 × 128 KB） |
| F′（配额，`http://`） | `"filled":39,"approxBytes":5111808,"threwAt":39,"error":"QuotaExceededError"` | 两口径同档，**不是 `file://` 才小** |
| G（删 leveldb 前后） | 删前 `"lsLength":2,"marker":".html?mode=all","twin":"html?mode=twin"` → 删后 `"lsLength":0,"marker":null,"twin":null` | 数据就在 `<user-data-dir>\Default\Local Storage\leveldb\`，删了它 = 清站点数据的效果 |
| H（`file://` + 旗标） | `"fetchSameDirFile":{"ok":true,"status":200,"type":"basic"}`、`"xhrSameDirFile":{"loaded":true,"status":200}` | 见下 |

三条要单独拎出来的：

- **`file://` 读不了本地文件，是策略不是路径。** A 腿：`"fetchSameDirFile":{"threw":true,"name":"TypeError","message":"Failed to fetch"}`、`"xhrSameDirFile":{"errored":true,"status":0,"statusText":""}`，而同一条 URL 的 `<script src>` 是通的（`"scriptSrcLoaded":{"isArray":true,"count":8}`）。H 腿加上 `--allow-file-access-from-files` 就两个都变 200 —— 所以"能不能读文件"取决于**用户怎么启动浏览器**，不能当交付形态的地基（⑨.4）。
- **两个 picker 在两个口径下都存在，但没有用户手势就拒**：`"fsApi":{"showSaveFilePicker":"function","showOpenFilePicker":"function",…}`，无手势调用 → `"SecurityError: Failed to execute 'showSaveFilePicker' on 'Window': Must be handling a user gesture to sho…"`（`showOpenFilePicker` 同一条）。注意 `isSecureContext` 在 `file://` 下也是 `true`，所以"有没有这个 API"不是判据，**"每次都要用户点一下"才是**。
- **`navigator.storage.estimate()` 报的数不能当 localStorage 配额**：它给 `"quota":10737418240`（10 GiB），而 F 腿写到 5,111,808 B 就抛。这条仪表本身还会空转：同一腿重复 3 次是 `2 次出数 / 1 次 5 s 超时`（`"storageEstimate":{"hung":true,"label":"estimate"}`），所以只把它当"报了一个比真实可写大三个数量级的数"看，不当精确容量。

两个 instrumentation 坑，都是本轮现场踩的：

1. A 腿第一版没有 per-leg 超时，异步链里 `estimate()` 那条不返回，整腿停在 `id="out">(running)`，`--dump-dom` 就照打了。补上 `withTimeout(label, p, 5000)` + `R.stage` 之后才看清：**卡住的只有 estimate**，同一仪表下 `fetch`/`XHR`/picker 三腿立刻 `end:`。修法顺带留下一个事实——那一趟虽然没出 JSON，但写标记那行是同步的、在异步链之前，所以 B/C 腿读到的 MARKER 正是这**卡住的一趟**写的。副作用不会因为腿卡住而撤回。
2. 想拿 `--timeout=15000` 替虚拟时间做真等待，两腿（`file://` 与 `http://`）都只回 `id="out">(running)`：这个 Edge 版本的 `--dump-dom` 不理会 `--timeout`。所以时间类读数（T 腿）只能靠**同步腿 + 不加虚拟时间**，异步腿一律用 `--virtual-time-budget`。

---

## ④ 打包与启动（整目录分发）

### 4.1 交付体清单

| 路径 | 文件数 | 体积 | 是不是运行必需 |
| --- | ---: | ---: | --- |
| `index.html` | 1 | 3.7 KB | 必需，唯一入口 |
| `css/`（`app.css` + `fonts.css`） | 2 | 29.1 KB | 必需，`fonts.css` 管预览字体 |
| `js/`（含 `js/ui/`） | 11 | 112.3 KB | 必需 |
| `data/`（5 份数据 + `fonts.js`） | 6 | 511.8 KB | 必需，`fonts.js` 管成图字体 |
| `vendor/` | 9 | 992.0 KB | 必需（其中 `README.md` 是说明，删了不影响运行） |
| `fonts/`（13 个字体 + `manifest.json`） | 14 | 284.0 KB | 必需（`css/fonts.css` 的 src 指向这里） |
| **交付体合计（运行必需）** | **43** | **1.89 MB** | — |
| `README.md`（项目全景） | 1 | 74.4 KB | 不必需，但 ④.2 的打包脚本按"根目录除 `tools`/`doc` 全收"，所以它一起进包 → 包内 44 条条目 |
| `tools/upstream/` | 33 | 571.8 KB | 不必需，重算 `data/` 与取证用 |
| `tools/.cache/` | 149 | 1408.6 KB | 不必需，`build-vendor`/`build-fonts` 的下载缓存 |
| `tools/probe/` | 7 | 82.6 KB | 不必需，③ 的探针台 |
| `doc/` | 3 | 241.6 KB | 不必需，本文 + 两张基线截图（这一行量的是它自己，改本文就会变） |

本机真实读数。统计脚本就是下面这一条（在仓库根跑，`du` 的口径和它一致），输出逐字照抄：

```powershell
PS> node -e 'const fs=require("fs"),p=require("path");const w=d=>fs.statSync(d).isFile()?[[d,fs.statSync(d).size]]:fs.readdirSync(d).flatMap(e=>w(p.join(d,e)));const s=(n,t)=>{let c=0,b=0;for(const x of w(t)){c++;b+=x[1]}console.log(n.padEnd(13),String(c).padStart(2),"文件",(b/1024).toFixed(1).padStart(6),"KB")};for(const d of ["index.html","css","js","data","vendor","fonts","tools/upstream","tools/.cache","tools/probe","doc"])s(d,d);let C=0,B=0;for(const d of ["index.html","css","js","data","vendor","fonts"])for(const x of w(d)){C++;B+=x[1]}console.log("交付体合计".padEnd(13),String(C).padStart(2),"文件",(B+" B = "+(B/1048576).toFixed(2)+" MB").padStart(9))'
```

```
index.html     1 文件     3.7 KB
css            2 文件    29.1 KB
js            11 文件   112.3 KB
data           6 文件   511.8 KB
vendor         9 文件   992.0 KB
fonts         14 文件   284.0 KB
交付体合计         43 文件      1979281 B = 1.89 MB
tools/upstream 33 文件   571.8 KB
tools/.cache 149 文件  1408.6 KB
tools/probe    7 文件    82.6 KB
doc            3 文件  241.6 KB
```

字体那 ~670 KB（`fonts/` 284.0 + `data/fonts.js` 374.6 + `css/fonts.css` 2.5）是**刻意的双份**：一份给预览（外链文件），一份给成图（data URI）。两口径各只嵌一次、且必须是同一份字节，这条由 `build-fonts --check` 逐族比 sha1 锁住，成因见 ③.5。

### 4.2 打包

```powershell
PS> $items = (Get-ChildItem -LiteralPath . | Where-Object { $_.Name -notin @("tools","doc") }).FullName
PS> Compress-Archive -LiteralPath $items -DestinationPath "$env:TEMP\carbon-offline.zip" -Force
```

本机真实输出（加入 `README.md` 之后重跑的那一轮）。验包脚本把结果写进 `$env:TEMP\pack.result.txt`（带 BOM 的 UTF-8）再回读，**不是**直接 `Write-Output`：PS 5.1 会把无 BOM 的 UTF-8 `.ps1` 当 ANSI 读，中文标签经 Git Bash 管道就是乱码（① 那条 `msedge --version` 的坑同一个成因），标签一律用 ASCII。

```
top-level items: css, data, fonts, index.html, js, README.md, vendor
zip bytes = 1002068
zip entries = 44
has index.html = True
has README.md = True
has css/app.css = True
has css/fonts.css = True
has vendor/hljs.min.js = True
has js/ui/panels.js = True
has fonts/hack.woff2 = True
has fonts/manifest.json = True
fonts entries = 14
leaked tools/doc = 0
```

上一轮这一挡的第一行打印出来是 `椤跺眰椤?`——那正是"顶层项"三个字被 PS 5.1 按 ANSI 读出来的样子，上面那句"标签一律用 ASCII"就是这么换来的；本轮脚本的标签全 ASCII，所以第一行是正常英文。

判据里的数对得上：运行必需 43 个文件 + `README.md` = 包内 **44** 条条目（`fonts entries = 14` 是 `fonts/` 那一档，13 个字体 + `manifest.json`，少一条就是字体没带上）；`leaked tools/doc = 0` 证排除表生效。包体从 967503 B 涨到 1002068 B（多 34565 B，就是那份 74.4 KB 的文档压完的大小）。

但 **`zip bytes` 本身不配当判据**：它随包里任何文件的大小动（上一轮记的是 1001915 B，README 少三个换行就变 1002068 B）。这一挡真正要盯的是四组结构数：`zip entries = 44`、八个 `has-* = True`、`fonts entries = 14`、`leaked tools/doc = 0`。

坑（实测踩过）：**验包名不要直接写 `$a.Entries.FullName -contains "vendor/hljs.min.js"`**。`Compress-Archive` 在 Windows 上把条目名写成反斜杠（`vendor\hljs.min.js`），这样判**永远 False**——我第一次跑就被它骗过，以为包里没有 vendor。要么先 `.Replace("\","/")` 归一（上面的写法），要么比对时就写反斜杠。

只发交付体的话，`tools/`、`doc/` 可以不带（上面的排除表就是这么写的）；但那样就没有 ③ 的判据和 ②.3/②.4/②.5 的重算能力了。

**必须保持目录层级**：`index.html` 与 `css/ js/ data/ vendor/` 同级，引用全是相对路径，改层级或只拷 `index.html` 即白屏。

### 4.3 启动

解压后双击 `index.html`。没有安装、没有服务、没有端口。

---

## ⑤ 改标题与文案

三处都会波及用户所见，改完都要回读。

### 5.1 浏览器标签标题

`index.html` 第 6 行：

```html
    <title>Carbon 复刻 · 代码转图片（离线单页）</title>
```

回读判据（不需要人眼看标签）：

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --virtual-time-budget=6000 --user-data-dir="D:\tmp\edge-t1" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/index.html" > "$env:TEMP\index.dom"
```

再从 dump 里取 `<title>`，本机真实读数：

```
document.title 回读 = Carbon 复刻 · 代码转图片（离线单页）
favicon link 存在 = false
hero 文案首行 = 把代码变成图片：左侧工具栏改主题与语言，中间画布直接编辑，右侧导出 PNG / SVG。 双击本文件即可离线使用，全部资源都在本地。
DOM 已渲染(theme 下拉有值) = true
data/fonts.js 引用 = true
```

最后一行同时是"页面真的起来了"的判据：`--dump-dom` 里出现 `Seti` 说明 `js/app.js` 已经跑完并把主题下拉填进去了，静态 HTML 里是没有这个字符串的。`data/fonts.js 引用 = true` 是字体面加进来的回读项：**这个 script 标签丢了不会报错、不会白屏，预览也照样对**，只有导出图的字体会静默退回系统字体（③.5）——所以必须当成文案一样的东西显式读一遍。

### 5.2 页头文案

`index.html` 的 `.hero-text`（第 17-19 行）：主句 + `.hero-sub` 副句。改完用上面 5.1 的判据回读 `hero 文案首行`。

### 5.3 导出文件名前缀

导出的图默认叫 `<name>.png` / `<name>.svg`，`name` 为空时用前缀 `carbon`。改点在 [js/export.js:89](file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/js/export.js#L89)（`const prefix = o.filename || s.name || 'carbon'`）与 [js/export.js:96](file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/js/export.js#L96)（`link.download = prefix + '.' + (isSvg ? 'svg' : 'png')`），以及导出面板里那个文件名输入框的占位文案（`js/ui/panels.js` 的 `exportMenu()`）。

判据：`node tools/probe/verify2.html` 那挡冒烟里的「文件名写入 state」一项（本机读数 `{"name":"audit-shot"}`）。

---

## ⑥ 改图标与品牌资产

这里没有 exe 图标。用户能认出来的"图"有三样：页头 logo、画布水印、浏览器标签图标。

### 6.1 页头 logo 与水印 SVG 从哪来

两者都是上游 SVG 资产，落在 `data/svg.js`：页头 logo 是 `CARBON.SVG.icons.logo`（15397 B），水印是 `CARBON.SVG.watermark.light` / `.dark`（各 37865 B，明暗两版），`CARBON.SVG.watermark.pairs` 另存三对描边/填充色（`#9e9e9e`/`#616161`、`#080808`/`#F7F7F7`、`#000`/`#fff`）。整份文件 107611 B / sha1 `ecaf96d1`，共 20 段 `<svg>`（另有 6 个字符串是颜色，不是图）。

**不要直接编辑 `data/svg.js`**——它由 `tools/build-data.js` 从 `tools/upstream/` 生成，手改会被下次重算覆盖。

正确改法二选一：

1. 换资产、保留生成链：替换 `tools/upstream/components_svg_Logo.js`（或 `components_svg_Watermark.js`）为新的 SVG 组件源码，然后 `node tools/build-data.js` 重算，再 `node tools/build-data.js --check` 确认落盘。
2. 一次性换图、不保留生成链：直接改 `data/svg.js` 里那一段字符串，接受"下次重算会被冲掉"。

判据（两条都要过）：

```powershell
PS> node tools/audit.js
```

其中两行是本节的靶子：

```
  ✓ SVG 资产契约 — 20 段 svg 可用、无 JSX 残留、色值合法
  ✓ 数据全局契约 — 29 主题 × 12 键配平，13 字体均有回退栈，25 个默认设置项
```

「无 JSX 残留」会抓住把 `className=`、`{light ? ... : ...}` 这类 React 写法原样拷进来的情况；「色值合法」会抓住上游那个漏 `#` 的 `fill='9e9e9e'` 同类错误。

### 6.2 加 favicon（保持零网络）

当前**没有** favicon（判据读数 `favicon link 存在 = false`）。要加，必须内联成 data URI，不能引外部 `.ico`/`.png`——一旦引外部文件，`vendor/` 之外的目录就跑不掉，而且审计的「无 ES module / 无绝对路径」只覆盖已声明的引用面。

在 `index.html` 的 `<title>` 之后加一行：

```html
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23121212'/%3E%3Ctext x='16' y='22' font-size='18' text-anchor='middle' fill='%23f4f34d' font-family='monospace'%3Ec%3C/text%3E%3C/svg%3E" />
```

改完判据：`node tools/audit.js`（零网络扫描会把 `data:` 放行、把 `https://` 拦下）+ 5.1 的 `favicon link 存在` 应为 `true`。

`未验证`：上面这行 SVG favicon 本轮**没有实际写进 index.html**，也没在无头里回读过。它是建议加法，不是现状描述。

### 6.3 换/加一个编辑器字体

13 个族是上游 `data/constants.js` 里 `FONTS` 的清单，族名是契约（下拉的 `id`、`font-family`、`CARBON.FONT_FALLBACKS` 的键三处要逐字相同）。`tools/build-fonts.js` 的 `SOURCES` 表是唯一的取源处，一条一个族：

```js
{ id: 'Hack', slug: 'hack', minBytes: 15000,
  url: 'https://cdn.jsdelivr.net/npm/hack-font@3.3.0/build/web/fonts/hack-regular-subset.woff2',
  note: '…' }
```

**要换字体只改这一张表**，然后：

```powershell
PS> node tools/build-fonts.js            # 重抓 + 重写 css/fonts.css + data/fonts.js + fonts/manifest.json
PS> node tools/build-fonts.js --check    # 必须仍然报 13 段（或你改后的族数）且逐族 sha1 一致
PS> node tools/audit.js                  # "成图字体链路"那条要绿
```

跑完之后必须重跑两个探针，因为**预览面和成图面是两个独立的面**，一边对不代表另一边对：

```powershell
PS> & "…\msedge.exe" --headless=new … tools/probe/verify3-font.html   # 预览：ownFaceCount 应 = 族数
PS> & "…\msedge.exe" --headless=new … tools/probe/verify4-exportfont.html # 成图：svgFontFaceCounts 真族应 = 1
```

三条硬约束（都是实测换来的）：

- **`id` 与 `CARBON.FONTS[].id` 逐字相同。** `@font-face` 的 `font-family` 靠字符串匹配，写错一个字母是静默不生效，不会报错。审计里「成图字体链路」双向对齐：缺族红、多族也红。
- **`data/fonts.js` 与 `fonts/` 必须是同一份字节。** 生成器把 `--check` 写成"解 base64 → 比 sha1 → 比字节"，就是为了这份双份不会各改各的。只改 `fonts/` 不重算，成图里嵌的还是旧字体，而预览已经换新了——两边不一致时**成图**是更难发现的那半边。
- **子集口径是 latin。** 与上游 Google Fonts 的 latin 子集同范围，所以中日韩字符仍然回退系统字体——这和线上 carbon.now.sh 一样，不是本工程的退化。要真支持 CJK 得换全集字体（体积上一个数量级），并同步改 `--check` 的字节阈值。

---

## ⑦ 发布与分发

两条面，互不替代。

### 7.1 整目录（离线，主用途）

见 ④。给别人之前跑一次 `node tools/audit.js`，退出码 0 再发。

### 7.2 分享链接（把状态塞进 URL）

工具栏「复制 → 分享链接」产出的形如：

```
<当前页面路径>?bg=rgba(171%2C%20184%2C%20195%2C%201)&t=dracula&wt=boxy&l=javascript&width=680&ds=false&dsyof…
```

本机真实读数（探针 `shareUrl` 步截的前 200 字符；`--dump-dom` 序列化时 `&` 会变成 `&amp;`，这里给的是解码后的原串）：

```
file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify.html?bg=rgba(171%2C%20184%2C%20195%2C%201)&t=dracula&wt=boxy&l=javascript&width=680&ds=false&…
```

要点：

- **键名与上游一致**。写侧（`writeMappings`，即"复制分享链接"会产出的键）22 个：
  `bg,t,wt,l,width,ds,dsyoff,dsblur,wc,wa,pv,ph,ln,fl,fm,fs,lh,si,es,wm,code,tb`。
  读侧（`readMappings`，即手工拼 URL 时被认的键）27 个 = 上面 22 个再加 `sl,copy,readonly,id,highlights`。
  也就是说 `sl`（选中行）等 5 个键**读得到、写不出**——这是上游的不对称，本工程照抄未改。审计里那行「URL 参数编解码回环 — 2 组样本 × 22 键全等」验的是写侧 22 键的往返。
- 也支持 `?state=<base64(JSON)>` 整包写法。
- **code 有 4000 字符软截断**：超过 4000 字符只把**前 2000** 编进链接（与上游同口径）。所以长代码分享要么截短，要么改用整目录 + 导出图。审计里 `>4000 字符软截断生效（2000）` 证的是这条。
- 链接里的 `pv`/`ph`/`fs`/`dsyoff`/`dsblur` **必须带单位**（`pv=40px`）。本工程会兜底补 `px`（见 ⑧.2 第 5 条），但上游不会——要拿这份链接去喂线上 carbon.now.sh，就得自己带单位。
- 分享链接会剥掉 `backgroundImage` 与 `fontUrl`（data URL 太大），所以背景图和本地上传的字体**不会**跟着链接走。

### 7.3 放到内网 HTTP 服务器上

③.6 已经证明同源 HTTP 下行为与 `file://` 一致（四挡 PNG 字节与持久化字节逐字相同、画布几何相同、`foreignOrigin=0`；只有 SVG 因两条嵌入路径的声明写法差 32 B，成因见那张对照表）。注意两点：

- 必须整个目录一起放，`index.html` 不能单独当首页发。
- 换到 HTTP 之后 `localStorage` 的 origin 从 `file://` 变成 `http://<host>`，**原来存的设置不会跟过去**。

`未验证`：只验过 `127.0.0.1:8123` 这一个临时服务。真实内网/nginx/IIS 的 MIME 与路径规则没验。

### 7.4 预设存到哪里（以及主题、当前配置）

三个键，全在浏览器 `localStorage` 里，键名与上游一致（`js/state.js:9-11`）。这一节只讲**分工**；`localStorage` 本身是什么、什么时候会丢、为什么不改成读写配置文件，单独在 ⑨：

| 键 | 装什么 | 形态 | 谁写它 |
| --- | --- | --- | --- |
| `CARBON_STATE` | **当前**这套配置（主题/语言/颜色/字号…）+ `preset`（当前应用的是哪个预设的 id） | 对象，实测 561 B | 每次 `store.set()` 都写（`saveSettings`） |
| `CARBON_PRESETS` | **自建预设库**，整表 | 数组，实测 1 条 = **133513 B** | 只有点「create +」和点删除时写 |
| `CARBON_THEMES` | 自建主题库，整表 | 数组 | 点 Create+ 建主题时写 |

三条容易记错的口径，都用探针 `tools/probe/verify6-presetstore.html` 实测过（见 ③.7）：

```
✓ | 载入后无 CARBON_PRESETS（内置 8 个不落盘） → {"keys":{"CARBON_STATE":{"present":false},"CARBON_PRESETS":{"present":false},"CARBON_THEMES":{"present":false}},"listCount":8,"customCount":0}
✓ | 建完：盘上出现 CARBON_PRESETS 且只有 1 条 → {"CARBON_PRESETS":{"bytes":133513,"shape":"array","count":1,"customFlags":[true],"names":["preset:dh08bn6j1s7"]}}
✓ | 预设 id 形如 preset:* 且带 custom:true → {"idHead":"preset:","custom":true,"stripped":[false,false,false,false,false],"iconBytes":132866,"fields":31}
✓ | 当前应用的预设写在 CARBON_STATE.preset，不在 CARBON_PRESETS → {"statePreset":"preset:dh08bn6j1s7","arrayHasAppliedFlag":false}
✓ | 点删除后盘上回到 0 条（整表重写） → {"onDisk":0,"inMemory":0}
```

1. **内置 8 个预设不占盘。** 它们来自 `data/presets.js`（`CARBON.DEFAULT_PRESETS`），是随目录分发的静态数据；`CARBON_PRESETS` 里只有自建的。列表是内存里现拼的：`customPresets.concat(DEFAULT_PRESETS)`（`js/state.js:224`），所以自建排在前面。读数佐证：新建后盘上 `count:1`，而界面上的 `listCount` 从 8 变 9。
2. **「当前应用了哪个预设」不属于预设库。** 它是 `CARBON_STATE.preset` 这个字段（实测 `statePreset:"preset:dh08bn6j1s7"`，而数组里没有任何 `applied` 标记）。所以撤销预设（`panels.js` 的 undo）做的是 `store.replace({...previous, preset:null})`，写的是 `CARBON_STATE`，`CARBON_PRESETS` 一个字节都不动。
3. **一条预设 ≈ 130 KB，几乎全是缩略图。** `createPreset` 把当前设置的 31 个字段（实测 `fields:31`）连同 `icon` 一起存，其中 `iconBytes=132866` / 整条 `133513 B`——缩略图占 99.5%。`icon` 是 `exporter.thumbnail()` 出的方形 1x PNG dataURL。落盘前明确剥掉 5 个字段：`code`、`titleBar`、`highlights`、`preset`、`backgroundImage`（`js/state.js:266-270`；实测这五个键在存下来的对象里全 `false`）。**注意剥掉的名单里没有 `fontUrl`**——存下来的对象里确实带着这个键（实测 `firstKeys` 含 `fontUrl`，本轮值为空，因为没上传字体）。也就是说上传字体后再建预设，那条 data URL 有留在 `CARBON_PRESETS` 里的嫌疑；**这条我没实测**（要真挑一个本机字体文件走上传路径，见 ⑧.4）。已知的是它与 ⑦.2 不同：分享链接那条路是明确剥掉 `fontUrl` 的。

- **删除是整表重写**，不是删一条记录：`customPresets.filter(...)` 再 `writeJson` 全量写回（`js/state.js:277-283`，实测删除后 `onDisk:0` 而键仍然存在，值是 `[]`）。
- **两个按钮都搬不走、也清不掉预设库。** 写 `CARBON_PRESETS` 的调用点只有两处：`createPreset`（`js/state.js:272`）与 `removePreset`（`:279`）。所以「其它」页签的**导出配置**（`carbon-config.json` 只含 `CARBON_STATE` 那 25 项设置，`panels.js:847-851`）**不含预设**，**重置设置**（`store.resetSettings` 只 `removeItem(SETTINGS_KEY)`，`js/state.js:200`）也**不碰预设**。要把自建预设搬到别的机器/别的 origin，当前没有 UI 通道，只能自己导 `localStorage['CARBON_PRESETS']` 这段 JSON 过去。
- **换 origin 就等于清空**：`file://` 与 `http://<host>` 是两个桶（实测 ③.9 E 腿，同 profile 换协议就读不到）；同机两个 `file://` 克隆反而共用一个桶（实测 ③.9 B/C 腿，详见 ⑨.2 性质 1、2）。
- **配额打满时是静默的。** `writeJson` 只对 `CARBON_STATE` 做"剥掉 backgroundImage 再写一次"的降级重试，`CARBON_PRESETS` 抛 `QuotaExceededError` 就直接 `return false`，而 `createPreset` **不看返回值**、先改内存再写盘 → 界面这条预设就在、`localStorage` 里没有、刷新就没。实测这一格：

  ```
  ✓ | 配额打满时建预设（异步轮询） → {"inMemoryBefore":0,"inMemoryAfter":1,"onDisk":0,"silentDiverge":true,"fillerCount":39,"fillerEachBytes":131072}
  ```

  （先用 39 × 128 KB 把 origin 填到抛错，再点 create +。）这是**已知边界，本轮没改**，改法要在 `createPreset` 检查 `writeJson` 的返回值并 `toast` 提示，属于行为变更，等你点头再做。
- 配额那条**读早过一次**：点「create +」是异步的（先 `exporter.thumbnail()` 出缩略图，再 `createPreset` 写盘），同步读拿到的是 `inMemoryAfter:0`，看着像"配额实验没触发"。改成轮询等内存变化才拿到 ③.7 那组数。

---

## ⑧ 注意事项与偏离清单

### 8.1 结构约束（改了会坏）

1. **脚本顺序不能动。** `vendor/codemirror.min.js` → addons → modes → custom-modes → `hljs.min.js` → hljs-languages → `dom-to-image.js` → `data/*`（含 `data/fonts.js`）→ `js/*` → `js/ui/*` → `js/app.js`。`hljs-languages.js` 里的语言文件裸引全局 `hljs`，核心必须在它前面；`data/fonts.js` 必须在 `js/export.js` 之前（导出时读 `CARBON.FONT_FACES_CSS`）。审计有专门一条按声明顺序验（`依赖加载顺序 — script 24 个 + css 3 个`）。
2. **只能 classic script。** `file://` 下 ES module 与 `fetch()` 本地 JSON 都会被 CORS 拦死，所以 `data/` 是 `window.CARBON.*` 赋值形式的 JS，不是 JSON。
3. **`index.html` 里的 `data-slot` 名字是契约。** 7 个：`logo,theme-dropdown,language-dropdown,background-select,settings,copy-menu,export-menu`。`js/app.js` 按名字挂面板，改名即空位。
4. **每个 `ui.popout()` 必须被 appendChild。** 早期版本 popout 全建了但没挂，结果五个弹层一个都不显示，界面上看不出原因。审计有一条「每个 popout 都被挂进文档 — 5 个 popout 全部 appendChild 到位」盯着。
5. **`vendor/` 里的文件带 `/*!-- 来源 URL/版本/字节/sha1 --*/` 注释**，可 grep 复核；`vendor/README.md` 的表由同一份构建数据生成，别手改。
6. **字体是两份，不能改成一份。** `css/fonts.css`（外链，管预览）+ `data/fonts.js`（内联 data: URI，管成图）。删掉后者不报错、不白屏、预览照旧，只有导出图静默回退；删掉前者则预览和成图一起退化到系统字体。两份的字节必须同源，`build-fonts --check` 逐族比 sha1，审计「成图字体链路」双向比族名。
7. **`js/export.js` 的挂载有开关，别把它当成冗余代码删掉。** `ensureFontFaceStyle()` 先问 `linkedFontFacesReadable()`：外链表的 `cssRules` 读得到（http 口径）就不挂内联表。去掉这个开关，`http://` 下会**同时**嵌内联那份和外链抓来的那份，SVG 里同族出现两段 `@font-face`。
8. **`[hidden]{display:none !important}` 是基座规则，删不得。** `css/app.css` 里 48 个类带作者层 `display`，UA 的 `[hidden]` 压不住它们（同为 0,1,0 特异性时作者层赢）。删掉这条，"收起预设""关掉窗口控件""隐藏起始行号"这类开关全部变成状态位翻了但元素还在。

### 8.2 与上游的偏离（有意为之，不是没做完）

| # | 偏离 | 原因 |
| --- | --- | --- |
| 1 | 账号/云端片段/计费/推荐/公告/Unsplash 图库/随机图/Tweet/Imgur/PWA/embed/页脚外链/SelectionEditor 全部移除 | 用户点名"移除界面冗余内容聚焦核业务完整性" |
| 2 | 不接 prettier（无「美化代码」按钮） | 上游 prettier standalone 约 1 MB，且不是核业务 |
| 3 | 不加载 CM5 的主题 CSS 文件 | 上游是 `highlights` 键 → `.cm-*` 选择器的 `!important` 表；本工程用同一张表在 `js/theme.js` 现生成，行号/选区/光标色由 `derived()` 推。等价，且不必从 cdnjs 拉 29 份 CSS |
| 4 | hljs 钉在 **10.7.2**（上游是 `^10.7.2`） | 对照实验：同一段默认 JS 代码、同一份 57 语言白名单，10.7.2 → `javascript (rel 21)`，11.9.0 → `coffeescript (rel 18)`。要跟线上"Auto 的结果"同构就得用 10.x |
| 5 | `pv/ph/fs/dsyoff/dsblur` 无单位时自动补 `px` | 上游这几个 URL 键是无类型透传，`?pv=40` 会拼出 `calc(40 + 16px)` 这种非法值、整条声明被浏览器丢掉（实测：水印跑到左下角并悬在容器外）。手改分享链接是正常入口，这里兜底。审计有一条双向对齐 `PX_KEYS` 与"默认值带 px 的设置项"，新增 px 设置忘了登记会红 |
| 6 | 选中行淡化按**文档行号**判定 | 上游 `Carbon.js` 用 `display.view` 的**下标 i**，滚动后下标漂移。本工程用 `view.line.lineNo()`，等价但不随滚动错位 |
| 7 | 行尾 `¬` 用 `setBookmark` 而不是零宽 `markText` | 实验：零宽 `markText({line,ch:len},{line,ch:len},{replacedWith})` 被 CM5 直接丢弃（`getAllMarks()` 读数 0、DOM 无节点）；跨行界 `markText` 能画但会把 `\n` 折进 widget；`setBookmark(pos,{widget})` 画得出且三行完好 |
| 8 | GraphQL 无 CM 高亮 | `codemirror-graphql@2.2.9` 没有 UMD/global 产物，要当 classic script 用必须打包 graphql-js，超出 vendor 范畴。影响：只显示为无高亮纯文本，**不丢** hljs 自动检测。CM5 对未知 mode 不抛错（实测 `getMode({},"graphql")` 返回 null mode）。证据在 `vendor/README.md` 第 6 节 |
| 9 | 水印浅色 `fill` 补了 `#` | 上游笔误，生成时报告（②.4 那行 `已修正上游缺陷`） |
| 10 | 预设缩略图是 CSS 画的，不是上游的 `/static/presets/N.png` | 上游那些 PNG 不在源码包里；本工程用 `exporter.thumbnail()` 现生成自建预设的缩略图，内置 8 个用 CSS 渐变近似 |
| 11 | 13 个编辑器字体**打包成两份**：`fonts/*.{woff2,woff,ttf}` + `css/fonts.css` 给预览，`data/fonts.js`（base64）给成图 | 上游运行时从 Google Fonts 拉，本工程零网络。只给预览那一份不够：`file://` 下外链表的 `cssRules` 抛 `SecurityError`，dom-to-image 扫不到 `@font-face`，导出图静默用系统回退字体（实测见 ③.5：修复前导出 SVG 的 `@font-face` 段数 = 0）。代价是交付体多 ~375 KB |
| 12 | 字体子集口径 = **latin** | 与上游 Google Fonts 的 latin 子集同范围，所以中日韩标点仍回退系统字体，**这条不是偏离**（线上也一样）。写在这里是因为它看着像偏离 |
| 13 | `Droid Sans Mono` 只有 TTF，且 URL 是 gstatic 的版本路径 | `fontsource`/`typeface` 都没有这个族（Google 已下架），只能取 `fonts.gstatic.com/s/droidsansmono/v21/…ttf` 这个钉版地址。魔数验出来是 `00 01 00 00`，`--check` 认 ttf。影响：这一个族比其他大 ~10 KB，且 Google 换版本号就会 404 |
| 14 | `Fantasque Sans Mono`、`Monoid` 取 `@typopro@3.7.5` 的 **woff**（不是 woff2） | fontsource 无这两个族（Monoid 也是 Google 已下架的）。`@typopro` 有，但只到 woff1；Chrome 全支持 woff1，`css/fonts.css` 里的 `format('woff')` 按魔数写，不按 URL 尾巴猜 |
| 15 | 取源**全部钉成具体文件 URL**（jsDelivr 上的 npm 包内文件 / gstatic 版本路径），不走 `fonts.googleapis.com/css*` | 两个原因：(a) 运行时零网络，`@font-face` 表本来就得本工具生成，用它的 CSS 反而多一层不确定性；(b) 这台网络下那条 API 现在**两条都不通**——实测 `css2?family=Hack` 与 `css?family=Hack` 都返回 `HTTP 400`、`text/html`、6475 B 的 bot-wall 页面（带 `window['ppConfig']` 那段），不是 CSS。所以 `Hack` 走 Source Foundry 官方 npm `hack-font@3.3.0` 的 subset woff2 |
| 16 | `js/export.js` 在导出前挂一次内联字体表，并且**只在外链表读不到时挂** | 这是为了让 `file://` 的成图与线上 `http` 同构。加了"只在读不到时挂"这个开关后，`http://` 口径仍然完全走上游 dom-to-image 自己的抓取+内联路径，不产生重复嵌入（③.6 那 32 B 差异就是这么来的：两条路径序列化 `@font-face` 的写法不同，`font-display` 21 B + mime 拼法 11 B） |

### 8.3 已知边界（不是 bug）

- 本地上传的背景图/字体只进 `localStorage`，不进分享链接（⑦.2）。
- 本地上传的字体（`fontUrl`）走的是 `new FontFace()` 运行时注册，**不在任何样式表里**，所以 dom-to-image 扫不到它 → 上传字体目前只保证预览，成图那一半没验（见 ⑧.4）。13 个内置族不受影响。
- `localStorage` 配额爆掉时会**丢掉 backgroundImage 再写一次**（`js/state.js` 的 `writeJson` 兜底），这是刻意的降级而不是失败。
- 隐形字符会把每个空格/制表都打一个标记。代码很长时这是几百个 `markText`——上游 `cm-show-invisibles` 同样行为，不是本工程的退化。
- 导出倍率 4x 时图很大（本轮实测 4x PNG 528485 B，SVG 1307121 B，都含嵌进去的那一份字体），低配机器上会慢。
- `file://` 下所有本地克隆**共用同一个 `localStorage` 桶**（origin 都是 `file://`）。拷两份目录并分别改设置，会互相看到对方的设置。已实测：③.9 的 B/C 腿——`C:\Users\webtu\Desktop\…` 写的标记被 `…\AppData\Local\Temp\p7-twin\` 读到，反向也读到。机制与丢数据的全部情形见 ⑨。
- 每次导出都会把当前族那一份字体字节 base64 塞进图里（实测 Hack 让 SVG 多 31 KB）。这是与线上同构的代价：线上 dom-to-image 也在做同一件事（③.6 两口径嵌的段数都是 1）。
- **`CARBON_PRESETS` 写不进盘时不吭声**（实测 ③.7 最后一档：内存 +1、盘上 0 条）。同源还有 `CARBON_THEMES`。`writeJson` 的降级重试只覆盖 `CARBON_STATE`。症状是"预设明明建好了，刷新就没了"，而且界面当时不会有任何报错——所以它看着像 bug，实际是配额边界（丢数据的其它情形总表见 ⑨.3）。要改成"检查返回值 + toast 提示"是行为变更，需点头。

### 8.4 未验证项汇总

`node tools/audit.js` 的 `[未验证]` 栏只列**判据层面**当下缺的 6 条；下面这张表是全量清单（多了本文自己没做的事与本轮没覆盖的环境），两者不冲突，以这张为准。

| 项 | 原因 |
| --- | --- |
| 双击 `index.html` 开可见窗口 | 本轮全程无头取证，没开过可见窗口；`file://` 加载路径已由无头等价验证（②.2、③.2） |
| 125% 系统 DPI 下预览与导出图是否一致 | 无头跑固定 `deviceScaleFactor=1`，量不到系统缩放；需人眼对照 `doc/截图-*.png` |
| 剪贴板写入图片（`ClipboardItem`） | 无头环境无剪贴板权限，且用户手势不可合成 |
| 字体上传 `new FontFace().load()` 成功路径 | 需真实挑选本机 ttf/woff 并等异步 load |
| 上传的字体能不能进成图 | `fontUrl` 那条路是运行时 `new FontFace()` 注册，不在任何样式表里 → dom-to-image 的 `cssRules` 扫描拿不到它。内置 13 族已证能进图（③.5），自定义上传这一半**没测**，很可能成图仍是回退字体（审计的「未验证」栏也有这条） |
| 上传字体后再建预设，`fontUrl` 会不会被带进 `CARBON_PRESETS` | `createPreset` 的剥离名单里没有 `fontUrl`（⑦.4），键确实在（③.7 实测 `firstKeys` 含它，本轮值为空）。要走真上传路径才能定论，本轮没有可复用的"脚本挑文件"通道（`upload_file` 要真实文件选择） |
| 配额打满时该不该给用户提示 | 现状是静默（③.7 最后一档：内存 +1、盘上 0 条）。改成"检查 `writeJson` 返回值 + toast"是行为变更，用户没点头，本轮不动 |
| 拖文件导入（带真实 `File` 的 drop） | 无头合成 `dragenter/drop` 拿不到真实 File |
| 导出后浏览器另存 / 「打开」按钮 | 需要真实下载与新标签行为 |
| SVG favicon 加法（⑥.2） | 建议加法，本轮没写进 `index.html`，也没回读过 |
| `node tools/build-vendor.js` 在断网下能否成功 | 本轮是联网跑的；`tools/.cache/`（149 文件）是下载缓存，但没验过离线命中路径 |
| `build-fonts.js` 在断网下能否重算 | `--verify` / `--check` 两挡是离线的（本轮跑过），但"缓存命中不联网"那一挡没单独断网验 |
| 部署到真实内网 HTTP 服务器 | 只验过 `127.0.0.1:8123` 临时服务（③.6）；且 ③.6 那条临时服务器脚本的 mime 表是现写的，真实服务器上 woff2 的 `Content-Type` 没对照 |
| Firefox / Safari 下的 `file://` 行为 | 只跑过 Edge 155（Chromium 内核）。③.5 那个 `cssRules` 的 `SecurityError` 是 Chromium 对 `file://` 的做法，别的内核不一定同样处理，内联表方案的必要性也因此只在 Chromium 上证过 |
| 无痕 / InPrivate 窗口下关窗是否即丢 | 无头每次都是全新 profile，"关窗即丢"与"新 profile 起始为空"（③.9 D 腿）用这套仪表分不开 |
| 浏览器后台存储驱逐（磁盘压力、长期不用） | 要跨天、要真实磁盘压力，本轮没有那个环境 |
| 点浏览器设置里的"清除站点数据" | 只有它的物理等价物（删 `<user-data-dir>\Default\Local Storage\leveldb`，③.9 G 腿），没走过那个 UI |
| 「导出配置」导出的 JSON 里到底有哪些键 | 读码所得（`js/ui/panels.js:847-851` 只取 `DEFAULT_SETTINGS` 的键），本轮没有点按钮把那个文件抓下来核 |
| 手工把 `CARBON_PRESETS` 的 JSON 搬到另一台机器后能不能看见 | 桶这一侧等价于 ③.9 的 B/C 腿（同 origin 换 key 值双向可见），但"真有一份预设跨机器搬过去"没走过 |
| `http://127.0.0.1:8123` 换成 `:8124` 是不是又一个桶 | 按 origin 定义应当是，但本轮只换了协议（③.9 E 腿），没单独量端口档 |
| `file://` 下 `navigator.storage.estimate()` 到底 resolve 不 resolve | 同一腿连跑 3 次是 `2 次出数 / 1 次 5 s 超时`（③.9 重复腿），分不清是虚拟时间仪表饿它还是 `file://` 这个源真的不给；`http://` 口径每次都出数（E / I 腿）。不影响结论，因为配额是用"真写到抛错"量的（F 腿） |

---

## ⑨ 用户数据：localStorage 是什么、什么时候会丢、为什么不写配置文件

规范的八节里没有这一章，它是 ⑦.4 那条"预设存到哪里"往下追出来的三连问，答案要落进文档、依据要能复现，所以单独成章（映射理由见 §0 表末行）。取证全部在 ③.9 的探针台 F，下面每条结论后面挂腿号；没量的显式写"未验证"，汇总在 ⑧.4。

### 9.1 三问三答

| 问题 | 答案 | 依据类型 |
| --- | --- | --- |
| localStorage 是什么 | 浏览器按 **origin** 分桶的一小块键值盘：同步 API、值只能是字符串、落在浏览器 profile 目录里而不是工程目录里，单桶实测能写 ~5 MB | 实测（③.9 A/B/C/D/F/G/T 腿） |
| 什么情况下会丢 | 换 profile（换浏览器/换 Windows 用户/换 `--user-data-dir`）、清站点数据、换 origin（协议档实测，端口档按定义推）、配额打满那一次写；**关标签关浏览器不丢**，同机两个 `file://` 克隆不是丢而是互相盖 | 实测为主，表里逐行标了哪几行只是读码或未验证 |
| 为什么不用读写配置文件 | 不是选择问题，是能力问题：纯静态目录里，页面**读**不到本地文件（策略拦，要用户加启动旗标），也**写不回**任何固定路径（`showSaveFilePicker` 要用户每次点对话框，`<a download>` 只落到下载目录）。工程里没有主进程可借（`require`/`process` 全 `undefined`） | 实测（③.9 A/H/E 腿）+ 取舍说明 |

### 9.2 localStorage 是什么（这个工程用得上的是这五条）

1. **它是按 origin 分桶的，不是按目录分的。** `file://` 页面里 `location.origin` 读出来就是字符串 `file://`（③.9 A 腿），所以桌面上这份 `C:\Users\webtu\Desktop\…` 和临时目录里那份 `C:\Users\webtu\AppData\Local\Temp\p7-twin\twin.html` 落进**同一个桶**：B 腿在 temp 里读到了原目录写的标记，C 腿回原目录读到了 temp 写的标记（双向）。跨盘符（D:）没单独量。
2. **桶跟着浏览器 profile 走。** 换一个全新 `--user-data-dir` 就是空桶（D 腿 `length:0`、两个标记都 `null`），而同一个 profile 换协议（`file://` → `http://127.0.0.1:8123`）也是空桶（E 腿）。**上线的 carbon 是 `https://carbon.now.sh`，那是第三个桶** —— 本地克隆和线上永远互相看不见（这条是按 origin 定义推的，没实测线上）。
3. **字节落在 profile 目录，不落在工程目录。** `Select-String` 能在 `<user-data-dir>\Default\Local Storage\leveldb\000003.log` 里搜到两个标记键名（③.9 那条命令，命中数 `2`；那个 log 在"只走过 A+B 两腿"的 profile 上是 480 B）；把那个目录删掉，同一个 profile 再读就 `lsLength` 2→0（G 腿）。所以你把工程目录整个拷走、发给别人，**拷不走任何用户数据**——这是它与"配置文件"形态最直观的差别。
4. **单桶容量实测约 5 MB，而不是 API 报的 10 GiB。** 一块 131072 B 填到第 39 块抛 `QuotaExceededError`，累计 `5111808 B`；`file://` 与 `http://` 两口径都是 39 块（F / F′ 腿）。`navigator.storage.estimate()` 报 `quota:10737418240`（10 GiB）——那是整个存储体系的预算，**别拿它当 localStorage 的配额**。一条自建预设 ≈ 133513 B（③.7），除一下是这个桶装 38 条左右（`5111808 ÷ 133513 = 38.3`，**算术而非实测** —— 没人真建到 38 条去看抛错）。
5. **API 是同步的，但代价在这个量级看不见。** 不加虚拟时间的那条腿（T 腿）：单条 128 KB 写 `0.4 ms`、200 条 1 KB 写 `1.3 ms`、读回 `0 ms`。所以"同步"要当成"写的时候会阻塞主线程"来理解，而不是"慢"。

工程侧只用到三个键（`CARBON_STATE` / `CARBON_PRESETS` / `CARBON_THEMES`，`js/state.js:9-11`），分工表和三条易错口径在 ⑦.4。

### 9.3 什么情况下保存的数据会丢失

| 情形 | 会不会丢 | 依据 | 能做什么 |
| --- | --- | --- | --- |
| 关标签页、关浏览器、重启电脑 | **不丢** | ③.9 的 B / C / E 腿是三个**独立浏览器进程**，第二个进程读到了第一个写的标记 | — |
| 换浏览器、换 Windows 用户、换 `--user-data-dir` | **等于清零**（新 profile 是空桶） | ③.9 D 腿实测 | 只能用 9.3 末段那三条通道搬 |
| 清除浏览数据时勾了"站点数据 / Cookie" | 丢 | 物理等价物已实测（③.9 G 腿：删掉 `Local Storage\leveldb` → `length` 2→0）；**点那个 UI 本身未验证** | 上面三条通道 |
| 无痕 / InPrivate 窗口 | 预期关窗即丢，**未验证** | 原因见 ⑧.4：无头每次都是全新 profile，与"起始为空"分不开 | 别在无痕里做长期工作 |
| 换 origin：把目录改成放内网 HTTP、或端口变了 | **旧数据读不到**（盘上并没有被删） | 协议档已实测（③.9 E 腿）；端口档**未单独量** | 部署时把 host:port 固定下来，别让人在 `:8123` 和 `:8124` 之间漂 |
| 同一台机器上放第二个 `file://` 克隆 | 不丢，反而**共用同一个桶**：两份目录互相看到、互相盖对方的设置 | ③.9 B / C 腿实测 | 要真隔离就换 profile 或走 `http://`（见 ⑧.3） |
| 配额打满时新建预设 / 改设置 | 那一次写**静默失败**：内存里有、盘上没有、刷新就没 | ③.7 最后一档 `{inMemoryAfter:1,onDisk:0,silentDiverge:true}` | 已知边界，改成 toast 提示要你点头（⑧.3 末条） |
| 点「重置设置」 | 只清 `CARBON_STATE`；预设库与自建主题**不动** | 读码 `js/state.js:200`（只 `removeItem(SETTINGS_KEY)`） | 想连预设一起清，当前只能手工删键 |
| 用「导出配置」当备份 | 搬**不走**预设：那个 JSON 只含设置项 | 读码 `js/ui/panels.js:847-851`；**导出件键集未实测**（⑧.4） | 见下面三条通道 |
| 浏览器后台存储驱逐（磁盘压力、长期不用） | 可能，**未验证** | 本轮没有那个环境 | — |
| 换机器 | 丢（数据本来就在旧机器 profile 里） | 由性质 3 直接得到 | 三条通道 |

现在真能搬数据的只有三条：`?state=` 分享链接（⑦.2，带代码内容和设置项，剥掉的是 `backgroundImage` / `backgroundImageSelection` / `fontUrl` 这三个 dataURL 键，`js/url.js:285`；**不含预设库与自建主题**）、「导出配置 / 导入配置」JSON（只含 25 项设置，`js/ui/panels.js:847-851`，实测 `DEFAULT_SETTINGS` 键数 = 25）、以及手工搬 `localStorage['CARBON_PRESETS']` 这段 JSON 到目标 origin 的同名键。第三条没有 UI，控制台三行就够：

```js
copy(localStorage['CARBON_PRESETS'])            // 旧 origin：把 JSON 放进剪贴板
localStorage.setItem('CARBON_PRESETS', '…')     // 新 origin：粘进去
location.reload()                                // rebuildPresetList 会重新 concat 内置 8 个
```

（这条路本轮**没有跨机器走过一次**，桶这一侧的等价证据是 ③.9 的 B/C 腿；`copy()` 是 DevTools 的函数，不在页面脚本里。）

### 9.4 为什么不用读写配置文件的形式

先说"能不能"，这一半是量的；再说"值不值"，这一半是取舍，我标明。

**能不能：能读能写的路都存在，但每一条都要求用户额外做一件事。**

| 想走的路 | `file://` 默认 | `file://` + `--allow-file-access-from-files` | `http://127.0.0.1` | 结论 |
| --- | --- | --- | --- | --- |
| `fetch()` 读同目录文件 | `TypeError: Failed to fetch`（A 腿） | `ok:true status:200`（H 腿） | `ok:true status:200`（E 腿） | 读得到，但**要每个用户改浏览器启动参数** |
| `XMLHttpRequest` 读同目录文件 | `errored:true, status:0` | `loaded:true, status:200` | `loaded:true, status:200` | 同上 |
| 同一 URL 用 `<script src>` | **通**（`CARBON.DEFAULT_PRESETS` 8 条） | 通 | 通 | 拦截在策略而不在路径 —— 这也是 `data/` 是 `.js` 而不是 `.json` 的原因（⑧.1 第 2 条） |
| `require` / `process` / `module` / `exports` / `ipcRenderer` | 全 `undefined`（每腿都读了） | 同 | 同 | 页面里没有主进程可以借 |
| 无手势调用两个 picker | 两个 API 都是 `function`；`showOpenFilePicker()` 调用即 `SecurityError: Must be handling a user gesture…`（A 腿；save 那一腿没在默认态单测） | **open 与 save 都拒**，同一条 `SecurityError`（H 腿） | open 与 save 都拒（I 腿） | 写得到，代价是**每次保存都要用户点一次"另存为"**，而且拿不回固定路径 |
| `<a download>` + `URL.createObjectURL` | `true` / `function` | 同 | 同 | 现在的「导出配置」就是这条路：文件只能落到浏览器下载目录，更新不了工程目录里那份 |

注意 `file://` 下 `isSecureContext` 也是 `true`、picker 也确实存在，所以"浏览器有没有这个 API"不是判据；拦住它的是**用户手势**和**路径不可指定**这两件事。

**值不值：即使能写文件，也未必换到想要的东西。** 配置文件形态真正换来的是"数据跟着目录走、能拷给同事"。但一旦把数据写成工程目录里的文件，就同时拿到三个新问题：同机多个克隆会各自有一份（现在反而是共用的）；网页只读得到用户手工挑进来的文件，所以每次开页面都要重新挑；写回时要用户点对话框，"自动保存"这条直接没了。也就是说，这条路把"看不见用户数据"的缺点换成了"看得见但要反复交互"的缺点。

真要配置文件形态，改的是**交付形态**，不是这个文件：

- 变 Electron 桌面应用：主进程有 `fs`，可以直接读写 `%APPDATA%` 或工程目录里的一个 json —— 那是 `windows-electron-scaffold` 那条路，代价是交付体从"一个目录 + 双击"变成要装运行时。
- 变带后端的内网服务：写盘发生在服务端，前端仍然走 `fetch`，需要 ⑦.3 那种部署再加一个服务。
- 留在纯静态目录（本工程的选择）：能做到的最接近配置文件的东西，就是面板里已有的「导出配置 / 导入配置」，以及 `?state=` 链接。

**为什么最后落在 localStorage**（三条理由 + 一条代价）：与上游同构（键名、内容形状都一样，对照线上行为成本低）；零权限零安装（双击 `index.html` 就生效，不要旗标、不要对话框）；写入代价实测可忽略（0.4 ms / 128 KB）。代价就是 9.3 那张表：看不见、搬不走、有配额，且配额满时静默失败。

### 9.5 如果你想把它改成"文件形态"，最小动作是什么

分两档，都不需要动 `vendor/`、`data/`、`fonts/`：

1. **不换交付形态**（还是双击 `index.html`）：把「导出配置」扩成"导出全部三个键"、把「导入配置」扩成"按键写回三个键再 reload"。用的就是现在那两条通道——`<a download>` 把文件写出去、`<input type="file">` + `FileReader` 把文件读进来（一整块在 `js/ui/panels.js:760-789`），用户手势也是现成的。顺带一条不对称：导出只取 `DEFAULT_SETTINGS` 那 25 个键（`:847-851`），导入却只摘掉 `code`、其余键全收（`:767-768` 的 `store().replace(rest)`）—— 所以"手写一份 JSON 喂进去"这条路本来就是通的，缺的只是把预设与主题库也纳入导出。这是行为变更，等你点头再做。
2. **换交付形态**：走 Electron（主进程 `fs` 读写 `%APPDATA%\carbon-offline\state.json`），localStorage 那三个键可以保留当缓存。这就是另一个工程了。

顺带一条与 9.3 第 7 行同源的：配额打满时 `writeJson` 返回 `false` 但调用点不看返回值（`js/state.js:272`、`:279`）。要改成"检查返回值 + toast"是一行级改动，也等你点头。

