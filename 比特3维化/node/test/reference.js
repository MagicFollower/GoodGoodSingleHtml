// 慢路径参照实现。
//
// 这份代码**故意**低效：逐比特走 §5.5 的 sqrt 闭式，不用等差段递推。
// 它存在的唯一目的是给判据 10 提供一个独立真值 —— 若 codec.js 的 2048 段
// 快路径把段起点或公差算错，往返测试（判据 5）会照样绿（编解码同源出错），
// 只有与这份参照对拍才能抓到。

import { L, N } from '../src/constants.js';
import { spiralForwardSlow, spiralInverse } from '../src/spiral.js';
import { affineForward } from '../src/affine.js';
import { getBit, setBit } from '../src/codec.js';
import { RankIndex } from '../src/rank.js';

export function buildRankSlow(m, a, b) {
  const rank = new RankIndex();
  for (let s = 0; s < m; s++) {
    const [x, y] = spiralForwardSlow(s);
    rank.set(affineForward(y * N + x, a, b));
  }
  rank.build();
  return rank;
}

// 慢路径散射：返回存储序的打包字节（长度 m/8），不含密钥流
export function scatterSlow(src, m, a, b, useRank) {
  const dst = Buffer.alloc(m / 8);
  const rank = useRank ? buildRankSlow(m, a, b) : null;
  for (let s = 0; s < m; s++) {
    const [x, y] = spiralForwardSlow(s);
    const r = affineForward(y * N + x, a, b);
    setBit(dst, rank ? rank.rank(r) : r, getBit(src, s));
  }
  return dst;
}

// 慢路径聚集：src 是存储序打包字节，返回填充序打包字节
export function gatherSlow(src, m, a, b, useRank) {
  const dst = Buffer.alloc(m / 8);
  const rank = useRank ? buildRankSlow(m, a, b) : null;
  for (let s = 0; s < m; s++) {
    const [x, y] = spiralForwardSlow(s);
    const r = affineForward(y * N + x, a, b);
    setBit(dst, s, getBit(src, rank ? rank.rank(r) : r));
  }
  return dst;
}

// 判据 6：几何覆盖自证。逐 s 走闭式，检查越界与重复落点，并核对逆映射。
export function auditGeometry() {
  const seen = new Uint8Array(L);
  let placed = 0;
  for (let s = 0; s < L; s++) {
    const [x, y] = spiralForwardSlow(s);
    if (x < 0 || x >= N || y < 0 || y >= N) return { ok: false, why: `s=${s} 越界 (${x},${y})` };
    const q = y * N + x;
    if (seen[q]) return { ok: false, why: `s=${s} 与更早的 s 重复落在 q=${q}` };
    seen[q] = 1;
    placed++;
    if (spiralInverse(x, y) !== s) return { ok: false, why: `逆映射不一致 s=${s} (${x},${y})` };
  }
  if (placed !== L) return { ok: false, why: `落点数 ${placed} ≠ L ${L}` };
  return { ok: true, placed };
}

// 判据 11：仿射双射自证
export function auditAffineBijection(a, b) {
  const seen = new Uint8Array(L);
  let distinct = 0;
  for (let q = 0; q < L; q++) {
    const r = affineForward(q, a, b);
    if (r < 0 || r >= L) return { ok: false, why: `q=${q} 的 r=${r} 越界` };
    if (!seen[r]) { seen[r] = 1; distinct++; }
  }
  return { ok: distinct === L, distinct };
}

// 判据 7：手性自证。返回前 count 个比特的落点坐标。
export function firstCells(count, a, b) {
  const out = [];
  for (let s = 0; s < count; s++) {
    const [x, y] = spiralForwardSlow(s);
    out.push({ s, x, y, q: y * N + x, r: affineForward(y * N + x, a, b) });
  }
  return out;
}
