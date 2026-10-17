// BT3D v1 编解码核心。口径见 ../../格式规格.md §9 / §10。
//
// 常驻内存与文件总大小无关（§14.2）：一个 128 KiB 层缓冲 + 秩压缩索引 256 KiB。

import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  L, LAYER_BYTES, HEADER_SIZE, SEG_PER_LAYER, OFF_TAG, LEN_TAG,
  modL, layerBytes, layerCountOf, Bt3dError,
} from './constants.js';
import { SEG_S, SEG_Q, SEG_QSTEP, SEG_LEN } from './spiral.js';
import { deriveAffine } from './affine.js';
import { RankIndex } from './rank.js';
import { applyKeystream } from './keystream.js';
import { buildHeader, beginTag, parseHeader, verifyTag, newKeyMaterial } from './header.js';

// ---- 位存取：MSB-first（约定 C2）----
export const getBit = (buf, i) => (buf[i >>> 3] >>> (7 - (i & 7))) & 1;

export function setBit(buf, i, v) {
  const j = i >>> 3;
  const m = 1 << (7 - (i & 7));
  if (v) buf[j] |= m;
  else buf[j] &= ~m;
}

// 段首的散射序号与段内 r 公差，由 (a, b) 与段的光栅起点/步进推出（§9.3）
const segR0 = (i, a, b) => (a * SEG_Q[i] + b) % L;
const segRStep = (i, a) => modL(a * SEG_QSTEP[i]);

// ---- 散射（编码侧）----

// 满层快路径：秩压缩退化为恒等，存储序号 r' = r = affine(q)
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

// 末层路径：先建秩压缩位图，再按 r' = rank(r) 写入
function scatterRank(src, dst, m, a, b, rank) {
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0) {
      rank.clear();
    }
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
      if (rank.count !== m) {
        throw new Bt3dError('RANK_COUNT', `秩压缩位图计数 ${rank.count} ≠ m ${m}`);
      }
    }
  }
}

// ---- 聚集（解码侧）----

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
  if (rank.count !== m) {
    throw new Bt3dError('RANK_COUNT', `秩压缩位图计数 ${rank.count} ≠ m ${m}`);
  }
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

// ---- 复用缓冲 ----

export class Scratch {
  constructor() {
    this.layer = Buffer.alloc(LAYER_BYTES); // 存储序层缓冲 O
    this.rank = new RankIndex();
  }
}

function makeParams(dek, nonce) {
  const { a, b, aInv } = deriveAffine(dek, nonce);
  return { dek, nonce, a, b, aInv };
}

// ---- 单层 ----

// src: 该层原始字节（长度 nb = m/8）；返回落盘的 nb 字节
export function encodeLayer(src, m, layer, p, scratch, opts = {}) {
  const useAffine = opts.useAffine !== false;
  const useKeystream = opts.useKeystream !== false;
  const a = useAffine ? p.a : 1; // a=1,b=0 时仿射退化为恒等光栅
  const b = useAffine ? p.b : 0;

  const O = scratch.layer;
  O.fill(0, 0, m / 8);
  if (m === L) scatterFull(src, O, a, b);
  else scatterRank(src, O, m, a, b, scratch.rank);

  const packed = O.subarray(0, m / 8);
  return useKeystream ? applyKeystream(packed, p.dek, p.nonce, layer) : Buffer.from(packed);
}

// seg: 落盘的 nb 字节；写入 dst（长度 nb）
export function decodeLayer(seg, m, layer, p, scratch, dst, opts = {}) {
  const useAffine = opts.useAffine !== false;
  const useKeystream = opts.useKeystream !== false;
  const a = useAffine ? p.a : 1;
  const b = useAffine ? p.b : 0;

  const P = useKeystream ? applyKeystream(seg, p.dek, p.nonce, layer) : seg;
  dst.fill(0);
  if (m === L) gatherFull(P, dst, a, b);
  else gatherRank(P, dst, m, a, b, scratch.rank);
}

// ---- 内存态 API（测试与黄金向量用）----

export function encodeBuffer(input, opts = {}) {
  const origSize = input.length;
  const layerCount = layerCountOf(origSize);
  const km = opts.keyMaterial ?? newKeyMaterial();
  const header = buildHeader({ origSize, layerCount, dek: km.dek, nonce: km.nonce });
  const p = makeParams(km.dek, km.nonce);
  const scratch = opts.scratch ?? new Scratch();

  const mac = beginTag(km.dek, header);
  const segs = [];
  for (let layer = 0; layer < layerCount; layer++) {
    const off = layer * LAYER_BYTES;
    const src = input.subarray(off, Math.min(off + LAYER_BYTES, origSize));
    const seg = encodeLayer(src, src.length * 8, layer, p, scratch, opts);
    mac.update(seg);
    segs.push(seg);
  }
  mac.digest().copy(header, OFF_TAG);
  return Buffer.concat([header, ...segs]);
}

export function decodeBuffer(container, opts = {}) {
  const header = container.subarray(0, HEADER_SIZE);
  const h = parseHeader(header, container.length);
  if (!verifyTag(header, h.dek, [container.subarray(HEADER_SIZE)])) {
    throw new Bt3dError('TAG_MISMATCH', 'payload_tag 校验失败：容器已损坏或与本实现不兼容');
  }

  const p = makeParams(h.dek, h.nonce);
  const scratch = opts.scratch ?? new Scratch();
  const out = Buffer.alloc(h.origSize);
  let pos = HEADER_SIZE;
  for (let layer = 0; layer < h.layerCount; layer++) {
    const nb = layerBytes(h.origSize, layer);
    decodeLayer(container.subarray(pos, pos + nb), nb * 8, layer, p, scratch,
      out.subarray(layer * LAYER_BYTES, layer * LAYER_BYTES + nb), opts);
    pos += nb;
  }
  if (out.length !== h.origSize) {
    throw new Bt3dError('SIZE_MISMATCH', `还原长度 ${out.length} ≠ origSize ${h.origSize}`);
  }
  return out;
}

// ---- 流式文件 API ----

async function readAt(fh, buf, len, position) {
  let off = 0;
  while (off < len) {
    const { bytesRead } = await fh.read(buf, off, len - off, position + off);
    if (bytesRead === 0) throw new Bt3dError('EOF', `读取提前结束（还差 ${len - off} 字节）`);
    off += bytesRead;
  }
}

export async function encodeFile(inPath, outPath, opts = {}) {
  const { size: origSize } = await fs.stat(inPath);
  const layerCount = layerCountOf(origSize);
  const km = opts.keyMaterial ?? newKeyMaterial();
  const header = buildHeader({ origSize, layerCount, dek: km.dek, nonce: km.nonce });
  const p = makeParams(km.dek, km.nonce);
  const scratch = opts.scratch ?? new Scratch();
  const mac = beginTag(km.dek, header);

  const buf = Buffer.alloc(LAYER_BYTES);
  const inFh = await fs.open(inPath, 'r');
  const outFh = await fs.open(outPath, 'w');
  try {
    await outFh.write(header, 0, HEADER_SIZE, 0);
    let pos = HEADER_SIZE;
    for (let layer = 0; layer < layerCount; layer++) {
      const nb = layerBytes(origSize, layer);
      await readAt(inFh, buf, nb, layer * LAYER_BYTES);
      const seg = encodeLayer(buf.subarray(0, nb), nb * 8, layer, p, scratch, opts);
      mac.update(seg);
      await outFh.write(seg, 0, seg.length, pos);
      pos += seg.length;
    }
    const tag = mac.digest();
    tag.copy(header, OFF_TAG);
    await outFh.write(tag, 0, LEN_TAG, OFF_TAG);
    return { origSize, layerCount, outSize: pos };
  } finally {
    await inFh.close();
    await outFh.close();
  }
}

export async function decodeFile(inPath, outPath) {
  const { size: fileSize } = await fs.stat(inPath);
  const inFh = await fs.open(inPath, 'r');
  // 输出文件刻意推迟到 tag 校验通过之后再打开。
  // 'w' 模式会立刻截断已存在的目标文件 —— 若在校验前打开，一次失败的解码
  // 就会把用户原有的同名文件清空（§10.1 第 8 步「禁止输出任何数据」）。
  let outFh = null;
  try {
    const headerBuf = Buffer.alloc(HEADER_SIZE);
    await readAt(inFh, headerBuf, HEADER_SIZE, 0);
    const h = parseHeader(headerBuf, fileSize);

    // 第一遍：只算 HMAC，不产出任何数据
    const hz = Buffer.from(headerBuf);
    hz.fill(0, OFF_TAG, OFF_TAG + LEN_TAG);
    const mac = createHmac('sha256', h.dek);
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
    if (!timingSafeEqual(h.tag, mac.digest())) {
      throw new Bt3dError('TAG_MISMATCH', 'payload_tag 校验失败：容器已损坏或与本实现不兼容');
    }

    // 第二遍：校验已通过，此时才创建输出文件
    outFh = await fs.open(outPath, 'w');
    const p = makeParams(h.dek, h.nonce);
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
    return { origSize: h.origSize, layerCount: h.layerCount, written: writePos };
  } finally {
    await inFh.close();
    if (outFh) await outFh.close();
  }
}
