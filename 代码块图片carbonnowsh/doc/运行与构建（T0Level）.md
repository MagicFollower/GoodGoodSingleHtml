# 运行与构建（T0Level）

读者设定：你从没碰过这个工程。本文只写"照着做就能复现"的东西，每条命令都是本机跑过的，输出原样贴在对应小节；跑不了或没跑的，显式标 `未验证` 并说明原因，末尾有汇总。

工程是什么：carbon.now.sh 的离线复刻。入口是仓库根的 `index.html`，**没有构建步骤、没有 npm install、运行时零网络**——复杂的 JS 与数据按用户要求放在子目录（`js/`、`data/`、`vendor/`、`css/`）。

---

## 0. 本文的章节映射（为什么标题和 WPF/Electron 那份不一样）

八节的**标题**是桌面工程口径。这里是纯前端静态页，硬套会写出不存在的东西（"打包成 exe""改 exe 图标"），所以按**三个不变量**移植，标题相应改名，映射理由逐条写明：

| 规范原节 | 本工程对应 | 为什么这样映射 |
| --- | --- | --- |
| 前置要求 | ① 前置要求 | 不变：装什么、什么版本、怎么核对 |
| 项目启动（首次构建） | ② 启动（无构建）与产物重算 | 本工程"启动"= 打开一个文件；真正需要构建的是 `vendor/` 与 `data/`，它们已随仓库交付，所以这一节同时给"最短可跑路径"和"重算产物"两条 |
| 本地调试 | ③ 本地调试与验收判据 | 不变，但判据从"跑起来看看"换成两套探针台 + 一份静态审计（可机器检） |
| 打包与启动 | ④ 打包与启动（整目录分发） | 桌面工程要产出 dir/portable/nsis；这里的"产物"就是目录本身，所以打包=压缩目录，启动=解压后打开 |
| 修改标题 | ⑤ 改标题与文案 | 桌面=窗口标题；这里是 `<title>` + 页头文案 + 导出文件名前缀，三处都会波及用户所见 |
| 修改图标 | ⑥ 改图标与品牌资产 | 桌面=exe 图标；这里是页面 logo、水印 SVG、浏览器标签 favicon（本工程当前**没有** favicon，给了不引入网络请求的加法） |
| 发布·分发 | ⑦ 发布与分发 | 桌面=安装包/在线发布；这里两条分发面：整目录（离线）与 `?state=` 分享链接（把状态塞进 URL） |
| 注意事项 | ⑧ 注意事项与偏离清单 | 不变，且必须存在：交付面收窄到"改了会波及产物"的项 |

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

1. 拿到整个目录（不要只拷 `index.html`，它靠相对路径引 25 个本地文件）。
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

---

## ③ 本地调试与验收判据

改代码不需要任何构建动作：文件是 classic script，浏览器刷新即生效（`Ctrl+Shift+R` 避免缓存）。

判据三挡，从快到慢。**改哪一面就跑哪一挡**，不用每次全跑。

### 3.1 静态审计（秒级，离线，不需要浏览器）

```powershell
PS> node tools/audit.js
```

本机真实输出：

```
=== audit: . ===

[已核 19]
  ✓ 零网络判据自身的反向自测 — 抓到 3 处合成违规 / 放过注释与命名空间
  ✓ 零运行时网络引用 — 扫描 26 个文件；点名豁免 1 处（上游 XHR）
  ✓ 无 ES module / 无绝对路径 — 25 个引用全部为相对路径 classic script/css
  ✓ 依赖加载顺序 — script 23 个 + css 2 个，顺序约束全通过
  ✓ 每个页面 JS 都能过语法关 — 23 个 js 文件语法全通过（含 vendor 与 data）
  ✓ 数据全局契约 — 29 主题 × 12 键配平，13 字体均有回退栈，25 个默认设置项
  ✓ SVG 资产契约 — 20 段 svg 可用、无 JSX 残留、色值合法
  ✓ URL 参数编解码回环 — 2 组样本 × 22 键全等；sl/ds/fl 型别正确；>4000 字符软截断生效（2000）
  ✓ 设置项都有落点 — 25 个设置项有落点；URL 键 22 个与上游一致
  ✓ 带 px 单位的设置项都在 PX_KEYS 归一化清单里 — px 型设置 5 个（paddingVertical, paddingHorizontal, dropShadowOffsetY, dropShadowBlurRadius, fontSize）与清单双向对齐
  ✓ data-slot 契约 — 7 个 slot 双向对齐：logo,theme-dropdown,language-dropdown,background-select,settings,copy-menu,export-menu
  ✓ 每个 popout 都被挂进文档 — 5 个 popout 全部 appendChild 到位
  ✓ CSS 结构 — 规则块 225 配平；变量定义 11，引用 119，其中 JS 现设 0（无）
  ✓ dom-to-image 保留上游前缀 — 上游 22770B 为严格前缀，追加 1030B 全局桥接
  ✓ vendor 核心与上游字节一致 — codemirror.min.js 169899B / codemirror.min.css 6037B
  ✓ hljs 检测面与上游同构 — 注册 71 → 白名单内 57（退订 14：bash,c,cpp,http,ini,less,makefile,php-template,plaintext,properties,python-repl,scss,vbnet,xml）；DEFAULT_CODE→javascript，python→python
  ✓ 语言到 CM mode 的覆盖 — mode 60 + 自定义 5；声明且确实不可用：GraphQL(graphql)
  ✓ build-vendor --verify-only —   vendor/dom-to-image.js  23800B  sha1 c60f5cfb  (阈值 22000)
  ✓ build-data --check — data/ 与上游一致

[探针已覆盖 6]（本脚本不重复证明，跑法与数值见 doc 第 3 节）
  · 导出 PNG/SVG 的字节与所见即所得 — tools/probe/verify.html 的 png/png1x/squared/svg 四步
  · 运行时 0 网络请求 — 同上 net 步（XHR/fetch/Image.src/a.href 钩子 + performance 条目，file:// 与 http:// 两口径）
  · file:// 下 localStorage 读写 — 同上 storageProbe 与 persist 两步（含 CARBON_STATE 的排除字段）
  · 隐形字符开/关 — 同上 afterInvisibles / afterInvisiblesOff
  · 选中行淡化 — tools/probe/verify2.html「非选中行被淡化」
  · 自定义主题创建 / 预设应用与撤销 / 三页签设置 — tools/probe/verify2.html 共 43 项

[未验证 5]（需实机，不假装通过）
  ? 真实渲染：125% 系统 DPI 下预览与导出图是否一致 — 无头跑固定 deviceScaleFactor=1，量不到系统缩放；需人眼对照 doc/截图-*.png
  ? 剪贴板写入图片（ClipboardItem）— 无头环境无剪贴板权限，且用户手势（Ctrl+C）不可合成
  ? 字体上传 new FontFace().load() 成功路径 — 需真实挑选一个本机 ttf/woff 并等异步 load
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

产物是整页 DOM，末尾有一段 `<pre id="verify-json">VERIFY_JSON{...}`，取出来即判据。本机真实数值（1440×1040 视口，`file://` 口径）：

```json
{ "ok": true, "hung": [],
  "layout": {
    "toolbar": [1346,40,35,83], "bgDisplay": [40,40,557,83],
    "settingsBtn": [40,40,605,83], "exportBtn": [92,40,1264,83],
    "canvasArea": [1346,391,35,139], "exportContainer": [812,391,302,139],
    "editor": [700,279,358,195], "windowControls": [686,24,372,205],
    "handler": [8,279,1050,195], "popoutMounted": 4,
    "mode": "javascript",
    "detection": { "allowed": 57, "registered": 57, "removed": 14 },
    "computed": { "containerPadding": "56px", "editorPadTop": "48px",
      "editorFont": "Hack", "editorFontSize": "14px", "editorLineHeight": "18.62px",
      "shadow": "rgba(0, 0, 0, 0.55) 0px 20px 68px 0px", "radius": "5px",
      "bg": "rgb(171, 184, 195)", "keywordColor": "rgb(230, 205, 105)" } },
  "png":  { "bytes": 190322, "type": "image/png", "head": "89 50 4e 47 0d 0a 1a 0a 00 00 00 0d" },
  "png1x":{ "bytes": 64644 }, "squared": { "bytes": 78393 }, "pngAfter": { "bytes": 29553 },
  "svg":  { "bytes": 1000843, "type": "image/svg+xml",
            "startsWith": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1624\" height=",
            "hasForeignObject": true, "hasCodeMirror": true, "hasCursors": false,
            "hasEliminate": false, "hasNbsp": false, "hasBadPct": false, "keywordCount": 7 },
  "sizeCheck": { "offset": [812,391], "expect2x": [1624,782] },
  "net":  { "scheme": "file:", "origin": "file://", "attempted": [], "resourceEntries": 0,
            "nonFile": 0, "foreignOrigin": 0, "dataOrBlob": 0 },
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
- `sizeCheck.offset [812,391]` 对 `expect2x [1624,782]`：导出图尺寸 = 画布尺寸 × 倍率，2x 恰好翻倍。
- `svg.hasCursors=false` / `hasEliminate=false`：`CodeMirror-cursors` 与 `eliminateOnRender`（白色/棋盘底）被 filter 掉了，不会进图。
- `svg.hasNbsp=false` / `hasBadPct=false`：SVG 后处理五步替换生效（`&nbsp;`→`&#160;`、`%23`→`#`、`%0A`→换行、裸 `&`→`&amp;`、删无用 `@font-face`）。
- `png.head`：`89 50 4e 47 0d 0a 1a 0a` 是 PNG 签名，证明拿到的是真图不是空 Blob。
- `persist.keys=26` 且 `hasCode=false`：`CARBON_STATE` 落盘时排除了 code / backgroundImage / highlights / themes / fontUrl / selectedLines / name（与上游同名同口径）。
- `afterInvisiblesOff.marks=0`：关掉隐形字符要**清得干净**。这条曾经量到 7，因为 CM5 的 `getAllMarks()` 拿不到 `replacedWith` 节点，靠反查节点属性清标记是清不掉的——现在 `js/invisibles.js` 自己记账（WeakMap）。

### 3.3 探针台 B：43 项交互冒烟

```powershell
PS> & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --window-size=1440,1040 --virtual-time-budget=60000 --user-data-dir="D:\tmp\edge-pB" --dump-dom "file:///C:/Users/webtu/Desktop/代码块图片carbonnowsh/tools/probe/verify2.html" > "$env:TEMP\smoke.dom"
```

本机真实读数：`{"total":43,"pass":43}`，`fatal=null`，页面 `console.error` 捕获为空。它覆盖：主题下拉 30 项（29 主题 + Create+）→ 选 Monokai 后画布底色 `rgb(39,40,34)`；语言下拉 78 项 + 输入 `py` 过滤；背景取色器拖 hue / 15 预设色 / 手输 hex；设置面板三页签、4 条滑杆、窗口主题四挡、字号、行号、隐形字符开关；预设应用与撤销；自建主题（12 个 token 色位 → Create+ 写进 `CARBON_THEMES`，主题数 29→30）；点行号淡化；导出面板 1x/2x/4x 与文件名；`CARBON_STATE` 落盘；4x PNG 与 SVG 字节。

两条踩过的坑，写在这里免得下一个人重踩：

1. **点行号必须带真实坐标。** CM5 的 `gutterEvent` 按 `clientX/clientY` 命中测试，**不看 `event.target`**。合成事件写 `clientX:10, clientY:10` 时 `selectedLines` 一直是 `null`，看着像功能坏了。给出行号元素的中心坐标后才量到 `sl=[1]`、非选中行 `opacity=0.5`。
2. **探针要能自己变红。** `net` 那一步在 `file://` 下 `resourceEntries=0`——Chromium 不给本地文件记资源条目，所以"0 条"既可能是"没联网"也可能是"探针瞎了"。用同一个探针跑本机 HTTP 做对照（③.4），`resourceEntries=26` 说明它看得见，`foreignOrigin=0` 才是"没出本机"的真凭据。

### 3.4 HTTP 口径对照（证明不是只会在 file:// 下活着）

```powershell
PS> node -e "const http=require('http'),fs=require('fs'),path=require('path');const root=process.cwd();const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(root,p);if(!f.startsWith(root)){s.writeHead(403).end('403');return}fs.readFile(f,(e,b)=>{if(e){s.writeHead(404).end('404 '+p);return}s.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});s.end(b)})}).listen(8123,'127.0.0.1',()=>console.log('serving '+root+' on http://127.0.0.1:8123/'))"
```

```
serving C:\Users\webtu\Desktop\代码块图片carbonnowsh on http://127.0.0.1:8123/
```

另开一个终端：

```powershell
PS> curl.exe -sS -o NUL -w "index.html HTTP=%{http_code} bytes=%{size_download}`n" http://127.0.0.1:8123/index.html
PS> curl.exe -sS -o NUL -w "vendor/hljs.min.js HTTP=%{http_code} bytes=%{size_download}`n" http://127.0.0.1:8123/vendor/hljs.min.js
PS> curl.exe -sS -o NUL -w "missing HTTP=%{http_code}`n" http://127.0.0.1:8123/nope.js
```

```
index.html HTTP=200 bytes=3665
vendor/hljs.min.js HTTP=200 bytes=135556
missing HTTP=404
```

再把 3.2 的探针 URL 换成 `http://127.0.0.1:8123/tools/probe/verify.html`，本机真实读数：

```json
{ "ok": true,
  "net": { "scheme": "http:", "origin": "http://127.0.0.1:8123", "attempted": [],
           "resourceEntries": 26, "nonFile": 26, "foreignOrigin": 0, "foreignList": [], "dataOrBlob": 0 },
  "png": 190322, "svg": 1000843, "persistBytes": 553 }
```

两口径的导出字节与持久化字节**逐字相同**（190322 / 1000843 / 553），说明页面不依赖 `file://` 的特殊行为。`resourceEntries=26` 全是同源本地文件，`foreignOrigin=0` 表示没有一个请求跑到机器外面。

### 3.5 手工调试入口

浏览器控制台里可直接用：

```js
CARBON.store.state              // 全量状态
CARBON.store.set({ theme: 'nord' })
CARBON.editor.cm.getValue()     // CodeMirror 实例
CARBON.exporter.getImage({ format: 'blob', exportSize: 4 })
CARBON.url.buildShareUrl(CARBON.store.state)
localStorage.getItem('CARBON_STATE')
```

---

## ④ 打包与启动（整目录分发）

### 4.1 交付体清单

| 路径 | 文件数 | 体积 | 是不是运行必需 |
| --- | ---: | ---: | --- |
| `index.html` | 1 | 3.6 KB | 必需，唯一入口 |
| `css/app.css` | 1 | 26.2 KB | 必需 |
| `js/`（含 `js/ui/`） | 11 | 110.6 KB | 必需 |
| `data/` | 5 | 137.2 KB | 必需 |
| `vendor/` | 9 | 992.0 KB | 必需（其中 `README.md` 是说明，删了不影响运行） |
| **交付体合计** | **27** | **1.24 MB** | — |
| `tools/upstream/` | 33 | 571.8 KB | 不必需，重算 `data/` 与取证用 |
| `tools/.cache/` | 136 | 1126.7 KB | 不必需，`build-vendor` 的下载缓存 |
| `tools/probe/` | 2 | 35.7 KB | 不必需，③ 的探针台 |
| `doc/` | 3 | 本文 + 两张基线截图 | 不必需 |

本机真实读数（`node` 递归统计）：

```
css      1 文件 26.2 KB
js       11 文件 110.6 KB
data     5 文件 137.2 KB
vendor   9 文件 992.0 KB
tools    174 文件 1852.6 KB
doc      3 文件 180.8 KB
index.html 3.6 KB
交付体(index+css+js+data+vendor)= 27 文件 1300088 B = 1.24 MB
```

### 4.2 打包

```powershell
PS> $items = (Get-ChildItem -LiteralPath . | Where-Object { $_.Name -notin @("tools","doc") }).FullName
PS> Compress-Archive -LiteralPath $items -DestinationPath "$env:TEMP\carbon-offline.zip" -Force
```

本机真实输出（含验包判据；`[Console]::OutputEncoding` 那句按 ②.2 的说明加）：

```
打包顶层项: css, data, js, vendor, index.html
zip 字节 = 402906
zip 内条目数 = 27
含 index.html = True
含 vendor/hljs.min.js = True
含 js/ui/panels.js = True
误含 tools/doc = False
```

判据里两个数对得上：交付体 27 个文件 → 包内 27 条条目。

坑（实测踩过）：**验包名不要直接写 `$a.Entries.FullName -contains "vendor/hljs.min.js"`**。`Compress-Archive` 在 Windows 上把条目名写成反斜杠（`vendor\hljs.min.js`），这样判**永远 False**——我第一次跑就被它骗过，以为包里没有 vendor。要么先 `.Replace("\","/")` 归一（上面的写法），要么比对时就写反斜杠。

只发交付体的话，`tools/`、`doc/` 可以不带（上面的排除表就是这么写的）；但那样就没有 ③ 的判据和 ②.3/②.4 的重算能力了。

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
```

最后一行同时是"页面真的起来了"的判据：`--dump-dom` 里出现 `Seti` 说明 `js/app.js` 已经跑完并把主题下拉填进去了，静态 HTML 里是没有这个字符串的。

### 5.2 页头文案

`index.html` 的 `.hero-text`（第 16-19 行）：主句 + `.hero-sub` 副句。改完用上面 5.1 的判据回读 `hero 文案首行`。

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

③.4 已经证明同源 HTTP 下行为与 `file://` 一致（导出字节、持久化字节逐字相同，`foreignOrigin=0`）。注意两点：

- 必须整个目录一起放，`index.html` 不能单独当首页发。
- 换到 HTTP 之后 `localStorage` 的 origin 从 `file://` 变成 `http://<host>`，**原来存的设置不会跟过去**。

`未验证`：只验过 `127.0.0.1:8123` 这一个临时服务。真实内网/nginx/IIS 的 MIME 与路径规则没验。

---

## ⑧ 注意事项与偏离清单

### 8.1 结构约束（改了会坏）

1. **脚本顺序不能动。** `vendor/codemirror.min.js` → addons → modes → custom-modes → `hljs.min.js` → hljs-languages → `dom-to-image.js` → `data/*` → `js/*` → `js/ui/*` → `js/app.js`。`hljs-languages.js` 里的语言文件裸引全局 `hljs`，核心必须在它前面。审计有专门一条按声明顺序验（`依赖加载顺序 — script 23 个 + css 2 个`）。
2. **只能 classic script。** `file://` 下 ES module 与 `fetch()` 本地 JSON 都会被 CORS 拦死，所以 `data/` 是 `window.CARBON.*` 赋值形式的 JS，不是 JSON。
3. **`index.html` 里的 `data-slot` 名字是契约。** 7 个：`logo,theme-dropdown,language-dropdown,background-select,settings,copy-menu,export-menu`。`js/app.js` 按名字挂面板，改名即空位。
4. **每个 `ui.popout()` 必须被 appendChild。** 早期版本 popout 全建了但没挂，结果五个弹层一个都不显示，界面上看不出原因。审计有一条「每个 popout 都被挂进文档 — 5 个 popout 全部 appendChild 到位」盯着。
5. **`vendor/` 里的文件带 `/*!-- 来源 URL/版本/字节/sha1 --*/` 注释**，可 grep 复核；`vendor/README.md` 的表由同一份构建数据生成，别手改。

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

### 8.3 已知边界（不是 bug）

- 本地上传的背景图/字体只进 `localStorage`，不进分享链接（⑦.2）。
- `localStorage` 配额爆掉时会**丢掉 backgroundImage 再写一次**（`js/state.js` 的 `writeJson` 兜底），这是刻意的降级而不是失败。
- 隐形字符会把每个空格/制表都打一个标记。代码很长时这是几百个 `markText`——上游 `cm-show-invisibles` 同样行为，不是本工程的退化。
- 导出倍率 4x 时图很大（本机实测 4x PNG 387587 B，SVG 1276482 B），低配机器上会慢。
- `file://` 下所有本地克隆**共用同一个 `localStorage` 桶**（origin 都是 `file://`）。拷两份目录并分别改设置，会互相看到对方的设置。

### 8.4 未验证项汇总

| 项 | 原因 |
| --- | --- |
| 双击 `index.html` 开可见窗口 | 本轮全程无头取证，没开过可见窗口；`file://` 加载路径已由无头等价验证（②.2、③.2） |
| 125% 系统 DPI 下预览与导出图是否一致 | 无头跑固定 `deviceScaleFactor=1`，量不到系统缩放；需人眼对照 `doc/截图-*.png` |
| 剪贴板写入图片（`ClipboardItem`） | 无头环境无剪贴板权限，且用户手势不可合成 |
| 字体上传 `new FontFace().load()` 成功路径 | 需真实挑选本机 ttf/woff 并等异步 load |
| 拖文件导入（带真实 `File` 的 drop） | 无头合成 `dragenter/drop` 拿不到真实 File |
| 导出后浏览器另存 / 「打开」按钮 | 需要真实下载与新标签行为 |
| SVG favicon 加法（⑥.2） | 建议加法，本轮没写进 `index.html`，也没回读过 |
| `node tools/build-vendor.js` 在断网下能否成功 | 本轮是联网跑的；`tools/.cache/`（136 文件）是下载缓存，但没验过离线命中路径 |
| 部署到真实内网 HTTP 服务器 | 只验过 `127.0.0.1:8123` 临时服务（③.4） |
| Firefox / Safari 下的 `file://` 行为 | 只跑过 Edge 155（Chromium 内核） |
