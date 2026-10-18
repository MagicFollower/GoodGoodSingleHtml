# BT3D Box 零基础上手（运行与构建）

读者设定：**从没碰过这个工程的人**。每条命令都是本机实际跑过的，判据就是它当时的输出；没跑过的行显式标 `未验证`。

工程位置：`比特3维化/app/`。加解密能力不在本工程里实现，而是逐字节拷贝 `../sdk/bt3d-encode.js` 与 `../sdk/bt3d-decode.js` 到 `electron/vendor/`，构建期核对哈希（见第 7 节）。

---

## 0. 前置

| 项 | 实测值 |
| --- | --- |
| Node | v24.21.0，装在 `C:\Program Files\nodejs`（`npm -v` = 11.19.0） |
| Electron | 44.7.0，二进制 `node_modules\electron\dist\electron.exe` = 246,302,208 字节 |
| npm registry | `https://registry.npmjs.org/react/latest` → 200 |
| ReactBits registry | `https://www.reactbits.dev/r/SplitText-TS-CSS` → 200；**不带 `www` 的 `reactbits.dev/r/...` 本机返回 000** |
| ReactBits 组件目录 | `api.github.com/repos/DavidHDev/react-bits/git/trees/main?recursive=1` → 200，`truncated=false`，218 个组件 |
| 二进制镜像 | `https://npmmirror.com/mirrors/electron/` → 302（可达）。构建脚本**默认注入**镜像 |

两条必须知道的坑：

1. **`npm install` 全绿不等于 Electron 能跑**。Electron 44 的包没有 `postinstall`，下载逻辑在 `bin/install-electron`，所以 `node_modules\electron\dist\` 是空的且不报错。唯一可信的口径是判据：

   ```powershell
   Test-Path node_modules\electron\dist\electron.exe     # 必须 True
   ```

2. **GitHub 探测证不住下载**。`HEAD https://github.com/electron/electron/releases` 返回 200，而 electron-builder 去 GET release 对象可能 `connect ETIMEDOUT` —— 两个请求打的是不同主机。所以镜像按"默认注入"处理，确认官方源真能下载时才用 `-NoMirror` 退出。代价：注入镜像等于信任那个源（`@electron/get` 的 SHASUMS 校验也走它）。

仓库里不该提交的：`node_modules/`、`dist/`、`dist-electron/`、`release*/`、`*.log`、`*-out.txt`、`*-err.txt`、`nul`。`.gitignore` 已按七组写好，末尾三条反向放行不许往后挪（后匹配者赢）。

---

## 1. 项目启动（首次构建）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\electron-win-build.ps1 -Target dir
```

判据：末行出现 `==> done`，且 `release\win-unpacked\BT3D Box.exe` 存在。本次实测的收尾几行：

```
         95.7 MB  BT3D Box_portable.exe
        368.4 MB  [installed directory] win-unpacked
==> done
```

首次构建会多一步拉 Electron 二进制（`==> Electron binary missing, fetching it`），属正常。脚本自带 typecheck，任一侧类型不过就停在那里，不会把"没装二进制"说成"构建失败"。

也可以直接双击 `bin\build-setup.bat`（安装包）或 `bin\build-portable.bat`（便携版）。bat 的提示文字是英文，这是硬要求不是省事 —— 见第 8 节。

---

## 2. 本地调试

```powershell
npm run dev
```

判据（本机实测输出）：

```
Vite dev server: http://localhost:5173/
window-shown title=BT3D Box dark=true
```

第一行说明 Vite 起来了，第二行是**主进程**打的 —— 只有渲染层从 `http://localhost:5173/` 真加载成功才会出现。改渲染层代码可热重载。

停掉：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\stop-dev.ps1
```

实测：

```
killing pid=3088 electron.exe
killing pid=20344 electron.exe
killing pid=22632 electron.exe
killing pid=28552 electron.exe
killed=4 remaining=0
```

`stop-dev.ps1` 只按"可执行文件路径是否落在本工程目录下"筛进程，绝不 `taskkill /IM electron.exe`（那会连坐别的 Electron 应用和编辑器）。杀掉主进程后 `bin/dev.mjs` 的子进程退出回调自己关 Vite，实测端口 5173 随之释放。

或直接双击 `bin\start.bat` / `bin\stop.bat`。

---

## 3. 打包与启动

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\electron-win-build.ps1 -Target all
```

三口径的语义与代价：

| 口径 | 形态 | 本机实测启动（到 `window-shown`） |
| --- | --- | --- |
| `dir` | `release\win-unpacked\` | **1301 ms**（到自证收尾 3430 ms） |
| `portable` | 单 exe，拷了就跑 | **6308 ms**（到自证收尾 8361 ms）≈ dir 的 4.85× |
| `nsis` | 安装包 | 装后目录 ≈ `dir` 口径 |

便携版每次启动要把整个应用解到 temp，所以慢；而且**它的 stdout 不冒泡**（宿主只负责解壳再拉子进程），所以自证只能靠标记文件。实测用的就是主进程在 `--selftest` 下写的 `%TEMP%\bt3d-box-selftest-log.txt`：

```
portable：到 window-shown = 6308 ms
portable：从启动到 SELFTEST done = 8361 ms
```

起安装后目录自证：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\smoke.ps1
```

实测末三行：

```
exitcode=0 ok-checks=24 failed=0 processes-before=0 after=0
markers: window-shown=1 done-line=1
==> smoke pass
```

`smoke.ps1` 断言四件事：`window-shown` 标记在（渲染层从 `file://` 真加载了）、`SELFTEST done` 标记在（自证跑完了）、失败断言数为 0、跑完之后本工程残留进程数为 0。

**一个会骗人的坑**：只跑 `dir` 之后 `release\` 里可能还坐着上一轮的 portable/setup exe —— electron-builder 只覆盖本次 target，不清空 output 目录。验收前先删空 `release\`（上面的 `-Target dir` 那次就仍列出了上一轮的 95.7 MB 便携版）。

---

## 4. 修改标题

真源只有一处，`electron/main.ts` 里的 `APP_TITLE`：

```ts
win = new BrowserWindow({ title: APP_TITLE, ... });
win.on('page-title-updated', (e) => e.preventDefault());
```

没有 `preventDefault` 那一行，`index.html` 的 `<title>` 或渲染层的 `document.title` 会盖掉主进程设定。

判据：`smoke.ps1` 输出里的 `window-shown title=<新标题>`。

---

## 5. 修改图标

本地生成，不联网、不依赖 ImageMagick/Python：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\make-icon.ps1 -Letter B
```

实测输出（像素 monogram 的判据就是这几行 `cell=Npx`）：

```
auto-fg = #ffffff (bg luminance 0.417)
mask 'B' = 42 / 121 inked cells
  layer  16px  cell=1px   glyph=11x11   BMP
  layer  24px  cell=2px   glyph=22x22   BMP
  layer  32px  cell=2px   glyph=22x22   BMP
  layer  48px  cell=4px   glyph=44x44   BMP
  layer  64px  cell=5px   glyph=55x55   BMP
  layer 128px  cell=11px  glyph=121x121 BMP
  layer 256px  cell=23px  glyph=253x253 PNG
icon-loaded size=32x32
==> wrote ...\app\electron\icon.ico (104364 bytes, 7 layers)
```

规则只写在一处：字母先被栅格化成 11×11 的墨点掩码，每一层都按 `cell = floor(Size/11)` 画实心方块，所以七层全是硬边、无重采样无抗锯齿 —— 这正是像素风。`-Letter` 表外字符（非 A–Z / 0–9）直接报错退出，不画空方块；字母色省略时按背景相对亮度自动选 `#fff`/`#111`。

`electron-builder.yml` 的 `win.icon` 必须指到这个文件。写错的后果是**告警不是失败**：builder 只打一行 `default Electron icon is used` 然后继续打包。

判据不靠肉眼，而是把 exe 里嵌的图标取回来逐像素比：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\verify-icon.ps1
```

实测：

```
source-ico-frame=32x32  extracted=32x32
pixel-match=100% (1024/1024)
==> icon verified
```

---

## 6. 发布 / 分发

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\publish.ps1                 # 只跑版本守门
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\publish.ps1 -Share <共享目录> -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File bin\publish.ps1 -Share <共享目录> -KeepVersions 2
```

守门判据（实测）：

```
==> gate: package.json version = 1.0.0
    ok  BT3D Box_portable.exe  FileVersion=1.0.0  100,369,857 bytes
    ok  BT3D Box_setup.exe     FileVersion=1.0.0  100,578,326 bytes
```

`FileVersion` 与 `package.json` 的 `version` 不一致就直接失败 —— 这条抓的是"版本号已 bump 但 `release/` 里仍是旧构建"。发布流程固定四步：改 version → 重新打包 → publish → 按 `-KeepVersions` 淘汰旧版。产物落 `<Share>\<productName>\<version>\`，每个 exe 旁边一份 `.sha256`。

---

## 7. 加解密链路与 Electron 的 ChaCha20 缺口（本工程最大的一条）

**现象**：`sdk/` 的实现直接用系统 Node 跑，15 条判据全绿；放进 Electron 主进程第一次编码就抛

```
Error: Unknown cipher
    at Cipheriv.createCipherBase (node:internal/crypto/cipher:121:19)
    at applyKeystream (...dist-electron\bt3d-encode.js:200:25)
```

**取证**（`node bin/crypto-probe.cjs` 与 `node_modules/electron/dist/electron.exe bin/crypto-probe.cjs` 同一段代码两个运行时）：

| 运行时 | openssl | `getCiphers()` 里有 chacha20 | `createCipheriv('chacha20')` |
| --- | --- | --- | --- |
| 系统 Node v24.21.0 | 3.5.8 | true | 可用，首 16 字节 `18b84231ade6a6d113615c61af434e27` |
| Electron 44.7.0 | `0.0.0`（BoringSSL） | **false** | **抛 `ERR_CRYPTO_UNKNOWN_CIPHER`** |

同一条探针里 `aes-256-ctr` 两侧都可用，`chacha20-poly1305`（AEAD）在 Electron 侧同样不可用。

**处置**：`sdk/` 那两份文件必须与仓库逐字节相同（自证里有哈希断言），所以补差不在它们身上做，而是在宿主加一层纯 JS ChaCha20 垫片 `electron/chacha20-shim.ts`，**只在运行时拿不到 chacha20 时才接管 `'chacha20'` 这一个算法名**，其余算法原样转给 OpenSSL。IV 口径与 `node/src/keystream.js` 一致：16 字节 = 块计数器 u32 LE(4B) ‖ nonce(12B)。

**证明它没算错**（两道，都要跑）：

```powershell
node bin/verify-shim.mjs
```

实测：

```
样本 300000 字节（末层 37856 B）
系统 Node（原生 chacha20）:      shim=not-needed  sha256=fbd5b20206e48113…  roundtrip=true
Electron（BoringSSL + 纯 JS 垫片）: shim=installed   sha256=fbd5b20206e48113…  roundtrip=true
容器逐字节相同 = true（300128 vs 300128 字节）

样本 1000003 字节（末层 82499 B）
容器逐字节相同 = true（1000131 vs 1000131 字节）
```

第二个样本是刻意挑的：末层 82,499 字节不是 4 的倍数。第一版垫片按 `byteLen/4` 分配字数组并在零头处用 `DataView.setUint32`，就是在这条上抛 `RangeError: offset is out of bounds` 被抓住的 —— 所以这条不是装饰。

外加两个外部锚点（在 `--selftest` 里断言）：

```
SELF ok 垫片锚点 RFC8439-2.4.2 ｜ 6e2e359a2568f98041ba0728dd0d6981
SELF ok 垫片锚点 交叉样本 ｜ 18b84231ade6a6d113615c61af434e27 ｜ 垫片状态 运行时缺 chacha20（BoringSSL），已装纯 JS 垫片
```

第一条是 RFC 8439 §2.4.2 的密文首 16 字节，与 `格式规格.md` §16.2 判据 14 记的是同一个值。

**代价**：纯 JS 的密钥流比 OpenSSL 慢。38 MB 实测（`--expose-gc`）：

| 路径 | 系统 Node（原生） | Electron（垫片） |
| --- | --- | --- |
| 38 MB 流式编码 | 91 ms | 见 `--selftest` 之外的手工计时，未单独取样 |
| 单层 128 KiB 散射+密钥流 | 0.09 ms（仅密钥流） | 4.24–5.07 ms（含散射） |

上表第二列的"38 MB 流式编码 91 ms"是**系统 Node** 的基线数字（来自 `几何散射与纯ChaCha20对比.md` 那轮实测）；Electron 侧的 38 MB 计时本轮没单独取，标 `未验证`，别拿 91 ms 当 Electron 的期望值。

---

## 8. 双击脚本（bat）的四条硬规矩

`bin\` 下四个 bat 是给不打开终端的人的薄封装：`start.bat`、`stop.bat`、`build-setup.bat`、`build-portable.bat`。它们遵守四条实测规矩：

| 规矩 | 违反时的症状（没有语法错误） |
| --- | --- |
| 整个文件零非 ASCII 字节，注释也算；工程根一律 `%~dp0..` | 默认代码页非 65001 时 `chcp` 属中途换页，cmd 按字符数重定位后续行 → 注释残片被当命令执行，且非确定（同一文件跑 3 次只有 1 次坏） |
| `echo` 文本里不许有裸 `>`（`==>`、`-->` 都算） | cmd 在 `>` 处切行，把后面的 token 当文件名写出去：实测把 957 字节的 `.ps1` 截成 4 字节，并在工程根造出 21 字节的 `running` 文件；那一行本身什么都不打印 |
| `(` 块内不 `goto`，块内 `echo` 不带 `)` | 右括号提前闭合块，if/else 两个分支全打，文本被截断 |
| bat 里调 npm 必须用绝对路径（`where npm.cmd` 取） | 裸名调用时 npm.cmd 的 `%~dp0` 展开成**调用方 cwd**，去工程目录找 `node_modules\npm\bin\npm-prefix.js` 报 MODULE_NOT_FOUND；同一条命令在顶层 `cmd /c` 里却是好的 |

静态自查四条（本轮四个文件都过）：非 ASCII 字节 = 0、`CR==LF`、括号配平、`echo` 载荷里没有裸 `>`、块内没有 `goto`。

---

## 9. ReactBits 组件的取用与否决

组件走 registry JSON 取，**不用 `npx shadcn add`**（它要 `components.json` 且默认按 Tailwind 配置，纯 CSS 工程会被迫装 Tailwind）。取件器 `bin/fetch-reactbits.mjs` 的源顺序是 `raw.githubusercontent.com` → `jsDelivr` → 官方站，实测官方站单请求 17~25 s 且 3 次里 2 次超时，raw 只要 0.5~1.4 s。

```powershell
npm run rb:fetch          # 只报每个候选件的真实依赖（看 import 行，不看 registry 的 dependencies 字段）
node bin/fetch-reactbits.mjs --write DarkVeil LineSidebar ...
node bin/fetch-reactbits.mjs --check
```

实测 `rb:check`：`29 件 / 55 文件，改动或缺失 0 处`。

**为什么必须看 import 行**：registry 的 `dependencies` 是候选集。本轮实测两处对不上 —— `JellyRadio` 声明 `motion@^12.23.12` 但源码 import 里没有它（零依赖件）；`ScrubField` 声明 `motion` 而真实 import 只有 `react`。反过来 `SplitText` 声明里有 `@gsap/react`，源码确实 import 了。

**装了四个包**（全部只在 `devDependencies`，由 Vite 打进 `dist/`，运行时零依赖不变）：`gsap 3.15.0`、`@gsap/react 2.1.2`、`motion 14.3.0`、`@hugeicons/react 1.1.10` + `@hugeicons/core-free-icons 4.3.5`。注意最后一个解包 78,540 KiB（磁盘），但被 Vite tree-shake，产物只多出用到的图标。

### 9.1 挂载清单（24 件）

| 界面位 | 件 | 接入要点（实测） |
| --- | --- | --- |
| 背景 | DarkVeil | `paused` 由宿主按 `prefers-reduced-motion` 兜（件不读） |
| 导航 | LineSidebar | **`fontSize` 单位是 rem**（件里 `'--font-size': \`${fontSize}rem\``），传 `15` 会渲染成 15rem 巨字并撑出横滚条；本轮传 `0.95` |
| 大标题 | SplitText | 换文本要重播必须给 `key`（件内有 `animationCompletedRef` 闸门） |
| 面板 | SpotlightCard / 自绘 `.panel` | 见 9.2 的 GlassSurface |
| 拖放框 | BorderGlow | 自带 1px 边框，`box-sizing:border-box` 下吃内容宽 2px → 宿主用 `.border-glow-host{box-sizing:content-box}` |
| 文件图标 | GlassIcons | `items[].icon` 收 ReactNode，本轮塞扩展名字符串 |
| 模式/主题切换 | JellyRadio | 零依赖（registry 声明的 motion 实际没 import） |
| 布尔开关 | SquishSwitch | 颜色只能走 props（内联 `--ss-*` 类 CSS 盖不住） |
| 枚举下拉 | GlideSelect | 需要 `@hugeicons` |
| 路径输入 | CurvedInput | `theme` 只认 `'dark'/'light'` |
| 主 CTA | HoldButton + StarBorder | 按住 520 ms 才触发 `onHold`；标签在 DOM 里渲染三遍，取文本只能取 `.hold-button__idle`；本轮按用户要求放大到 `size="lg"`（件里三挡 36/44/52 高的最大那挡，`--probe` 实测盒 `176x52`、`fs=17px`），宽度由宿主 `.cta-frame .hold-button{min-width:176px}` 钉住，让三挡标签（按住执行混淆/还原/队列）同宽 |
| 次级按钮 | SpecularButton | 支持 `onClick` + rest 透传 |
| 进度 | CometDial | `disabled` 当纯展示用；`min/max` 默认 0/100 |
| 数字 | Counter | 用它而不是 CountUp：CountUp 的弹簧尾部渐近，展示型数值会停在 9112/9178 这种读数 |
| 状态 | StatusMark | 五态 `pending/running/done/failed/cancelled` |
| 忙时无 | LatticeLoader | `pattern` 十种具名，`showTimer` 配 `elapsed` |
| 任务队列 | AnimatedList | 件里 `width` 默认 500px → 传 `width="100%"`；`selectOnHover` 默认 true（悬停即选中）→ 传 `false` |
| 视图切换 | FadeContent | ScrollTrigger 件，当"挂载即播"用要 `trigger="mount"` + `threshold={0}`；它渲染的那个包装 div 是**块盒**，卡片间距要靠宿主给它 `className="view-stack"`（见 11.2） |
| 提示 | WarmTooltip | `children` 必须是 ReactElement；`content` 才是气泡正文 |
| 状态行 | DecryptedText | 换文本靠 `key` 重挂载才重播 |
| 徽标 | ShinyText | 传 `text` 或 children 都行 |
| 强调字 | GradientText | 只用于大字号；小标题上用会显出重影（见 9.3） |

**两件已退挂**（2026-10-18 22:1x / 22:3x，都是按用户要求摘的）：**Shredder** 随「历史」面板一起摘掉（它是第 26 件）；**GradualBlur** 随「容器检查」末尾那条渐隐带一起摘掉（见 11.2，它把那张卡的底部文字糊掉了）。两份 `src/reactbits/*.tsx|css` 仍在原地、`lock.json` 哈希核对不受影响，只是没人 import；宿主侧的 `.shred-host` 规则一并删掉。副作用要说清：**已完成/已失败的任务行从此没有移除入口**（「清空待执行」按名字只清 `queued`），要清干净只能重开应用。

### 9.2 明确否决的件（带实测理由）

| 件 | 否决理由（实测） |
| --- | --- |
| **FlyingButton** | 根盒实测 `div.flying-button [90,744 1408×240]` —— 在 1440×880 窗口里横穿整个底栏并压在 `footer.statusbar` 之上，`elementsFromPoint` 第一命中就是它，即它会**吞掉那一条区域的点击**。截图上表现为右下角一条黑弧。改件假定自己在确定尺寸的容器里，本工程的底栏不是。换 SpecularButton |
| **GlassSurface** | 作为面板容器时实测渲染成不透明灰块盖住内容（`--fallback`/`--webgl` 三条渲染分支都试过，`refraction={false}` 仍不行）。它的折射需要 backdrop（图/视频/画布）才有意义。面板改用 SpotlightCard + 自绘 `.panel` |
| **TiltedCard** | `TiltedCardProps` 是图片卡（`imageSrc/captionText/containerHeight…`），不接受任意 `children` 当内容位 |
| **SloshGauge** | 值域未验证（`clamp(v, a, b)` 的 a/b 没读清），拿它显示百分比有风险，改用 CometDial |
| PillNav 类 | 声明 `react-router-dom`，本工程无路由 |
| PaperCrumple | 真实 import `three`，为一个删除动画背 600 kB 不值，当时改用 Shredder（Shredder 后来随「历史」面板一起退挂，见 9.1） |

### 9.3 三条通用适配纪律

1. **不改 vendored 源码**。所有尺寸/颜色适配写在 `src/styles/adapt.css`，件的颜色 props 一律传解析后的真色 —— 件里那批 `parse()` 只认 `#hex`/`rgb()`，传 `'var(--x)'` 会静默变白。`src/lib/theme.ts` 的 `useTokens()` 就是干这个的（含 `rgb()` → `hex` 归一，半透明令牌直接判不可用作纯色）。
2. **件不读 `prefers-reduced-motion`**（GooeyNav 那一类例外，本工程没挂它）→ 宿主读一次 `matchMedia` 导出常量，在 `Veil`/`BorderGlow`/CSS 三处兜。
3. **wrapper 类件会改几何**：多包一层 div 就可能把子级的 `height:100%` 链断掉。本轮实测的三处：`.border-glow-host` 补 `box-sizing`、`.cta-frame > div` 补 `display:block; width:100%`、`.fit-inner > *` 补 `height:100%`。

---

## 10. 交付前精简

删掉中间物：`dist/`、`dist-electron/`，以及自证产生的 `*-out.txt`、`*-err.txt`、`*.log`。

两条判据都实测过：

1. **已打好的包不依赖中间目录** —— 删掉 `dist/` 与 `dist-electron/` 之后 `bin\smoke.ps1` 仍 `==> smoke pass`（`exitcode=0 ok-checks=24 failed=0 processes-before=0 after=0`），因为两者已拷进 `resources/app.asar`。
2. **删完能一把重建** —— `bin\electron-win-build.ps1 -Target dir -SkipInstall` 从最小清单重新产出全部产物并 `==> done`（typecheck 也在脚本里，0 错）。

`app.asar` 顶层族核对（`node -e` 用 `@electron/asar.listPackage`）：

```
条目数 13  顶层族 \dist, \dist-electron, \package.json
```

正好三族，没有多余的 `node_modules` —— 因为 `dependencies` 是空的，React/gsap/motion 全在 `devDependencies`，由 Vite 打进 `dist/`。

产物实测（2026-10-18 22:2x 那一轮，含第 11 节三处改动 + 摘掉「历史」面板 + CTA 放大）：`BT3D Box_setup.exe` 100,573,962 字节、`BT3D Box_portable.exe` 100,365,513 字节、`win-unpacked\` 368.5 MB。两个可对账的差值：深色异常那一轮是 100,581,552 / 100,373,090（比更早的基线 100,578,326 / 100,369,857 各 +3.2 KB，来自主进程多出的 103 行 `--probe` 与三条闸门）；本轮再各 −7.6 KB，因为 Shredder 的 tsx+css 不再被 bundle 收进去（件文件本身还在 `src/reactbits/` 里）。

**22:3x~22:4x 这一轮（卡片间距 + 摘 GradualBlur + 第 24 条闸门）的两个 exe 目前不在 `release/` 里**，别把上一段那对数字当它。现场状态：`win-unpacked\` 是 22:42:21 的新产物（`--selftest` 24/24、`bin\smoke.ps1` `==> smoke pass`，即 dir 口径已含本轮改动），旁边躺着一个没人收走的 `bt3d-box-1.0.0-x64.nsis.7z`（77,660,884 字节，22:43:31）—— nsis 目标在"打完 7z、还没包成 setup exe"那一步停了。补两条踩过的坑：同一轮我自己跑的两趟 `-Target all` / `-Target dir` 都死在 `EBUSY: resource busy or locked, unlink ...\app.asar` 与 `...\win-unpacked.tmp\resources\default_app.asar`，句柄不在本工程任何进程上（`tasklist` 里既无 BT3D 也无 node/7z/nsis），是系统侧扫描器临时占着；**处置只到"等 + 把 `.tmp` 树删掉重试"，没有去动任何非本工程的进程**。

### `.gitignore` 的双向核对

在 `%TEMP%` 里建同形空树（`git init -q .` + 拷进这份 `.gitignore` + 两份清单），逐条跑 `git check-ignore -q --no-index`：退出码 0 = 被忽略。

```
必须跟踪 45 条 → 误判 0；必须忽略 38 条 → 误判 0
```

「必须跟踪」那份清单就是首次提交该有的一切（45 条里含 `src/reactbits/*.tsx|css` 与 `lock.json` —— vendored 件是交付物不是中间物，`electron/vendor/bt3d-encode.js` 同理）。

核对过程中真实改掉的两条缺口：`*.log` 盖不住 `npm-debug.log.12345`（补 `npm-debug.log*`），`*-out.txt`/`*-err.txt` 盖不住会话里产生的 `package-out2.txt`/`package-err2.txt`（放宽成 `*-out*.txt`/`*-err*.txt`）。

判据口径提醒：不带 `-q` 时 `check-ignore` 对反向放行也打印匹配行并返回 0，「有条规则匹配上」不等于「被忽略」；`-v` 只用来看是哪条规则赢了：

```
.gitignore:44:!src/reactbits/**      src/reactbits/DarkVeil.tsx
.gitignore:45:!electron/icon.ico     electron/icon.ico
.gitignore:46:!doc/**                doc/运行与构建（T0Level）.md
```

`.gitignore` 只对未跟踪文件生效；`git init` 之后已经 `git add` 过的，要 `git rm --cached` 才退出索引。

---

## 11. 界面自证通道：`--selftest` / `--shoot` / `--probe`

三个模式都走 `EPHEMERAL` 闸门：不落 `settings.json`、不记忆窗口几何、不读回旧几何 —— 跑完用户状态一字不改。

| 模式 | 干什么 | 产物 |
| --- | --- | --- |
| `--selftest` | 24 条断言，末行 `SELFTEST done checks=24 fail=0` | stdout；portable 口径另落 `%TEMP%\bt3d-box-selftest-log.txt` |
| `--shoot <dir>` | 1440×880 五挡 × 深/浅各一张，再补一张 1264×755 两列深色，每张打 `data-theme=` | `<dir>\{dark,light}-*.png` 共 11 张 |
| `--probe` | 在 1264×755（出问题的这台机器的客户区尺寸）逐步骤打 DOM 盒、计算样式与**逐像素读数** | stdout + `%TEMP%\bt3d-shots\probe-*.png` |

```powershell
.\node_modules\electron\dist\electron.exe . --probe
```

`--shoot` 有一处必须记住的口径：渲染层的 `data-theme` 只跟它自己 state 里的挡位走，`'dark'`/`'light'` 是钉死的，只有 `'system'` 才读 `matchMedia`。所以拍照前主进程先把名义挡位改成 `system` 再 `reload()`，否则翻 `themeSource` 对页面无效，`light-*.png` 与 `dark-*.png` 会拍成同一套（这个坑是本轮改 `--probe` 时才发现的，之前的 `dark-two-col.png` 实际是浅色）。每张图打的 `data-theme=` 就是这条的自检。

### 11.1 一次「深色界面显示异常」的完整归因

用户 2026-10-18 20:21 的截图（客户区 1264×755，主题挡位 dark，队列空）三条现象，逐条对上读数：

| 现象 | 截图里的像素 | 对上的事实 |
| --- | --- | --- |
| 整窗蒙一层中性灰 | 面板 `#94979D`、空隙 `#919396` | 与 `0.55×#fff + 0.45×各自底色` 逐通道差 ≤1 —— 即 `--veil: .55` 那一层背景交付出了**实心白** |
| 中间整列控件不见了 | 面板区空白 | `--probe`：`main=[244,76 1006x0] scrollH=449`，两列挡位下右列内容 701px 比可用高度 617px 高，`minmax(0,1fr)` 被挤成 0（那 701px 里有 220px 属于「历史」面板；22:1x 摘掉它之后同一挡位实测 `side scrollH=481`，仍 > 行高 309 ⇒ 这条结论与修法都不受影响） |
| 白色方块 + 左上角一个 ⊠ | 方块 270×84 | 尺寸正是那两颗按钮自己的画布盒：`specular-button__light [237,311 145x82]`、`[344,311 159x82]` |

三处改动：

1. **`src/styles/adapt.css`：`.bg-veil` 的 `z-index` 由 `0` 改 `-1`。** 层序是这次故障的放大器：`.app` 是 `position:relative; z-index:1` 的层叠上下文，面板/顶栏/状态栏全是普通静态块盒（`--probe` 的 `stack=` 行实测 `panel:static/auto`），而按 CSS 绘制顺序「定位且 `z-index:0`」排在所有静态块盒**之后** —— 背景层平时看不出问题（噪声场本身很暗，只在栏间空隙露头），一旦这块全屏画布变白，整窗就被 55% 白洗掉。
2. **`src/styles/app.css`：两列/一列挡位的行高不再用会被挤干的 `1fr`**，改成 `minmax(0,1fr) minmax(0,1fr)`（一列挡 `auto minmax(0,1fr) minmax(0,1fr)`）→ 修复后 `main=[244,76 1006x309]`，且切一次挡之后 `child op=1`（旧状态下盒高 0 让 `FadeContent` 的 IntersectionObserver 永不 intersects，停在 `opacity:0`，等于二次隐藏）。
3. **`src/components/rb.tsx`：背景层画布降档** `dpr 1.25→1`、`quality 0.5→0.4` → 画布从 1580×944 降到 1264×755（−39% 像素），噪声场从 632×377 降到 506×302。这块全屏画布是整窗最大的一块 GPU 面，先出故障的就是它。

`--probe` 的五步是同一条链上的对照，判据读数由打包体跑出（`release\win-unpacked\BT3D Box.exe --probe`，像素取 `img.toBitmap()`，字节序 BGRA）：

| 步骤 | 空隙 (232,400) | 面板 (700,130) | 说明 |
| --- | --- | --- | --- |
| A-boot | `#192639` | `#141A27` | 干净态：噪声场只在空隙里露头 |
| B-nav-decode | `#172133` | `#141A27` | 切一次挡，主列仍有高度 |
| C-context-lost | `#0B0F17` | `#141A27` | 弄丢 7 个 WebGL 上下文 —— **画布变透明，不是变白** |
| D-veil-white | `#919396` | `#141A27` | 背景层涂实心白，层序已修 → 只亮空隙 |
| E-veil-white-z0 | `#919396` | `#95989E` | 同一份白，挪回修复前的 `z-index:0` → 面板被洗成用户截图那个值 |

D 与 E 是这次修复的正反两半：同一份"背景层出白"的最坏情况，改层序之前洗掉整窗、之后只亮栏间空隙。E 行的 `#95989E` 与用户截图的 `#94979D` 差 1~2（截图经 PixPin 落盘，非同一采样路径）。

新增三条回归闸门（`--selftest` 第 21~23 条，实测输出）：

```
SELF ok 背景层在内容之下（z-index 为负） ｜ z-index=-1
SELF ok 两列挡位主列不被压成 0 高 ｜ main 高=309 内容=488（旧缺陷读数 0 / 449）
SELF ok 切挡后入场动画落到可见 ｜ opacity=1
```

**没查清的那一半：白是从哪来的。** 已排除"上下文丢失"（C 行是透明）。剩下的候选都指向画布资源/GPU 内存吃紧，最具体的一条是 `DarkVeil` 的 `toLinear()`：它在 effect 里一次性建了个 1×1 的 2D 探针画布，`let rgb = [1,1,1]` 只在 `probe` 非空时才覆盖 —— 探针拿不到上下文时，**任何 accent 色都会被当成纯白送进着色器**，出图正好是中性白噪声；而同一时刻按钮自己的 WebGL 画布也坏了，才需要解释白方块与 ⊠。这条本轮没复现出来（用户那次是连续开着近一小时之后），所以只进未验证项，不当结论用。

### 11.2 中间区域的卡片节奏，与「容器检查」下方那条渐隐带（22:3x 一轮）

`--probe` 新增的 `PROBE-CARDS` 行是这一轮的量尺：五挡逐个切过去，逐张打 `.main .panel` 的盒与"与上一张的上下间隔"。**修复前四挡多卡的读数全是 `上间隔=0`** —— 卡片直接挨着，看着像有缝只是圆角加阴影。成因：`.main` 虽然是 `display:flex; gap:14px`，但它只有**一个**子元素（FadeContent 的包装 div），卡片在那个 div 里面，而它原本是块盒，块盒没有 gap 可言。

做法：宿主给 `Fade` 传 `className="view-stack"`（件把 `className` 原样落在包装 div 上，实测 `display` 由 `block` 变 `flex`），`app.css` 里给 `.view-stack{display:flex;flex-direction:column;gap:18px;min-width:0}`。修复后：

```
PROBE-CARDS view=0 main高/内容/包装display=309|475|flex → 0:[244,76 996x316] 首张 | 1:[244,410 996x141] 上间隔=18
view=1 上间隔=18 ｜ view=2 上间隔=18 ｜ view=3 上间隔=18 ｜ view=4 单张（关于只有一张卡，无比值）
```

新增第 24 条闸门（五挡取最小间隔，旧状态 0 会被它咬住）：

```
SELF ok 中间区域卡片上下间隔 ≥16px（五挡取最小） ｜ 实测最小 18px ｜ 旧状态 0px
```

**「容器检查」中间区域下方那张"多余的、显示效果异常的卡片"就是 `GradualBlur`。** 它挂在 `InspectView` 返回片段的最后，外面套 `<div style={{position:'relative', height:0}}>`，件参数 `height="90px"` + `tint=c.surface` + `opacity=1` ⇒ 父盒高度 0，那条 90px 的模糊+着色带整个画在卡片**外面**的空白区（截图里是左下一块边界发直的亮斑），顺带把上面「尚未解析」那张卡的底部文字糊掉。摘掉调用点与 `TopFade` 适配器，`GradualBlur` 随之退挂（9.1 因此是 24 件）。这一条没立闸门：它判的是"那块东西不该存在"，`--probe` 的 `view=2` 读数（2 张卡、上间隔=18）加上 22:3x 的 `dark-inspect.png` 亮斑消失就是它的验收。

---

## 12. 未验证项

| 项 | 原因 |
| --- | --- |
| Electron 侧 38 MB 大文件的端到端耗时 | 本轮只在系统 Node 上量过 38 MB（91/98 ms 基线）。垫片下的整文件计时没取，别拿基线数字当期望值 |
| 大端机器、>256 GiB 输入 | 与 `格式规格.md` §16.11 同样未验证 |
| NSIS 安装后的实际安装流程 | 只验了安装包产出与 `FileVersion` 守门，没在这台机器上安装运行 |
| 代码签名 | 未签名（builder 只是走了一遍 signtool 的默认分支） |
| Windows 11 之外的宿主 | 本机 `win32 10.0.26300 x64` |
| 真鼠标拖放与按住手势 | `--shoot` 走的是程序化 `click()`；HoldButton 的三条时间分支（<250 ms 轻点 / 中途松手 / 走满 `holdTime`）里只验了逻辑，没做物理指针级取证 |
| 背景层交付实心白的触发条件 | 只证明了层序放大器与修复后的 containment（§11.1 的 D/E 两行）。白的来源没复现：已排除上下文丢失，最具体的候选是 `toLinear()` 那个一次性 2D 探针画布拿不到上下文（`rgb` 留在 `[1,1,1]`），但这条要靠把画布资源逼爆才能证，本轮没做 |
| 长时间运行后的画布/GPU 占用曲线 | 用户那次是连续开着近一小时之后出现的。本轮跑过的是两趟分开的短程压力：一趟 30 次切挡（`--probe` 旧版 E 步，收尾读数里活着的 WebGL 画布仍全 `ok`、无 `LOST`，但那一版把画布清单截在 8 条，所以"数量不涨"这句没被证到），一趟把 7 个 WebGL 上下文一次弄丢（C 步）。没有"挂着两小时看内存曲线"这一挡 |
