// 纯 JS 的 ChaCha20（RFC 8439 §2.3 / §2.4）垫片。
//
// 为什么需要它：Electron 的 Node 是挂在 BoringSSL 上编的，本机实测（bin/crypto-probe.cjs）：
//   Electron 44.7.0  openssl=0.0.0  chacha20-in-getCiphers=false  createCipheriv('chacha20') 抛 ERR_CRYPTO_UNKNOWN_CIPHER
//   系统 node 24.21  openssl=3.5.8  chacha20-in-getCiphers=true
// sdk/ 的两份实现里 applyKeystream 走的正是 createCipheriv('chacha20', dek, iv16)，
// 而那份文件必须与仓库里的逐字节相同（自证里有哈希断言），所以补差在宿主这一侧：
// 只接管 'chacha20' 这一个算法名，其余算法原样转给 OpenSSL。
//
// IV 口径与 node/src/keystream.js 一致：16 字节 = 块计数器 u32 LE(4B) ‖ nonce(12B)。

import { createCipheriv as origCreateCipheriv } from 'node:crypto';

const SIG = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

function rotl(v: number, n: number): number {
  return ((v << n) >>> 0) | (v >>> (32 - n));
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 7);
}

function block(out: Uint32Array, state: Uint32Array): void {
  const work = new Uint32Array(16);
  work.set(state);
  for (let i = 0; i < 10; i++) {
    quarterRound(work, 0, 4, 8, 12);
    quarterRound(work, 1, 5, 9, 13);
    quarterRound(work, 2, 6, 10, 14);
    quarterRound(work, 3, 7, 11, 15);
    quarterRound(work, 0, 5, 10, 15);
    quarterRound(work, 1, 6, 11, 12);
    quarterRound(work, 2, 7, 8, 13);
    quarterRound(work, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) out[i] = (work[i] + state[i]) >>> 0;
}

function initState(key: Uint8Array, counter: number, nonce: Uint8Array): Uint32Array {
  if (key.length !== 32) throw new Error(`chacha20 shim: key 长度 ${key.length} != 32`);
  if (nonce.length !== 12) throw new Error(`chacha20 shim: nonce 长度 ${nonce.length} != 12`);
  const s = new Uint32Array(16);
  s.set(SIG, 0);
  const kv = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (let i = 0; i < 8; i++) s[4 + i] = kv.getUint32(i * 4, true);
  s[12] = counter >>> 0;
  const nv = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  s[13] = nv.getUint32(0, true);
  s[14] = nv.getUint32(4, true);
  s[15] = nv.getUint32(8, true);
  return s;
}

// 与 OpenSSL 的 16 字节 IV 对齐：前 4 字节是 u32 LE 的块计数器，后 12 字节是 nonce。
export function keystream(byteLen: number, key: Uint8Array, iv16: Uint8Array): Buffer {
  const counter = (iv16[0] | (iv16[1] << 8) | (iv16[2] << 16) | (iv16[3] << 24)) >>> 0;
  const state = initState(key, counter, iv16.subarray(4));
  const blocks = Math.ceil(byteLen / 64);          // 必须按 64 字节整块数取词，按 byteLen/4 会在零头处越界
  const words = new Uint32Array(blocks * 16);
  const one = new Uint32Array(16);
  for (let b = 0; b < blocks; b++) {
    state[12] = (counter + b) >>> 0;
    block(one, state);
    words.set(one, b * 16);
  }
  const out = Buffer.alloc(byteLen);
  // 逐字节写，别用 DataView.setUint32：byteLen 不是 4 的倍数时（比如 5 字节的末层）会踩到 off+4 > byteLen
  for (let i = 0, w = 0; i < byteLen; i += 4, w++) {
    const v = words[w];
    out[i] = v & 0xff;
    if (i + 1 < byteLen) out[i + 1] = (v >>> 8) & 0xff;
    if (i + 2 < byteLen) out[i + 2] = (v >>> 16) & 0xff;
    if (i + 3 < byteLen) out[i + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

export function xorWithKeystream(input: Uint8Array, key: Uint8Array, iv16: Uint8Array): Buffer {
  const ks = keystream(input.length, key, iv16);
  const out = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ ks[i];
  return out;
}

// 鸭子类型的 Cipher。sdk 的用法固定是"新建 → update(整块) → final()"，
// 所以一次性异或就与 OpenSSL 等价，不需要维护跨次调用的流位置。
function makeShimCipher(key: Uint8Array, iv16: Uint8Array) {
  return {
    update(input: Uint8Array): Buffer {
      return xorWithKeystream(input, key, iv16);
    },
    final(): Buffer { return Buffer.alloc(0); },
    setAutoPadding(): boolean { return true; },
    getAuthTag(): Buffer { throw new Error('chacha20 shim: 这是裸 ChaCha20，没有 tag；完整性由 payload_tag(HMAC) 负责'); },
    _shim: true
  };
}

let installed = false;

export function shimActive(): boolean {
  return installed;
}

/** 只有在运行时拿不到 chacha20 时才装垫片；能拿到就一行都不改。 */
export function installChaCha20Shim(): { installed: boolean; reason: string } {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const has = crypto.getCiphers().includes('chacha20');
  if (has) return { installed: false, reason: '运行时原生支持 chacha20，未打垫片' };
  if (installed) return { installed: true, reason: '已装（幂等）' };
  const anyCrypto = crypto as unknown as { createCipheriv: unknown };
  const original = anyCrypto.createCipheriv as (...a: unknown[]) => unknown;
  const patched = function (algorithm: unknown, key: unknown, iv: unknown, options?: unknown) {
    if (typeof algorithm === 'string' && algorithm.toLowerCase() === 'chacha20') {
      return makeShimCipher(key as Uint8Array, iv as Uint8Array);
    }
    return original.call(crypto, algorithm, key, iv, options);
  };
  anyCrypto.createCipheriv = patched;
  installed = true;
  return { installed: true, reason: '运行时缺 chacha20（BoringSSL），已装纯 JS 垫片' };
}

/**
 * RFC 8439 §2.4.2 的阳性对照：key = 00..1f，nonce = 00000000 0000004a 00000000，块计数器 = 1，
 * 明文首 16 字节 "Ladies and Gentl" 的密文必须是 6e2e359a2568f98041ba0728dd0d6981。
 * 这个值与本仓库 格式规格.md §16.2 判据 14 记的是同一条。
 */
export function rfc8439Vector(): string {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i;
  const nonce = Buffer.from('000000000000004a00000000', 'hex');
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(1, 0);
  nonce.copy(iv, 4);
  const plain = Buffer.from('Ladies and Gentlemen of the class of ’99: If I could offer you only one tip for the future, sunscreen would be it.', 'utf8');
  return xorWithKeystream(plain.subarray(0, 16), key, iv).toString('hex');
}

/** 交叉核对用的固定样本：与 bin/crypto-probe.cjs 里系统 Node 打出来的那串同参数。 */
export function shimSample(): string {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i;
  const iv = Buffer.alloc(16, 0);
  iv.writeUInt32LE(1, 0);
  return keystream(16, key, iv).toString('hex');
}
