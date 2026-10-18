// 构建：Vite 出 dist/，tsc 出 dist-electron/，再把两份 vendored SDK 与来源哈希拷进 dist-electron/。
//
// vendored 的 .cjs/.js 不参与 tsc 编译（它们是交付物的原件，逐字节不能动），
// 所以单独拷贝，并写 vendor-manifest.json 记下它们在仓库 sdk/ 里的 sha256 ——
// 自证阶段用它断言"跑的就是那份文件"。
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

const { build } = await import('vite');
await build({ root: ROOT, mode: 'production' });
console.log('vite build ok');

mkdirSync(path.join(ROOT, 'dist-electron'), { recursive: true });

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'electron', 'tsconfig.json')], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error(`tsc 主进程侧失败 rc=${r.status}`);
  process.exit(r.status ?? 1);
}

const sdkDir = path.resolve(ROOT, '..', 'sdk');
const files = ['bt3d-encode.js', 'bt3d-decode.js'];
const manifest = { source: '../sdk', builtAt: new Date().toISOString(), files: {} };
for (const f of files) {
  const repoPath = path.join(sdkDir, f);
  if (!existsSync(repoPath)) {
    console.error(`仓库缺文件 ${repoPath}`);
    process.exit(1);
  }
  const dest = path.join(ROOT, 'electron', 'vendor', f);
  const repoHash = createHash('sha256').update(readFileSync(repoPath)).digest('hex');
  const localHash = createHash('sha256').update(readFileSync(dest)).digest('hex');
  if (repoHash !== localHash) {
    copyFileSync(repoPath, dest);
    console.log(`刷新 vendored 副本 ${f}（与 ../sdk 不同步，已覆盖）`);
  }
  manifest.files[f] = { sha256: repoHash, bytes: readFileSync(repoPath).length };
  copyFileSync(dest, path.join(ROOT, 'dist-electron', f));
}
writeFileSync(path.join(ROOT, 'dist-electron', 'vendor-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`dist-electron 就绪：${['main.js', 'preload.js', ...files, 'vendor-manifest.json'].join(', ')}`);
