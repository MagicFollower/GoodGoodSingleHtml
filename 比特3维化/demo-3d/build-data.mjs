#!/usr/bin/env node
// BT3D 三维演示数据生成器。
//
// demo-3d/index.html 上出现的每一个数值、每一张盘面纹理，都来自这一个脚本的这一次实跑。
// 机制层公式一律调用 ../node/src/ 里的生产实现（encodeLayer / decodeLayer / deriveAffine /
// buildHeader / tagFromHeader），本文件只做「分层装配」与「取数」，不重写任何几何或密码原语。
//
//   用法：node demo-3d/build-data.mjs
//   产出：demo-3d/data.js（生成物，勿手改）+ stdout 的四挡实测指标与自检表
//   退出码：自检全部通过 0；任一 FAIL 1，并且**不写 data.js**
//
// 口径警告：本页数字与 ../node/README.md 第 11 章台账**不是同一次测量** —— 输入不同
// （那边是 node.exe 前 1 MiB，恰好整层，走不到末层代码路径；这边故意取前 1,117,504 B
// 让末层非空）。两处能互相印证的只有纯几何量：派生 a/b/aInv 与判据 2 的邻接统计，
// 它们只依赖固定的 (dek, nonce) 与 (a, b)，见自检 C4 与 C9。

import { writeFileSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync, constants as zconst } from 'node:zlib';

import {
  N, L, LAYER_BYTES, RING_COUNT, SEG_PER_LAYER, BLOCKS_PER_LAYER, HEADER_SIZE, CHACHA_BLOCK,
  modL, layerBytes as layerBytesOf, layerCountOf,
} from '../node/src/constants.js';
import { SEG_S, SEG_Q, SEG_QSTEP, SEG_LEN, SEG_TOTAL_LEN } from '../node/src/spiral.js';
import { deriveAffine } from '../node/src/affine.js';
import { MAX_LAYER } from '../node/src/keystream.js';
import { Scratch, encodeLayer, decodeLayer } from '../node/src/codec.js';
import { buildHeader, tagFromHeader } from '../node/src/header.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = Date.now();

// ---- 取数粒度（只是显示分辨率，不属于格式）----
const GRID = 128;  // 盘面纹理：128×128 单元，每单元 8×8 比特 = 8 个整字节，天然字节对齐
const FULL = 512;  // 邻接泄露图：512×512 单元，每单元 2×2 比特

// ---- 固定密钥材料（与 test/criteria.js、test/vectors.js 同一组）----
const FIXED_DEK = Buffer.from('BT3D-v1-fixed-dek-golden-vector!', 'ascii'); // 32 B
const FIXED_NONCE = Buffer.from('BT3D-nonce-1', 'ascii');                    // 12 B

// ---- 输入样本：8 满层 + 68,928 B 末层 = 1,117,504 B ----
// 末层非整层是刻意的：只有它非空，D2（秩压缩关）与 D3（秩压缩开）才有可见差别。
const INPUT_SIZE = 8 * LAYER_BYTES + 68928;

const POPCNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCNT[i] = POPCNT[i >> 1] + (i & 1);
const bitCount = (buf) => { let n = 0; for (let i = 0; i < buf.length; i++) n += POPCNT[buf[i]]; return n; };
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');

// 与 test/criteria.js 判据 3 同口径：zstd 级别 19
function zstdRatio(buf) {
  const c = zstdCompressSync(buf, { params: { [zconst.ZSTD_c_compressionLevel]: 19 } });
  return c.length / buf.length;
}
// 与 test/criteria.js 判据 1 同口径：8 字节窗口取 52 位安全整数作键，命中后再做字节级确认
const winKey = (b, i) => b.readUInt32LE(i) * 0x100000 + (b.readUInt32LE(i + 4) >>> 8);
function countCommonSubstrings(win, orig, payload, minLen = 8) {
  let hits = 0; let first = -1;
  for (let i = 0; i + minLen <= payload.length; i++) {
    if (win.has(winKey(payload, i)) && orig.indexOf(payload.subarray(i, i + minLen)) >= 0) {
      hits++;
      if (first < 0) first = i;
    }
  }
  return { hits, first };
}
function readSlice(path, len) {
  const fd = openSync(path, 'r');
  try {
    const b = Buffer.alloc(len);
    readSync(fd, b, 0, len, 0);
    return b;
  } finally { closeSync(fd); }
}

// =====================================================================
// 1) 输入
// =====================================================================
if (statSync(process.execPath).size < INPUT_SIZE) throw new Error(`node 可执行文件不足 ${INPUT_SIZE} B`);
const input = readSlice(process.execPath, INPUT_SIZE);
const layerCount = layerCountOf(input.length);
const lastBytes = layerBytesOf(input.length, layerCount - 1);
const LAST_BITS = lastBytes * 8;          // 末层真实比特数；秩压缩关掉时 [LAST_BITS, L) 全是补的
const INPUT_ONES = bitCount(input);
const inputOnesRatio = INPUT_ONES / (input.length * 8);
const inputZstd = zstdRatio(input);
const origWin = (() => {
  const win = new Set();
  for (let i = 0; i + 8 <= input.length; i++) win.add(winKey(input, i));
  return win;
})();

// =====================================================================
// 2) 几何取数
//    满层上秩压缩退化为恒等（README §7.4 / 判据 12），所以第 0 层的落点只由 (a,b) 决定。
// =====================================================================
function geomMaps(a, b) {
  const R = new Int32Array(L);              // R[s] = 第 s 个填充序比特在盘面上的存储序号
  for (let i = 0; i < SEG_PER_LAYER; i++) {
    let s = SEG_S[i];
    let r = (a * SEG_Q[i] + b) % L;
    const step = modL(a * SEG_QSTEP[i]);
    const len = SEG_LEN[i];
    for (let j = 0; j < len; j++) { R[s++] = r; r += step; if (r >= L) r -= L; }
  }

  // 判据 2：环形 |Δ| 分布。只适用于满层。
  const d = new Int32Array(L - 1);
  let eq1 = 0;
  for (let s = 0; s < L - 1; s++) {
    const diff = Math.abs(R[s + 1] - R[s]);
    const circ = Math.min(diff, L - diff);
    d[s] = circ;
    if (circ <= 1) eq1++;
  }
  d.sort();

  // 泄露盘面：来源相邻的两个比特（s−1 与 s）落点仍是邻接 ⇒ 标记 R[s] 所在单元
  const adj = new Uint8Array(FULL * FULL);
  for (let s = 1; s < L; s++) {
    const diff = Math.abs(R[s] - R[s - 1]);
    if (Math.min(diff, L - diff) > 1) continue;
    const pos = R[s];
    const x = pos % N;
    adj[(((pos - x) / N) >> 1) * FULL + (x >> 1)] = 1;
  }

  // 原文件前 128 字节（= 前 1024 比特）的落点，按 FULL 网格展平
  const front = new Uint32Array(1024);
  let onBottomRow = 0;
  for (let s = 0; s < 1024; s++) {
    const pos = R[s];
    const x = pos % N;
    if (pos === x) onBottomRow++;                      // pos < N ⇒ 还在 y=0 那一行
    front[s] = (((pos - x) / N) >> 1) * FULL + (x >> 1);
  }

  // 末层补满：秩压缩关掉时 s ∈ [LAST_BITS, L) 全是补出来的零，标记它们落在哪些 GRID 格子上（0..8 个字节）
  const padCells = new Uint8Array(GRID * GRID);
  for (let s = LAST_BITS; s < L; s++) {
    const pos = R[s];
    const x = pos % N;
    padCells[((((pos - x) / N) >> 3) * GRID) + (x >> 3)]++;
  }

  return { eq1Ratio: eq1 / (L - 1), median: d[(L - 1) >> 1], eq1, adj, front: Array.from(front), onBottomRow, padCells };
}

// =====================================================================
// 3) 四挡 flags 阶梯：每挡只比上一挡多开一个位
// =====================================================================
// encodeLayer/decodeLayer 需要的参数形状与 codec.js 内部 makeParams 一致：
// 派生值 (a,b,aInv) 再加上密钥材料本身（keystream.js 要 dek 与 nonce）。
const p = { ...deriveAffine(FIXED_DEK, FIXED_NONCE), dek: FIXED_DEK, nonce: FIXED_NONCE };
const scratch = new Scratch();
const geomCache = new Map();
const geomOf = (a, b) => {
  const k = `${a}:${b}`;
  if (!geomCache.has(k)) geomCache.set(k, geomMaps(a, b));
  return { key: k, ...geomCache.get(k) };
};

const VARIANTS = [
  { id: 'D1', name: '全关 · 最初的方案',      flags: 0x00, affine: false, rank: false, keystream: false },
  { id: 'D2', name: '＋仿射散射 bit3',        flags: 0x08, affine: true,  rank: false, keystream: false },
  { id: 'D3', name: '＋秩压缩 bit4',          flags: 0x18, affine: true,  rank: true,  keystream: false },
  { id: 'OK', name: '＋密钥流 bit2 = 规范 v1', flags: 0x1c, affine: true,  rank: true,  keystream: true },
];

function buildVariant(v) {
  const opts = { useAffine: v.affine, useKeystream: v.keystream };
  const a = v.affine ? p.a : 1;   // codec.js 的约定：a=1,b=0 即仿射退化为恒等光栅
  const b = v.affine ? p.b : 0;
  const segs = [];

  for (let layer = 0; layer < layerCount; layer++) {
    const off = layer * LAYER_BYTES;
    const nb = Math.min(LAYER_BYTES, input.length - off);
    const src = input.subarray(off, off + nb);
    if (!v.rank && nb < LAYER_BYTES) {
      // 秩压缩关掉 ⇒ 末层必须补满一整层，否则散落在 [0,2^20) 里的比特取不回来
      const pad = Buffer.alloc(LAYER_BYTES);
      src.copy(pad);
      segs.push(Buffer.from(encodeLayer(pad, L, layer, p, scratch, opts)));
    } else {
      segs.push(Buffer.from(encodeLayer(src, nb * 8, layer, p, scratch, opts)));
    }
  }

  // 自洽往返：四挡都应当绿，这正是「判据 5 抓不到混淆缺陷」的证据
  const out = Buffer.alloc(input.length);
  const dst = Buffer.alloc(LAYER_BYTES);
  for (let layer = 0; layer < layerCount; layer++) {
    const off = layer * LAYER_BYTES;
    const nb = Math.min(LAYER_BYTES, input.length - off);
    decodeLayer(segs[layer], segs[layer].length * 8, layer, p, scratch, dst, opts);
    dst.subarray(0, nb).copy(out, off);
  }

  const payload = Buffer.concat(segs);
  const front128 = payload.subarray(0, 128);
  let equalBytes = 0;
  for (let i = 0; i < 128; i++) if (front128[i] === input[i]) equalBytes++;
  const ones = bitCount(payload);

  return {
    v, a, b, segs, payload,
    geom: geomOf(a, b),
    containerLen: HEADER_SIZE + payload.length,
    lastStoredBytes: segs[segs.length - 1].length,
    roundtrip: out.equals(input),
    front128Copied: front128.equals(input.subarray(0, 128)),
    equalBytes,
    headHex: front128.toString('hex'),
    zstd: zstdRatio(payload),
    ones,
    onesRatio: ones / (payload.length * 8),
    common: countCommonSubstrings(origWin, input, payload),
  };
}

const built = VARIANTS.map(buildVariant);
const byId = Object.fromEntries(built.map((r) => [r.v.id, r]));

// 规范挡的 128 字节真实头部（含 tag），供「前 128 Byte 逐位」面板直接切片
const okHeader = buildHeader({ origSize: INPUT_SIZE, layerCount, dek: FIXED_DEK, nonce: FIXED_NONCE });
const okTag = tagFromHeader(okHeader, FIXED_DEK, [byId.OK.payload]);
okTag.copy(okHeader, 96);
// tag 落位后重算必须得到同一个值 —— 即「头部 + payload」的覆盖关系自洽
const tagRecheck = okTag.equals(tagFromHeader(okHeader, FIXED_DEK, [byId.OK.payload]));

// =====================================================================
// 4) 自检：任一 FAIL 就不出图
// =====================================================================
const M = (id) => byId[id].geom.median;
const E = (id) => byId[id].geom.eq1Ratio;
const checks = [
  {
    name: 'C1 螺旋段表正好覆盖一整层',
    pass: SEG_TOTAL_LEN === L,
    detail: `SEG_TOTAL_LEN = ${SEG_TOTAL_LEN.toLocaleString()}（应 ${L.toLocaleString()}）；N=${N} RING_COUNT=${RING_COUNT} SEG_PER_LAYER=${SEG_PER_LAYER}`,
  },
  {
    name: 'C2 派生 a 落在收窄区间且为奇数',
    pass: p.a % 2 === 1 && p.a >= 1 << 19 && p.a < 1 << 20,
    detail: `a=${p.a} 奇数=${p.a % 2 === 1} 2^19≤a<2^20 → ${p.a >= 524288 && p.a < 1048576}`,
  },
  {
    name: 'C3 模逆自洽 a·aInv ≡ 1 (mod 2^20)',
    pass: (p.a * p.aInv) % L === 1,
    detail: `aInv=${p.aInv} 乘积取模 = ${(p.a * p.aInv) % L}`,
  },
  {
    name: 'C4 派生值与仓库黄金向量台账同数',
    pass: p.a === 846561 && p.b === 70669 && p.aInv === 907553,
    detail: `本脚本 a/b/aInv = ${p.a}/${p.b}/${p.aInv}；README §11.4 = 846561/70669/907553`,
  },
  {
    name: 'C5 四挡各自自洽往返一致（这一条绿恰恰说明它没有区分力）',
    pass: built.every((r) => r.roundtrip),
    detail: built.map((r) => `${r.v.id}=${r.roundtrip}`).join(' '),
  },
  {
    name: 'C6 规范挡容器长度 = 输入 + 128',
    pass: byId.OK.containerLen === INPUT_SIZE + HEADER_SIZE,
    detail: `${byId.OK.containerLen.toLocaleString()} = ${INPUT_SIZE.toLocaleString()} + ${HEADER_SIZE}`,
  },
  {
    name: 'C7 秩压缩关 ⇒ 末层被补满一整层；开 ⇒ 精确 68,928 B',
    pass: byId.D1.lastStoredBytes === LAYER_BYTES && byId.D2.lastStoredBytes === LAYER_BYTES
      && byId.D3.lastStoredBytes === lastBytes && byId.OK.lastStoredBytes === lastBytes,
    detail: `末层落盘 D1=${byId.D1.lastStoredBytes} D2=${byId.D2.lastStoredBytes} D3=${byId.D3.lastStoredBytes} OK=${byId.OK.lastStoredBytes}`,
  },
  {
    name: 'C8 只有 D1 把原文件前 128 字节原样抄进容器',
    pass: byId.D1.front128Copied === true && !byId.D2.front128Copied && !byId.D3.front128Copied && !byId.OK.front128Copied,
    detail: `照抄 D1=${byId.D1.front128Copied} D2=${byId.D2.front128Copied} D3=${byId.D3.front128Copied} OK=${byId.OK.front128Copied}；D1 逐字节相同 ${byId.D1.equalBytes}/128`,
  },
  {
    name: 'C9 恒等邻接：无仿射挡 ≈50%，有仿射挡必须为 0 处且与 README §11.2 判据 2 同数',
    pass: E('D1') > 0.45 && M('D1') === 1 && byId.OK.geom.eq1 === 0 && M('OK') === 202015,
    detail: `|Δ|=1 占比 D1=${(E('D1') * 100).toFixed(4)}%（${byId.D1.geom.eq1.toLocaleString()} 对，中位数 ${M('D1')}） / OK=${byId.OK.geom.eq1} 对（中位数 ${M('OK')}，台账 202015）`,
  },
  {
    name: 'C10 只有密钥流挡让 payload 压不动',
    pass: byId.OK.zstd >= 0.98 && byId.D3.zstd < 0.98 && byId.D3.zstd > inputZstd,
    detail: `zstd-19 压缩比 原文=${inputZstd.toFixed(6)} → D1=${byId.D1.zstd.toFixed(6)} D2=${byId.D2.zstd.toFixed(6)} D3=${byId.D3.zstd.toFixed(6)} OK=${byId.OK.zstd.toFixed(6)}（阈值 0.98）`,
  },
  {
    name: 'C11 ≥8 B 公共子串：规范挡必须 0 处，D1 必须成规模',
    pass: byId.OK.common.hits === 0 && byId.D1.common.hits > 1000,
    detail: `D1=${byId.D1.common.hits} 处（首处 payload 偏移 ${byId.D1.common.first}） D2=${byId.D2.common.hits} D3=${byId.D3.common.hits} OK=${byId.OK.common.hits}`,
  },
  {
    name: 'C12 1 的个数只由密钥流改变；补满的全零会额外稀释占比（秩压缩关掉的次生指纹）',
    pass: byId.D1.ones === INPUT_ONES && byId.D2.ones === INPUT_ONES && byId.D3.ones === INPUT_ONES
      && Math.abs(byId.OK.onesRatio - 0.5) <= 0.01 && Math.abs(inputOnesRatio - 0.5) >= 0.05
      && byId.D3.onesRatio === inputOnesRatio && byId.D1.onesRatio < inputOnesRatio,
    detail: `1 的个数 原文=${INPUT_ONES.toLocaleString()} = D1 = D2 = D3（前四步只换位置，异或才改值）；`
      + `占比 原文=${(inputOnesRatio * 100).toFixed(3)}%（偏离 ${(Math.abs(inputOnesRatio - 0.5) * 100).toFixed(1)} pp）`
      + ` → D3=${(byId.D3.onesRatio * 100).toFixed(3)}%（长度未变，占比也不变）`
      + ` → D1=${(byId.D1.onesRatio * 100).toFixed(3)}%（个数相同但被 ${(byId.D1.lastStoredBytes - lastBytes).toLocaleString()} B 补满零稀释）`
      + ` → OK=${(byId.OK.onesRatio * 100).toFixed(3)}%`,
  },
  {
    name: 'C13 前 1024 比特落点：D1 全压在最外圈下边那一行，OK 散布全盘面',
    pass: byId.D1.geom.onBottomRow === 1024 && byId.OK.geom.onBottomRow < 64,
    detail: `落在 y=0 行 D1=${byId.D1.geom.onBottomRow}/1024  OK=${byId.OK.geom.onBottomRow}/1024`,
  },
  {
    name: 'C14 payload_tag 覆盖「tag 置零的头部 + 完整 payload」',
    pass: tagRecheck === true,
    detail: `tag=${okTag.toString('hex').slice(0, 32)}… 落位后重算相同 = ${tagRecheck}`,
  },
];

console.log(`\n=== BT3D 三维演示数据实跑 ===`);
console.log(`Node ${process.version}  ${process.platform} ${process.arch}`);
console.log(`输入 = ${process.execPath} 的前 ${INPUT_SIZE.toLocaleString()} B = ${layerCount} 层（末层 ${lastBytes.toLocaleString()} B）`);
console.log(`固定 dek=${FIXED_DEK.subarray(0, 8).toString('hex')}…  nonce=${FIXED_NONCE.toString('hex')}`);
console.log(`派生 a=${p.a} (0x${p.a.toString(16)})  b=${p.b} (0x${p.b.toString(16)})  aInv=${p.aInv}\n`);
console.log('--- 自检 ---');
for (const c of checks) console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.name}\n        ${c.detail}`);
const failed = checks.filter((c) => !c.pass);
console.log(`\n自检 ${checks.length - failed.length} / ${checks.length} 通过`);
if (failed.length) {
  console.error(`\n有 ${failed.length} 条 FAIL ⇒ 不写 data.js（宁可不出图，也不出一张说谎的图）`);
  process.exit(1);
}

// =====================================================================
// 5) 落 data.js
// =====================================================================
// 盘面纹理按「存储序号」铺 —— 也就是它在容器里真的怎么排，不是按来源 s 铺。
// 单元 (cx,cy) 覆盖 x∈[8cx,8cx+8)、y∈[8cy,8cy+8) ⇒ 正好 8 个整字节。
function valueCells(seg) {
  const g = new Uint8Array(GRID * GRID);
  const totalBytes = seg.length;
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      let sum = 0;
      for (let dy = 0; dy < 8; dy++) {
        const byteIndex = (cy * 8 + dy) * (N / 8) + cx;
        if (byteIndex >= totalBytes) break;
        sum += POPCNT[seg[byteIndex]];
      }
      g[cy * GRID + cx] = sum;
    }
  }
  return g;
}

const blobs = [];
const blobIndex = new Map();
function putBlob(u8orBuf) {
  const key = b64(u8orBuf);
  let i = blobIndex.get(key);
  if (i === undefined) { i = blobs.length; blobs.push(key); blobIndex.set(key, i); }
  return i;
}

const geomsOut = {};
for (const [key, g] of geomCache) {
  geomsOut[key] = {
    a: Number(key.split(':')[0]),
    eq1Ratio: g.eq1Ratio, median: g.median, onBottomRow: g.onBottomRow,
    adjBlob: putBlob(g.adj),
    padBlob: putBlob(g.padCells),
    front: g.front,
  };
}

const variantsOut = built.map((r) => ({
  ...r.v,
  geomKey: `${r.a}:${r.b}`,
  containerLen: r.containerLen,
  overhead: r.containerLen - INPUT_SIZE,
  lastStoredBytes: r.lastStoredBytes,
  roundtrip: r.roundtrip,
  front128Copied: r.front128Copied,
  equalBytes: r.equalBytes,
  headHex: r.headHex,
  zstd: r.zstd,
  ones: r.ones,
  onesRatio: r.onesRatio,
  hits: r.common.hits,
  hitsFirst: r.common.first,
  eq1Ratio: r.geom.eq1Ratio,
  medianDelta: r.geom.median,
  onBottomRow: r.geom.onBottomRow,
  layerBytesStored: r.segs.map((s) => s.length),
  layers: r.segs.map((seg) => putBlob(valueCells(seg))),
}));

const data = {
  meta: {
    builtAt: new Date().toISOString(),
    buildMs: Date.now() - T0,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    execPath: process.execPath,
    inputSize: INPUT_SIZE,
    inputHeadHex: input.subarray(0, 128).toString('hex'),
    inputOnesRatio,
    inputOnes: INPUT_ONES,
    inputZstd,
    layerCount,
    lastBytes,
    grid: GRID,
    full: FULL,
    const: { N, L, LAYER_BYTES, RING_COUNT, SEG_PER_LAYER, HEADER_SIZE, CHACHA_BLOCK, BLOCKS_PER_LAYER, MAX_LAYER },
    km: { dekHex: FIXED_DEK.toString('hex'), nonceHex: FIXED_NONCE.toString('hex') },
    derived: { a: p.a, b: p.b, aInv: p.aInv },
    headerHex: okHeader.toString('hex'),
    checks: checks.map((c) => ({ name: c.name, pass: c.pass, detail: c.detail })),
    note: '本页全部数值来自这一次实跑；输入取本机 node.exe 前缀，换机器重跑会变。与 ../node/README.md 第 11 章台账不是同一次测量。',
  },
  geoms: geomsOut,
  variants: variantsOut,
  blobs,
};

const json = JSON.stringify(data);
const outPath = join(HERE, 'data.js');
writeFileSync(outPath,
  `// 生成物，勿手改。由 node demo-3d/build-data.mjs 于 ${data.meta.builtAt} 产出。\n` +
  `window.BT3D_DEMO = ${json};\n`, 'utf8');

console.log(`\n已写出 ${outPath}`);
console.log(`  盘面纹理去重后 ${blobs.length} 个 blob，data.js ${(readFileSync(outPath).length / 1048576).toFixed(2)} MiB，总耗时 ${Date.now() - T0} ms`);

console.log('\n--- 四挡实测 ---');
console.log('挡位  flags  容器长度      末层落盘   前128B照抄  ≥8B子串   |Δ|=1占比   中位数   zstd压缩比  1占比     往返');
for (const r of built) {
  console.log(
    `${r.v.id.padEnd(4)} 0x${r.v.flags.toString(16).padStart(2, '0')}  ` +
    `${r.containerLen.toLocaleString().padStart(11)}  ${r.lastStoredBytes.toLocaleString().padStart(9)}  ` +
    `${String(r.front128Copied).padStart(9)}  ${r.common.hits.toLocaleString().padStart(8)}  ` +
    `${(r.geom.eq1Ratio * 100).toFixed(4).padStart(8)}%  ${r.geom.median.toLocaleString().padStart(7)}  ` +
    `${r.zstd.toFixed(6).padStart(9)}  ${(r.onesRatio * 100).toFixed(3).padStart(7)}%  ${r.roundtrip}`,
  );
}
