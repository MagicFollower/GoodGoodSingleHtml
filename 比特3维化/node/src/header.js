// 头部构造、解析与校验。口径见 ../../格式规格.md §4。

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  HEADER_SIZE, MAGIC, VERSION, N,
  FLAGS_NORMATIVE, FLAGS_MUST_BE_ZERO,
  OFF_MAGIC, OFF_VERSION, OFF_FLAGS, OFF_RESERVED0, OFF_ORIG_SIZE, OFF_LAYER_COUNT,
  OFF_DIM_X, OFF_DIM_Y, OFF_NONCE, OFF_RESERVED2, LEN_RESERVED2,
  OFF_DEK, LEN_DEK, OFF_TAG, LEN_TAG,
  LAYER_BYTES, Bt3dError,
} from './constants.js';

export function newKeyMaterial() {
  return { dek: randomBytes(LEN_DEK), nonce: randomBytes(12) };
}

// 构造 128 字节头部，tag 字段留 0（§4.4 要求 tag 覆盖「tag 置零的头部」）
export function buildHeader({ origSize, layerCount, dek, nonce }) {
  const h = Buffer.alloc(HEADER_SIZE);
  h.write(MAGIC, OFF_MAGIC, 4, 'ascii');
  h[OFF_VERSION] = VERSION;
  h[OFF_FLAGS] = FLAGS_NORMATIVE;
  // OFF_RESERVED0 (6) 与 7 保持 0
  h.writeBigUInt64LE(BigInt(origSize), OFF_ORIG_SIZE);
  h.writeBigUInt64LE(BigInt(layerCount), OFF_LAYER_COUNT);
  h.writeUInt32LE(N, OFF_DIM_X);
  h.writeUInt32LE(N, OFF_DIM_Y);
  nonce.copy(h, OFF_NONCE);
  // OFF_RESERVED2 .. +20 保持 0
  dek.copy(h, OFF_DEK);
  return h;
}

// 流式 HMAC：先喂 tag 置零的头部，再逐块喂 payload
export function beginTag(dek, headerWithTagZeroed) {
  const mac = createHmac('sha256', dek);
  mac.update(headerWithTagZeroed);
  return mac;
}

export function tagFromHeader(header, dek, payloadChunks) {
  const h = Buffer.from(header);
  h.fill(0, OFF_TAG, OFF_TAG + LEN_TAG);
  const mac = beginTag(dek, h);
  for (const c of payloadChunks) mac.update(c);
  return mac.digest();
}

export function verifyTag(header, dek, payloadChunks) {
  const stored = Buffer.from(header.subarray(OFF_TAG, OFF_TAG + LEN_TAG));
  const actual = tagFromHeader(header, dek, payloadChunks);
  return timingSafeEqual(stored, actual);
}

export function parseHeader(buf, fileSize) {
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
    origSize,
    layerCount,
    dimX,
    dimY,
    flags,
    dek: Buffer.from(buf.subarray(OFF_DEK, OFF_DEK + LEN_DEK)),
    nonce: Buffer.from(buf.subarray(OFF_NONCE, OFF_NONCE + 12)),
    tag: Buffer.from(buf.subarray(OFF_TAG, OFF_TAG + LEN_TAG)),
  };
}
