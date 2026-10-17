// 缺陷注入参照实现。
//
// 这些**不是**本格式的合法变体，而是 deliberately broken 的版本，唯一用途是
// 证明判据会自己红 —— 一套永远不会失败的判据等于没有判据。
// 运行方式：node test/criteria.js --prove-red
//
// 注入的三个缺陷分别对应三类「往返测试抓不到」的错误：
//   D1/D2  缺 keystream        → 判据 5 绿，判据 1/3/4 红
//   D5     位序写成 LSB-first  → 判据 5 绿、判据 10 绿，只有黄金向量红
//   D6     圈内边序交换        → 判据 5 绿、判据 7 绿，只有判据 10 与黄金向量红

import { L, N, RING_COUNT, SEG_PER_LAYER } from '../src/constants.js';
import { SEG_S, SEG_Q, SEG_QSTEP, SEG_LEN, ringBase } from '../src/spiral.js';
import { getBit, setBit } from '../src/codec.js';

const modL = (v) => ((v % L) + L) % L;

const getBitLsb = (buf, i) => (buf[i >>> 3] >>> (i & 7)) & 1;
function setBitLsb(buf, i, v) {
  const j = i >>> 3;
  const m = 1 << (i & 7);
  if (v) buf[j] |= m;
  else buf[j] &= ~m;
}

// D6 的段表：把每圈的「右边」与「上边」的 s 区间对调。
// 每个 s 值仍被用且只用一次 ⇒ 双射；(x,y) 覆盖集合不变 ⇒ 不越界。
// 因此编解码同源时往返完美，但几何与 §5.5 的边序不符。
const D6_S = new Int32Array(SEG_PER_LAYER);
{
  let i = 0;
  for (let k = 0; k < RING_COUNT; k++) {
    const e = (N - 2 * k) - 1;
    const s0 = ringBase(k);
    D6_S[i++] = s0;          // 下边（正确）
    D6_S[i++] = s0 + 2 * e;  // 右边（缺陷：本该 s0 + e）
    D6_S[i++] = s0 + e;      // 上边（缺陷：本该 s0 + 2e）
    D6_S[i++] = s0 + 3 * e;  // 左边（正确）
  }
}

function scatterWith(sArr, src, dst, a, b, get, set) {
  for (let i = 0; i < SEG_PER_LAYER; i++) {
    let s = sArr[i];
    let r = (a * SEG_Q[i] + b) % L;
    const step = modL(a * SEG_QSTEP[i]);
    const len = SEG_LEN[i];
    for (let j = 0; j < len; j++) {
      set(dst, r, get(src, s));
      s++;
      r += step;
      if (r >= L) r -= L;
    }
  }
}

function gatherWith(sArr, src, dst, a, b, get, set) {
  for (let i = 0; i < SEG_PER_LAYER; i++) {
    let s = sArr[i];
    let r = (a * SEG_Q[i] + b) % L;
    const step = modL(a * SEG_QSTEP[i]);
    const len = SEG_LEN[i];
    for (let j = 0; j < len; j++) {
      set(dst, s, get(src, r));
      s++;
      r += step;
      if (r >= L) r -= L;
    }
  }
}

// D5：位序 LSB-first（违反约定 C2），几何正确
export const scatterD5 = (src, dst, a, b) => scatterWith(SEG_S, src, dst, a, b, getBitLsb, setBitLsb);
export const gatherD5 = (src, dst, a, b) => gatherWith(SEG_S, src, dst, a, b, getBitLsb, setBitLsb);

// D6：圈内边序交换，位序正确
export const scatterD6 = (src, dst, a, b) => scatterWith(D6_S, src, dst, a, b, getBit, setBit);
export const gatherD6 = (src, dst, a, b) => gatherWith(D6_S, src, dst, a, b, getBit, setBit);

// 对照：与 codec.js 内部同构但独立写一遍的正确满层散射
export const scatterOk = (src, dst, a, b) => scatterWith(SEG_S, src, dst, a, b, getBit, setBit);
