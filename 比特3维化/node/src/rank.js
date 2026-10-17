// 几何映射 III：秩压缩。口径见 ../../格式规格.md §7。
//
// 满层时 rank(r) 严格等于 r（§7.4），因此本模块在满层上是恒等变换；
// 判据 12 断言这一点。末层用 rank 把 m 个散射位置紧凑到 [0, m)，
// 使总大小精确为 origSize + 128 而非向上取整到 128 KiB 的倍数。

import { L } from './constants.js';

const WORD_BITS = 32;
export const WORDS = L / WORD_BITS; // 32768

// SWAR popcount。入参先 >>> 0 转无符号；每字节结果 ≤ 8，
// 故最后 v * 0x01010101 ≤ 0x08080808 * 0x01010101 ≈ 2.27e15 < 2^53，float64 精确。
function popcount32(v) {
  v = v >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return ((v * 0x01010101) >>> 24) & 0x3f;
}

export class RankIndex {
  constructor() {
    this.bitmap = new Uint32Array(WORDS);      // 128 KiB
    this.prefix = new Uint32Array(WORDS + 1);  // 128 KiB
    this.count = 0;
    this.built = false;
  }

  clear() {
    this.bitmap.fill(0);
    this.count = 0;
    this.built = false;
  }

  set(r) {
    this.bitmap[r >>> 5] |= 1 << (r & 31);
  }

  build() {
    let acc = 0;
    for (let j = 0; j < WORDS; j++) {
      this.prefix[j] = acc;
      acc += popcount32(this.bitmap[j]);
    }
    this.prefix[WORDS] = acc;
    this.count = acc;
    this.built = true;
  }

  // r -> r'（编码侧与解码侧共用；解码按 s 顺序遍历，因此不需要反函数 select）
  rank(r) {
    const j = r >>> 5;
    const b = r & 31;
    const mask = b === 0 ? 0 : ((1 << b) - 1);
    return this.prefix[j] + popcount32(this.bitmap[j] & mask);
  }
}
