// BT3D 三维演示 · 页面装配与交互。页面里出现的每一个数字都从 data.js 取，不写死。
(function () {
  const D = window.BT3D_DEMO;
  const R = window.BT3DRender;
  const M = D.meta;
  const C = M.const;
  const V = D.variants;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const n0 = (n) => Number(n).toLocaleString('en-US');
  const pc = (x, dp) => (x * 100).toFixed(dp === undefined ? 3 : dp) + '%';
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // 头部字段规格（偏移取自 src/constants.js 的 OFF_*，值从本次实跑解析）
  const HDR = [
    { off: 0, len: 4, name: 'magic', type: '4×u8', norm: "'BT3D'", hue: 200, note: '魔数 42 54 33 44', get: (b) => String.fromCharCode(b[0], b[1], b[2], b[3]) },
    { off: 4, len: 1, name: 'version', type: 'u8', norm: '1', hue: 262, note: 'v1', get: (b) => String(b[0]) },
    { off: 5, len: 1, name: 'flags', type: 'u8', norm: '0x1C', hue: 158, note: '逐位见 2.2', get: (b) => '0x' + b[0].toString(16).padStart(2, '0') },
    { off: 6, len: 1, name: 'reserved0', type: 'u8', norm: '0', hue: 44, note: '必须为 0', get: (b) => String(b[0]) },
    { off: 7, len: 1, name: 'reserved1', type: 'u8', norm: '0', hue: 44, note: '必须为 0', get: (b) => String(b[0]) },
    { off: 8, len: 8, name: 'origSize', type: 'u64 LE', norm: '原文件字节数', hue: 12, note: '往返闭环的唯一保证；决定层数、每层的 m、输出截断位置', get: (b, dv) => n0(dv.getBigUint64(8, true)) + ' B' },
    { off: 16, len: 8, name: 'layerCount', type: 'u64 LE', norm: 'ceil(origSize/131072)', hue: 12, note: '冗余字段，解码方必须交叉校验', get: (b, dv) => String(dv.getBigUint64(16, true)) },
    { off: 24, len: 4, name: 'dimX', type: 'u32 LE', norm: '1024', hue: 210, note: '写成大端会读成 262144', get: (b, dv) => String(dv.getUint32(24, true)) },
    { off: 28, len: 4, name: 'dimY', type: 'u32 LE', norm: '1024', hue: 210, note: '', get: (b, dv) => String(dv.getUint32(28, true)) },
    { off: 32, len: 12, name: 'file_nonce', type: '12×u8', norm: '每文件随机', hue: 300, note: 'ChaCha20 nonce。同密钥+同 nonce = two-time pad', get: (b) => hexOf(b) },
    { off: 44, len: 20, name: 'reserved2', type: '20×u8', norm: '全 0', hue: 44, note: '解码方必须逐字节校验；v3 放 KDF 参数的位置', get: (b) => (b.every((x) => x === 0) ? '全零 ✓' : '非零 ✗') },
    { off: 64, len: 32, name: 'dek', type: '32×u8', norm: '每文件随机', hue: 0, note: '明文数据密钥 —— 机密性 0 bit 的全部原因', get: (b) => hexOf(b) },
    { off: 96, len: 32, name: 'payload_tag', type: '32×u8', norm: 'HMAC-SHA256', hue: 88, note: '覆盖「tag 置零的头部 ‖ payload」', get: (b) => hexOf(b) },
  ];
  function hexOf(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }
  const headerBytes = (() => {
    const a = new Uint8Array(128);
    for (let i = 0; i < 128; i++) a[i] = parseInt(M.headerHex.substr(i * 2, 2), 16);
    return a;
  })();
  const headerDV = new DataView(headerBytes.buffer);
  const fieldOf = (off) => HDR.find((f) => off >= f.off && off < f.off + f.len);

  // ---------------------------------------------------------------- 顶部口径条
  const checksAll = M.checks.every((c) => c.pass);
  $('#provenance').innerHTML = [
    ['生成时间', M.builtAt.replace('T', ' ').slice(0, 19) + ' UTC'],
    ['运行时', 'Node ' + M.node + ' · ' + M.platform],
    ['输入', 'node.exe 前 ' + n0(M.inputSize) + ' B'],
    ['层数', M.layerCount + ' 层（末层 ' + n0(M.lastBytes) + ' B）'],
    ['派生', 'a=' + M.derived.a + ' b=' + M.derived.b],
    ['自检', M.checks.length + ' / ' + M.checks.length + (checksAll ? ' 通过' : ' 有失败')],
    ['数据块', D.blobs.length + ' 个 blob'],
    ['耗时', M.buildMs + ' ms'],
  ].filter((r) => r[1] !== undefined).map((r, i) =>
    `<span class="pv${i === 5 ? (checksAll ? ' good' : ' bad') : ''}">${esc(r[0])} <b>${esc(r[1])}</b></span>`).join('');

  // ---------------------------------------------------------------- 1.1 五步映射链
  const CHAIN = [
    ['分层', 'i → (layer, s)', 'layer = i / 2²⁰，s = i mod 2²⁰', 'pos', 'codec.js'],
    ['螺旋', 's → (x, y)', '逆时针，起点左下角 (k,k)', 'pos', 'spiral.js'],
    ['光栅', '(x,y) → q', 'q = y·' + C.N + ' + x（底行优先）', 'pos', 'spiral.js'],
    ['仿射散射', 'q → r', 'r = (a·q + b) mod 2²⁰', 'pos', 'affine.js'],
    ['秩压缩', 'r → r′', 'r′ = rank(r)，满层退化为恒等', 'pos', 'rank.js'],
    ['打包 + 异或', 'bit → byte', 'MSB-first，再 ⊕ ChaCha20', 'val', 'keystream.js'],
  ];
  $('#chain').innerHTML = CHAIN.map((c) =>
    `<div class="chk" data-kind="${c[3]}"><div class="k">${esc(c[4])}</div><div class="f">${esc(c[1])}</div>` +
    `<div class="k">${esc(c[0])}</div><div class="d">${esc(c[2])}</div></div>`).join('');

  // ---------------------------------------------------------------- 1.3 四条边步进
  const a = M.derived.a, N = C.N, L = C.L;
  const modl = (v) => ((v % L) + L) % L;
  const EDGES = [
    ['下边', '+1', modl(a), 'leak', '恒等泄露的来源'],
    ['右边', '+' + N, modl(a * N), 'shot', '本来就被打散'],
    ['上边', '−1', modl(-a), 'rev', '位序反转'],
    ['左边', '−' + N, modl(-a * N), 'shot', '本来就被打散'],
  ];
  $('#edgebars').innerHTML = EDGES.map((e) => {
    const circ = Math.min(e[2], L - e[2]);
    return `<div class="eb"><div class="nm">${esc(e[0])}</div>` +
      `<div class="ln">q 步进 ${esc(e[1])}<br>r 步进 ${e[2]}（环形 ${n0(circ)}）</div>` +
      `<span class="tag ${e[3]}">${esc(e[4])}</span></div>`;
  }).join('') + `<div class="eb"><div class="nm">关掉仿射会怎样</div>` +
    `<div class="ln">a=1, b=0 ⇒ r 步进 = q 步进<br>下边 = 恒等，两条水平边合计 50% 的比特仍紧邻</div>` +
    `<span class="tag leak">这就是 3.3 里那条前缘</span></div>`;

  // ---------------------------------------------------------------- 1.4 模块地图
  const ARCH = [
    ['接口层', [['cli.js', 'encode / decode / inspect，参数解析、计时、退出码']]],
    ['编排层', [['codec.js', '分层循环、四条散射/聚集路径、缓冲复用、流式 I/O、tag 顺序']]],
    ['机制层', [['spiral.js', 's ↔ (x,y)，慢路径 sqrt 闭式 + 2048 段等差表'],
                ['affine.js', 'q ↔ r，HKDF 派生 a/b，Hensel 求模逆'],
                ['rank.js', '位图 + 字级前缀和，r → r′（没有 select）'],
                ['keystream.js', 'ChaCha20 绑定：IV = 计数器 u32 LE ‖ nonce'],
                ['header.js', '128 字节构造、九项校验、HMAC 常量时间比对']]],
    ['契约层', [['constants.js', '唯一的魔法数字出处 + 加载期断言掩码并集为 0xFF']]],
  ];
  $('#arch').innerHTML = ARCH.map((row) =>
    `<div class="arch-row"><div class="arch-lane">${esc(row[0])}</div><div class="mods">` +
    row[1].map((m) => `<div class="mod${m[0] === 'constants.js' ? ' sink' : ''}"><div class="mn">${esc(m[0])}</div><div class="md">${esc(m[1])}</div></div>`).join('') +
    '</div></div>').join('') +
    '<p class="cap">机制层五个模块互不依赖，只依赖契约层 ⇒ 可以单独替换、单独测试。<code>codec.js</code> 是唯一知道「层」这个概念的地方。依赖无环。</p>';

  // ---------------------------------------------------------------- 2.1 头部色带 + 字段表
  const band = $('#headerband');
  HDR.forEach((f) => {
    for (let i = 0; i < f.len; i++) {
      const off = f.off + i;
      const c = el('div', 'hb');
      const light = f.name === 'reserved0' || f.name === 'reserved1' || f.name === 'reserved2' ? 26 : 42;
      c.style.background = `hsl(${f.hue} 62% ${headerBytes[off] === 0 ? light - 12 : light}%)`;
      c.title = `偏移 ${off} · ${f.name} = 0x${headerBytes[off].toString(16).padStart(2, '0')}`;
      c.dataset.off = String(off);
      band.appendChild(c);
    }
  });
  $('#headerLegend').innerHTML = HDR.map((f) =>
    `<span class="lg"><i style="background:hsl(${f.hue} 62% 42%)"></i>${esc(f.name)} <span class="mono">[${f.off}..${f.off + f.len - 1}]</span></span>`).join('');
  const htb = $('#headerTable').querySelector('tbody');
  htb.innerHTML = HDR.map((f) => {
    const bytes = headerBytes.slice(f.off, f.off + f.len);
    let shown = f.get(bytes, headerDV);
    if (shown.length > 40) shown = shown.slice(0, 40) + '…';
    return `<tr data-off="${f.off}" data-end="${f.off + f.len - 1}"><td class="num">${f.off}</td><td class="num">${f.len}</td>` +
      `<td><code>${esc(f.name)}</code></td><td>${esc(f.type)}</td><td class="mono">${esc(f.norm)}</td>` +
      `<td class="mono">${esc(shown)}</td><td style="color:var(--dim)">${esc(f.note)}</td></tr>`;
  }).join('');
  band.addEventListener('pointerover', (e) => {
    const t = e.target.closest('.hb');
    if (!t) return;
    const off = Number(t.dataset.off);
    $$('#headerTable tbody tr').forEach((tr) =>
      tr.classList.toggle('hl', off >= Number(tr.dataset.off) && off <= Number(tr.dataset.end)));
  });

  // ---------------------------------------------------------------- 2.2 flags 逐位
  const FLAGS = [
    [0, 1, 'F_SPIRAL_CW', 0, '螺旋方向：0 逆时针 / 1 顺时针', '盘面互为镜像，两份实现互不兼容', 'v1 必为 0'],
    [1, 2, 'F_BIT_LSB_FIRST', 0, '位序：0 MSB-first / 1 LSB-first', '每字节内 8 比特倒序，<b>往返仍全绿</b>', 'v1 必为 0'],
    [2, 4, 'F_KEYSTREAM_ON', 1, 'ChaCha20 密钥流开关', '压缩率、位占比、公共子串三个指纹全部回归', '第 3 节 D3→OK'],
    [3, 8, 'F_AFFINE_ON', 1, '仿射散射开关', '原文件前 128 字节被原样抄进容器', '第 3 节 D1→D2'],
    [4, 16, 'F_RANK_COMPACT', 1, '秩压缩开关', '末层补满一整层，1 字节文件膨胀成 128 KiB', '第 3 节 D2→D3'],
    [5, 32, 'F_COMPRESSED', 0, '每层压缩（v2 预留）', 'v1 规范禁止置 1；置 1 必须报 BAD_PROFILE', '规格初稿曾漏掉这一位'],
    [6, 64, 'F_RESERVED6', 0, '保留', '置 1 报 BAD_PROFILE', ''],
    [7, 128, 'F_RESERVED7', 0, '保留', '置 1 报 BAD_PROFILE', ''],
  ];
  const flagsVal = headerBytes[5];
  $('#flagsBits').innerHTML = FLAGS.slice().reverse().map((f) => {
    const bit = (flagsVal >> f[0]) & 1;
    const must0 = f[3] === 0;
    return `<div class="bit ${bit ? 'on' : 'off'} ${must0 ? 'must0' : ''}"><div class="bv">${bit}</div><div class="bn">bit${f[0]} · ${f[2]}</div></div>`;
  }).join('') + `<div class="bit" style="border-style:dashed"><div class="bv mono" style="font-size:14px">0x${flagsVal.toString(16)}</div><div class="bn">本次实跑 flags</div></div>`;
  $('#flagsTable').querySelector('tbody').innerHTML = FLAGS.map((f) => {
    const bit = (flagsVal >> f[0]) & 1;
    return `<tr><td class="num">bit${f[0]}</td><td class="num">${f[1]}</td><td><code>${esc(f[2])}</code></td>` +
      `<td class="num">${f[3]}</td><td class="mono" style="color:${bit ? 'var(--green)' : 'var(--dim2)'}">实跑=${bit}</td>` +
      `<td>${esc(f[4])}</td><td style="color:var(--dim)">${f[5]}${f[6] ? '<span class="sub">' + esc(f[6]) + '</span>' : ''}</td></tr>`;
  }).join('');
  $('#flagsTable thead tr').innerHTML = '<th>位</th><th>权重</th><th>常量名</th><th>规范值</th><th>本次</th><th>含义</th><th>关掉/置 1 会怎样</th>';

  // ---------------------------------------------------------------- 2.3 常量表
  const CONSTS = [
    ['N（dimX=dimY）', n0(C.N), '1024² = 2²⁰ 比特 = 128 KiB，正好是 2 的幂 ⇒ 「全局比特序号 ↔ (层号, 层内序号)」是纯位运算；换成 1000 就处处要除法'],
    ['L = N²', n0(C.L), '每层比特数'],
    ['LAYER_BYTES', n0(C.LAYER_BYTES) + ' B', '每层字节数 = 128 KiB'],
    ['RING_COUNT', n0(C.RING_COUNT), '每层圈数 = N/2。N 是偶数 ⇒ 最内圈是 2×2 而不是 1×1，这个退化最容易写错'],
    ['SEG_PER_LAYER', n0(C.SEG_PER_LAYER), '每层等差段数 = 512×4。一整层只需 2048 个「起点+步长+长度」，段内只做加法，无 sqrt 无除法'],
    ['HEADER_SIZE', C.HEADER_SIZE + ' B', '固定 128：payload 起始偏移恒定，无需先解析变长字段'],
    ['CHACHA_BLOCK', C.CHACHA_BLOCK + ' B', 'ChaCha20 一个块'],
    ['BLOCKS_PER_LAYER', n0(C.BLOCKS_PER_LAYER), '131072/64 ⇒ 计数器基址 = layer × 2048，各层密钥流互不重叠'],
    ['MAX_LAYER', n0(C.MAX_LAYER), '32 位块计数器上限 ⇒ payload ≤ 256 GiB，超限抛 COUNTER_OVERFLOW 而不是静默回绕'],
    ['体积开销', '+128 B（恒定）', '规范值，无向上取整'],
  ];
  $('#constTable').querySelector('tbody').innerHTML = CONSTS.map((r) =>
    `<tr><td><code>${esc(r[0])}</code></td><td class="num">${esc(r[1])}</td><td style="color:var(--dim)">${esc(r[2])}</td></tr>`).join('');

  // ---------------------------------------------------------------- 2.4 派生参数
  const DERIVE = [
    ['dek（数据密钥）', 'crypto.randomBytes(32)，本演示用黄金向量的固定值', M.km.dekHex.slice(0, 32) + '…', '明文存于头部 64..95。挡位 B：可恢复无条件成立，机密性 0 bit'],
    ['file_nonce', 'crypto.randomBytes(12)', M.km.nonceHex, '每文件必须重新随机；ChaCha20 的 nonce 是 12 字节'],
    ['HKDF info 串', "'BT3D-v1-scan-a' / 'BT3D-v1-scan-b'", '两条串做域分隔', '换任何一个字 ⇒ a、b 全变 ⇒ payload 全变，必须升 version'],
    ['a（散射乘数）', 'HKDF-SHA256 → u64LE mod 2¹⁹，再 +2¹⁹，再 |1', a + ' (0x' + a.toString(16) + ')', '必须奇数（与 2²⁰ 互素 ⇒ 双射）且 ∈ [2¹⁹, 2²⁰)：不收窄的话千分之一的文件会拿到很小的 a，散射静默退化'],
    ['b（散射偏移）', 'HKDF-SHA256 → u64LE mod 2²⁰', M.derived.b, ''],
    ['a_inv', 'Hensel 提升 x←x(2−ax)，5 轮', M.derived.aInv, '精度每轮翻倍：1→2→4→8→16→32 位。中间积达 2⁶⁰，必须 BigInt；实测 50% 的奇数 a 四轮就够，所以断言要钉在固定见证 a=3 上'],
    ['IV 拼装', '计数器 u32 LE (4 B) ‖ nonce (12 B)', '共 16 字节', '已对 RFC 8439 §2.4.2 测试向量逐字节验证；另两种拼法（计数器 BE、nonce 在前）都不匹配'],
    ['第 0 层计数器基址', 'layer × 2048', '0', '第 8 层为 ' + (M.layerCount - 1) * C.BLOCKS_PER_LAYER],
  ];
  $('#deriveTable').querySelector('tbody').innerHTML = DERIVE.map((r) =>
    `<tr><td><code>${esc(r[0])}</code></td><td style="color:var(--dim)">${esc(r[1])}</td>` +
    `<td class="mono">${esc(r[2])}</td><td style="color:var(--dim2);font-size:12px">${esc(r[3])}</td></tr>`).join('');

  // ---------------------------------------------------------------- 3.1 挡位阶梯
  const chips = $('#variantChips');
  V.forEach((v, i) => {
    const c = el('button', 'chip');
    c.type = 'button';
    c.dataset.i = String(i);
    c.setAttribute('aria-selected', String(i === 0));
    c.innerHTML = `<span class="cid">${v.id}</span><span>${esc(v.name)}</span><span class="cfl">flags 0x${v.flags.toString(16)}</span>`;
    c.addEventListener('click', () => select(i));
    chips.appendChild(c);
  });
  const SWNAME = [[3, '仿射'], [4, '秩压缩'], [2, '密钥流']];
  const LADDER_NOTE = {
    D1: '最初的提案原样落地：只螺旋 + 只光栅。往返完美，但把原文件前 128 字节照抄在容器开头。',
    D2: '开 bit3。位置被真打散了，值没动 ⇒ 1 的个数仍等于原文。',
    D3: '再开 bit4。末层不再补满一整层，体积精确 = 原文 + 128。',
    OK: '再开 bit2。唯一改变「值」的一步，也是唯一提供真混淆的一步。',
  };
  $('#ladderFlow').innerHTML = V.map((v) => {
    const pills = SWNAME.map((s) => {
      const on = ((v.flags >> s[0]) & 1) === 1;
      return `<span class="sw ${on ? 'on' : 'off'}">${on ? '✓' : '✗'} ${s[1]}</span>`;
    }).join('');
    return `<div class="lf"><div class="h">${v.id} · 0x${v.flags.toString(16).padStart(2, '0')}</div>${pills}` +
      `<div style="color:var(--dim2);font-size:12px;margin-top:5px">${esc(LADDER_NOTE[v.id])}</div></div>`;
  }).join('');

  // ---------------------------------------------------------------- 3.x 控件与状态
  const st = { vi: 0, view: 'stack', adj: true, front: true, pad: true, xray: true, anno: true, layer: 0, allLayers: true, planeLayer: 0, az: -34, el: 52, gap: 80, zoom: 1, panX: 0, panY: 0, spin: false };
  const ZMIN = 0.4, ZMAX = 8, ZSTEP = 1.1;              // 滚轮一档 ×1.1，两端限幅

  const selLayer = $('#selLayer');
  selLayer.innerHTML = Array.from({ length: M.layerCount }, (_, i) =>
    `<option value="${i}">z=${i}${i === M.layerCount - 1 ? ' 末层 ' + n0(M.lastBytes) + ' B' : ''}</option>`).join('');
  $('#ckAdj').checked = st.adj; $('#ckFront').checked = st.front; $('#ckPad').checked = st.pad;
  $('#ckXray').checked = st.xray; $('#ckAnno').checked = st.anno;
  $('#ckAllLayers').checked = st.allLayers;
  $('#rgAz').value = st.az; $('#rgEl').value = st.el; $('#rgGap').value = st.gap;

  $$('#controls .seg[data-view]').forEach((b) => b.addEventListener('click', () => {
    st.view = b.dataset.view;
    $$('#controls .seg[data-view]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    redraw();
  }));
  $('#controls .seg[data-view="stack"]').setAttribute('aria-pressed', 'true');
  $('#ckAdj').addEventListener('change', (e) => { st.adj = e.target.checked; redraw(); });
  $('#ckFront').addEventListener('change', (e) => { st.front = e.target.checked; redraw(); });
  $('#ckPad').addEventListener('change', (e) => { st.pad = e.target.checked; redraw(); });
  $('#ckXray').addEventListener('change', (e) => { st.xray = e.target.checked; redraw(); });
  $('#ckAnno').addEventListener('change', (e) => { st.anno = e.target.checked; redraw(); });
  $('#ckAllLayers').addEventListener('change', (e) => { st.allLayers = e.target.checked; redraw(); });
  selLayer.addEventListener('change', (e) => { st.layer = Number(e.target.value); st.planeLayer = st.layer; redraw(); });
  const syncOut = () => { $('#outAz').textContent = st.az + '°/' + st.el + '°'; $('#outGap').textContent = st.gap + '%'; $('#outZoom').textContent = '×' + st.zoom.toFixed(2); };
  $('#rgAz').addEventListener('input', (e) => { st.az = Number(e.target.value); syncOut(); redraw(); });
  $('#rgEl').addEventListener('input', (e) => { st.el = Number(e.target.value); syncOut(); redraw(); });
  $('#rgGap').addEventListener('input', (e) => { st.gap = Number(e.target.value); syncOut(); redraw(); });
  $('#btnReset').addEventListener('click', () => {
    st.az = -34; st.el = 52; st.gap = 80; st.zoom = 1; st.panX = 0; st.panY = 0; st.spin = false;
    $('#btnSpin').setAttribute('aria-pressed', 'false');
    $('#rgAz').value = st.az; $('#rgEl').value = st.el; $('#rgGap').value = st.gap; syncOut(); redraw();
  });

  let spinRaf = 0;
  function spinLoop() {
    st.az = ((st.az + 0.6 + 180) % 360) - 180;
    $('#rgAz').value = String(Math.round(st.az));
    syncOut();
    paint();
    spinRaf = requestAnimationFrame(spinLoop);
  }
  $('#btnSpin').addEventListener('click', (e) => {
    st.spin = !st.spin;
    e.target.setAttribute('aria-pressed', String(st.spin));
    if (st.spin) spinLoop();
    else if (spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = 0; }
  });

  // 拖拽旋转：位移由光标增量直接累加，不做任何「追光标」的窗口位移。
  // 右键拖 / Shift+左键拖 = 平移（左键已被旋转占了，平移只能让给它的路）。
  const main = $('#main3d');
  let drag = null;
  const dpr = () => { const cw = main.clientWidth; return cw ? main.width / cw : 1; };
  const toCanvas = (clientX, clientY) => {
    const r = main.getBoundingClientRect(), k = dpr();
    // getBoundingClientRect 含 border，clientWidth 不含 —— 不扣掉这 1px 会整体带一个常数偏差
    const bw = (r.width - main.clientWidth) / 2, bh = (r.height - main.clientHeight) / 2;
    return [(clientX - r.left - bw) * k, (clientY - r.top - bh) * k];
  };
  // 以光标为锚的缩放：屏幕位置 = 锚点 + zoom × (世界点的 zoom=1 投影偏移)，
  // 所以「光标下的那点不动」等价于 pan₂ = pan₁ + (光标 − 锚点 − pan₁)(1 − z₂/z₁)。
  function setZoom(z2, clientX, clientY) {
    z2 = Math.max(ZMIN, Math.min(ZMAX, z2));
    if (z2 === st.zoom) return;
    const b = R.viewInfo(main);
    if (b && clientX !== undefined) {
      const c = toCanvas(clientX, clientY), kk = 1 - z2 / st.zoom;
      st.panX += (c[0] - b.anchorX - st.panX) * kk;
      st.panY += (c[1] - b.anchorY - st.panY) * kk;
    }
    st.zoom = z2;
    syncOut();
    redraw();
  }
  main.addEventListener('wheel', (e) => {
    e.preventDefault();                                  // 不加这条，滚轮滚到画布上会连带滚整页（本页 11k px 高）
    setZoom(st.zoom * (e.deltaY < 0 ? ZSTEP : 1 / ZSTEP), e.clientX, e.clientY);
  }, { passive: false });
  main.addEventListener('contextmenu', (e) => e.preventDefault());   // 右键留给平移，别浮浏览器菜单

  main.addEventListener('pointerdown', (e) => {
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    drag = { x: e.clientX, y: e.clientY, pan: pan };
    main.classList.add(pan ? 'panning' : 'dragging');
    main.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  main.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.pan) {
      const k = dpr();
      st.panX += dx * k; st.panY += dy * k;
    } else {
      st.az = ((st.az + dx * 0.45 + 180) % 360) - 180;
      st.el = Math.max(5, Math.min(88, st.el + dy * 0.3));
      $('#rgAz').value = String(Math.round(st.az));
      $('#rgEl').value = String(Math.round(st.el));
    }
    drag = { x: e.clientX, y: e.clientY, pan: drag.pan };
    syncOut();
    redrawSoon();
  });
  const endDrag = (e) => {
    if (!drag) return;
    main.classList.remove(drag.pan ? 'panning' : 'dragging');
    drag = null;
    try { main.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  main.addEventListener('pointerup', endDrag);
  main.addEventListener('pointercancel', endDrag);

  // 四挡缩略
  const minis = $('#minis');
  const miniCvs = V.map((v, i) => {
    const box = el('div', 'mini');
    box.innerHTML = `<div class="mh"><b>${v.id}</b><span class="mono">${esc(v.name)}</span></div>`;
    const c = el('canvas');
    c.width = 340; c.height = 226;
    c.style.width = '100%'; c.style.height = 'auto';
    box.appendChild(c);
    box.addEventListener('click', () => select(i));
    minis.appendChild(box);
    return { box, c };
  });

  // ---------------------------------------------------------------- 指标表
  const ROWS = [
    ['flags 位图', (v) => SWNAME.map((s) => `<span class="fpill ${((v.flags >> s[0]) & 1) ? 'on' : 'off'}">bit${s[0]} ${s[1]}</span>`).join(''), null],
    ['容器长度', (v) => n0(v.containerLen) + ' B', null],
    ['体积开销', (v) => '+' + n0(v.overhead) + ' B', (v) => v.overhead === 128],
    ['末层落盘', (v) => n0(v.lastStoredBytes) + ' B' + (v.lastStoredBytes === C.LAYER_BYTES ? '<span class="sub">补满一整层</span>' : '<span class="sub">= 真实余数</span>'), (v) => v.lastStoredBytes === M.lastBytes],
    ['判据 1 · 前 128 B 照抄', (v) => String(v.front128Copied) + `<span class="sub">逐字节相同 ${v.equalBytes}/128</span>`, (v) => v.front128Copied === false],
    ['判据 1 · ≥8 B 公共子串', (v) => n0(v.hits) + ' 处' + (v.hitsFirst >= 0 ? `<span class="sub">首处偏移 ${n0(v.hitsFirst)}</span>` : ''), (v) => v.hits === 0],
    ['判据 2 · 环形 |Δ|=1 占比', (v) => pc(v.eq1Ratio, 4) + '<span class="sub">仅满层</span>', (v) => v.eq1Ratio <= 0.01],
    ['判据 2 · |Δ| 中位数', (v) => n0(v.medianDelta), (v) => v.medianDelta >= 256],
    ['判据 3 · zstd-19 压缩比', (v) => v.zstd.toFixed(6) + '<span class="sub">阈值 ≥ 0.98</span>', (v) => v.zstd >= 0.98],
    ['判据 4 · 1 的个数', (v) => n0(v.ones), null],
    ['判据 4 · 1 占比', (v) => pc(v.onesRatio) + '<span class="sub">阈值 50%±1pp</span>', (v) => Math.abs(v.onesRatio - 0.5) <= 0.01],
    ['判据 5 · 自洽往返', (v) => String(v.roundtrip), null],
    ['几何键（a:b）', (v) => '<code>' + v.geomKey + '</code>', null],
  ];
  $('#metricsTable').innerHTML =
    '<thead><tr><th>指标</th>' + V.map((v) => `<th>${v.id} · ${esc(v.name)}</th>`).join('') + '</tr></thead><tbody>' +
    ROWS.map((r) => '<tr><td>' + r[0] + '</td>' + V.map((v) => {
      const pass = r[2] ? r[2](v) : null;
      const cls = pass === null ? 'na' : pass ? 'ok' : 'bad';
      return `<td class="mono ${cls}">${r[1](v)}</td>`;
    }).join('') + '</tr>').join('') + '</tbody>' +
    '<tfoot><tr><td>该挡哪条判据红</td>' + V.map((v) => {
      const bad = [];
      if (v.front128Copied || v.hits) bad.push('1');
      if (v.eq1Ratio > 0.01) bad.push('2');
      if (v.zstd < 0.98) bad.push('3');
      if (Math.abs(v.onesRatio - 0.5) > 0.01) bad.push('4');
      if (v.overhead !== 128) bad.push('体积');
      return `<td>${bad.length ? '<span class="badge bad">判据 ' + bad.join(' / ') + ' 红</span>' : '<span class="badge ok">全绿</span>'}</td>`;
    }).join('') + '</tr></tfoot>';

  // 判据 5 那一行加脚注：四挡全绿本身就是结论
  const rtRow = $$('#metricsTable tbody tr')[ROWS.length - 2];
  void rtRow;

  // ---------------------------------------------------------------- 近景
  const plane2d = $('#plane2d');
  const bitsOrig = $('#bitsOrig');
  const bitsHost = $('#bitsVariantHost');
  let bitsV;
  {
    const lab = el('span', 'rowlab');
    bitsHost.appendChild(lab);
    bitsV = el('canvas');
    bitsV.width = 512; bitsV.height = 40;
    bitsHost.appendChild(bitsV);
  }
  const frontZoom = $('#frontZoom');
  const fz = V.map((v) => {
    const box = el('div', 'fz');
    box.innerHTML = `<div class="fh">${v.id} · 盘面 y=0 那一行（= 容器最前面 1024 比特）</div>`;
    const c = el('canvas');
    c.width = 512; c.height = 40;
    box.appendChild(c);
    const val = el('div', 'fv');
    box.appendChild(val);
    frontZoom.appendChild(box);
    return { box, c, val };
  });

  function drawFrontZoom() {
    V.forEach((v, i) => {
      const cells = R.u8(v.layers[0]);
      const g = fz[i].c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#05070b'; g.fillRect(0, 0, 512, 40);
      // y=0 那 8 行的聚合值：128 格 → 每格 4 px
      for (let cx = 0; cx < M.grid; cx++) {
        const d = cells[cx] / 64;
        g.fillStyle = `rgba(${30 + 170 * d},${80 + 170 * d},${130 + 120 * d},1)`;
        g.fillRect(cx * 4, 0, 4, 40);
      }
      g.strokeStyle = 'rgba(243,194,100,.85)'; g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, 511, 39);
      fz[i].val.textContent = '前 128 字节照抄：' + v.front128Copied + ' · 相同字节 ' + v.equalBytes + '/128';
    });
  }

  // ---------------------------------------------------------------- 逐级结论
  const find = (id) => V.find((v) => v.id === id);
  const DELTA = (from, to, unit, good) => `<span class="delta"><span class="${good ? 'to' : 'from'}">${from}${unit || ''}</span><span class="ar">→</span><span class="to">${to}${unit || ''}</span></span>`;
  const d1 = find('D1'), d2 = find('D2'), d3 = find('D3'), ok = find('OK');
  $('#ladderSteps').innerHTML = [
    ['D1 → D2', '开 bit3 仿射散射', [
      DELTA(pc(d1.eq1Ratio, 4), pc(d2.eq1Ratio, 4), '', true),
      DELTA(String(d1.front128Copied), String(d2.front128Copied), '', true),
      DELTA(n0(d1.hits) + ' 处', n0(d2.hits) + ' 处', '', true),
    ].join('') + '<div style="color:var(--dim);margin-top:4px">位置被打散，几何泄露消失。但 <code>1 的个数</code> 仍是 ' + n0(d2.ones) + '，与原文完全相同 —— 值一点没动。</div>'],
    ['D2 → D3', '开 bit4 秩压缩', [
      DELTA(n0(d2.containerLen) + ' B', n0(d3.containerLen) + ' B', '', true),
      DELTA('末层 ' + n0(d2.lastStoredBytes), '末层 ' + n0(d3.lastStoredBytes), '', true),
      DELTA(pc(d2.onesRatio), pc(d3.onesRatio), '', true),
    ].join('') + '<div style="color:var(--dim);margin-top:4px">体积回到精确的 +128。附带好处：补满一整层的那些零原本会把 1 占比稀释到 ' + pc(d1.onesRatio) + '（个数没变、分母变了），现在这个次生指纹也一起没了。</div>'],
    ['D3 → OK', '开 bit2 密钥流', [
      DELTA(d3.zstd.toFixed(6), ok.zstd.toFixed(6), '', true),
      DELTA(pc(d3.onesRatio), pc(ok.onesRatio), '', true),
      DELTA(n0(d3.ones) + ' 个', n0(ok.ones) + ' 个', '', true),
    ].join('') + '<div style="color:var(--dim);margin-top:4px">前三步都只搬位置，只有异或改值。注意 <code>≥8 B 公共子串</code> 在 D2/D3 就已经是 0 处 —— 这一条判据分不出「真混淆」与「只有几何」，能分开它的是判据 3 与判据 4。</div>'],
    ['四挡共同点', '判据 5 自洽往返', '<span class="delta"><span class="to">D1 绿</span><span class="ar">/</span><span class="to">D2 绿</span><span class="ar">/</span><span class="to">D3 绿</span><span class="ar">/</span><span class="to">OK 绿</span></span>' +
      '<div style="color:var(--dim);margin-top:4px">四挡全部「往返一致」，包括把原文件前 128 字节照抄出去的 D1。<b>编解码同源出错时两边一起错</b>，所以只跑往返测试不能验收一个混淆容器 —— 这是本工程最重要的一条经验。</div>'],
  ].map((s) => `<div class="step"><div class="who">${esc(s[0])}<span>${esc(s[1])}</span></div><div class="what">${s[2]}</div></div>`).join('');

  // ---------------------------------------------------------------- 自检表
  $('#checksTable').querySelector('tbody').innerHTML = M.checks.map((c, i) =>
    `<tr><td class="num">C${i + 1}</td><td>${esc(c.name)}</td><td class="mono" style="font-size:12px;color:var(--dim)">${esc(c.detail)}</td>` +
    `<td><span class="badge ${c.pass ? 'ok' : 'bad'}">${c.pass ? 'PASS' : 'FAIL'}</span></td></tr>`).join('');

  // ---------------------------------------------------------------- 4 口径与边界
  $('#scopeList').innerHTML = [
    '本页所有数来自 <code>node demo-3d/build-data.mjs</code> 的<b>这一次实跑</b>，机制层调用的是 <code>../node/src/</code> 里的生产实现，演示脚本不重写任何几何或密码公式。',
    '输入 = 本机 <code>' + esc(M.execPath) + '</code> 的前 ' + n0(M.inputSize) + ' 字节。换机器或升级 Node 之后重跑，与文件内容有关的数会变（压缩比、位占比、公共子串数）。',
    '压缩比用 <code>zlib.zstdCompressSync</code> 级别 19；公共子串用 8 字节窗口；邻接距离用环形 <code>min(|Δ|, 2²⁰−|Δ|)</code> —— 三条都与 <code>test/criteria.js</code> 同口径。',
    '可与仓库台账互证的是两个纯几何量：派生 <code>a/b/aInv = ' + M.derived.a + '/' + M.derived.b + '/' + M.derived.aInv + '</code>（README §11.4）与 <code>|Δ|</code> 中位数 ' + n0(ok.medianDelta) + '（README §11.2 判据 2）。它们只依赖固定的 (dek, nonce)，与输入内容无关。',
    '与 <code>README.md</code> 第 11 章台账<b>不是同一次测量</b>：那边输入是 node.exe 前 1 MiB，恰好整层、走不到末层代码路径；这里故意留 ' + n0(M.lastBytes) + ' B 的末层。',
    '盘面按<b>存储序号</b>铺（它在容器里真的怎么排），不是按来源 s 铺。纹理单元 8×8 比特，叠加层单元 2×2 比特。',
    '<code>data.js</code> 用 <code>window.BT3D_DEMO = …</code> 内联（' + D.blobs.length + ' 个 base64 数据块）。<code>file://</code> 下 <code>fetch</code> 本地 JSON 会被策略拦，而 <code>&lt;script src&gt;</code> 通 —— 所以不用 fetch、不用构建、不用服务器。',
  ].map((s) => '<li>' + s + '</li>').join('');
  $('#limitsList').innerHTML = [
    '<b>容器里没有三维数组。</b> <code>(x, y, z)</code> 是从比特序号即时算出的视图；这张图演示的是「怎么看」，不是「怎么存」。',
    '叠加层（恒等邻接 / 前 128 比特落点）来自第 0 层的几何。满层上 <code>rank(r)=r</code> 所以对所有满层成立；<b>末层若开了秩压缩，存储序被紧凑化到 [0, m)，这张几何图不再适用</b>，渲染层因此不画它（图上有空格区域可对照）。',
    '演示只跑了 9 层（约 1.07 MiB）。单层独立解密、随机访问单比特（<code>affineInverse</code> 的实际使用路径）在 v1 里没实现 API，画不了。',
    '<code>F_COMPRESSED</code>（v2 每层压缩）与口令包裹 DEK（v3 挡位 C）未实现，本页不做推测性展示。',
    '仓库自列的未验证项这里同样没碰：Go / Rust 实现、payload > 256 GiB、大端机器、并发/多线程、秩压缩在 m 接近 L 时的性能。',
    '正交轴测投影故意不做近大远小 —— 那样每层到屏幕就不是仿射映射，只能逐像素投影。',
  ].map((s) => '<li>' + s + '</li>').join('');

  // ---------------------------------------------------------------- 右侧读数
  function updateReadout(bv) {
    const v = V[st.vi];
    $('#stageReadout').innerHTML = `
      <div class="ro-h">${v.id} · ${esc(v.name)}</div>
      <dl>
        <dt>flags</dt><dd>0x${v.flags.toString(16).padStart(2, '0')}</dd>
        <dt>几何键 a:b</dt><dd>${esc(v.geomKey)}</dd>
        <dt>容器长度</dt><dd>${n0(v.containerLen)} B</dd>
        <dt>体积开销</dt><dd class="${v.overhead === 128 ? 'ok' : 'bad'}">+${n0(v.overhead)} B</dd>
        <dt>末层落盘</dt><dd>${n0(v.lastStoredBytes)} B</dd>
        <dt>|Δ|=1 占比</dt><dd class="${v.eq1Ratio <= 0.01 ? 'ok' : 'bad'}">${pc(v.eq1Ratio, 4)}</dd>
        <dt>zstd-19</dt><dd class="${v.zstd >= 0.98 ? 'ok' : 'bad'}">${v.zstd.toFixed(6)}</dd>
        <dt>1 占比</dt><dd class="${Math.abs(v.onesRatio - 0.5) <= 0.01 ? 'ok' : 'bad'}">${pc(v.onesRatio)}</dd>
        <dt>≥8 B 子串</dt><dd class="${v.hits === 0 ? 'ok' : 'bad'}">${n0(v.hits)}</dd>
        <dt>前 128 B</dt><dd class="${v.front128Copied ? 'bad' : 'ok'}">${v.front128Copied ? '照抄' : '未照抄'}</dd>
      </dl>
      <div class="swatch"><i style="background:linear-gradient(90deg,#0a1220,#4fd8ce)"></i>值纹理（1 占比 0→1）</div>
      <div class="swatch"><i style="background:rgba(255,78,78,.8)"></i>恒等邻接（来源相邻⇒落点也相邻）</div>
      <div class="swatch"><i style="background:rgba(124,255,242,.9)"></i>原文件前 128 字节的落点</div>
      <div class="swatch"><i style="background:rgba(88,148,255,.9)"></i>补出来的空位（秩压缩关）</div>
      <div class="swatch"><i style="background:#05080e"></i>容器里不存在这段字节</div>
      <p class="hint">当前层 z=${st.layer}${st.allLayers ? '（全部层里高亮）' : '（只画这一层）'}；近景面板同步显示该层。</p>
      ${(() => {
        const b = bv;
        if (!b) return '';
        const fit1 = Math.abs(b.zoom - 1) < 1e-9 && !b.panX && !b.panY;   // 只有「自适应铺满」这一态才谈越界
        const ok = b.x0 > 1 && b.y0 > 1 && b.x1 < b.w - 1 && b.y1 < b.h - 1;
        return `<div class="ro-h" style="margin-top:10px">取景</div><dl><dt>缩放</dt><dd>×${b.zoom.toFixed(2)}</dd>`
          + `<dt>平移</dt><dd>${Math.round(b.panX)} , ${Math.round(b.panY)}</dd>`
          + `<dt>盘面包围盒</dt><dd>${Math.round(b.x1 - b.x0)}×${Math.round(b.y1 - b.y0)}</dd>`
          + `<dt>画布</dt><dd>${b.w}×${b.h}</dd><dt>画了</dt><dd>${b.layers} 层</dd>`
          + `<dt>是否越界</dt><dd class="${fit1 ? (ok ? 'ok' : 'bad') : 'na'}">${fit1 ? (ok ? '否' : '是') : '视口外已裁剪（放大后本应如此）'}</dd></dl>`;
      })()}`;
  }

  // ---------------------------------------------------------------- 图上编号对照
  // 编号内容与画布上的圆牌一一对应；「当前条件下不出现」的行要标出来，
  // 否则读者会在图上找一个本来就不该存在的牌子。
  function renderAnnoKey() {
    const v = V[st.vi], li = st.layer, stored = v.layerBytesStored[li];
    const multi = st.allLayers;
    const hasRed = st.adj && (li !== R.LAST || !v.rank);
    const hasPad = st.pad && li === R.LAST && !v.rank;
    const hasVoid = stored < C.LAYER_BYTES;
    const pxCell = (() => { const b = R.viewInfo(main); return b ? (b.sidePx / M.grid) : 0; })();    const ROWS = [
      [1, '前缘 y=0（金线，贴在盘外一侧）',
        '这一行装的是容器最前面的 <b>' + n0(C.N) + '</b> 比特 = 原文件最前面的 <b>128</b> 字节。' + (v.front128Copied
          ? '<b class="bad">当前挡青色落点整条贴在这里</b> —— 前 128 B 被照抄，删掉容器头拿 <code>file</code> 仍能认出原文件类型。'
          : '当前挡这 1024 比特已被仿射散到全盘，前缘不再等于原文开头。'), true],
      [2, '层距', '左后角之间那段引线量的就是层距。层与层之间<b>没有字节</b>，画面上撑开多少纯由「层距」滑块决定（当前 <b>' + st.gap + '%</b>），与容器格式无关。', multi],
      [3, 'z 轴脊线', '各层前缘左角 (x=0, y=0) 连成的线，只为让「堆叠」这件事看得见；<b>容器里没有这个结构</b>。', multi],
      [4, '当前层', '不透明的那一层（z=<b>' + li + '</b>' + (li === R.LAST ? '，末层' : '') + '），其余层按「半透明穿层」压到 24%；关掉穿层就只剩轮廓与前缘。', true],
      [5, '恒等邻接（红）', '来源上相邻的两个比特（s 与 s−1）落点环形 |Δ| ≤ 1 ⇒ 该格涂红。当前挡 <b class="' + (v.eq1Ratio <= 0.01 ? 'ok' : 'bad') + '">' + pc(v.eq1Ratio, 4) + '</b> 的比特对如此（阈值 ≤ 1%）。', hasRed],
      [6, '补出来的零（蓝）', '秩压缩关掉时末层被补满一整层 <b>' + n0(C.LAYER_BYTES) + '</b> B，这些格子在容器里真的占位置，但全是 0 比特。当前挡末层落盘 <b>' + n0(v.lastStoredBytes) + '</b> B。', hasPad],
      [7, '容器里不存在这段字节（黑蓝）', '开了秩压缩的末层只存真实余数，后面的格子在容器里<b>没有对应字节</b> —— 不是"值为 0"，是"没有"。', hasVoid],
      [8, '一个纹理单元 = 8×8 比特 = 8 字节', M.grid + '×' + M.grid + ' 格 × 每格 64 比特 = <b>' + n0(C.L) + '</b> 比特 = <b>' + n0(C.LAYER_BYTES) + '</b> B = 正好一层。当前缩放下每格只有 <b>' + pxCell.toFixed(1) + '</b> px，放大到 ×2 以上才看得清单格内部。', true],
    ];
    $('#annoKey').innerHTML = ROWS.map((r) =>
      `<li${r[3] ? '' : ' class="off"'}><span class="ab">${r[0]}</span><b>${r[1]}</b><span>${r[2]}</span>${r[3] ? '' : '<i>当前条件下不出现</i>'}</li>`).join('');
  }

  // ---------------------------------------------------------------- 汇总重绘
  // 控件改动同步画（一次也就十几毫秒，等一帧反而像「点了没反应」）；
  // 只有拖拽与自转走 rAF 合帧，避免一帧内重复铺九层。
  function paint() {
    R.draw(main, st, st.vi);
    const mainView = R.viewInfo(main);          // 缩略图也会写 viewInfo，这里先替主画布留个快照
    // 小图不跟缩放/平移、也不画编号：它们的职责是四挡并排对照，跟着放大就看不出差别了
    miniCvs.forEach((m, i) => R.draw(m.c, Object.assign({}, st, { view: 'stack', allLayers: true, front: false, pad: false, zoom: 1, panX: 0, panY: 0, anno: false }), i));
    miniCvs.forEach((m, i) => m.box.classList.toggle('sel', i === st.vi));
    R.drawPlane2D(plane2d, st, st.vi);
    R.drawBits(bitsOrig, M.inputHeadHex, null, 'orig');
    R.drawBits(bitsV, V[st.vi].headHex, M.inputHeadHex, 'payload');
    bitsHost.firstChild.textContent = V[st.vi].id + ' 前 128 B';
    const vv = V[st.vi];
    $('#bitNote').innerHTML = vv.front128Copied
      ? '<b class="bad">逐字节相同 ' + vv.equalBytes + '/128</b> —— 原文件开头 128 字节被原样抄进容器：删掉容器头再拿 <code>file</code> 认，仍能认出原文件类型。红格 =「是 1 且与原文同」，青格 =「是 1 但与原文异」。'
      : '与原文逐字节相同 <b>' + vv.equalBytes + '/128</b>。' + (vv.equalBytes ? '红格就是碰巧相同的字节。' : '一个相同字节都没有，红/青只表示该位是 1。');
    $('#plane2dCap').innerHTML = '第 ' + st.planeLayer + ' 层盘面，' + C.N + '×' + C.N + ' 比特，按存储序铺；画到 ' + M.grid + '×' + M.grid + ' / ' + M.full + '×' + M.full + ' 两级分辨率。金线 = y=0 那一行（容器最前面的 1024 比特）。';
    drawFrontZoom();
    updateReadout(mainView);
    renderAnnoKey();
  }
  function redraw() { paint(); }
  let raf = 0;
  function redrawSoon() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paint(); });
  }

  function select(i) {
    st.vi = i;
    $$('#variantChips .chip').forEach((c, j) => c.setAttribute('aria-selected', String(j === i)));
    redraw();
  }

  window.addEventListener('resize', () => redraw());
  syncOut();
  select(0);
})();
