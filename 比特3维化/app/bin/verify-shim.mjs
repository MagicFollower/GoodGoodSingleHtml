// 驱动：用两个运行时跑同一个 worker，比对容器哈希。
//   node bin/verify-shim.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const worker = path.join(ROOT, 'bin', 'verify-shim-run.cjs');
const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const SIZES = [300000, 1000003];   // 后者末层 82499 字节，不是 4 的倍数：专门踩零头

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, timeout: 180000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('VS ')) || `FAIL rc=${r.status} ${String(r.stderr || '').slice(0, 160)}`;
  console.log(`${label}: ${line}`);
  const sha = /sha256=([0-9a-f]{64})/.exec(line);
  return sha ? sha[1] : null;
}

let allOk = true;
for (const SIZE of SIZES) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bt3d-shim-'));
  const src = path.join(dir, 'src.bin');
  let x = 24601;
  const buf = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; buf[i] = (x >>> 16) & 0xff; }
  writeFileSync(src, buf);
  console.log(`\n样本 ${SIZE} 字节（末层 ${(SIZE - Math.floor(SIZE / 131072) * 131072)} B），sha256=${createHash('sha256').update(buf).digest('hex').slice(0, 16)}`);

  const nodeSha = run('系统 Node（原生 chacha20）', process.execPath, [worker, src, path.join(dir, 'c-node.bt3d')]);
  const elSha = run('Electron（BoringSSL + 纯 JS 垫片）', electronExe, [worker, src, path.join(dir, 'c-el.bt3d')]);

  if (!nodeSha || !elSha) {
    console.log('判定：至少一侧没跑出来，不算通过');
    allOk = false;
  } else {
    const cNode = readFileSync(path.join(dir, 'c-node.bt3d'));
    const cEl = readFileSync(path.join(dir, 'c-el.bt3d'));
    const eq = cNode.equals(cEl) && nodeSha === elSha;
    console.log(`容器逐字节相同 = ${eq}（${cNode.length} vs ${cEl.length} 字节），哈希 ${nodeSha.slice(0, 32)}…`);
    if (!eq) allOk = false;
  }
  rmSync(dir, { recursive: true, force: true });
}
process.exit(allOk ? 0 : 1);
