// BT3D v1 独立解码器（单文件，零依赖，CommonJS）。
//
// 本文件是自包含的：只使用 Node 内置模块 node:crypto / node:fs / node:path，
// 不 import 本工程任何其他文件。任何项目拷走这一个文件就能用。
//
//   const { decodeFile } = require('./bt3d-decode.js');
//   await decodeFile('a.jpg.bt3d', 'a.jpg');   // 输出名必填，见下方说明
//   const orig = decodeBuffer(container);      // 内存态
//
// 解码不需要密钥参数以外的任何外部状态：dek 与 file_nonce 就在容器头部
// 64..95 / 32..43，仿射参数 (a, b) 由它们派生而来，因此单文件即可自解。
//
// 与 node/src/ 参考实现的字节级一致性由 sdk/README.md 里的对拍实验证明。
// 格式口径：../格式规格.md §4~§7、§8、§10。

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// =====================================================================
// 1. 常量（§2.3 / §4.1）—— 与 bt3d-encode.js 必须逐项相同
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
const modL = (v) => ((v % L) + L) % L;

// =====================================================================
// 2. 几何映射 I：螺旋 → 2048 个等差段（§5.5 / §9.3）
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
  const a = ((1 << 19) + t) | 1;
  const b = Number(okmB.readBigUInt64LE(0) % BigInt(L));
  return { a, b, aInv: modInverse20(a) };
}

// =====================================================================
// 5. 几何映射 III：秩压缩（§7）
//
// 解码侧只需要 rank 这一个方向：它按 s 正向遍历，每步问「这个 r 是第几个
// 被选中的位置」，不需要反函数 select。
// =====================================================================

const WORDS = L / 32; // 32768

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
// 6. 密钥流 ChaCha20（§8）—— 流密码，加解密同一个函数
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
  cipher.final();
  return out;
}

// =====================================================================
// 7. 头部解析（§4.3）
// =====================================================================

function parseHeader(buf, fileSize) {
  const fail = (code, msg) => { throw new Bt3dError(code, msg); };

  if (buf.length < HEADER_SIZE) fail('TOO_SHORT', `文件不足 ${HEADER_SIZE} 字节头部`);
  if (buf.toString('ascii', OFF_MAGIC, OFF_MAGIC + 4) !== MAGIC) fail('BAD_MAGIC', '魔数不是 BT3D');
  if (buf[OFF_VERSION] !== VERSION) fail('BAD_VERSION', `version=${buf[OFF_VERSION]}，本实现只支持 ${VERSION}`);

  if (buf[OFF_RESERVED0] !== 0 || buf[OFF_RESERVED0 + 1] !== 0) fail('BAD_RESERVED', '偏移 6..7 保留位非零');
  for (let i = 0; i < LEN_RESERVED2; i++) {
    if (buf[OFF_RESERVED2 + i] !== 0) fail('BAD_RESERVED', `偏移 ${OFF_RESERVED2 + i} 保留位非零`);
  }

  const flags = buf[OFF_FLAGS];
  if (flags & FLAGS_MUST_BE_ZERO) fail('BAD_PROFILE', `flags=0x${flags.toString(16)} 含未支持的位置 1（必零掩码 0x${FLAGS_MUST_BE_ZERO.toString(16).toUpperCase()}）`);
  if ((flags & FLAGS_NORMATIVE) !== FLAGS_NORMATIVE) fail('BAD_PROFILE', `flags=0x${flags.toString(16)} 缺少必需位（必一掩码 0x${FLAGS_NORMATIVE.toString(16).toUpperCase()}）`);

  const dimX = buf.readUInt32LE(OFF_DIM_X);
  const dimY = buf.readUInt32LE(OFF_DIM_Y);
  if (dimX !== N || dimY !== N) fail('BAD_GEOMETRY', `dimX=${dimX} dimY=${dimY}，本实现只支持 ${N}×${N}`);

  const origSize = Number(buf.readBigUInt64LE(OFF_ORIG_SIZE));
  const layerCount = Number(buf.readBigUInt64LE(OFF_LAYER_COUNT));
  const expectLayers = Math.ceil(origSize / LAYER_BYTES);
  if (layerCount !== expectLayers) {
    fail('HEADER_INCONSISTENT', `layerCount=${layerCount} 与 origSize=${origSize} 推出的 ${expectLayers} 不符`);
  }

  if (fileSize !== undefined && fileSize !== origSize + HEADER_SIZE) {
    fail('BAD_LENGTH', `文件长度 ${fileSize} ≠ origSize+128 = ${origSize + HEADER_SIZE}`);
  }

  return {
    origSize, layerCount, dimX, dimY, flags,
    dek: Buffer.from(buf.subarray(OFF_DEK, OFF_DEK + LEN_DEK)),
    nonce: Buffer.from(buf.subarray(OFF_NONCE, OFF_NONCE + LEN_NONCE)),
    tag: Buffer.from(buf.subarray(OFF_TAG, OFF_TAG + LEN_TAG)),
  };
}

// =====================================================================
// 8. 聚集（解码侧，§10）
//
// 与编码侧互为逆运算：散射是「读 s 写 r」，聚集是「读 r 写 s」。
// =====================================================================

const segR0 = (i, a, b) => (a * SEG_Q[i] + b) % L;
const segRStep = (i, a) => modL(a * SEG_QSTEP[i]);

function gatherFull(src, dst, a, b) {
  for (let i = 0; i < SEG_PER_LAYER; i++) {
    let s = SEG_S[i];
    let r = segR0(i, a, b);
    const step = segRStep(i, a);
    const len = SEG_LEN[i];
    for (let j = 0; j < len; j++) {
      setBit(dst, s, getBit(src, r));
      s++;
      r += step;
      if (r >= L) r -= L;
    }
  }
}

// 三块顺序执行而非两趟循环：位图必须先建完整，才能问 rank。
function gatherRank(src, dst, m, a, b, rank) {
  rank.clear();
  for (let i = 0; i < SEG_PER_LAYER && SEG_S[i] < m; i++) {
    let r = segR0(i, a, b);
    const step = segRStep(i, a);
    const len = Math.min(SEG_LEN[i], m - SEG_S[i]);
    for (let j = 0; j < len; j++) {
      rank.set(r);
      r += step;
      if (r >= L) r -= L;
    }
  }
  rank.build();
  if (rank.count !== m) throw new Bt3dError('RANK_COUNT', `秩压缩位图计数 ${rank.count} ≠ m ${m}`);
  for (let i = 0; i < SEG_PER_LAYER && SEG_S[i] < m; i++) {
    let s = SEG_S[i];
    let r = segR0(i, a, b);
    const step = segRStep(i, a);
    const len = Math.min(SEG_LEN[i], m - SEG_S[i]);
    for (let j = 0; j < len; j++) {
      setBit(dst, s, getBit(src, rank.rank(r)));
      s++;
      r += step;
      if (r >= L) r -= L;
    }
  }
}

class Scratch {
  constructor() {
    this.layer = Buffer.alloc(LAYER_BYTES);
    this.rank = new RankIndex();
  }
}

// seg: 落盘的 m/8 字节；结果写入 dst（长度 m/8）
function decodeLayer(seg, m, layer, p, scratch, dst) {
  const P = applyKeystream(seg, p.dek, p.nonce, layer);
  dst.fill(0);
  if (m === L) gatherFull(P, dst, p.a, p.b);
  else gatherRank(P, dst, m, p.a, p.b, scratch.rank);
}

// =====================================================================
// 9. 对外 API
// =====================================================================

/**
 * 内存态解码。tag 校验失败抛 Bt3dError('TAG_MISMATCH')，不返回部分结果。
 * @param {Buffer} container
 * @returns {Buffer} 原始字节
 */
function decodeBuffer(container, opts = {}) {
  const header = container.subarray(0, HEADER_SIZE);
  const h = parseHeader(header, container.length);

  const hz = Buffer.from(header);
  hz.fill(0, OFF_TAG, OFF_TAG + LEN_TAG);
  const mac = crypto.createHmac('sha256', h.dek);
  mac.update(hz);
  mac.update(container.subarray(HEADER_SIZE));
  if (!crypto.timingSafeEqual(h.tag, mac.digest())) {
    throw new Bt3dError('TAG_MISMATCH', 'payload_tag 校验失败：容器已损坏或与本实现不兼容');
  }

  const p = { ...h, ...deriveAffine(h.dek, h.nonce) };
  const scratch = opts.scratch ?? new Scratch();
  const out = Buffer.alloc(h.origSize);
  let pos = HEADER_SIZE;
  for (let layer = 0; layer < h.layerCount; layer++) {
    const nb = layerBytes(h.origSize, layer);
    decodeLayer(container.subarray(pos, pos + nb), nb * 8, layer, p, scratch,
      out.subarray(layer * LAYER_BYTES, layer * LAYER_BYTES + nb));
    pos += nb;
  }
  return out;
}

async function readAt(fh, buf, len, position) {
  let off = 0;
  while (off < len) {
    const { bytesRead } = await fh.read(buf, off, len - off, position + off);
    if (bytesRead === 0) throw new Bt3dError('EOF', `读取提前结束（还差 ${len - off} 字节）`);
    off += bytesRead;
  }
}

/** 只读头部，不解码。用于「先看看这是什么再决定解到哪」。 */
async function readHeader(inPath) {
  const { size } = await fs.promises.stat(inPath);
  const fh = await fs.promises.open(inPath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_SIZE);
    await readAt(fh, buf, HEADER_SIZE, 0);
    const h = parseHeader(buf, size);
    return { fileSize: size, ...h };
  } finally {
    await fh.close();
  }
}

function assertDistinct(inPath, outPath) {
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[.]+$/, '');
  if (norm(inPath) === norm(outPath)) {
    throw new Bt3dError('SAME_PATH', '输入与输出是同一个文件，解码会就地毁掉容器（本工具不做原地覆盖）');
  }
}

/**
 * 流式解码。输出文件刻意推迟到 tag 校验通过之后才创建：
 * 'w' 模式会立刻截断已存在的目标文件，若在校验前打开，一次失败的解码
 * 就会把用户原有的同名文件清空 —— 那是解码器不该有的破坏性。
 *
 * @param {string} inPath  容器文件
 * @param {string} outPath 必填。容器内不保存原文件名，输出名只能由调用方给。
 * @returns {Promise<{origSize:number, layerCount:number, written:number, outPath:string}>}
 */
async function decodeFile(inPath, outPath) {
  if (!outPath) throw new Bt3dError('NEED_OUTPUT', 'decode 必须显式给出输出文件名');
  assertDistinct(inPath, outPath);

  const { size: fileSize } = await fs.promises.stat(inPath);
  const inFh = await fs.promises.open(inPath, 'r');
  let outFh = null;
  try {
    const headerBuf = Buffer.alloc(HEADER_SIZE);
    await readAt(inFh, headerBuf, HEADER_SIZE, 0);
    const h = parseHeader(headerBuf, fileSize);

    // 第一遍：只算 HMAC，不产出任何数据
    const hz = Buffer.from(headerBuf);
    hz.fill(0, OFF_TAG, OFF_TAG + LEN_TAG);
    const mac = crypto.createHmac('sha256', h.dek);
    mac.update(hz);
    const buf = Buffer.alloc(LAYER_BYTES);
    let remaining = h.origSize;
    let readPos = HEADER_SIZE;
    while (remaining > 0) {
      const nb = Math.min(LAYER_BYTES, remaining);
      await readAt(inFh, buf, nb, readPos);
      mac.update(buf.subarray(0, nb));
      readPos += nb;
      remaining -= nb;
    }
    if (!crypto.timingSafeEqual(h.tag, mac.digest())) {
      throw new Bt3dError('TAG_MISMATCH', 'payload_tag 校验失败：容器已损坏或与本实现不兼容');
    }

    // 第二遍：校验已通过，此时才创建输出文件
    outFh = await fs.promises.open(outPath, 'w');
    const p = { ...h, ...deriveAffine(h.dek, h.nonce) };
    const scratch = new Scratch();
    const out = Buffer.alloc(LAYER_BYTES);
    let writePos = 0;
    for (let layer = 0; layer < h.layerCount; layer++) {
      const nb = layerBytes(h.origSize, layer);
      await readAt(inFh, buf, nb, HEADER_SIZE + layer * LAYER_BYTES);
      decodeLayer(buf.subarray(0, nb), nb * 8, layer, p, scratch, out.subarray(0, nb));
      await outFh.write(out, 0, nb, writePos);
      writePos += nb;
    }
    return { origSize: h.origSize, layerCount: h.layerCount, written: writePos, outPath: outPath };
  } finally {
    await inFh.close();
    if (outFh) await outFh.close();
  }
}

exports.decodeFile = decodeFile;
exports.decodeBuffer = decodeBuffer;
exports.readHeader = readHeader;
exports.parseHeader = parseHeader;
exports.Scratch = Scratch;
exports.Bt3dError = Bt3dError;
exports.HEADER_SIZE = HEADER_SIZE;
exports.LAYER_BYTES = LAYER_BYTES;
exports.SUFFIX = SUFFIX;
exports.USAGE = `BT3D v1 解码（单文件独立版）

用法:
  node bt3d-decode.js <输入.bt3d> <输出文件>
      两个参数都必填：容器内不保存原文件名，输出名只能由调用方给。
`;

// 直接运行本文件时当 CLI 用；被 require 时不产生任何副作用。
if (require.main === module) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || inPath === '-h' || inPath === '--help') {
    console.error(exports.USAGE);
    process.exit(2);
  }
  decodeFile(inPath, outPath)
    .then((r) => console.log(`解码完成: ${r.origSize} 字节，${r.layerCount} 层，写出 ${r.written} 字节 → ${r.outPath}`))
    .catch((e) => {
      if (e instanceof Bt3dError) {
        console.error(`错误 [${e.code}]: ${e.message}`);
        process.exit(1);
      }
      throw e;
    });
}
