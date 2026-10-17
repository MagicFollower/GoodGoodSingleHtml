// BT3D 三维演示 · 渲染引擎。零依赖，只用 Canvas 2D。
//
// 世界坐标遵循规格 C3/C4：
//   x = 存储序号低 10 位（向右）、y = 存储序号高 10 位（底行优先 ⇒ y=0 是原文件开头那一行）、
//   z = 层号（向上）。
// 投影取正交轴测：
//   sx = ( x·cos az + y·sin az ) · px
//   sy = ( x·sin az − y·cos az ) · sin el · px − z · cos el · pz
// 关键性质：同一 z 的平面到屏幕是**纯仿射**映射，所以每层盘面可以用
// ctx.setTransform + drawImage 精确铺设，不需要逐像素投影、也不需要透视除法。
// 代价：拿不到近大远小（正交投影本来就没有），旋转时也不会抖。
(function () {
  const D = window.BT3D_DEMO;
  const C = D.meta.const;
  const G = D.meta.grid;          // 128：值纹理分辨率，每单元 8×8 比特
  const F = D.meta.full;          // 512：叠加层分辨率，每单元 2×2 比特
  const NL = D.meta.layerCount;
  const LAST = NL - 1;
  const ROW_BYTES = C.N / 8;      // 128 字节/行

  const u8Cache = new Map();
  function u8(i) {
    let a = u8Cache.get(i);
    if (a === undefined) {
      const s = atob(D.blobs[i]);
      a = new Uint8Array(s.length);
      for (let k = 0; k < s.length; k++) a[k] = s.charCodeAt(k);
      u8Cache.set(i, a);
    }
    return a;
  }

  const planeCache = new Map();   // `${vi}|${li}` → 值纹理（不含叠加层，切换叠加不用重画）
  const ovCache = new Map();      // `${kind}|${geomKey}` → 叠加层（按几何键共用）
  const views = new Map();        // 画布 → 最近一次取景包围盒（供页面读数与验收判据）
  const EMPTY = [5, 8, 14];       // 「容器里根本没有这段字节」的底色

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 单元是否存在（按存储序铺 ⇒ 一个层段只覆盖前 storedBytes 个字节）
  function cellBytes(cx, cy, storedBytes) {
    const first = cy * 8 * ROW_BYTES + cx;
    if (first >= storedBytes) return 0;
    return Math.max(1, Math.min(8, Math.floor((storedBytes - cx) / ROW_BYTES) - cy * 8));
  }

  function planeCanvas(vi, li) {
    const ck = vi + '|' + li;
    let cv = planeCache.get(ck);
    if (cv) return cv;
    const v = D.variants[vi];
    const cells = u8(v.layers[li]);
    const stored = v.layerBytesStored[li];
    cv = makeCanvas(G, G);
    const img = cv.getContext('2d').createImageData(G, G);
    const px = img.data;
    for (let cy = 0; cy < G; cy++) {
      for (let cx = 0; cx < G; cx++) {
        const o = (cy * G + cx) * 4;
        const nb = cellBytes(cx, cy, stored);
        if (nb === 0) { px[o] = EMPTY[0]; px[o + 1] = EMPTY[1]; px[o + 2] = EMPTY[2]; px[o + 3] = 255; continue; }
        const d = cells[cy * G + cx] / (8 * nb);          // 0..1，该单元实际落盘比特的 1 占比
        px[o] = 12 + 150 * d * d;
        px[o + 1] = 30 + 205 * d;
        px[o + 2] = 52 + 200 * d;
        px[o + 3] = 255;
      }
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    planeCache.set(ck, cv);
    return cv;
  }

  function overlay(kind, key, build) {
    const ck = kind + '|' + key;
    let cv = ovCache.get(ck);
    if (cv) return cv;
    cv = build();
    ovCache.set(ck, cv);
    return cv;
  }
  const adjCanvas = (key) => overlay('adj', key, () => {
    const a = u8(D.geoms[key].adjBlob);
    const cv = makeCanvas(F, F);
    const img = cv.getContext('2d').createImageData(F, F);
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      const o = i * 4;
      img.data[o] = 255; img.data[o + 1] = 78; img.data[o + 2] = 78; img.data[o + 3] = 168;
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    return cv;
  });
  const frontCanvas = (key) => overlay('front', key, () => {
    const cv = makeCanvas(F, F);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(124,255,242,.95)';
    for (const cell of D.geoms[key].front) {
      const x = cell % F, y = (cell - x) / F;
      ctx.fillRect(x, y, 2, 2);                    // 一格 2×2 比特 ⇒ 在 512 分辨率上正好 2×2 px
    }
    return cv;
  });
  const padCanvas = (key) => overlay('pad', key, () => {
    const a = u8(D.geoms[key].padBlob);
    const cv = makeCanvas(G, G);
    const img = cv.getContext('2d').createImageData(G, G);
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      const o = i * 4;
      img.data[o] = 78; img.data[o + 1] = 138; img.data[o + 2] = 255;
      img.data[o + 3] = Math.min(215, 34 + a[i] * 26);   // 单元里补了几个字节就浓几分
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    return cv;
  });

  // ---------- 投影 ----------
  // 单位约定：x/y 用「格」，z 也用「格」，一切经 px = sidePx/G 换算成屏幕像素。
  // 层的间距因此随仰角一起被 cos(el) 压缩 —— 俯视时层堆成一叠，平视时摊成一排，都是真的。
  function cam(tx, ty, sidePx, azDeg, elDeg) {
    const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
    const ca = Math.cos(az), sa = Math.sin(az), se = Math.sin(el), ce = Math.cos(el);
    const px = sidePx / G;
    const pt = (x, y, z) => [tx + (x * ca + y * sa) * px, ty + (x * sa - y * ca) * se * px - z * ce * px];
    const mat = (imgSize, z) => {
      const s = sidePx / imgSize;
      // 平移项必须与 pt() 同一条式子：源 (0,0) ↔ 世界 (0,0,z)。
      // 若顺手把图居中（e = tx − (a+c)·imgSize/2），贴图会与轮廓错开半个盘面 ——
      // 且自报包围盒（按 pt 算）再也预言不了像素实际落在哪（实测偏 396 px @ az=0）。
      const a = ca * s, b = sa * se * s, c = sa * s, d = -ca * se * s;
      return [a, b, c, d, tx, ty - z * ce * px];
    };
    const corners = (z) => [pt(0, 0, z), pt(G, 0, z), pt(G, G, z), pt(0, G, z)];
    return { pt, mat, corners, ce, px };
  }

  // 页面隐藏时 clientWidth 会是 0，退回一个能画的比例，至少保证探针与截图有内容
  function fit(canvas, ratio) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth, chh = canvas.clientHeight;
    const w = Math.max(280, Math.round((cw || 640) * dpr));
    const h = Math.max(180, Math.round((cw ? (chh || cw * ratio) : 640 * ratio) * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { ctx: canvas.getContext('2d'), w: w, h: h, k: w / 960 };
  }

  function bg(g, w, h) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#080b11'; g.fillRect(0, 0, w, h);
  }

  // 给平面加一点厚度：只画外法线屏幕分量朝下的那些边（凸四边形 ⇒ 这个判据精确）
  function slab(g, cs, thick, fill) {
    const cx = (cs[0][0] + cs[1][0] + cs[2][0] + cs[3][0]) / 4;
    const cy = (cs[0][1] + cs[1][1] + cs[2][1] + cs[3][1]) / 4;
    g.fillStyle = fill;
    for (let e = 0; e < 4; e++) {
      const p1 = cs[e], p2 = cs[(e + 1) % 4];
      const oy = (p1[1] + p2[1]) / 2 - cy;
      if (oy <= 0.2) continue;
      g.beginPath();
      g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]);
      g.lineTo(p2[0], p2[1] + thick); g.lineTo(p1[0], p1[1] + thick);
      g.closePath(); g.fill();
    }
  }

  function quad(g, cs, color, lw, close) {
    g.strokeStyle = color; g.lineWidth = lw;
    g.beginPath(); g.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(cs[i][0], cs[i][1]);
    if (close) g.closePath();
    g.stroke();
  }

  // 画布内的文字也要受宽度约束：长中文文案会一路顶到画布边缘，
  // 让「像素触边」这个判据把文字当成溢出（实测发生过）。超宽就截断加省略号。
  function fitText(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function blit(g, cm, img, z) {
    const m = cm.mat(img.width, z);
    g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    g.drawImage(img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // 叠加层只在「该层几何与满层一致」时成立：满层恒 rank(r)=r，
  // 末层若开了秩压缩则存储序被紧凑化到 [0,m)，满层几何图不再适用。
  function overlayOkFor(v, li) { return li !== LAST || !v.rank; }

  // ---------- 编号标注（图解引线）----------
  // 锚点一律由投影式子现算 ⇒ 旋转、缩放、平移之后仍然指着同一个地方。
  // 圆牌一律落在取景包围盒之外：这一轮刚栽过一次 —— 标记压在它自己要标的那一行上，
  // 于是图案和「以该图案为读数的判据」一起消失（实测 D1 青色落点只剩 1 px 可测）。
  function annoPlace(box, A, k, w, h) {
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    let dx = A[0] - cx, dy = A[1] - cy;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { dx = 0; dy = 1; }
    const tx = dx > 1e-6 ? (box.x1 - cx) / dx : dx < -1e-6 ? (box.x0 - cx) / dx : Infinity;
    const ty = dy > 1e-6 ? (box.y1 - cy) / dy : dy < -1e-6 ? (box.y0 - cy) / dy : Infinity;
    const t = Math.min(tx, ty) + (13 * k) / Math.hypot(dx, dy);
    return [Math.max(12 * k, Math.min(w - 12 * k, cx + dx * t)),
            Math.max(12 * k, Math.min(h - 46 * k, cy + dy * t))];
  }
  // 沿「包围盒中心 → 锚点」这条射线把圆牌推到盒外；若那个位置已经有牌子，就绕中心转开一点再推。
  // 不避让会出事：实测 ⑤ 与 ⑧ 的射线几乎同向，两张牌子叠成一张，编号直接读不出来。
  function annoSlot(box, A, k, w, h, taken) {
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    let base = Math.atan2(A[1] - cy, A[0] - cx);
    if (!isFinite(base)) base = Math.PI / 2;
    let P = annoPlace(box, A, k, w, h);
    for (let i = 1; i <= 14; i++) {
      const clash = taken.some((t) => Math.hypot(t[0] - P[0], t[1] - P[1]) < 21 * k);
      if (!clash) break;
      const s = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.26;
      const dx = Math.cos(base + s), dy = Math.sin(base + s);
      const tx = dx > 1e-6 ? (box.x1 - cx) / dx : dx < -1e-6 ? (box.x0 - cx) / dx : Infinity;
      const ty = dy > 1e-6 ? (box.y1 - cy) / dy : dy < -1e-6 ? (box.y0 - cy) / dy : Infinity;
      const t = Math.min(tx, ty) + 13 * k;
      P = [Math.max(12 * k, Math.min(w - 12 * k, cx + dx * t)), Math.max(12 * k, Math.min(h - 46 * k, cy + dy * t))];
    }
    taken.push(P);
    return P;
  }
  function badge(g, A, P, n, k) {
    g.strokeStyle = 'rgba(150,175,205,.55)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(P[0], P[1]); g.stroke();
    const r = 8.5 * k;
    g.beginPath(); g.arc(P[0], P[1], r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(9,13,20,.92)'; g.fill();
    g.strokeStyle = 'rgba(124,255,242,.7)'; g.lineWidth = 1.2 * k; g.stroke();
    g.fillStyle = 'rgba(228,240,255,.96)';
    g.font = `600 ${11 * k}px ui-monospace, Consolas, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), P[0], P[1] + 0.5 * k);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  }
  function drawAnno(ctx, cm, box, layers, zRef, gapCells, v, st, k, w, h) {
    const li = st.layer, z = (li - zRef) * gapCells, cs = cm.corners(z);
    const gm = D.geoms[v.geomKey], stored = v.layerBytesStored[li];
    const taken = [], list = [];
    const put = (n, A) => { if (!A) return; const P = annoSlot(box, A, k, w, h, taken); badge(ctx, A, P, n, k); list.push({ n: n, A: A, P: P }); };
    put(1, [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2]);        // 前缘 y=0 中点
    put(4, cs[2]);                                                        // 当前层远角
    const other = layers.find((x) => x !== li);
    if (other !== undefined) {
      const a = cm.pt(0, G, z), b = cm.pt(0, G, (other - zRef) * gapCells);
      put(2, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);                      // 层距（左后角之间）
      const r0 = cm.pt(0, 0, (layers[0] - zRef) * gapCells), r1 = cm.pt(0, 0, (layers[layers.length - 1] - zRef) * gapCells);
      put(3, [(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2]);                  // z 轴脊线中点
    }
    if (st.adj && overlayOkFor(v, li)) {                                   // 找一个真的红格，锚在它中心
      const a = u8(gm.adjBlob);
      let hit = null;
      for (let gy = 40; gy < 96 && !hit; gy++) for (let gx = 20; gx < 108 && !hit; gx++) if (a[(gy * 4) * F + gx * 4]) hit = cm.pt(gx + 0.5, gy + 0.5, z);
      put(5, hit);
    }
    if (st.pad && li === LAST && !v.rank) {                                // 补零最多的那一格
      const p = u8(gm.padBlob); let bi = -1, bv = 0;
      for (let i = 0; i < p.length; i++) if (p[i] > bv) { bv = p[i]; bi = i; }
      if (bi >= 0) { const x = bi % G, y = (bi - x) / G; put(6, cm.pt(x + 0.5, y + 0.5, z)); }
    }
    if (stored < C.LAYER_BYTES) {                                          // 容器里真的没有这段字节
      let hit = null;
      for (let gy = G - 1; gy >= 0 && !hit; gy--) for (let gx = G - 1; gx >= 0 && !hit; gx--) if (!cellBytes(gx, gy, stored)) hit = cm.pt(gx + 0.5, gy + 0.5, z);
      put(7, hit);
    }
    {                                                                      // 一格 = 8×8 比特：给一格描框
      let gx = 44, gy = 44;
      if (!cellBytes(gx, gy, stored)) {
        outer: for (let y = 30; y < 100; y++) for (let x = 30; x < 100; x++) if (cellBytes(x, y, stored)) { gx = x; gy = y; break outer; }
      }
      const q = [cm.pt(gx, gy, z), cm.pt(gx + 1, gy, z), cm.pt(gx + 1, gy + 1, z), cm.pt(gx, gy + 1, z)];
      quad(ctx, q, 'rgba(226,238,255,.92)', 1.2 * k, true);
      put(8, [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]);
    }
    box.badges = list;                                                     // 供页面读数与「不许互相叠」的判据用
  }

  // 自适应取景：先按「投影包围盒」解出 zoom=1 的平面尺寸与层距，再把包围盒中心对到画布中心。
  // 不能只用 sidePx·包围盒系数 当宽度 —— 旋转后角点的屏幕中心并不落在 tx 上，
  // 低仰角时单边会顶出画布（实测 el=12 时前缘一路画到第 0 列）。
  // 缩放只是把这套基准乘上 zoom：正交投影没有「推近」，缩放 = 均匀放大 sidePx 与层距的屏幕投影。
  // 关键：世界层距 gapCells 必须由 zoom=1 的基准反推后钉死。若改用缩放后的 px 去反推，
  // gapCells 会缩成 1/zoom，于是盘而变大了、九层却重新糊回一叠。
  function view(canvas, w, h, st, layers, extraTop, cyFrac) {
    const az = st.az * Math.PI / 180, el = st.el * Math.PI / 180;
    const ca = Math.cos(az), sa = Math.sin(az), se = Math.sin(el), ce = Math.cos(el);
    const fW = Math.abs(ca) + Math.abs(sa) || 1;
    const denom = Math.max(0.06, se * fW);
    const zRef = layers.length > 1 ? (NL - 1) / 2 : layers[0];
    const cy0 = cyFrac === undefined ? 0.46 : cyFrac;
    const zoom = Math.max(0.05, st.zoom || 1);
    const spanPx = (st.gap / 100) * h * 0.50 * (layers.length > 1 ? 1 : 0);   // zoom=1 时整叠的屏幕总高
    // 基准边长：usable 取 0.88w / 0.78h，给角落的 z 标签与底部说明留出余量，
    // 这样「渲染层自报的包围盒」与「像素触边检查」两个口径能互相印证。
    const fitPx = Math.max(60, Math.min(0.88 * w / fW, (0.78 * h - spanPx - (extraTop || 0)) / denom));
    const gapCells = spanPx / Math.max(1, NL - 1) / Math.max(0.06, ce) / (fitPx / G);
    const sidePx = fitPx * zoom;
    const px = sidePx / G;
    const zA = (Math.max.apply(null, layers) - zRef) * gapCells;
    const zB = (Math.min.apply(null, layers) - zRef) * gapCells;
    const probe = cam(0, 0, sidePx, st.az, st.el);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of [[0, 0], [G, 0], [G, G], [0, G]]) {
      for (const z of [zA, zB]) {
        const p = probe.pt(c[0], c[1], z);
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
    }
    const panX = st.panX || 0, panY = st.panY || 0;
    const tx = w / 2 - (x0 + x1) / 2 + panX;
    const ty = h * cy0 - (y0 + y1) / 2 + panY;
    // 按画布记录取景包围盒（只算盘面四角，不含文字）——页面读数与验收判据都用它，
    // 避免「靠配色猜几何」：细斜线一被抗锯齿糊掉就量不准。
    // anchorX/anchorY 是「未加平移的视口锚点」，滚轮以光标为锚缩放时要用它解平移量。
    views.set(canvas, { x0: x0 + tx, x1: x1 + tx, y0: y0 + ty, y1: y1 + ty, w: w, h: h, layers: layers.length, sidePx: sidePx, gapCells: gapCells, zoom: zoom, panX: panX, panY: panY, anchorX: w / 2, anchorY: h * cy0 });
    return { cm: cam(tx, ty, sidePx, st.az, st.el), sidePx, px, gapCells, zRef, zA, zB, spanPx: spanPx * zoom, ce };
  }

  // ---------- 视图 A：层叠盘面 ----------
  function drawStack(canvas, st, vi) {
    const g = fit(canvas, 0.66);
    const { ctx, w, h, k } = g;
    bg(ctx, w, h);
    const v = D.variants[vi];
    const az = st.az * Math.PI / 180, el = st.el * Math.PI / 180;
    const sa = Math.sin(az), ca = Math.cos(az), se = Math.sin(el);
    const layers = st.allLayers ? Array.from({ length: NL }, (_, i) => i) : [st.layer];
    const V0 = view(canvas, w, h, st, layers, 0);
    const cm = V0.cm, gapCells = V0.gapCells, zRef = V0.zRef;
    ctx.imageSmoothingEnabled = true;

    // z 轴脊线：把各层前缘左角连起来，让「堆叠」这件事看得见
    if (layers.length > 1) {
      ctx.strokeStyle = 'rgba(120,140,175,.4)'; ctx.lineWidth = k;
      ctx.beginPath();
      layers.forEach((li, i) => {
        const p = cm.pt(0, 0, (li - zRef) * gapCells);
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
    }

    for (const li of layers) {
      const z = (li - zRef) * gapCells;
      const cur = li === st.layer;
      const fade = cur ? 1 : (st.xray ? 0.24 : 0);
      if (fade > 0) {
        ctx.globalAlpha = fade;
        if (cur) slab(ctx, cm.corners(z), Math.max(2, 5 * k), 'rgba(20,28,45,.97)');
        blit(ctx, cm, planeCanvas(vi, li), z);
        if (st.pad && li === LAST && !v.rank) blit(ctx, cm, padCanvas(v.geomKey), z);
        ctx.globalAlpha = 1;
      }
      const cs = cm.corners(z);
      const rec = views.get(canvas);
      if (rec && cur) rec.frontEdge = [cs[0], cs[1]];   // y=0 那条边的屏幕坐标，供「前 1024 比特贴在边上」的判据用
      quad(ctx, cs, cur ? 'rgba(158,182,218,.85)' : 'rgba(88,112,150,.55)', (cur ? 1.4 : 1) * k, true);
      // 前缘 = y=0 那一行 = 原文件开头 1024 比特所在。标记线沿盘外法线挪几像素 ——
      // 画在同一行上会把该行自己的落点像素（青色叠加）整个糊掉，实测 D1 挡因此只剩 1 px 可测。
      const ux = -sa, uy = ca * se, un = (Math.hypot(ux, uy) || 1), off = 3.6 * k;
      ctx.strokeStyle = cur ? 'rgba(243,194,100,.95)' : 'rgba(243,194,100,.5)';
      ctx.lineWidth = (cur ? 2 : 1.3) * k;
      ctx.beginPath();
      ctx.moveTo(cs[0][0] + ux / un * off, cs[0][1] + uy / un * off);
      ctx.lineTo(cs[1][0] + ux / un * off, cs[1][1] + uy / un * off);
      ctx.stroke();
      // 叠加层铺在轮廓与标记线之后：它们标的正是这一行，压在上面才量得到
      if (fade > 0 && overlayOkFor(v, li)) {
        ctx.globalAlpha = fade;
        if (st.adj) blit(ctx, cm, adjCanvas(v.geomKey), z);
        if (st.front) blit(ctx, cm, frontCanvas(v.geomKey), z);
        ctx.globalAlpha = 1;
      }
      ctx.font = `${10.5 * k}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = cur ? 'rgba(200,220,245,.95)' : 'rgba(150,170,200,.8)';
      ctx.textAlign = 'left';
      const lab = cm.pt(4, G - 8, z);                 // 标在盘面内侧，免得字戳出取景包围盒
      ctx.fillText('z=' + li, lab[0], lab[1]);
    }

    if (st.anno) drawAnno(ctx, cm, views.get(canvas), layers, zRef, gapCells, v, st, k, w, h);

    ctx.font = `${11 * k}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = 'rgba(139,155,180,.92)'; ctx.textAlign = 'left';
    const maxW = w - 24 * k;
    ctx.fillText(fitText(ctx, v.id + ' · ' + v.name + ' · 画 ' + layers.length + ' / ' + NL + ' 层（亮层为当前层）', maxW), 12 * k, h - 27 * k);
    ctx.fillText(fitText(ctx, '每格 = 8×8 比特   亮 = 1 多   黑蓝 = 容器里没这段字节   金线（贴盘外）= y=0 前缘', maxW), 12 * k, h - 12 * k);
  }

  // ---------- 视图 B：高度场（单层柱子）----------
  function drawBars(canvas, st, vi) {
    const g = fit(canvas, 0.66);
    const { ctx, w, h, k } = g;
    bg(ctx, w, h);
    const v = D.variants[vi];
    const li = st.layer;
    const cells = u8(v.layers[li]);
    const stored = v.layerBytesStored[li];
    // 柱子往上长 ⇒ 给顶部留出预估高度，并把底座压到画面下半部
    const az0 = st.az * Math.PI / 180, el0 = st.el * Math.PI / 180;
    const fW0 = Math.abs(Math.cos(az0)) + Math.abs(Math.sin(az0)) || 1;
    const est = 0.30 * Math.min(0.95 * w / fW0, h * 0.8);
    const V0 = view(canvas, w, h, Object.assign({}, st, { gap: 0 }), [li], est, 0.68);
    const cm = V0.cm, sidePx = V0.sidePx;
    const HB = 64, step = G / HB;                       // 每根柱子覆盖 16×16 比特
    // 上限也乘 zoom：否则放大后柱高被画布高度钉死，柱子不再跟着长（zoom=1 时与旧值逐字相同）
    const maxH = Math.min(0.30 * sidePx, h * 0.34 * (st.zoom || 1));
    const adj = st.adj ? u8(D.geoms[v.geomKey].adjBlob) : null;
    const useAdj = adj && overlayOkFor(v, li);
    const padA = (st.pad && li === LAST && !v.rank) ? u8(D.geoms[v.geomKey].padBlob) : null;
    const lw = Math.max(1, sidePx / HB * 0.58);

    slab(ctx, cm.corners(0), Math.max(3, 8 * k), 'rgba(22,31,49,.9)');
    quad(ctx, cm.corners(0), 'rgba(96,124,168,.6)', 1.1 * k, true);

    for (let by = HB - 1; by >= 0; by--) {              // y 越大越远 ⇒ 远处先画
      for (let bx = 0; bx < HB; bx++) {
        let sum = 0, nb = 0;
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const cy = by * step + dy, cx = bx * step + dx;
            const b = cellBytes(cx, cy, stored);
            if (!b) continue;
            sum += cells[cy * G + cx]; nb += 8 * b;
          }
        }
        const wx = bx * step, wy = by * step;
        const p = cm.pt(wx + step / 2, wy + step / 2, 0);
        if (!nb) {                                       // 这一格整块不存在
          ctx.fillStyle = 'rgba(58,72,100,.4)';
          ctx.fillRect(p[0] - k, p[1] - k, 2 * k, 2 * k);
          continue;
        }
        const d = sum / nb;
        const pc = padA ? padA[wy * G + wx] : 0;
        let fill = 'rgba(' + (34 + 150 * d) + ',' + (74 + 172 * d) + ',' + (124 + 128 * d) + ',.96)';
        if (pc) fill = 'rgba(88,148,255,' + (0.3 + 0.085 * Math.min(8, pc)).toFixed(3) + ')';
        let hh = d * maxH;
        // 补出来的零全是 0 比特 ⇒ 柱高天然是 0，不垫一个矮台就等于没画（实测这张图上的补零区整块是空的）
        if (pc && hh < 1.5 * k) hh = 1.5 * k + pc * 0.55 * k;
        ctx.strokeStyle = fill; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - hh); ctx.stroke();
        if (useAdj) {                                    // 该柱覆盖范围内只要有恒等邻接就点一盏红
          const fx = bx * step * 4, fy = by * step * 4;  // FULL 分辨率下的起始单元（1 格 = 2 比特）
          let hit = 0;
          for (let s = 0; s < 4; s++) if (adj[(fy + (s >> 1)) * F + fx + (s & 1)]) { hit = 1; break; }
          if (hit) {
            ctx.fillStyle = 'rgba(255,92,92,.96)';
            ctx.fillRect(p[0] - lw / 2, p[1] - hh - 3 * k, lw, 3 * k);
          }
        }
      }
    }

    const e0 = cm.pt(0, 0, 0), e1 = cm.pt(G, 0, 0);
    const recB = views.get(canvas);
    if (recB) recB.frontEdge = [e0, e1];
    ctx.strokeStyle = 'rgba(243,194,100,.92)'; ctx.lineWidth = 1.5 * k;
    ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();

    ctx.font = `${11 * k}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = 'rgba(139,155,180,.92)'; ctx.textAlign = 'left';
    const maxW2 = w - 24 * k;
    ctx.fillText(fitText(ctx, v.id + ' · ' + v.name + ' · z=' + li + (li === LAST ? '（末层落盘 ' + stored.toLocaleString() + ' B）' : ''), maxW2), 12 * k, 22 * k);
    ctx.fillText(fitText(ctx, '柱高 = 该 16×16 比特块的 1 占比   矮蓝台 = 补出来的零（全 0，故只立一点高度）   灰点 = 容器里没有这段字节', maxW2), 12 * k, 38 * k);
  }

  // ---------- 2D 近景：盘面按存储序铺，y=0 翻到画面下沿 ----------
  function flipBlit(ctx, img, W, H) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(0, H);
    ctx.scale(1, -1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, W, W);
    ctx.restore();
  }
  function drawPlane2D(canvas, st, vi) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    const v = D.variants[vi];
    const li = st.planeLayer;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, H);
    flipBlit(ctx, planeCanvas(vi, li), W, H);
    if (overlayOkFor(v, li)) {
      if (st.adj) flipBlit(ctx, adjCanvas(v.geomKey), W, H);
      if (st.front) flipBlit(ctx, frontCanvas(v.geomKey), W, H);
    }
    if (st.pad && li === LAST && !v.rank) flipBlit(ctx, padCanvas(v.geomKey), W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(243,194,100,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
  }

  // ---------- 前 128 字节逐格位图（MSB-first，约定 C2）----------
  function hexBytes(h) {
    const a = [];
    for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16));
    return a;
  }
  function drawBits(canvas, hexStr, cmpHex, mode) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, H);
    const byt = hexBytes(hexStr);
    const cmp = cmpHex ? hexBytes(cmpHex) : null;
    const cw = W / byt.length, ch = H / 8;
    for (let b = 0; b < byt.length; b++) {
      const same = cmp ? cmp[b] === byt[b] : true;
      for (let j = 0; j < 8; j++) {
        const bit = (byt[b] >> (7 - j)) & 1;
        ctx.fillStyle = mode === 'orig'
          ? (bit ? 'rgba(158,186,224,.95)' : 'rgba(28,38,56,.95)')
          : bit ? (same ? 'rgba(255,110,110,.98)' : 'rgba(124,255,242,.92)')
                : (same ? 'rgba(126,42,46,.9)' : 'rgba(22,32,48,.9)');
        ctx.fillRect(b * cw, j * ch, Math.max(1, cw - 0.7), Math.max(1, ch - 0.7));
      }
    }
  }

  window.BT3DRender = {
    draw(canvas, st, vi) { if (st.view === 'bars') drawBars(canvas, st, vi); else drawStack(canvas, st, vi); },
    drawPlane2D, drawBits,
    viewInfo(canvas) { return (canvas && views.get(canvas)) || null; },
    variantOf(id) { for (let i = 0; i < D.variants.length; i++) if (D.variants[i].id === id) return i; return D.variants.length - 1; },
    u8, LAST, NL,
  };
})();
