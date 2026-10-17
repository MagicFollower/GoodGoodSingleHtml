// BT3D v1 常量。所有数值口径见 ../../格式规格.md §2.3。

export const N = 1024;
export const L = N * N;                 // 1048576 = 2^20 比特/层
export const LAYER_BYTES = L / 8;       // 131072 = 128 KiB
export const RING_COUNT = N / 2;        // 512
export const SEG_PER_LAYER = RING_COUNT * 4; // 2048
export const HEADER_SIZE = 128;
export const CHACHA_BLOCK = 64;
export const BLOCKS_PER_LAYER = LAYER_BYTES / CHACHA_BLOCK; // 2048

export const MAGIC = 'BT3D';
export const VERSION = 1;

// flags（§4.2）
export const F_SPIRAL_CW = 0x01;
export const F_BIT_LSB_FIRST = 0x02;
export const F_KEYSTREAM_ON = 0x04;
export const F_AFFINE_ON = 0x08;
export const F_RANK_COMPACT = 0x10;
export const F_COMPRESSED = 0x20;
export const F_RESERVED6 = 0x40;
export const F_RESERVED7 = 0x80;

export const FLAGS_NORMATIVE = F_KEYSTREAM_ON | F_AFFINE_ON | F_RANK_COMPACT; // 0x1C
// 必零位掩码由各标志位常量算出，不写死字面量。
// 规格初稿曾把它写成 0xC3（漏掉 F_COMPRESSED），后果见 §4.2 的说明；
// 这样写让那类错误在结构上不可能发生，并被下面的加载期断言守住。
export const FLAGS_MUST_BE_ZERO =
  F_SPIRAL_CW | F_BIT_LSB_FIRST | F_COMPRESSED | F_RESERVED6 | F_RESERVED7;

if ((FLAGS_NORMATIVE | FLAGS_MUST_BE_ZERO) !== 0xff) {
  throw new Error('flags 的两个掩码未覆盖全部 8 位');
}
if ((FLAGS_NORMATIVE & FLAGS_MUST_BE_ZERO) !== 0) {
  throw new Error('flags 的两个掩码互相重叠');
}

// 头部字段偏移（§4.1）
export const OFF_MAGIC = 0;
export const OFF_VERSION = 4;
export const OFF_FLAGS = 5;
export const OFF_RESERVED0 = 6;
export const OFF_ORIG_SIZE = 8;
export const OFF_LAYER_COUNT = 16;
export const OFF_DIM_X = 24;
export const OFF_DIM_Y = 28;
export const OFF_NONCE = 32;
export const OFF_RESERVED2 = 44;
export const LEN_RESERVED2 = 20;
export const OFF_DEK = 64;
export const LEN_DEK = 32;
export const OFF_TAG = 96;
export const LEN_TAG = 32;

export const HKDF_INFO_A = Buffer.from('BT3D-v1-scan-a', 'ascii');
export const HKDF_INFO_B = Buffer.from('BT3D-v1-scan-b', 'ascii');

export class Bt3dError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Bt3dError';
    this.code = code;
  }
}

export const layerBytes = (origSize, layer) =>
  Math.min(origSize - layer * LAYER_BYTES, LAYER_BYTES);

export const layerCountOf = (origSize) => Math.ceil(origSize / LAYER_BYTES);

// 负数安全取模。C/JS/Rust 对负数取模的行为不一，一律走这个（§14.3 第 3 条）。
export const modL = (v) => ((v % L) + L) % L;
