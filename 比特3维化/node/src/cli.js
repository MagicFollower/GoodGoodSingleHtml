#!/usr/bin/env node
// BT3D v1 命令行入口。

import { promises as fs } from 'node:fs';
import { encodeFile, decodeFile } from './codec.js';
import { parseHeader } from './header.js';
import { HEADER_SIZE, LAYER_BYTES, Bt3dError } from './constants.js';
import { deriveAffine } from './affine.js';

const USAGE = `BT3D v1 —— 比特流三维混淆容器

用法:
  bt3d encode <输入文件> <输出.bt3d>
  bt3d decode <输入.bt3d> <输出文件>
  bt3d inspect <输入.bt3d>
`;

async function inspect(path) {
  const { size } = await fs.stat(path);
  const fh = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(HEADER_SIZE);
    await fh.read(buf, 0, HEADER_SIZE, 0);
    const h = parseHeader(buf, size);
    const { a, b, aInv } = deriveAffine(h.dek, h.nonce);
    const full = Math.floor(h.origSize / LAYER_BYTES);
    const tail = h.origSize % LAYER_BYTES;
    const rows = [
      ['文件大小', `${size} 字节`],
      ['origSize', `${h.origSize} 字节`],
      ['layerCount', `${h.layerCount}（满层 ${full}${tail > 0 ? `，末层 ${tail} 字节` : '，无末层'}）`],
      ['几何', `${h.dimX} × ${h.dimY}，每层 ${LAYER_BYTES} 字节`],
      ['flags', `0x${h.flags.toString(16).padStart(2, '0')}`],
      ['dek', h.dek.toString('hex')],
      ['file_nonce', h.nonce.toString('hex')],
      ['仿射 a', `${a} (0x${a.toString(16)})`],
      ['仿射 b', `${b} (0x${b.toString(16)})`],
      ['a_inv mod 2^20', `${aInv}  校验 a*a_inv mod 2^20 = ${(BigInt(a) * BigInt(aInv)) % BigInt(1 << 20)}`],
      ['payload_tag', h.tag.toString('hex')],
      ['体积开销', `${size - h.origSize} 字节（规范值 ${HEADER_SIZE}）`],
    ];
    const w = Math.max(...rows.map((r) => r[0].length));
    for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}  ${v}`);
  } finally {
    await fh.close();
  }
}

const [, , cmd, a1, a2] = process.argv;

try {
  if (cmd === 'encode' && a1 && a2) {
    const t0 = process.hrtime.bigint();
    const r = await encodeFile(a1, a2);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`编码完成: ${r.origSize} 字节 → ${r.outSize} 字节，${r.layerCount} 层，${ms.toFixed(0)} ms`);
  } else if (cmd === 'decode' && a1 && a2) {
    const t0 = process.hrtime.bigint();
    const r = await decodeFile(a1, a2);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`解码完成: ${r.origSize} 字节，${r.layerCount} 层，写出 ${r.written} 字节，${ms.toFixed(0)} ms`);
  } else if (cmd === 'inspect' && a1) {
    await inspect(a1);
  } else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (e) {
  if (e instanceof Bt3dError) {
    console.error(`错误 [${e.code}]: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
