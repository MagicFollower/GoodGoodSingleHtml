// 诊断：同一份 crypto 探针分别在 Electron 与系统 Node 里跑，比较 chacha20 支持面。
//   node bin/crypto-probe.cjs
//   node_modules/electron/dist/electron.exe bin/crypto-probe.cjs
const crypto = require('node:crypto');

const tag = process.versions.electron ? 'ELECTRON' : 'NODE';
const list = crypto.getCiphers();

console.log(`${tag}.runtime = ${process.versions.electron ? 'electron ' + process.versions.electron : 'node ' + process.versions.node}`);
console.log(`${tag}.openssl = ${process.versions.openssl}`);
console.log(`${tag}.chacha20-in-getCiphers = ${list.includes('chacha20')}`);
console.log(`${tag}.chacha-ish = ${list.filter((x) => /chacha/i.test(x)).join(',') || '(无)'}`);

const iv = Buffer.alloc(16, 0);
iv.writeUInt32LE(1, 0);
const key = Buffer.alloc(32, 0);
for (let i = 0; i < 32; i++) key[i] = i;
try {
  const c = crypto.createCipheriv('chacha20', key, iv);
  const out = Buffer.concat([c.update(Buffer.alloc(64, 0)), c.final()]);
  console.log(`${tag}.chacha20-first16 = ${out.subarray(0, 16).toString('hex')}`);
} catch (e) {
  console.log(`${tag}.chacha20 = 抛错 ${e.code || e.message}`);
}

try {
  const c = crypto.createCipheriv('chacha20-poly1305', key, Buffer.alloc(12, 0), { tagLength: 16 });
  const out = Buffer.concat([c.update(Buffer.alloc(8, 0)), c.final()]);
  console.log(`${tag}.aead-chacha20-poly1305 = 可用（${out.length} 字节含 tag）`);
} catch (e) {
  console.log(`${tag}.aead-chacha20-poly1305 = 抛错 ${e.code || e.message}`);
}

console.log(`${tag}.aes-256-ctr = ${(() => { try { crypto.createCipheriv('aes-256-ctr', key, Buffer.alloc(16, 0)); return '可用'; } catch (e) { return '抛错 ' + (e.code || e.message); } })()}`);

// Electron 跑脚本时不会自己退出（没有窗口也常驻），显式收掉
process.exit(0);
