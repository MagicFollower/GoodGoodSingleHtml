// BT3D 独立 SDK 与参考实现的对拍检查。
//
// 用法（在仓库任意目录）：node sdk/interop-check.js
//
// 为什么要有这个文件：sdk/bt3d-encode.js 与 sdk/bt3d-decode.js 各自内联了一份
// 格式实现，与 node/src/ 是**重复实现**而非同一份代码。重复实现最大的风险不是
// 写错，而是「两边各自自洽、内部往返测试全绿，但互解不开」。所以这里测的是
// 交叉方向与既有靶子，而不是 SDK 自己的往返：
//   C1 黄金向量逐字节     —— SDK 的输出必须等于已归档的容器哈希（权威靶子）
//   C2 交叉解码           —— 参考实现解 SDK 的容器，反之亦然
//   C3 文件级 + 缺省输出名 —— 新增的 CLI/API 行为
//   C4 篡改与不破坏既有输出 —— 失败路径
//   C5 两个文件当 CLI 跑
//   C6 隔离目录 drop-in    —— 只拷这两个文件，CJS 与 ESM 两种引入方式都能用

'use strict';

const assert = require('node:assert');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const { encodeFile, encodeBuffer, defaultOutPath, Bt3dError: EncErr } = require('./bt3d-encode.js');
const { decodeFile, decodeBuffer, readHeader, Bt3dError: DecErr } = require('./bt3d-decode.js');

const results = [];
async function run(name, fn) {
  const t0 = process.hrtime.bigint();
  try {
    const evidence = await fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    results.push({ name, pass: true, evidence, ms });
    console.log(`[PASS] ${name} (${ms.toFixed(0)} ms)\n       ${evidence}`);
  } catch (e) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    results.push({ name, pass: false, evidence: `${e.name}: ${e.message}`, ms });
    console.log(`[FAIL] ${name} (${ms.toFixed(0)} ms)\n       ${e.name}: ${e.message}`);
  }
}

// 固定密钥材料，与 node/test/vectors.js 一致
const DEK = Buffer.from('BT3D-v1-fixed-dek-golden-vector!', 'ascii');
const NONCE = Buffer.from('BT3D-nonce-1', 'ascii');
const KM = { dek: DEK, nonce: NONCE };

// 与 vectors.js 的 CASES 同一组输入
const LAYER_BYTES = 131072;
const GV_INPUTS = [
  ['GV-1', Buffer.alloc(0)],
  ['GV-2', Buffer.from([0x00])],
  ['GV-3', Buffer.from([0xff])],
  ['GV-4', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])],
  ['GV-5', Buffer.alloc(LAYER_BYTES, 0xa5)],
  ['GV-6', Buffer.concat([Buffer.alloc(LAYER_BYTES, 0x00), Buffer.from([0xff])])],
];

// 可复现的伪随机样本（LCG，跨进程稳定）
function lcgBytes(len, seed = 20261018) {
  const b = Buffer.alloc(len);
  let x = seed;
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    b[i] = (x >>> 16) & 0xff;
  }
  return b;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bt3d-sdk-'));
process.on('exit', () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* 忽略 */ } });

(async () => {
  const ref = await import(pathToFileURL(path.join(ROOT, 'node', 'src', 'codec.js')).href);
  const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'node', 'test', 'golden-vectors.json'), 'utf8'));

  // ---- C1 黄金向量逐字节 ----
  await run('C1 黄金向量逐字节（SDK 输出 = 已归档容器）', () => {
    const rows = [];
    for (const g of golden.vectors) {
      const input = GV_INPUTS.find(([id]) => id === g.id);
      assert.ok(input, `黄金向量 ${g.id} 在本检查里没有对应输入定义`);
      const c = encodeBuffer(input[1], { keyMaterial: KM });
      assert.strictEqual(c.length, g.containerLen, `${g.id} 容器长度`);
      assert.strictEqual(c.subarray(0, 128).toString('hex'), g.headerHex, `${g.id} 头部`);
      assert.strictEqual(sha256(c), g.containerSha256, `${g.id} 整容器 sha256`);
      rows.push(`${g.id}=${g.containerLen}B`);
    }
    return `6/6 向量的头部十六进制与整容器 sha256 全部匹配（${rows.join(' ')}）`;
  });

  // ---- C2 交叉解码 ----
  await run('C2 交叉解码（参考实现 ↔ SDK）', async () => {
    const sizes = [0, 1, 7, 127, 128, 129, LAYER_BYTES, LAYER_BYTES + 1, 300000];
    const parts = [];
    for (const n of sizes) {
      const input = lcgBytes(n);
      const fromSdk = encodeBuffer(input, { keyMaterial: KM });
      const fromRef = ref.encodeBuffer(input, { keyMaterial: KM });
      assert.ok(fromSdk.equals(fromRef), `输入 ${n} 字节：两个编码器产出的容器不同`);
      assert.ok(decodeBuffer(fromRef).equals(input), `输入 ${n} 字节：SDK 解不开参考实现的容器`);
      assert.ok(ref.decodeBuffer(fromSdk).equals(input), `输入 ${n} 字节：参考实现解不开 SDK 的容器`);
      parts.push(n);
    }
    return `9 种长度（${parts.join(', ')}）：两侧容器逐字节相同，且双向都能解开` +
      `（含 0 层、单满层、跨层进位、3 层带末层）`;
  });

  // ---- C3 文件级 + 缺省输出名 ----
  await run('C3 encodeFile 缺省输出名 + 文件级双向', async () => {
    const src = path.join(work, 'photo.jpg');
    const original = lcgBytes(250000);          // 2 满层 + 末层
    fs.writeFileSync(src, original);

    const r = await encodeFile(src);             // 不传输出名
    assert.strictEqual(r.outPath, src + '.bt3d', '缺省输出名不是「源文件名 + .bt3d」');
    assert.strictEqual(r.outSize, original.length + 128, '容器长度 ≠ 原长 + 128');
    assert.strictEqual(defaultOutPath('a.tar.gz'), 'a.tar.gz.bt3d', '多后缀文件名被错误地剥掉了后缀');

    const back = path.join(work, 'restored.bin');
    const d = await decodeFile(r.outPath, back);
    assert.ok(fs.readFileSync(back).equals(original), 'SDK 自己往返不一致');
    assert.strictEqual(d.written, original.length, '写出字节数 ≠ origSize');

    const back2 = path.join(work, 'restored-by-ref.bin');
    await ref.decodeFile(r.outPath, back2);      // 参考实现解 SDK 生成的文件
    assert.ok(fs.readFileSync(back2).equals(original), '参考实现解不开 SDK 生成的文件');

    const srcRef = path.join(work, 'by-ref.bin');
    fs.writeFileSync(srcRef, original);
    const refContainer = path.join(work, 'by-ref.bt3d');
    await ref.encodeFile(srcRef, refContainer);
    const back3 = path.join(work, 'restored-by-sdk.bin');
    await decodeFile(refContainer, back3);       // SDK 解参考实现生成的文件
    assert.ok(fs.readFileSync(back3).equals(original), 'SDK 解不开参考实现生成的文件');

    const h = await readHeader(r.outPath);
    assert.strictEqual(h.origSize, original.length, 'readHeader.origSize 不符');
    return `缺省名 ${path.basename(r.outPath)}，容器 ${r.outSize} B / ${r.layerCount} 层；` +
      `SDK↔SDK、参考↔SDK、SDK↔参考 三条文件级通路全部逐字节还原；readHeader origSize=${h.origSize}`;
  });

  // ---- C4 篡改与失败不破坏既有输出 ----
  await run('C4 篡改容器 → TAG_MISMATCH，且不碰已存在的输出文件', async () => {
    const src = path.join(work, 't.bin');
    fs.writeFileSync(src, lcgBytes(4096));
    const cont = path.join(work, 't.bt3d');
    await encodeFile(src, cont);

    const bad = path.join(work, 'bad-out.bin');
    const sentinel = Buffer.from('THIS MUST SURVIVE A FAILED DECODE'.repeat(40));
    fs.writeFileSync(bad, sentinel);

    const raw = fs.readFileSync(cont);
    raw[200] ^= 0x01;                            // payload 首字节之后、末层之前
    fs.writeFileSync(cont, raw);

    let code = '';
    try { await decodeFile(cont, bad); } catch (e) { code = e.code; }
    assert.strictEqual(code, 'TAG_MISMATCH', `篡改后没有报 TAG_MISMATCH，而是 ${code || '无异常'}`);
    assert.ok(fs.readFileSync(bad).equals(sentinel), '解码失败却把已存在的输出文件截断/改写了');

    return `TAG_MISMATCH 命中；输出文件 ${sentinel.length} 字节哨兵内容原样保留（失败路径不落半个字节）`;
  });

  // ---- C5 两个文件当 CLI 跑 ----
  await run('C5 CLI：缺省输出名 / 必填输出名 / 同路径守卫 / 退出码', async () => {
    const src = path.join(work, 'cli-demo.dat');
    fs.writeFileSync(src, 'hello from cli'.repeat(500));
    const cli = (file, args) => execFileSync(process.execPath, [path.join(HERE, file), ...args], { encoding: 'utf8' });

    const enc = cli('bt3d-encode.js', [src]);
    assert.ok(fs.existsSync(src + '.bt3d'), 'CLI 缺省输出名没有生成 .bt3d 文件');
    assert.match(enc, /输出 .*cli-demo\.dat\.bt3d（输出名缺省 = 源文件名 \+ \.bt3d）/);

    const out = path.join(work, 'cli-restored.dat');
    const dec = cli('bt3d-decode.js', [src + '.bt3d', out]);
    assert.ok(fs.readFileSync(out).equals(fs.readFileSync(src)), 'CLI 往返不一致');
    assert.match(dec, /解码完成: 7000 字节/);

    let noArgExit = 0;
    try { cli('bt3d-encode.js', []); } catch (e) { noArgExit = e.status; }
    assert.strictEqual(noArgExit, 2, `无参数时应退出码 2，实际 ${noArgExit}`);

    let missingOut = '';
    try { cli('bt3d-decode.js', [src + '.bt3d']); } catch (e) { missingOut = String(e.stderr || e.status); }
    assert.match(missingOut, /NEED_OUTPUT|两个参数都必填/, `decode 缺输出名时应当报错，实际 ${missingOut}`);

    // 就地覆盖守卫：编与解两侧、CLI 与库两条入口都要拒
    const same = { code: '' };
    for (const [label, fn] of [
      ['encode 库', () => encodeFile(src, src)],
      ['decode 库', () => decodeFile(src + '.bt3d', src + '.bt3d')],
    ]) {
      try { await fn(); } catch (e) { if (e.code !== 'SAME_PATH') throw new Error(`${label} 未抛 SAME_PATH，而是 ${e.code || e.message}`); }
      same.code = 'SAME_PATH';
    }
    try { cli('bt3d-encode.js', [src, src]); throw new Error('CLI encode 未拒绝就地覆盖'); }
    catch (e) { assert.match(String(e.stderr), /SAME_PATH/, 'CLI encode 的 SAME_PATH 文本'); }

    return `encode 缺省名生成 ${path.basename(src)}.bt3d 并被 CLI decode 还原（7000 字节）；` +
      `无参数 exit=2；decode 缺输出名被拒；${same.code} 在编码/解码的库入口与 CLI 入口共 3 条路径上都被触发`;
  });

  // ---- C6 隔离目录 drop-in ----
  await run('C6 隔离目录：只拷两个文件，CJS 与 ESM 都能引入', () => {
    const iso = path.join(work, 'consumer');
    fs.mkdirSync(iso, { recursive: true });
    for (const f of ['bt3d-encode.js', 'bt3d-decode.js']) fs.copyFileSync(path.join(HERE, f), path.join(iso, f));
    fs.writeFileSync(path.join(iso, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
    fs.writeFileSync(path.join(iso, 'src.dat'), lcgBytes(9001));

    fs.writeFileSync(path.join(iso, 'use-cjs.js'), `
      const assert = require('node:assert');
      const fs = require('node:fs');
      const { encodeFile } = require('./bt3d-encode.js');
      const { decodeFile } = require('./bt3d-decode.js');
      (async () => {
        const r = await encodeFile('src.dat');
        const d = await decodeFile(r.outPath, 'out.bin');
        assert.ok(fs.readFileSync('out.bin').equals(fs.readFileSync('src.dat')));
        console.log('CJS ok', r.origSize, r.outSize, d.written);
      })();
    `);
    fs.writeFileSync(path.join(iso, 'use-esm.mjs'), `
      import assert from 'node:assert';
      import fs from 'node:fs';
      import { encodeFile } from './bt3d-encode.js';
      import { decodeFile } from './bt3d-decode.js';
      const r = await encodeFile('src.dat', 'esm.bt3d');
      const d = await decodeFile('esm.bt3d', 'esm-out.bin');
      assert.ok(fs.readFileSync('esm-out.bin').equals(fs.readFileSync('src.dat')));
      console.log('ESM ok', r.origSize, r.outSize, d.written);
    `);
    fs.writeFileSync(path.join(iso, 'use-esm-default.mjs'), `
      import assert from 'node:assert';
      import pkg from './bt3d-decode.js';
      const buf = pkg.decodeBuffer(await (await import('node:fs')).promises.readFile('esm.bt3d'));
      assert.strictEqual(buf.length, 9001);
      console.log('ESM default ok', buf.length);
    `);

    const node = (file) => execFileSync(process.execPath, [path.join(iso, file)], { encoding: 'utf8', cwd: iso }).trim();
    const cjs = node('use-cjs.js');
    const esm = node('use-esm.mjs');
    const esmDef = node('use-esm-default.mjs');
    assert.match(cjs, /CJS ok 9001 9129 9001/);
    assert.match(esm, /ESM ok 9001 9129 9001/);
    assert.match(esmDef, /ESM default ok 9001/);
    return `目录内只有两个 SDK 文件 + package.json（无 src/ 无 node_modules）：` +
      `require 具名导入、ESM 具名导入、ESM 默认导入三种引入方式都可用并逐字节还原（9001 → 9129 → 9001）`;
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n--- 结果：通过 ${results.length - failed.length} / ${results.length} ---`);
  if (failed.length) {
    for (const f of failed) console.log(`FAIL ${f.name}: ${f.evidence}`);
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
