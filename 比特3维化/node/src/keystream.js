// 密钥流。口径见 ../../格式规格.md §8。
//
// Node 绑定（§8.3）：OpenSSL 的 chacha20 要求 16 字节 IV，布局为
//     IV = 块计数器 u32 LE (4 B) ‖ nonce (12 B)
// 这一布局已对 RFC 8439 §2.4.2 测试向量逐字节验证（判据 14）；
// 另两种拼法（计数器 BE 在前、nonce 在前）均不匹配。

import { createCipheriv } from 'node:crypto';
import { BLOCKS_PER_LAYER, Bt3dError } from './constants.js';

export const MAX_LAYER = Math.floor(0x100000000 / BLOCKS_PER_LAYER); // 2097152

export function counterBaseOf(layer) {
  if (layer >= MAX_LAYER) {
    throw new Bt3dError(
      'COUNTER_OVERFLOW',
      `层号 ${layer} 超出 32 位块计数器上限（payload > 256 GiB）`
    );
  }
  return layer * BLOCKS_PER_LAYER;
}

export function buildIv(layer, nonce) {
  const iv = Buffer.allocUnsafe(16);
  iv.writeUInt32LE(counterBaseOf(layer), 0);
  nonce.copy(iv, 4);
  return iv;
}

// 用显式计数器做一次性变换。ChaCha20 是流密码，update() 的返回值就是
// 输入与密钥流的异或，因此加密与解密是同一个函数。
export function applyKeystream(buf, dek, nonce, layer) {
  const cipher = createCipheriv('chacha20', dek, buildIv(layer, nonce));
  const out = cipher.update(buf);
  cipher.final(); // 流密码，返回空；调用它是为了触发 OpenSSL 的状态校验
  return out;
}

// 直接以 (key, nonce, counter) 生成 keystream，仅供判据 14 对 RFC 向量使用。
export function chacha20Raw(key, nonce, counter, data) {
  const iv = Buffer.allocUnsafe(16);
  iv.writeUInt32LE(counter, 0);
  nonce.copy(iv, 4);
  const cipher = createCipheriv('chacha20', key, iv);
  const out = cipher.update(data);
  cipher.final();
  return out;
}
