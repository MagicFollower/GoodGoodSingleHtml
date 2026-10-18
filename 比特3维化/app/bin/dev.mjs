// 开发模式：自己拉 Vite + Electron，不依赖插件式启动器。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');          // 返回 electron.exe 的路径

const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, mode: 'development' });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) {
  await server.close();
  console.error('Vite 起来了但拿不到本地地址');
  process.exit(1);
}
console.log(`Vite dev server: ${url}`);

const child = spawn(String(electronBin), ['.'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url }
});

let closing = false;
const shutdown = (code) => {
  if (closing) return;
  closing = true;
  void server.close().finally(() => process.exit(code ?? 0));
};
child.on('exit', (code) => shutdown(code ?? 0));
process.on('SIGINT', () => { child.kill(); });
