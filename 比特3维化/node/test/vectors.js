#!/usr/bin/env node
// 黄金向量生成与对拍。口径见 ../../格式规格.md §15。
//
// 用法:
//   node test/vectors.js          生成并写入 test/golden-vectors.json，同时打印
//   node test/vectors.js --check  只校验现有 JSON 是否仍匹配（回归守卫）
//
// 黄金向量的作用：任何语言的任何实现，只要对同一组固定输入产出同一组字节，
// 即视为符合规格。这是跨栈互通的机器可检靶子 —— 判据 5（往返）抓不到
// 「编解码同源出错」，黄金向量能抓到（见 --prove-red 里的 D5/D6）。

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { LAYER_BYTES, HEADER_SIZE } from '../src/constants.js';
import { encodeBuffer, decodeBuffer } from '../src/codec.js';
import { deriveAffine } from '../src/affine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'golden-vectors.json');

// 固定密钥材料：与 test/criteria.js 保持一致
const DEK = Buffer.from('BT3D-v1-fixed-dek-golden-vector!', 'ascii');   // 32 B
const NONCE = Buffer.from('BT3D-nonce-1', 'ascii');                     // 12 B

const CASES = [
  { id: 'GV-1', desc: '空文件（layerCount = 0，纯头部）', input: Buffer.alloc(0) },
  { id: 'GV-2', desc: '1 字节 0x00（极小末层，秩压缩 m = 8）', input: Buffer.from([0x00]) },
  { id: 'GV-3', desc: '1 字节 0xFF（位序 MSB-first 自证）', input: Buffer.from([0xff]) },
  { id: 'GV-4', desc: '8 字节 00..07（手性与前 4 比特落点）', input: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]) },
  { id: 'GV-5', desc: '131072 字节全 0xA5（满层快路径 + 秩压缩退化）', input: Buffer.alloc(LAYER_BYTES, 0xa5) },
  {
    id: 'GV-6',
    desc: '131073 字节 = 0x00×131072 + 0xFF（跨层进位）',
    input: Buffer.concat([Buffer.alloc(LAYER_BYTES, 0x00), Buffer.from([0xff])]),
  },
];

function generate() {
  const { a, b, aInv } = deriveAffine(DEK, NONCE);
  const vectors = CASES.map((c) => {
    const container = encodeBuffer(c.input, { keyMaterial: { dek: DEK, nonce: NONCE } });
    const payload = container.subarray(HEADER_SIZE);
    const back = decodeBuffer(container);
    return {
      id: c.id,
      desc: c.desc,
      inputLen: c.input.length,
      inputSha256: createHash('sha256').update(c.input).digest('hex'),
      inputHead64Hex: c.input.subarray(0, 64).toString('hex'),
      containerLen: container.length,
      layerCount: Number(container.readBigUInt64LE(16)),
      headerHex: container.subarray(0, HEADER_SIZE).toString('hex'),
      payloadHead64Hex: payload.subarray(0, 64).toString('hex'),
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      containerSha256: createHash('sha256').update(container).digest('hex'),
      roundTripOk: back.equals(c.input) && back.length === c.input.length,
    };
  });
  return {
    format: 'BT3D',
    version: 1,
    generatedBy: `node ${process.version}`,
    generatedAt: new Date().toISOString(),
    keyMaterial: { dekHex: DEK.toString('hex'), nonceHex: NONCE.toString('hex') },
    derived: { a, b, aInv },
    vectors,
  };
}

const doc = generate();

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error(`未找到 ${OUT}，先运行 node test/vectors.js 生成`);
    process.exit(1);
  }
  const ref = JSON.parse(readFileSync(OUT, 'utf8'));
  let bad = 0;
  if (ref.derived.a !== doc.derived.a || ref.derived.b !== doc.derived.b || ref.derived.aInv !== doc.derived.aInv) {
    console.error(`参数派生不匹配: 参考 a=${ref.derived.a} b=${ref.derived.b} aInv=${ref.derived.aInv} / 实得 a=${doc.derived.a} b=${doc.derived.b} aInv=${doc.derived.aInv}`);
    bad++;
  }
  for (let i = 0; i < doc.vectors.length; i++) {
    const g = doc.vectors[i];
    const r = ref.vectors?.[i];
    if (!r || r.id !== g.id) { console.error(`${g.id}: 参考向量缺失或顺序不符`); bad++; continue; }
    for (const k of ['containerLen', 'layerCount', 'headerHex', 'payloadHead64Hex', 'payloadSha256', 'containerSha256']) {
      if (r[k] !== g[k]) { console.error(`${g.id} 字段 ${k} 不匹配\n  参考 ${String(r[k]).slice(0, 80)}\n  实得 ${String(g[k]).slice(0, 80)}`); bad++; }
    }
    if (!g.roundTripOk) { console.error(`${g.id}: 往返失败`); bad++; }
  }
  console.log(bad === 0 ? `黄金向量对拍通过：${doc.vectors.length} 组全部匹配` : `黄金向量对拍失败：${bad} 处不匹配`);
  process.exit(bad === 0 ? 0 : 1);
}

writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');

console.log('=== BT3D v1 黄金向量 ===');
console.log(`固定 DEK   = ${DEK.toString('hex')}`);
console.log(`固定 nonce = ${NONCE.toString('hex')}`);
console.log(`派生 a = ${doc.derived.a}  b = ${doc.derived.b}  aInv = ${doc.derived.aInv}`);
console.log(`写入 ${OUT}\n`);
for (const v of doc.vectors) {
  console.log(`${v.id}  ${v.desc}`);
  console.log(`  输入 ${v.inputLen} B  sha256=${v.inputSha256.slice(0, 32)}…`);
  console.log(`  容器 ${v.containerLen} B（= 输入 + ${v.containerLen - v.inputLen}）  layerCount=${v.layerCount}  往返=${v.roundTripOk}`);
  console.log(`  头部 hex = ${v.headerHex}`);
  console.log(`  payload 前 64 B hex = ${v.payloadHead64Hex}`);
  console.log(`  payload sha256 = ${v.payloadSha256}`);
  console.log(`  容器 sha256 = ${v.containerSha256}\n`);
}
