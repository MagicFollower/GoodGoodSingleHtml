// 交叉核对的执行体：同一段代码分别在系统 Node（OpenSSL 原生 chacha20）
// 与 Electron（BoringSSL，走纯 JS 垫片）里跑一遍，容器必须逐字节相同。
//   node    bin/verify-shim-run.cjs <输入> <输出>
//   electron bin/verify-shim-run.cjs <输入> <输出>
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const { installChaCha20Shim } = require(path.join(ROOT, 'dist-electron', 'chacha20-shim.js'));
const sdk = require(path.resolve(ROOT, '..', 'sdk', 'bt3d-encode.js'));   // 仓库里那份原件，不是副本

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.log('VS usage: verify-shim-run <in> <out>'); process.exit(2); }

const installed = installChaCha20Shim();
const KM = {
  dek: Buffer.from('BT3D-v1-fixed-dek-golden-vector!', 'ascii'),
  nonce: Buffer.from('BT3D-nonce-1', 'ascii')
};

(async () => {
  const r = await sdk.encodeFile(inPath, outPath, { keyMaterial: KM });
  const buf = fs.readFileSync(outPath);
  const rt = require(path.resolve(ROOT, '..', 'sdk', 'bt3d-decode.js'));
  const back = path.join(path.dirname(outPath), 'back-' + path.basename(outPath));
  await rt.decodeFile(outPath, back);
  const same = fs.readFileSync(back).equals(fs.readFileSync(inPath));
  console.log([
    `VS runtime=${process.versions.electron ? 'electron' : 'node'}`,
    `node=${process.versions.node}`,
    `openssl=${process.versions.openssl}`,
    `shim=${installed.installed ? 'installed' : 'not-needed'}`,
    `bytes=${r.outSize}`,
    `layers=${r.layerCount}`,
    `sha256=${crypto.createHash('sha256').update(buf).digest('hex')}`,
    `roundtrip=${same}`
  ].join(' '));
  process.exit(0);
})().catch((e) => { console.log('VS FAIL ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ⏎ ' ) : String(e))); process.exit(1); });
