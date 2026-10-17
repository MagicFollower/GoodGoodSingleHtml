#!/usr/bin/env node
// BT3D v1 判据实跑脚本。口径见 ../../格式规格.md §13。
//
// 用法:
//   node test/criteria.js               跑判据 1~14
//   node test/criteria.js --prove-red   额外注入缺陷，证明判据会自己红
//
// 退出码：全部通过 0，任一失败 1。

import { zstdCompressSync, constants as zconst } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { openSync, readSync, closeSync } from 'node:fs';

import { L, N, LAYER_BYTES, HEADER_SIZE, SEG_PER_LAYER, modL, layerCountOf } from '../src/constants.js';
import { SEG_S, SEG_Q, SEG_QSTEP, SEG_LEN, SEG_TOTAL_LEN } from '../src/spiral.js';
import { deriveAffine, modInverse20, affineForward, affineInverse } from '../src/affine.js';
import { RankIndex, WORDS } from '../src/rank.js';
import { encodeBuffer, decodeBuffer, encodeLayer, Scratch } from '../src/codec.js';
import { chacha20Raw } from '../src/keystream.js';
import { auditGeometry, auditAffineBijection, firstCells, scatterSlow } from './reference.js';
import { scatterD5, gatherD5, scatterD6, gatherD6, scatterOk } from './defects.js';

const PROVE_RED = process.argv.includes('--prove-red');

// ---- 固定密钥材料（黄金向量与 prove-red 的可复现性依赖它）----
const FIXED_DEK = Buffer.from('BT3D-v1-fixed-dek-golden-vector!', 'ascii'); // 32 B
const FIXED_NONCE = Buffer.from('BT3D-nonce-1', 'ascii');                    // 12 B

// ---- 通用工具 ----
const POPCNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCNT[i] = POPCNT[i >> 1] + (i & 1);
const bitCount = (buf) => { let n = 0; for (let i = 0; i < buf.length; i++) n += POPCNT[buf[i]]; return n; };

// 8 字节窗口取 52 位安全整数作键（丢弃 8 位，命中后再做字节级确认）
const winKey = (b, i) => b.readUInt32LE(i) * 0x100000 + (b.readUInt32LE(i + 4) >>> 8);

function readSlice(path, len) {
  const fd = openSync(path, 'r');
  try {
    const b = Buffer.alloc(len);
    readSync(fd, b, 0, len, 0);
    return b;
  } finally { closeSync(fd); }
}

function zstdRatio(buf) {
  const c = zstdCompressSync(buf, { params: { [zconst.ZSTD_c_compressionLevel]: 19 } });
  return c.length / buf.length;
}

// ---- 测试数据 ----
const MiB = 1024 * 1024;
const exeSample = readSlice(process.execPath, MiB);              // 真 PE 二进制，开头是 MZ
const textSample = Buffer.from('BT3D 格式规格判据测试数据，重复度极高。'.repeat(40000)).subarray(0, MiB);
// 稀疏样本：90% 零 + 10% 递增字节。确定性构造（不用 randomBytes）以便复现。
// 1 占比 ≈ 0.9×0% + 0.1×50% = 5%，对判据 4 有 45pp 的区分余量。
const sparseSample = (() => {
  const b = Buffer.alloc(MiB);
  const zeroLen = Math.floor(MiB * 0.9);
  for (let i = zeroLen; i < MiB; i++) b[i] = (i - zeroLen) & 0xff;
  return b;
})();

const E5_SIZE = 37 * MiB + 1;   // 38,797,313 = 296 满层 + 1 字节末层（§13.2）
const boundaries = [
  { id: 'E1', size: 0, data: Buffer.alloc(0) },
  { id: 'E2', size: 1, data: Buffer.from([0xa5]) },
  { id: 'E3', size: LAYER_BYTES, data: Buffer.from(Array.from({ length: LAYER_BYTES }, (_, i) => i & 0xff)) },
  { id: 'E4', size: LAYER_BYTES + 1, data: null },
  { id: 'E5', size: E5_SIZE, data: null },
];
boundaries[3].data = Buffer.concat([boundaries[2].data, Buffer.from([0xff])]);
boundaries[4].data = randomBytes(E5_SIZE);

// ---- 结果收集 ----
const results = [];
function record(id, name, pass, evidence, ms) {
  results.push({ id, name, pass, evidence, ms });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] 判据 ${String(id).padStart(2)} ${name}  (${ms.toFixed(0)} ms)\n       ${evidence}`);
}
async function run(id, name, fn) {
  const t0 = process.hrtime.bigint();
  let pass = false; let evidence = '';
  try {
    const r = await fn();
    pass = r.pass; evidence = r.evidence;
  } catch (e) {
    evidence = `抛异常 ${e.name}: ${String(e.message).slice(0, 200)}`;
  }
  record(id, name, pass, evidence, Number(process.hrtime.bigint() - t0) / 1e6);
}

// =====================================================================
// 判据 1：恒等泄露 —— payload 与原文件之间不存在长度 ≥ 8 字节的公共子串
// =====================================================================
function commonSubstrings(orig, payload, minLen = 8) {
  const win = new Set();
  for (let i = 0; i + minLen <= orig.length; i++) win.add(winKey(orig, i));
  let hits = 0; let first = -1;
  for (let i = 0; i + minLen <= payload.length; i++) {
    if (win.has(winKey(payload, i)) && orig.indexOf(payload.subarray(i, i + minLen)) >= 0) {
      hits++;
      if (first < 0) first = i;
    }
  }
  return { hits, first };
}

// =====================================================================
// 判据 2：邻接保留 —— 满层 |Δ| 分布（只适用于满层，§13.3）
// =====================================================================
function adjacencyStats(a, b) {
  const R = new Int32Array(L);
  for (let i = 0; i < SEG_PER_LAYER; i++) {
    let r = (a * SEG_Q[i] + b) % L;
    const step = modL(a * SEG_QSTEP[i]);
    let s = SEG_S[i];
    const len = SEG_LEN[i];
    for (let j = 0; j < len; j++) { R[s++] = r; r += step; if (r >= L) r -= L; }
  }
  const d = new Int32Array(L - 1);
  let eq1 = 0;
  for (let s = 0; s < L - 1; s++) {
    const diff = Math.abs(R[s + 1] - R[s]);
    const circ = Math.min(diff, L - diff);   // 环形距离
    d[s] = circ;
    if (circ <= 1) eq1++;
  }
  d.sort();
  return { eq1Ratio: eq1 / (L - 1), median: d[(L - 1) >> 1] };
}

// =====================================================================
// 主流程
// =====================================================================
const km = { dek: FIXED_DEK, nonce: FIXED_NONCE };
const P = deriveAffine(FIXED_DEK, FIXED_NONCE);
const scratch = new Scratch();

console.log(`\n=== BT3D v1 判据实跑 ===`);
console.log(`Node ${process.version}  固定 DEK=${FIXED_DEK.toString('hex').slice(0, 16)}…  nonce=${FIXED_NONCE.toString('hex')}`);
console.log(`派生 a=${P.a} (0x${P.a.toString(16)}, 奇数=${P.a % 2 === 1})  b=${P.b}  aInv=${P.aInv}\n`);

// ---- 判据 1 ----
await run(1, '恒等泄露（无 ≥8B 公共子串）', () => {
  const c = encodeBuffer(exeSample, { keyMaterial: km, scratch });
  const p = c.subarray(HEADER_SIZE);
  const head128 = p.subarray(0, 128).equals(exeSample.subarray(0, 128));
  const { hits, first } = commonSubstrings(exeSample, p);
  return {
    pass: !head128 && hits === 0,
    evidence: `输入=node.exe 前 1 MiB（开头 "${exeSample.subarray(0, 2).toString('ascii')}"）；payload 前 128B 与原文前 128B 相同？${head128}；≥8B 公共子串命中 ${hits} 处${hits ? `，首处 payload 偏移 ${first}` : ''}`,
  };
});

// ---- 判据 2 ----
await run(2, '邻接保留（满层 |Δ|=1 占比 ≤1%，中位数 ≥256）', () => {
  const st = adjacencyStats(P.a, P.b);
  return {
    pass: st.eq1Ratio <= 0.01 && st.median >= 256,
    evidence: `满层 1,048,575 个相邻对：环形 |Δ|=1 占比 ${(st.eq1Ratio * 100).toFixed(4)}%（阈值 1%），中位数 ${st.median}（阈值 256）`,
  };
});

// ---- 判据 3 ----
await run(3, '熵代理（zstd -19 压缩比 ≥0.98）', () => {
  const rawText = zstdRatio(textSample);
  const c = encodeBuffer(textSample, { keyMaterial: km, scratch });
  const p = c.subarray(HEADER_SIZE);
  const ratio = zstdRatio(p);
  return {
    pass: ratio >= 0.98,
    evidence: `输入 1 MiB 高重复文本；原文压缩比 ${rawText.toFixed(6)} → payload 压缩比 ${ratio.toFixed(6)}（阈值 0.98）`,
  };
});

// ---- 判据 4 ----
// 前置条件：原文的 1 占比必须偏离 50% 至少 5 个百分点，否则该判据对此输入
// 不具备区分力，必须报「不适用」而不是报「通过」。
// 这条前置是从一次真实翻车加上的：最初用中文 UTF-8 文本当输入，而中文 UTF-8
// 的三字节序列本身就接近 50% 占比（实测 50.670%，只偏离 0.67 pp），
// 于是「有没有 keystream」在这个输入上根本测不出来。
await run(4, '位占比指纹（前置：原文偏离50%≥5pp；断言：payload 落在 50%±1pp）', () => {
  const one = (buf) => bitCount(buf) / (buf.length * 8) * 100;
  const lines = [];
  let allOk = true;
  for (const [name, orig] of [['node.exe 前1MiB', exeSample], ['稀疏样本(90%零)', sparseSample]]) {
    const c = encodeBuffer(orig, { keyMaterial: km, scratch });
    const p = c.subarray(HEADER_SIZE);
    const ro = one(orig);
    const rp = one(p);
    const precond = Math.abs(ro - 50) >= 5;
    const ok = precond && Math.abs(rp - 50) <= 1;
    if (!ok) allOk = false;
    lines.push(`${name}: 原文 ${ro.toFixed(3)}%（偏离 ${Math.abs(ro - 50).toFixed(3)}pp，前置${precond ? '成立' : '不成立→不适用'}）→ payload ${rp.toFixed(3)}%（偏离 ${Math.abs(rp - 50).toFixed(3)}pp，阈值 1pp）${ok ? '' : ' ✗'}`);
  }
  return { pass: allOk, evidence: lines.join('；') };
});

// ---- 判据 5 ----
await run(5, '往返（5 个边界文件逐字节相同）', () => {
  const lines = [];
  let allOk = true;
  for (const b of boundaries) {
    const t0 = process.hrtime.bigint();
    const c = encodeBuffer(b.data, { keyMaterial: km, scratch });
    const back = decodeBuffer(c, { scratch });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const sizeOk = c.length === b.size + HEADER_SIZE;
    const eq = back.equals(b.data) && back.length === b.size;
    const layers = layerCountOf(b.size);
    const hdrLayers = Number(c.readBigUInt64LE(16));
    if (!eq || !sizeOk || hdrLayers !== layers) allOk = false;
    lines.push(`${b.id} ${b.size}B: 容器=${c.length}B(${sizeOk ? '精确+128' : '偏' + (c.length - b.size)}) 层=${hdrLayers}/${layers} 还原${eq ? '一致' : '不一致'} ${ms.toFixed(0)}ms`);
  }
  return { pass: allOk, evidence: lines.join('；') };
});

// ---- 判据 6 ----
await run(6, '几何覆盖（去重落点数 = L，坐标不越界，逆映射一致）', () => {
  const g = auditGeometry();
  const segOk = SEG_TOTAL_LEN === L;
  return {
    pass: g.ok && segOk,
    evidence: `逐 s 走 sqrt 闭式 1,048,576 次：${g.ok ? `落点去重 ${g.placed} = L，无越界无重复，spiralInverse 全部一致` : g.why}；2048 段长度之和 = ${SEG_TOTAL_LEN}（应 ${L}）`,
  };
});

// ---- 判据 7 ----
await run(7, '手性（前 4 比特落点 (0,0)(1,0)(2,0)(3,0)）', () => {
  const cells = firstCells(4, P.a, P.b);
  const got = cells.map((c) => `(${c.x},${c.y})`).join(' ');
  const want = '(0,0) (1,0) (2,0) (3,0)';
  const qs = cells.map((c) => c.q).join(',');
  return {
    pass: got === want,
    evidence: `实测 ${got}；期望 ${want}；对应光栅序号 q = ${qs}（应为 0,1,2,3 —— 证明 y 升序底行优先，非图像光栅）`,
  };
});

// ---- 判据 8 ----
await run(8, '随机性（同文件两次编码 payload 不同；同密钥材料则相同）', () => {
  const a1 = encodeBuffer(exeSample.subarray(0, 4096), { scratch });
  const a2 = encodeBuffer(exeSample.subarray(0, 4096), { scratch });
  const differ = !a1.subarray(HEADER_SIZE).equals(a2.subarray(HEADER_SIZE));
  const nonceDiffer = !a1.subarray(32, 44).equals(a2.subarray(32, 44));
  const dekDiffer = !a1.subarray(64, 96).equals(a2.subarray(64, 96));
  const b1 = encodeBuffer(exeSample.subarray(0, 4096), { keyMaterial: km, scratch });
  const b2 = encodeBuffer(exeSample.subarray(0, 4096), { keyMaterial: km, scratch });
  const same = b1.equals(b2);
  return {
    pass: differ && nonceDiffer && dekDiffer && same,
    evidence: `随机密钥两次编码：payload 不同=${differ}，nonce 不同=${nonceDiffer}，dek 不同=${dekDiffer}；固定密钥材料两次编码：容器逐字节相同=${same}（可复现性）`,
  };
});

// ---- 判据 9 ----
await run(9, '完整性（翻转 payload / 头部任一比特都必须报错且不输出数据）', () => {
  const c = encodeBuffer(exeSample.subarray(0, 4096), { keyMaterial: km, scratch });
  const cases = [];
  const flip = (buf, off, bit) => { const b = Buffer.from(buf); b[off] ^= 1 << bit; return b; };
  for (const [name, mutated] of [
    ['payload 首字节 bit0', flip(c, HEADER_SIZE, 0)],
    ['payload 末字节 bit7', flip(c, c.length - 1, 7)],
    ['头部 origSize bit0', flip(c, 8, 0)],
    ['头部 flags bit2（关掉 keystream）', flip(c, 5, 2)],
    ['头部 reserved2 首字节', flip(c, 44, 0)],
  ]) {
    let outcome;
    try { const out = decodeBuffer(mutated, { scratch }); outcome = `未报错，还原 ${out.length} B（应为报错）`; }
    catch (e) { outcome = `${e.code || e.name}`; }
    cases.push(`${name} → ${outcome}`);
  }
  const allRejected = cases.every((s) => !s.includes('未报错'));
  return { pass: allRejected, evidence: cases.join('；') };
});

// ---- 判据 10 ----
await run(10, '快慢路径等价（2048 段等差 vs 逐比特 sqrt 闭式）', () => {
  const src = exeSample.subarray(0, LAYER_BYTES);
  // 满层：快路径（codec 内部走 scatterFull）vs 慢路径（reference 走 sqrt 闭式）
  const fastFull = encodeLayer(src, L, 0, { ...P, dek: FIXED_DEK, nonce: FIXED_NONCE }, scratch, { useKeystream: false });
  const slowFull = scatterSlow(src, L, P.a, P.b, false);
  const fullOk = fastFull.equals(slowFull);

  // 末层：m = 8000 比特（1000 字节），快路径走秩压缩，慢路径也走秩压缩
  const mSmall = 8000;
  const srcSmall = exeSample.subarray(0, mSmall / 8);
  const fastSmall = encodeLayer(srcSmall, mSmall, 0, { ...P, dek: FIXED_DEK, nonce: FIXED_NONCE }, scratch, { useKeystream: false });
  const slowSmall = scatterSlow(srcSmall, mSmall, P.a, P.b, true);
  const smallOk = fastSmall.equals(slowSmall);

  let firstDiff = -1;
  if (!fullOk) for (let i = 0; i < fastFull.length; i++) if (fastFull[i] !== slowFull[i]) { firstDiff = i; break; }
  return {
    pass: fullOk && smallOk,
    evidence: `满层 131072 B 逐字节相同=${fullOk}${firstDiff >= 0 ? `（首个差异在偏移 ${firstDiff}）` : ''}；末层 m=8000 逐字节相同=${smallOk}`,
  };
});

// ---- 判据 11 ----
// 除了双射，还要覆盖 §6.2 的逆变换。流式解码路径不用 affineInverse
// （解码按 s 顺序正向遍历段表），所以不加这条断言它就是完全未测的规格条款。
await run(11, '仿射双射 + 逆变换（去重计数 = L，inverse∘forward = id）', () => {
  const r = auditAffineBijection(P.a, P.b);
  const probes = [0, 1, 2, L - 2, L - 1, P.a % L, (P.b + 1) % L];
  for (let i = 0; i < 20000; i++) probes.push(randomBytes(4).readUInt32LE(0) % L);
  let badInv = 0; let badFirst = -1;
  for (const q of probes) {
    if (affineInverse(affineForward(q, P.a, P.b), P.aInv, P.b) !== q) { badInv++; if (badFirst < 0) badFirst = q; }
  }
  return {
    pass: r.ok && badInv === 0,
    evidence: `a=${P.a}（奇数=${P.a % 2 === 1}，∈[2^19,2^20)=${P.a >= (1 << 19) && P.a < L}）；去重后 r 计数 = ${r.distinct}（应 ${L}）；affineInverse∘affineForward 抽样 ${probes.length} 个 q（含 0/1/2/L−2/L−1 边界），失败 ${badInv} 个${badInv ? `（首个 q=${badFirst}）` : ''}`,
  };
});

// ---- 判据 12 ----
await run(12, '秩压缩满层退化（rank(r) === r 对全部 r 成立）', () => {
  const rank = new RankIndex();
  rank.clear();
  for (let i = 0; i < SEG_PER_LAYER; i++) {
    let r = (P.a * SEG_Q[i] + P.b) % L;
    const step = modL(P.a * SEG_QSTEP[i]);
    const len = SEG_LEN[i];
    for (let j = 0; j < len; j++) { rank.set(r); r += step; if (r >= L) r -= L; }
  }
  rank.build();
  let bad = 0; let firstBad = -1;
  for (let r = 0; r < L; r++) {
    if (rank.rank(r) !== r) { bad++; if (firstBad < 0) firstBad = r; }
  }
  return {
    pass: rank.count === L && bad === 0,
    evidence: `满层位图计数 = ${rank.count}（应 ${L}）；rank(r) ≠ r 的 r 个数 = ${bad}${firstBad >= 0 ? `（首个 ${firstBad}）` : ''}；前缀和末项 W[${WORDS}] = ${rank.prefix[WORDS]}`,
  };
});

// ---- 判据 13 ----
// 轮数断言不能用派生出的 a：实测 524,288 个奇数 a 中恰好 50%（262,144 个）
// 4 轮 Hensel 就已收敛，所以「4 轮必然不足」是个掷硬币式断言（本判据曾因此假失败）。
// 改用固定见证 a=3 + 对生产函数 modInverse20 的随机抽样。
await run(13, '派生确定性 + 模逆正确性（轮数见证 + 5000 抽样）', () => {
  const p2 = deriveAffine(FIXED_DEK, FIXED_NONCE);
  const same = p2.a === P.a && p2.b === P.b && p2.aInv === P.aInv;
  const prod = Number((BigInt(P.a) * BigInt(P.aInv)) % BigInt(L));
  const odd = P.a % 2 === 1;
  const inRange = P.a >= (1 << 19) && P.a < L;

  const henselN = (a, rounds) => {
    const A = BigInt(a); const M = BigInt(L); let x = 1n;
    for (let i = 0; i < rounds; i++) { x = (x * (2n - A * x)) % M; if (x < 0n) x += M; }
    return Number(x);
  };
  const w4 = Number((3n * BigInt(henselN(3, 4))) % BigInt(L));
  const w5 = Number((3n * BigInt(henselN(3, 5))) % BigInt(L));

  let bad = 0; let badFirst = -1;
  for (let i = 0; i < 5000; i++) {
    const a = (randomBytes(4).readUInt32LE(0) % (L - 1)) | 1; // 奇数，∈ [1, 2²⁰)
    const x = modInverse20(a);
    if (Number((BigInt(a) * BigInt(x)) % BigInt(L)) !== 1) { bad++; if (badFirst < 0) badFirst = a; }
  }

  return {
    pass: same && prod === 1 && odd && inRange && w4 !== 1 && w5 === 1 && bad === 0,
    evidence: `两次派生一致=${same}；a·aInv mod 2²⁰ = ${prod}（应 1）；a 奇数=${odd}；a∈[2¹⁹,2²⁰)=${inRange}；轮数见证 a=3：4 轮得 ${w4}（≠1 ⇒ 4 轮不足）、5 轮得 ${w5}；生产函数 modInverse20 抽样 5000 个随机奇数 a，失败 ${bad} 个${bad ? `（首个 a=${badFirst}）` : ''}`,
  };
});

// ---- 判据 14 ----
await run(14, 'ChaCha20 绑定符合 RFC 8439 §2.4.2', () => {
  const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
  const nonce = Buffer.from('000000000000004a00000000', 'hex');
  const pt = Buffer.from("4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e", 'hex');
  const want = '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0bf91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d807ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab77937365af90bbf74a35be6b40b8eedf2785e42874d';
  const got = chacha20Raw(key, nonce, 1, pt).toString('hex');
  return {
    pass: got === want,
    evidence: `IV 布局 = 计数器 u32 LE ‖ nonce 12B；密文前 16 B = ${got.slice(0, 32)}，与 RFC 期望一致=${got === want}`,
  };
});

// ---- 判据 15 ----
// 头部逐字段对齐 §4.1 的偏移表。
// 这条断言的是**规格一致性**而不是往返自洽：若 dimX 被写到偏移 26 而非 24，
// 编解码同源 ⇒ 判据 5 依然全绿，只有逐字段核对与黄金向量能抓到。
await run(15, '头部逐字段对齐 §4.1（12 个字段偏移全中）', () => {
  const probe = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
  const c = encodeBuffer(probe, { keyMaterial: km, scratch });
  const h = c.subarray(0, HEADER_SIZE);
  const rows = [
    ['0..3', 'magic', 'BT3D', h.toString('ascii', 0, 4)],
    ['4', 'version', '1', String(h[4])],
    ['5', 'flags', '0x1c', '0x' + h[5].toString(16)],
    ['6..7', 'reserved0/1', '0,0', `${h[6]},${h[7]}`],
    ['8..15', 'origSize', '8', String(Number(h.readBigUInt64LE(8)))],
    ['16..23', 'layerCount', '1', String(Number(h.readBigUInt64LE(16)))],
    ['24..27', 'dimX', '1024', String(h.readUInt32LE(24))],
    ['28..31', 'dimY', '1024', String(h.readUInt32LE(28))],
    ['32..43', 'file_nonce', FIXED_NONCE.toString('hex'), h.subarray(32, 44).toString('hex')],
    ['44..63', 'reserved2 全零', 'true', String(h.subarray(44, 64).every((x) => x === 0))],
    ['64..95', 'dek', FIXED_DEK.toString('hex'), h.subarray(64, 96).toString('hex')],
    ['96..127', 'payload_tag 非全零', 'true', String(!h.subarray(96, 128).every((x) => x === 0))],
  ];
  const bad = rows.filter(([, , want, got]) => want !== got);
  return {
    pass: bad.length === 0 && h.length === HEADER_SIZE,
    evidence: bad.length === 0
      ? `${rows.length} 个字段偏移全部匹配（magic/version/flags/reserved/origSize/layerCount/dimX/dimY/nonce/reserved2/dek/tag），头部长度 ${h.length} B`
      : `不匹配 ${bad.length} 处：${bad.map(([off, n, w, g]) => `${off} ${n} 期望 ${w} 实得 ${g}`).join('；')}`,
  };
});

// =====================================================================
// prove-red：证明上面这些判据会自己红
// =====================================================================
if (PROVE_RED) {
  console.log('\n=== 缺陷注入自证（prove-red）===');
  console.log('目的：证明判据不是恒真。每个变体都用同一套判据函数评估。\n');

  const redResults = [];
  const evalVariant = (label, container, opts, scatterForGeo) => {
    const p = container.subarray(HEADER_SIZE);
    const c1 = commonSubstrings(exeSample, p);
    const head128 = p.subarray(0, 128).equals(exeSample.subarray(0, 128));
    const c3 = zstdRatio(p);
    const c3raw = zstdRatio(exeSample);
    const ro = bitCount(exeSample) / (exeSample.length * 8) * 100;
    const rp = bitCount(p) / (p.length * 8) * 100;
    const c4 = Math.abs(rp - ro);
    let c5;
    try { c5 = decodeBuffer(container, { ...opts, scratch }).equals(exeSample) ? '往返一致' : '往返不一致'; }
    catch (e) { c5 = `解码抛错 ${e.code || e.name}`; }
    redResults.push({
      label,
      c1: head128 || c1.hits > 0 ? `红（前128B照抄=${head128}，≥8B公共子串 ${c1.hits} 处）` : '绿',
      c3: c3 >= 0.98 ? '绿' : `红（压缩比 ${c3.toFixed(4)}，原文 ${c3raw.toFixed(4)}）`,
      c4: c4 >= 5 ? '绿' : `红（原文占比 ${ro.toFixed(3)}% 偏离50%达 ${Math.abs(ro - 50).toFixed(3)}pp 前置成立，payload ${rp.toFixed(3)}%，差仅 ${c4.toFixed(3)}pp）`,
      c5,
    });
  };

  const optsD1 = { keyMaterial: km, scratch, useAffine: false, useKeystream: false };
  const optsD2 = { keyMaterial: km, scratch, useAffine: true, useKeystream: false };
  const optsOk = { keyMaterial: km, scratch };

  evalVariant('D1 纯螺旋+纯光栅，无仿射无keystream（最初的方案）', encodeBuffer(exeSample, optsD1), optsD1);
  evalVariant('D2 有仿射散射，无 keystream（只转置不加密）', encodeBuffer(exeSample, optsD2), optsD2);
  evalVariant('OK 规范实现（仿射+秩压缩+keystream）', encodeBuffer(exeSample, optsOk), optsOk);

  const w = 46;
  console.log('变体'.padEnd(w - 2) + '判据1  判据3  判据4  判据5');
  for (const r of redResults) {
    console.log(`${r.label.padEnd(w - dispLen(r.label))}${r.c1.split('（')[0].padEnd(7)}${r.c3.split('（')[0].padEnd(7)}${r.c4.split('（')[0].padEnd(7)}${r.c5}`);
  }
  console.log('\n明细：');
  for (const r of redResults) console.log(`  ${r.label}\n    判据1 ${r.c1}\n    判据3 ${r.c3}\n    判据4 ${r.c4}\n    判据5 ${r.c5}`);

  // D5 / D6：几何与位序类缺陷，判据 5 全绿，只有对拍能抓
  console.log('\n--- D5 / D6：往返绿但对拍红 ---');
  const srcFull = exeSample.subarray(0, LAYER_BYTES);
  const ref = scatterSlow(srcFull, L, P.a, P.b, false);
  const bufOk = Buffer.alloc(LAYER_BYTES);
  const bufD6 = Buffer.alloc(LAYER_BYTES);
  scatterOk(srcFull, bufOk, P.a, P.b);
  scatterD6(srcFull, bufD6, P.a, P.b);

  // D6 的往返：用同一套错误段表做聚集
  const backD6 = Buffer.alloc(LAYER_BYTES);
  gatherD6(bufD6, backD6, P.a, P.b);
  console.log(`D6 圈内边序交换：`);
  console.log(`  与慢路径参照逐字节相同 = ${bufD6.equals(ref)}（判据 10 应为红 → ${bufD6.equals(ref) ? '判据失效!' : '判据 10 红 ✓'}）`);
  console.log(`  D6 自洽往返一致 = ${backD6.equals(srcFull)}（判据 5 仍绿 ⇒ 往返测试抓不到）`);
  console.log(`  对照 scatterOk 与慢路径相同 = ${bufOk.equals(ref)}`);

  // D5 的往返
  const bufD5 = Buffer.alloc(LAYER_BYTES);
  scatterD5(srcFull, bufD5, P.a, P.b);
  const backD5 = Buffer.alloc(LAYER_BYTES);
  gatherD5(bufD5, backD5, P.a, P.b);
  console.log(`D5 位序 LSB-first：`);
  console.log(`  与规范输出逐字节相同 = ${bufD5.equals(bufOk)}（黄金向量应为红 → ${bufD5.equals(bufOk) ? '黄金向量失效!' : '黄金向量红 ✓'}）`);
  console.log(`  D5 自洽往返一致 = ${backD5.equals(srcFull)}（判据 5 仍绿 ⇒ 往返测试抓不到）`);
  console.log(`  首个差异字节偏移 = ${firstDiffIndex(bufD5, bufOk)}`);
}

function dispLen(s) { let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1; return n; }
function firstDiffIndex(x, y) {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return i;
  return -1;
}

// =====================================================================
// 汇总
// =====================================================================
const failed = results.filter((r) => !r.pass);
console.log(`\n=== 汇总 ===`);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
const totalMs = results.reduce((s, r) => s + r.ms, 0);
console.log(`判据总耗时 ${totalMs.toFixed(0)} ms`);
if (failed.length) {
  console.log(`失败项：${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('全部判据通过');
