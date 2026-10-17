// 几何映射 II：仿射扫描 + 参数派生。口径见 ../../格式规格.md §6 与 §11。

import { hkdfSync } from 'node:crypto';
import { L, modL, HKDF_INFO_A, HKDF_INFO_B } from './constants.js';

// r = (a*q + b) mod 2^20
// a, q < 2^20 ⇒ a*q < 2^40 < 2^53，float64 精确（§14.1）
export const affineForward = (q, a, b) => (a * q + b) % L;

// q = a_inv * ((r - b) mod 2^20) mod 2^20
export const affineInverse = (r, aInv, b) => (aInv * modL(r - b)) % L;

// §11.2：Hensel 提升求 a^-1 mod 2^20。
// 每轮精度翻倍：1 -> 2 -> 4 -> 8 -> 16 -> 32，故 5 轮足够覆盖 2^20。
// 中间积 x*(2 - a*x) 可达 2^60 > 2^53，必须用 BigInt。
export function modInverse20(a) {
  const A = BigInt(a);
  const M = BigInt(L);
  let x = 1n;
  for (let i = 0; i < 5; i++) {
    x = (x * (2n - A * x)) % M;
    if (x < 0n) x += M;
  }
  return Number(x);
}

// §11.1：从 (dek, file_nonce) 派生 (a, b)。
// a 强制落在 [2^19, 2^20) 且为奇数，结构上排除小 a 导致的散射退化（§6.4）。
export function deriveAffine(dek, nonce) {
  const okmA = Buffer.from(hkdfSync('sha256', dek, nonce, HKDF_INFO_A, 32));
  const okmB = Buffer.from(hkdfSync('sha256', dek, nonce, HKDF_INFO_B, 32));

  const rawA = okmA.readBigUInt64LE(0);
  const rawB = okmB.readBigUInt64LE(0);

  const t = Number(rawA % BigInt(1 << 19));   // t ∈ [0, 2^19)
  const a = ((1 << 19) + t) | 1;              // a ∈ [2^19, 2^20)，恒奇
  const b = Number(rawB % BigInt(L));         // b ∈ [0, 2^20)

  return { a, b, aInv: modInverse20(a) };
}
