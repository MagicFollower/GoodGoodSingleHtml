// 交付前核对：electron/vendor 里的两份实现必须与仓库 sdk/ 逐字节相同。
//   node bin/check-sdk.mjs      （不一致时退出码 1）
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = ['bt3d-encode.js', 'bt3d-decode.js'];
const sha = (b) => createHash('sha256').update(b).digest('hex');

let bad = 0;
for (const f of FILES) {
  const repo = path.resolve(ROOT, '..', 'sdk', f);
  const vendored = path.join(ROOT, 'electron', 'vendor', f);
  const built = path.join(ROOT, 'dist-electron', f);
  const rows = [];
  let base = null;
  for (const [label, p] of [['仓库 sdk', repo], ['vendor 副本', vendored], ['构建产物', built]]) {
    if (!existsSync(p)) { rows.push(`${label}=缺文件`); bad++; continue; }
    const h = sha(readFileSync(p));
    if (base === null) base = h;
    rows.push(`${label}=${h.slice(0, 16)}${h === base ? '' : ' ≠'}`);
    if (h !== base) bad++;
  }
  console.log(`${f}  ${rows.join('  ｜  ')}`);
}

console.log(bad ? `!! 有 ${bad} 处不一致（跑一次 npm run build 会自动刷新副本）` : 'ok 三处逐字节相同');
process.exit(bad ? 1 : 0);
