// BT3D v1 独立编码器（单文件，零依赖，CommonJS）。
//
// 本文件是自包含的：只使用 Node 内置模块 node:crypto / node:fs / node:path，
// 不 import 本工程任何其他文件。任何项目拷走这一个文件就能用。
//
//   const { encodeFile } = require('./bt3d-encode.js');
//   await encodeFile('a.jpg');              // → a.jpg.bt3d
//   await encodeFile('a.jpg', 'b/a.enc');   // 显式指定输出名
//   const container = encodeBuffer(buf);    // 内存态
//
// ESM 侧：
//   import bt3dEncode from './bt3d-encode.js';
//   import { encodeFile } from './bt3d-encode.js';   // 命名导入（CJS 具出导出）
//
// 与 node/src/ 参考实现的字节级一致性由 sdk/README.md 里的对拍实验证明。
// 格式口径：../格式规格.md §4~§10。

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// =====================================================================
// 1. 常量（§2.3 / §4.1）
// =====================================================================

const N = 1024;
const L = N * N;                       // 1 048 576 比特/层 = 2^20
const LAYER_BYTES = L / 8;             // 131 072 字节 = 128 KiB
const RING_COUNT = N / 2;              // 512
const SEG_PER_LAYER = RING_COUNT * 4;  // 2048
const HEADER_SIZE = 128;
const CHACHA_BLOCK = 64;
const BLOCKS_PER_LAYER = LAYER_BYTES / CHACHA_BLOCK; // 2048
const MAX_LAYER = Math.floor(0x100000000 / BLOCKS_PER_LAYER); // 2 097 152

const MAGIC = 'BT3D';
const VERSION = 1;

// flags：本实现只产出「密钥流 + 仿射 + 秩压缩」这一组规范位（§4.2）
const FLAGS_NORMATIVE = 0x04 | 0x08 | 0x10; // 0x1C
const FLAGS_MUST_BE_ZERO = 0x01 | 0x02 | 0x20 | 0x40 | 0x80;

const OFF_MAGIC = 0, OFF_VERSION = 4, OFF_FLAGS = 5, OFF_RESERVED0 = 6;
const OFF_ORIG_SIZE = 8, OFF_LAYER_COUNT = 16, OFF_DIM_X = 24, OFF_DIM_Y = 28;
const OFF_NONCE = 32, OFF_RESERVED2 = 44, LEN_RESERVED2 = 20;
const OFF_DEK = 64, LEN_DEK = 32, OFF_TAG = 96, LEN_TAG = 32;
const LEN_NONCE = 12;

const HKDF_INFO_A = Buffer.from('BT3D-v1-scan-a', 'ascii');
const HKDF_INFO_B = Buffer.from('BT3D-v1-scan-b', 'ascii');

const SUFFIX = '.bt3d';

class Bt3dError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Bt3dError';
    this.code = code;
  }
}

const layerBytes = (origSize, layer) => Math.min(origSize - layer * LAYER_BYTES, LAYER_BYTES);
const layerCountOf = (origSize) => Math.ceil(origSize / LAYER_BYTES);
const modL = (v) => ((v % L) + L) % L;

// =====================================================================
// 2. 几何映射 I：螺旋 → 2048 个等差段（§5.5 / §9.3）
//
// 一层 = 2048 个段，段内只有 s++ / r += step 两种加法。
// 这里不出现 sqrt：段首用解析式直接算出，因此跨平台不会有浮点差异。
// =====================================================================

const ringBase = (k) => 4 * k * (N - k);

const SEG_S = new Int32Array(SEG_PER_LAYER);
const SEG_Q = new Int32Array(SEG_PER_LAYER);
const SEG_QSTEP = new Int32Array(SEG_PER_LAYER);
const SEG_LEN = new Int32Array(SEG_PER_LAYER);

let SEG_TOTAL_LEN = 0;
{
  let i = 0;
  for (let k = 0; k < RING_COUNT; k++) {
    const m = N - 2 * k;
    const e = m - 1;
    const s0 = ringBase(k);
    const hi = k + m - 1;

    SEG_S[i] = s0;         SEG_Q[i] = k * N + k;   SEG_QSTEP[i] = 1;  SEG_LEN[i] = e; i++;
    SEG_S[i] = s0 + e;     SEG_Q[i] = k * N + hi;  SEG_QSTEP[i] = N;  SEG_LEN[i] = e; i++;
    SEG_S[i] = s0 + 2 * e; SEG_Q[i] = hi * N + hi; SEG_QSTEP[i] = -1; SEG_LEN[i] = e; i++;
    SEG_S[i] = s0 + 3 * e; SEG_Q[i] = hi * N + k;  SEG_QSTEP[i] = -N; SEG_LEN[i] = e; i++;

    SEG_TOTAL_LEN += 4 * e;
  }
  if (i !== SEG_PER_LAYER) throw new Error(`段数不符：${i} != ${SEG_PER_LAYER}`);
  if (SEG_TOTAL_LEN !== L) throw new Error(`段长之和 ${SEG_TOTAL_LEN} != L ${L}`);
}

// =====================================================================
// 3. 位存取：MSB-first（约定 C2）
// =====================================================================

const getBit = (buf, i) => (buf[i >>> 3] >>> (7 - (i & 7))) & 1;

function setBit(buf, i, v) {
  const j = i >>> 3;
  const m = 1 << (7 - (i & 7));
  if (v) buf[j] |= m;
  else buf[j] &= ~m;
}

// =====================================================================
// 4. 几何映射 II：仿射与参数派生（§6 / §11）
// =====================================================================

// Hensel/Newton 提升求 a^-1 mod 2^20。每轮精度翻倍 1→2→4→8→16→32，故 5 轮。
// 中间积 x*(2-a*x) 可达 2^60 > 2^53，必须走 BigInt。
function modInverse20(a) {
  const A = BigInt(a), M = BigInt(L);
  let x = 1n;
  for (let i = 0; i < 5; i++) {
    x = (x * (2n - A * x)) % M;
    if (x < 0n) x += M;
  }
  return Number(x);
}

function deriveAffine(dek, nonce) {
  const okmA = Buffer.from(crypto.hkdfSync('sha256', dek, nonce, HKDF_INFO_A, 32));
  const okmB = Buffer.from(crypto.hkdfSync('sha256', dek, nonce, HKDF_INFO_B, 32));
  const t = Number(okmA.readBigUInt64LE(0) % BigInt(1 << 19));
  const a = ((1 << 19) + t) | 1;              // a ∈ [2^19, 2^20) 且恒为奇数
  const b = Number(okmB.readBigUInt64LE(0) % BigInt(L));
  return { a, b, aInv: modInverse20(a) };
}

// =====================================================================
// 5. 几何映射 III：秩压缩（§7）
//
// 末层只有 m 个散射位置，rank() 把它们紧凑到 [0, m)，使容器长度精确等于
// origSize + 128。满层时位图全 1，rank(r) ≡ r，这一段整体退化为恒等。
// =====================================================================

const WORD_BITS = 32;
const WORDS = L / WORD_BITS; // 32768

function popcount32(v) {
  v = v >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return ((v * 0x01010101) >>> 24) & 0x3f;
}

class RankIndex {
  constructor() {
    this.bitmap = new Uint32Array(WORDS);
    this.prefix = new Uint32Array(WORDS + 1);
    this.count = 0;
  }
  clear() { this.bitmap.fill(0); this.count = 0; }
  set(r) { this.bitmap[r >>> 5] |= 1 << (r & 31); }
  build() {
    let acc = 0;
    for (let j = 0; j < WORDS; j++) {
      this.prefix[j] = acc;
      acc += popcount32(this.bitmap[j]);
    }
    this.prefix[WORDS] = acc;
    this.count = acc;
  }
  rank(r) {
    const j = r >>> 5, b = r & 31;
    const mask = b === 0 ? 0 : ((1 << b) - 1);
    return this.prefix[j] + popcount32(this.bitmap[j] & mask);
  }
}

// =====================================================================
// 6. 密钥流 ChaCha20（§8）
//
// OpenSSL 绑定的 IV 布局是 块计数器 u32 LE (4B) ‖ nonce (12B)，
// 已对 RFC 8439 §2.4.2 向量逐字节验证。换一种拼法就解不开别人的容器。
// =====================================================================

function counterBaseOf(layer) {
  if (layer >= MAX_LAYER) {
    throw new Bt3dError('COUNTER_OVERFLOW', `层号 ${layer} 超出 32 位块计数器上限（payload > 256 GiB）`);
  }
  return layer * BLOCKS_PER_LAYER;
}

function applyKeystream(buf, dek, nonce, layer) {
  const iv = Buffer.allocUnsafe(16);
  iv.writeUInt32LE(counterBaseOf(layer), 0);
  nonce.copy(iv, 4);
  const cipher = crypto.createCipheriv('chacha20', dek, iv);
  const out = cipher.update(buf);
  cipher.final(); // 流密码返回空，调用它是为触发 OpenSSL 的状态校验
  return out;
}

// =====================================================================
// 7. 头部（§4）
// =====================================================================

function newKeyMaterial() {
  return { dek: crypto.randomBytes(LEN_DEK), nonce: crypto.randomBytes(LEN_NONCE) };
}

function buildHeader({ origSize, layerCount, dek, nonce }) {
  const h = Buffer.alloc(HEADER_SIZE); // alloc ⇒ 保留字段天然为 0
  h.write(MAGIC, OFF_MAGIC, 4, 'ascii');
  h[OFF_VERSION] = VERSION;
  h[OFF_FLAGS] = FLAGS_NORMATIVE;
  h.writeBigUInt64LE(BigInt(origSize), OFF_ORIG_SIZE);
  h.writeBigUInt64LE(BigInt(layerCount), OFF_LAYER_COUNT);
  h.writeUInt32LE(N, OFF_DIM_X);
  h.writeUInt32LE(N, OFF_DIM_Y);
  nonce.copy(h, OFF_NONCE);
  dek.copy(h, OFF_DEK);
  return h;
}

function beginTag(dek, headerWithTagZeroed) {
  const mac = crypto.createHmac('sha256', dek);
  mac.update(headerWithTagZeroed);
  return mac;
}

// =====================================================================
// 8. 散射（编码侧，§9.2 / §9.4）
// =====================================================================

const segR0 = (i, a, b) => (a * SEG_Q[i] + b) % L;
const segRStep = (i, a) => modL(a * SEG_QSTEP[i]);

function scatterFull(src, dst, a, b) {
  for (let i = 0; i < SEG_PER_LAYER; i++) {
    let s = SEG_S[i];
    let r = segR0(i, a, b);
    const step = segRStep(i, a);
    const len = SEG_LEN[i];
    for (let j = 0; j < len; j++) {
      setBit(dst, r, getBit(src, s));
      s++;
      r += step;
      if (r >= L) r -= L;
    }
  }
}

// 两趟：第一趟只置位图算秩，第二趟才按 rank(r) 落位。
// 必须两趟是因为 rank 需要完整位图，而位图依赖整层散射结果。
function scatterRank(src, dst, m, a, b, rank) {
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0) rank.clear();
    for (let i = 0; i < SEG_PER_LAYER && SEG_S[i] < m; i++) {
      let s = SEG_S[i];
      let r = segR0(i, a, b);
      const step = segRStep(i, a);
      const len = Math.min(SEG_LEN[i], m - SEG_S[i]);
      for (let j = 0; j < len; j++) {
        if (pass === 0) rank.set(r);
        else setBit(dst, rank.rank(r), getBit(src, s));
        s++;
        r += step;
        if (r >= L) r -= L;
      }
    }
    if (pass === 0) {
      rank.build();
      if (rank.count !== m) throw new Bt3dError('RANK_COUNT', `秩压缩位图计数 ${rank.count} ≠ m ${m}`);
    }
  }
}

class Scratch {
  constructor() {
    this.layer = Buffer.alloc(LAYER_BYTES);
    this.rank = new RankIndex();
  }
}

// 单层：src 为该层原始字节（长度 m/8），返回落盘的 m/8 字节
function encodeLayer(src, m, layer, p, scratch) {
  const O = scratch.layer;
  O.fill(0, 0, m / 8);
  if (m === L) scatterFull(src, O, p.a, p.b);
  else scatterRank(src, O, m, p.a, p.b, scratch.rank);
  const packed = O.subarray(0, m / 8);
  return applyKeystream(packed, p.dek, p.nonce, layer);
}

// =====================================================================
// 9. 对外 API
// =====================================================================

/** 缺省容器名：源文件名（含后缀）+ .bt3d，落在同一目录 */
function defaultOutPath(inPath) {
  return inPath + SUFFIX;
}

function assertDistinct(inPath, outPath) {
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[.]+$/, '');
  if (norm(inPath) === norm(outPath)) {
    throw new Bt3dError('SAME_PATH', '输入与输出是同一个文件，编码会就地毁掉源文件（本工具不做原地覆盖）');
  }
}

/**
 * 内存态编码。opts.keyMaterial = { dek: Buffer(32), nonce: Buffer(12) } 可复现输出。
 * @returns {Buffer} 完整容器（128 字节头 + payload）
 */
function encodeBuffer(input, opts = {}) {
  const origSize = input.length;
  const layerCount = layerCountOf(origSize);
  const km = opts.keyMaterial ?? newKeyMaterial();
  const header = buildHeader({ origSize, layerCount, dek: km.dek, nonce: km.nonce });
  const p = { ...km, ...deriveAffine(km.dek, km.nonce) };
  const scratch = opts.scratch ?? new Scratch();

  const mac = beginTag(km.dek, header);
  const segs = [];
  for (let layer = 0; layer < layerCount; layer++) {
    const off = layer * LAYER_BYTES;
    const src = input.subarray(off, Math.min(off + LAYER_BYTES, origSize));
    const seg = encodeLayer(src, src.length * 8, layer, p, scratch);
    mac.update(seg);
    segs.push(seg);
  }
  mac.digest().copy(header, OFF_TAG);
  return Buffer.concat([header, ...segs]);
}

async function readAt(fh, buf, len, position) {
  let off = 0;
  while (off < len) {
    const { bytesRead } = await fh.read(buf, off, len - off, position + off);
    if (bytesRead === 0) throw new Bt3dError('EOF', `读取提前结束（还差 ${len - off} 字节）`);
    off += bytesRead;
  }
}

/**
 * 流式编码：常驻内存与文件大小无关（一个 128 KiB 层缓冲 + 256 KiB 秩索引）。
 * @param {string} inPath   源文件
 * @param {string} [outPath] 省略时 = defaultOutPath(inPath)
 * @returns {Promise<{origSize:number, layerCount:number, outSize:number, outPath:string}>}
 */
async function encodeFile(inPath, outPath, opts = {}) {
  const out = outPath ?? defaultOutPath(inPath);
  assertDistinct(inPath, out);

  const { size: origSize } = await fs.promises.stat(inPath);
  const layerCount = layerCountOf(origSize);
  const km = opts.keyMaterial ?? newKeyMaterial();
  const header = buildHeader({ origSize, layerCount, dek: km.dek, nonce: km.nonce });
  const p = { ...km, ...deriveAffine(km.dek, km.nonce) };
  const scratch = opts.scratch ?? new Scratch();
  const mac = beginTag(km.dek, header);

  const buf = Buffer.alloc(LAYER_BYTES);
  const inFh = await fs.promises.open(inPath, 'r');
  const outFh = await fs.promises.open(out, 'w');
  try {
    await outFh.write(header, 0, HEADER_SIZE, 0);
    let pos = HEADER_SIZE;
    for (let layer = 0; layer < layerCount; layer++) {
      const nb = layerBytes(origSize, layer);
      await readAt(inFh, buf, nb, layer * LAYER_BYTES);
      const seg = encodeLayer(buf.subarray(0, nb), nb * 8, layer, p, scratch);
      mac.update(seg);
      await outFh.write(seg, 0, seg.length, pos);
      pos += seg.length;
    }
    const tag = mac.digest();
    tag.copy(header, OFF_TAG);
    await outFh.write(tag, 0, LEN_TAG, OFF_TAG);
    return { origSize, layerCount, outSize: pos, outPath: out };
  } finally {
    await inFh.close();
    await outFh.close();
  }
}

exports.encodeFile = encodeFile;
exports.encodeBuffer = encodeBuffer;
exports.defaultOutPath = defaultOutPath;
exports.newKeyMaterial = newKeyMaterial;
exports.Scratch = Scratch;
exports.Bt3dError = Bt3dError;
exports.HEADER_SIZE = HEADER_SIZE;
exports.LAYER_BYTES = LAYER_BYTES;
exports.SUFFIX = SUFFIX;
exports.USAGE = `BT3D v1 编码（单文件独立版）

用法:
  node bt3d-encode.js <输入文件> [<输出文件>]
      省略输出时，在输入文件名（含后缀）后加 .bt3d：a.jpg → a.jpg.bt3d
`;

// 直接运行本文件时当 CLI 用；被 require 时不产生任何副作用。
if (require.main === module) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || inPath === '-h' || inPath === '--help') {
    console.error(exports.USAGE);
    process.exit(2);
  }
  encodeFile(inPath, outPath)
    .then((r) => {
      console.log(`编码完成: ${r.origSize} 字节 → ${r.outSize} 字节，${r.layerCount} 层`);
      console.log(`        输出 ${r.outPath}${outPath ? '' : '（输出名缺省 = 源文件名 + .bt3d）'}`);
    })
    .catch((e) => {
      if (e instanceof Bt3dError) {
        console.error(`错误 [${e.code}]: ${e.message}`);
        process.exit(1);
      }
      throw e;
    });
}
