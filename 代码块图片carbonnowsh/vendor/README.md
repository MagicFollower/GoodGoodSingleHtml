# vendor/ — 离线依赖清单（由 `tools/build-vendor.js` 生成，请勿手改）

目标：双击 `index.html`（file://）即可用，零运行时网络。所有文件都是 **classic script**（`<script src>`），无 ES module、无 `fetch`/`XHR` 依赖（dom-to-image 内部有 XHR，见 §4）。

## 1. 加载顺序（index.html 必须照此）

```html
<link rel="stylesheet" href="vendor/codemirror.min.css">
<script src="vendor/codemirror.min.js"></script>      <!-- 全局 CodeMirror，内置 mode "null" -->
<script src="vendor/addons.js"></script>              <!-- 只依赖 core，必须早于 modes.js -->
<script src="vendor/modes.js"></script>               <!-- 依赖拓扑序拼接 -->
<script src="vendor/custom-modes.js"></script>        <!-- apache/nim/riscv/solidity/elixir -->
<script src="vendor/hljs.min.js"></script>             <!-- 核心，var hljs=... → window.hljs -->
<script src="vendor/hljs-languages.js"></script>      <!-- 裸引全局 hljs，核心必须在前面 -->
<script src="vendor/dom-to-image.js"></script>        <!-- 挂 window.domtoimage -->
```

> hljs 核心由本脚本从 tools/upstream/highlight.min.js **原样字节**复制为 vendor/hljs.min.js（135556 B, sha1 f4527fcc，与 https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@10.7.2/highlight.min.js 同字节），所以删掉任何抓取中间目录都不影响交付体。

## 2. 文件表

| 文件 | 来源 URL / 上游版本 | 字节 | sha1(8) | 校验方式 |
| --- | --- | ---: | --- | --- |
| `vendor/codemirror.min.js` | https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.5/codemirror.min.js<br>_v5.65.5_ | 169899 | `ed863419` | CodeMirror 5 core（UMD，浏览器走 global 分支；实测含 defineMode("null")+defineMIME("text/plain","null")） |
| `vendor/codemirror.min.css` | https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.5/codemirror.min.css<br>_v5.65.5_ | 6037 | `f72a15fb` | CodeMirror 5 基础样式 |
| `vendor/addons.js` | https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.5/addon/<dir>/<name>.min.js + tools/upstream/autoCloseBrackets.js<br>_v5.65.5_ | 16691 | `89d268e5` | 假 CodeMirror + 真 core 双轨 vm 执行；addon 数=4 (mode/multiplex, mode/overlay, mode/simple, edit/autoCloseBrackets(Carbon 补丁)) |
| `vendor/modes.js` | https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.5/mode/<m>/<m>.min.js<br>_v5.65.5_ | 395357 | `a2d42ed7` | 假 CodeMirror + 真 core 双轨 vm 执行；mode 数=60，依赖闭包全满足 |
| `vendor/custom-modes.js` | tools/upstream/*.js + https://registry.npmmirror.com/codemirror-mode-elixir<br>_vcarbon@main + elixir@1.1.2_ | 51252 | `278be7a6` | vm 执行；mode=apache/nim/riscv/solidity/elixir；graphql 已剔除 |
| `vendor/hljs.min.js` | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@10.7.2/highlight.min.js<br>_v10.7.2_ | 135556 | `f4527fcc` | 与 tools/upstream/highlight.min.js 逐字节相同（Buffer 原样复制）+ node require 取得 hljs + listLanguages=39 |
| `vendor/hljs-languages.js` | https://cdnjs.cloudflare.com/ajax/libs/highlight.js/10.7.2/languages/<name>.min.js<br>_v10.7.2__<br>核心内置 25 个无需下载；跳过 无 | 196921 | `55562311` | 逐语言隔离注册(32/32 通过) + 合并后 listLanguages 复核 + highlightAuto 实测 |
| `vendor/dom-to-image.js` | 本地 tools/upstream/dom-to-image.js（carbon-app/carbon lib/dom-to-image.js，源自 tsayen/dom-to-image master）<br>_vdom-to-image 2.x (fork, 22770B)_ | 23800 | `c60f5cfb` | vm 加载断言 5 个导出方法齐全 + 前缀比对证明原实现零改动 + file:// 风险点静态扫描 |

实测合计：modes 60 个 / addons 3 个 / hljs 扩展 32 个。

## 3. CodeMirror 依赖闭包

| # | mode（拓扑序=拼接序） | 上游字节 | sha1(8) | 文件级依赖（UMD 数组） | 注册名 |
| ---: | --- | ---: | --- | --- | --- |
| 0 | `clike` | 20891 | `b351be26` | — | `clike` |
| 1 | `clojure` | 11127 | `8a75fbf2` | — | `clojure` |
| 2 | `cobol` | 6402 | `5b578893` | — | `cobol` |
| 3 | `coffeescript` | 4160 | `6ef4cd07` | — | `coffeescript` |
| 4 | `commonlisp` | 2481 | `d614bad0` | — | `commonlisp` |
| 5 | `crystal` | 5325 | `7155cd2b` | — | `crystal` |
| 6 | `css` | 27098 | `14283c4f` | — | `css` |
| 7 | `d` | 3976 | `390d49a7` | — | `d` |
| 8 | `dart` | 2448 | `5a82b371` | `mode:clike` | `dart` |
| 9 | `diff` | 557 | `cb5aea17` | — | `diff` |
| 10 | `xml` | 5981 | `863624bf` | — | `xml` |
| 11 | `javascript` | 17313 | `c7ec6e10` | — | `javascript` |
| 12 | `htmlmixed` | 2870 | `35b311da` | `mode:xml` `mode:javascript` `mode:css` | `htmlmixed` |
| 13 | `django` | 4819 | `3ebda869` | `mode:htmlmixed` `addon:mode/overlay` | `django` |
| 14 | `dockerfile` | 2195 | `ccba46b4` | `addon:mode/simple` | `dockerfile` |
| 15 | `elm` | 2084 | `3a3d5008` | — | `elm` |
| 16 | `erlang` | 8118 | `a30bbbe5` | — | `erlang` |
| 17 | `fortran` | 4807 | `9fd9b4db` | — | `fortran` |
| 18 | `gherkin` | 10410 | `d1eb9d8e` | — | `gherkin` |
| 19 | `go` | 3016 | `4122b3ae` | — | `go` |
| 20 | `groovy` | 4316 | `dfba8f88` | — | `groovy` |
| 21 | `handlebars` | 1458 | `4ef7abc4` | `addon:mode/simple` `addon:mode/multiplex` | `handlebars` |
| 22 | `haskell` | 4546 | `e7b838cd` | — | `haskell` |
| 23 | `jsx` | 2324 | `975cfbee` | `mode:xml` `mode:javascript` | `jsx` |
| 24 | `julia` | 5593 | `0bb26978` | — | `julia` |
| 25 | `lua` | 3638 | `be2ff40c` | — | `lua` |
| 26 | `markdown` | 14631 | `467a0e17` | `mode:xml` | `markdown` |
| 27 | `mathematica` | 2119 | `da199703` | — | `mathematica` |
| 28 | `mllike` | 5014 | `5e6cd92c` | — | `mllike` |
| 29 | `nginx` | 7461 | `c5420eac` | — | `nginx` |
| 30 | `ntriples` | 1708 | `fa22677c` | — | `ntriples` |
| 31 | `octave` | 2548 | `89f1838e` | — | `octave` |
| 32 | `pascal` | 2343 | `a29f9d69` | — | `pascal` |
| 33 | `perl` | 9802 | `64c4182e` | — | `perl` |
| 34 | `php` | 13940 | `56dace39` | `mode:htmlmixed` `mode:clike` | `php` |
| 35 | `powershell` | 7985 | `04bd01aa` | — | `powershell` |
| 36 | `protobuf` | 1180 | `e29826b6` | — | `protobuf` |
| 37 | `pug` | 7929 | `dd3c3990` | `mode:javascript` `mode:css` `mode:htmlmixed` | `pug` |
| 38 | `python` | 6446 | `41d2cf94` | — | `python` |
| 39 | `r` | 3119 | `2e8dd197` | — | `r` |
| 40 | `ruby` | 5287 | `4cdbab56` | — | `ruby` |
| 41 | `rust` | 2388 | `6b2df0a8` | `addon:mode/simple` | `rust` |
| 42 | `sass` | 4655 | `4e69715d` | `mode:css` | `sass` |
| 43 | `shell` | 2753 | `e15b4e29` | — | `shell` |
| 44 | `smalltalk` | 2202 | `f170e046` | — | `smalltalk` |
| 45 | `sparql` | 3651 | `1e7d99bb` | — | `sparql` |
| 46 | `sql` | 40326 | `7eb97820` | — | `sql` |
| 47 | `stex` | 3270 | `730812c0` | — | `stex` |
| 48 | `stylus` | 25921 | `3c6a3ab3` | — | `stylus` |
| 49 | `swift` | 4012 | `c5d27bc5` | — | `swift` |
| 50 | `tcl` | 2494 | `04428ba2` | — | `tcl` |
| 51 | `toml` | 1243 | `01573f2e` | — | `toml` |
| 52 | `turtle` | 2099 | `53a12bca` | — | `turtle` |
| 53 | `twig` | 2174 | `bd146a9a` | `addon:mode/multiplex` | `twig` |
| 54 | `vb` | 4108 | `a9d012bb` | — | `vb` |
| 55 | `verilog` | 10417 | `2be11faa` | — | `verilog` |
| 56 | `vhdl` | 3532 | `a0d6e84d` | — | `vhdl` |
| 57 | `vue` | 1897 | `6b6de213` | `addon:mode/overlay` `mode:xml` `mode:javascript` `mode:coffeescript` `mode:css` `mode:sass` `mode:stylus` `mode:pug` `mode:handlebars` | `vue` |
| 58 | `xquery` | 6782 | `826aef35` | — | `xquery` |
| 59 | `yaml` | 1820 | `f0c771ee` | — | `yaml` |

| # | addon | 上游字节 | sha1(8) | 文件级依赖 | 被谁需要 |
| ---: | --- | ---: | --- | --- | --- |
| 0 | `mode/multiplex` | 2331 | `c09d42ed` | — | `handlebars`, `twig` |
| 1 | `mode/overlay` | 1323 | `5430aed6` | — | `django`, `vue` |
| 2 | `mode/simple` | 4026 | `dd29da7a` | — | `dockerfile`, `handlebars`, `rust` |

- 种子（58）：`shell `, `clike `, `clojure `, `cobol `, `coffeescript `, `crystal `, `css `, `sql `, `d `, `dart `, `diff `, `django `, `dockerfile `, `elm `, `erlang `, `mllike `, `fortran `, `gherkin `, `go `, `groovy `, `handlebars `, `haskell `, `htmlmixed `, `javascript `, `jsx `, `julia `, `stex `, `commonlisp `, `lua `, `markdown `, `mathematica `, `octave `, `ntriples `, `nginx `, `pascal `, `perl `, `php `, `powershell `, `protobuf `, `python `, `r `, `ruby `, `rust `, `sass `, `smalltalk `, `sparql `, `stylus `, `swift `, `tcl `, `toml `, `turtle `, `twig `, `vb `, `verilog `, `vhdl `, `vue `, `xquery `, `yaml`
- 递归额外引入的 mode（2）：`xml`（被 `htmlmixed`, `jsx`, `markdown`, `vue` 依赖）、`pug`（被 `vue` 依赖）
- 递归引入 + 手工确认的 addon（3）：`mode/multiplex`（被 `handlebars`, `twig` 依赖）、`mode/overlay`（被 `django`, `vue` 依赖）、`mode/simple`（被 `dockerfile`, `handlebars`, `rust` 依赖）
- 拓扑序前 8：`clike → clojure → cobol → coffeescript → commonlisp → crystal → css → d …`
- 种子剔除：`auto`：Carbon 的 Auto 选项，非 CM mode，由 hljs.highlightAuto 实现；`text`：cdnjs 无 mode/text/text.min.js（实测 404）；CM5 core 只内置 defineMode("null") + defineMIME("text/plain","null")。实测 CodeMirror.getMode({}, "text") 不抛错、返回 null mode，因此无需下载
- 实测（真 core）：`CodeMirror.getMode({}, "text"/"plaintext"/"auto"/"graphql")` 全部返回 `null` mode、不抛错 → 未注册的 mode 自动降级为纯文本，不会崩。

### 假 CodeMirror 注册结果（轨道 A）

- defineMode 注册名 69 个；defineMIME 128 条；defineSimpleMode 0 个；extendMode 0 个；defineOption/defineExtension 1 个。
- 真 core 注册后 `CodeMirror.modes` 数量：70（core 自带 null）。
- 未被满足的文件级依赖：**0 个**
- mode 名级依赖（`ext.depend` / simple-mode 的 `mode:` 字段）未注册项：**0 个**
- 假对象被访问到、但我没预置的 API（Proxy 记录）：无
- 真 core 下自定义 mode 的 API 面：apache/nim/riscv/solidity/elixir 只用到 `defineMode`+`defineMIME`，无 addon 依赖（轨道 B 无抛错 + 注册名 apache/nim/riscv/solidity/elixir）。

### mime||mode → mode 解析覆盖（Carbon 把 `language.mime || language.mode` 直接喂给 CM，实测 75/78 条能解析到真实 mode）

| 显示名 | 传给 CM 的 spec | 解析到的 mode |
| --- | --- | --- |
| Auto | `auto` | **null**（无高亮，见 §6） |
| Plain Text | `text` | **null**（无高亮，见 §6） |
| GraphQL | `graphql` | **null**（无高亮，见 §6） |
其余 75 条全部解析到具名 mode（完整清单见构建日志 / 本次运行输出）。

## 4. dom-to-image 在 file:// 下的调用结论

改造方式：产物 = `tools/upstream/dom-to-image.js`（22770 B, sha1 ba326ae0）**逐字节原样** + 末尾追加一段桥接（见文件尾注释），因此产物以原文件为严格前缀（脚本内断言）。上游第 36-37 行 `if (typeof module!=='undefined') module.exports=domtoimage; else global.domtoimage=domtoimage` 配 `;})(this)`，classic script 下 `module` 不存在、`this`===window → 天然挂出 `window.domtoimage`；追加段只是防 `window.module` 被别处污染时兜底。

网络出口点（静态扫描实测）：
- `new XMLHttpRequest()`：1 处，全在 `util.getAndEncode()`（唯一的取字节通道）。
- `fetch(`：0 处（本 fork 不使用 fetch）。
- `document.styleSheets`：1 处，`fontFaces.readAll()` 遍历 `cssRules` 抓 `@font-face`。
- `new Image(); image.src = uri`：1 处（`util.makeImage`），uri 恒为 data: URL，不产生请求。
- `util.isDataUrl` 闸门：2 处 —— 这是本库唯一的「跳过网络」开关。

结论（调用时必须传什么）：
1. **本 fork 没有 `fontEmbedCSS`/ `skipFonts`/ `ignoreFonts` 选项**（实测扫描：false/false/false）；只有 `filter, bgcolor, width, height, style, quality, imagePlaceholder, cacheBust, escapePercentSign`。所以「跳过字体」不能靠参数，只能靠**让 `@font-face` 的 `src` 里的 `url()` 已经是 `data:` 字体**：`inliner.readUrls()` 会 `filter(!isDataUrl)` 把 data URL 全部滤掉 → `getAndEncode` 根本不会被调用。`<img>` 与内联 `background` 同理（`newImage().inline()` 第一行 `if (util.isDataUrl(element.src)) return Promise.resolve()`）。
2. `embedFonts` 无条件执行（`toSvg` 第 61 行 `.then(embedFonts)`，`toPng/toBlob/toJpeg` 经 `draw()` 走同一条链）。字体规则来源是 `document.styleSheets`：file:// 下 Chrome 把每个本地文件当独立 opaque origin，外链 `<link>` 样式表（如 `vendor/codemirror.min.css`）读 `cssRules` 抛 SecurityError —— 被 `getCssRules` 的 try/catch 吞掉并 `console.log`，**不会中断导出**，只是那条表里的 @font-face 不进 SVG。所以：**应用自己的 @font-face 要写在 index.html 的内联 `<style>` 里**（同源同文档，一定能读到），字体文件本身用 base64/data URL。
3. 万一有非 data 的 `url(...)` 漏进来：file:// 下 XHR 得到 `status===0` → 走 `fail()`，而 `fail(){ console.error(msg); resolve('') }` **resolve 空串而不是 reject** → 结果是 `data:<mime>;base64,`（空 body），图仍然生成，只是那个字体/背景图缺失。想让缺图有占位，传 `imagePlaceholder: "image/png;base64,iVBOR…"`（注意它按 `split(/,/)[1]` 取第 2 段，即不带 `data:` 前缀的写法）。
4. `cacheBust` 保持默认 `false`（true 会给 URL 追加 `?<timestamp>`，离线场景无意义）。
5. Carbon 的调用参数照抄自 tools/upstream/src_Editor.txt 的 getCarbonImage：config 对象含 style（transform / transformOrigin / background / alignItems / justifyContent）、filter（排除 className 含 eliminateOnRender 与 CodeMirror-cursors 的节点）、width、height；SVG 导出后还要做五步正则替换 —— &nbsp; 转 &#160;、%23 转 #、%0A 转换行、裸 & 转 &amp;、按当前 fontFamily 删掉其它 @font-face 块；最后 slice(uri.indexOf(逗号)+1) 取 base64 段并拼 Blob（type=image/svg+xml）。

## 5. hljs

- 核心：tools/upstream/highlight.min.js（v10.7.2 default build，内置 39 个语言：`apache ` bash ` c ` coffeescript ` cpp ` csharp ` css ` diff ` go ` http ` ini ` java ` javascript ` json ` kotlin ` less ` lua ` makefile ` xml ` markdown ` nginx ` objectivec ` perl ` php ` php-template ` plaintext ` properties ` python ` python-repl ` r ` ruby ` rust ` scss ` shell ` sql ` swift ` typescript ` vbnet ` yaml`）。
- `highlight:true` 的语言（short||mode 去重）共 57 个；核心已内置 25 个 → 需下载 32 个 → 实际拿到 32 个。
- 逐个「干净核心」隔离注册全部通过 → 证明 cdnjs 的每个语言文件把依赖在编译期内联了（不需要拓扑）。一次注册多个名字的：无。
- 名字不一致：无（本清单里 cdnjs 文件名与 short 名全部一致）。
- 被剔除的 hljs 语言及原因：无
- 合并加载后 `hljs.listLanguages()`：
```
长度 71（核心 39 + 新增 32）
apache bash c coffeescript cpp csharp css diff go http ini java javascript json kotlin less lua makefile xml markdown nginx objectivec perl php php-template plaintext properties python python-repl r ruby rust scss shell sql swift typescript vbnet yaml c-like clojure crystal d dart django dockerfile elixir elm erlang fortran fsharp gherkin groovy handlebars haskell julia latex lisp mathematica matlab nim ocaml powershell scala smalltalk stylus tcl twig verilog vhdl xquery
```
- `highlightAuto` 实测（证明自动检测通路真的通）：
| 输入 | .language | .relevance |
| --- | --- | ---: |
| javascript | `javascript` | 8 |
| python | `python` | 5 |
| mixed | `csharp` | 12 |
| cpp | `cpp` | 14 |

| hljs 名（LANGUAGES.short） | 上游文件 | 字节 | sha1(8) | 隔离注册到干净核心 |
| --- | --- | ---: | --- | --- |
| `c-like` | `c-like.min.js` | 5156 | `62278caa` | OK → [c-like] |
| `clojure` | `clojure.min.js` | 3642 | `42418e4b` | OK → [clojure] |
| `crystal` | `crystal.min.js` | 3594 | `6ba5311c` | OK → [crystal] |
| `d` | `d.min.js` | 2443 | `d232846b` | OK → [d] |
| `dart` | `dart.min.js` | 1992 | `15a24ae3` | OK → [dart] |
| `django` | `django.min.js` | 1788 | `fe584894` | OK → [django] |
| `dockerfile` | `dockerfile.min.js` | 424 | `9a194ba3` | OK → [dockerfile] |
| `elixir` | `elixir.min.js` | 2283 | `38e723d3` | OK → [elixir] |
| `elm` | `elm.min.js` | 1148 | `22b8e37e` | OK → [elm] |
| `erlang` | `erlang.min.js` | 1989 | `e7b2f64c` | OK → [erlang] |
| `fortran` | `fortran.min.js` | 4805 | `6fee3648` | OK → [fortran] |
| `fsharp` | `fsharp.min.js` | 1150 | `f85a3614` | OK → [fsharp] |
| `gherkin` | `gherkin.min.js` | 542 | `d90e71ff` | OK → [gherkin] |
| `groovy` | `groovy.min.js` | 1573 | `d7be02d0` | OK → [groovy] |
| `handlebars` | `handlebars.min.js` | 2345 | `9274fc17` | OK → [handlebars] |
| `haskell` | `haskell.min.js` | 1712 | `afdf541d` | OK → [haskell] |
| `julia` | `julia.min.js` | 4004 | `3343ab2b` | OK → [julia] |
| `latex` | `latex.min.js` | 3474 | `cbd7c8e9` | OK → [latex] |
| `lisp` | `lisp.min.js` | 1152 | `8cf9fb07` | OK → [lisp] |
| `mathematica` | `mathematica.min.js` | 112999 | `b60e089a` | OK → [mathematica] |
| `matlab` | `matlab.min.js` | 2318 | `12835309` | OK → [matlab] |
| `nim` | `nim.min.js` | 1427 | `558fd7ab` | OK → [nim] |
| `ocaml` | `ocaml.min.js` | 1256 | `2a1a052e` | OK → [ocaml] |
| `powershell` | `powershell.min.js` | 4355 | `4ca82424` | OK → [powershell] |
| `scala` | `scala.min.js` | 1567 | `9e927530` | OK → [scala] |
| `smalltalk` | `smalltalk.min.js` | 634 | `e7d27305` | OK → [smalltalk] |
| `stylus` | `stylus.min.js` | 6977 | `0a0d569c` | OK → [stylus] |
| `tcl` | `tcl.min.js` | 1797 | `06fb8c15` | OK → [tcl] |
| `twig` | `twig.min.js` | 1171 | `2789afa9` | OK → [twig] |
| `verilog` | `verilog.min.js` | 4882 | `b2341c2f` | OK → [verilog] |
| `vhdl` | `vhdl.min.js` | 1674 | `e45cbf36` | OK → [vhdl] |
| `xquery` | `xquery.min.js` | 5272 | `c0971dfa` | OK → [xquery] |

## 6. 被剔除的显示名（不静默降级）

| 显示名（LANGUAGES.name） | mode | 原因 |
| --- | --- | --- |
| GraphQL | `graphql` | codemirror-graphql@2.2.9 无 UMD/global 产物：main=index.js(CJS)+esm/index.js(ESM)，mode.js → utils/mode-factory.js → require("graphql-language-service")（本身又依赖 graphql parser 与 vscode-languageserver-types）。要当 classic script 用必须打包 graphql-js，超出 vendor 范畴。影响显示名：GraphQL（LANGUAGES 中 {name:"GraphQL",mode:"graphql"}，无 short、无 highlight → 只丢 CM 着色，不丢 hljs 自动检测）。CM5 对未知 mode 不抛错，实测 getMode({},"graphql") 返回 null mode → 该语言显示为无高亮纯文本。 |

## 7. License（逐条）

- **codemirror** — MIT (LICENSE: https://cdn.jsdelivr.net/npm/codemirror@5.65.5/LICENSE, "MIT License / Copyright (C) 2017 by Marijn Haverbeke <marijnh@gmail.com> and others")
- **hljs** — BSD-3-Clause (核心文件头注释自带 "License: BSD-3-Clause")
- **dom-to-image** — MIT (npm dom-to-image@2.6.0 LICENSE: "The MIT License (MIT) / Copyright 2015 Anatolii Saienko / Copyright 2012 Paul Bakaus")
- **carbon** — MIT (carbon-app/carbon@main LICENSE: "MIT License / Copyright (c) 2022 Carbon") —— 不是 Apache-2.0
- **codemirror-mode-elixir** — MIT (npm codemirror-mode-elixir@1.1.2 LICENSE: "MIT License / Copyright (c) 2016 Ian Walter")
- 每个第三方文件的来源 URL/版本/字节/sha1(8) 都写在了拼接处的 `/*!-- … --*/` 注释里（可直接 grep 复核），本 README 的表由同一份构建数据生成，不存在手写漂移。

## 8. 复现 / 自检

```bash
node tools/build-vendor.js            # 下载(可断点续) + 拼接 + 校验 + 生成本文件
node tools/build-vendor.js --verify-only   # 只跑校验
node tools/build-vendor.js --offline        # 只用 tools/.cache 里的缓存（CI 无网）
```

缓存在 `tools/.cache/`（`index.json` 记 url→sha1/字节/时间）。产物阈值：codemirror.min.js≥150000, codemirror.min.css≥5000, addons.js≥2000, modes.js≥60000, custom-modes.js≥20000, hljs.min.js≥100000, hljs-languages.js≥40000, dom-to-image.js≥22000。

生成时间：2026-10-16T07:58:56.478Z（node v24.21.0, win32 10.0.26300）
