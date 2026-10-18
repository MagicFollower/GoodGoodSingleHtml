// 把落盘的 ReactBits 组件的 props 形状抽出来，供宿主按真实 API 调用（不靠猜）。
//   node bin/rb-props.mjs            全部
//   node bin/rb-props.mjs GlassSurface JellyRadio
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'src', 'reactbits');
const want = process.argv.slice(2);
const files = readdirSync(OUT).filter((f) => f.endsWith('.tsx') && (!want.length || want.some((w) => f === `${w}.tsx`)));

for (const f of files) {
  const src = readFileSync(path.join(OUT, f), 'utf8');
  const name = f.replace(/\.tsx$/, '');
  // 1) props 类型块：type/interface XProps {...} 或内联解构
  const blocks = [...src.matchAll(/(?:export\s+)?(?:type|interface)\s+\w*Props\w*[^{]*\{([\s\S]*?)\n\}/g)]
    .map((m) => m[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' | '));
  // 2) 默认值：函数签名里的 = 赋值
  const defaults = [...src.matchAll(/(?:const|function)\s+(?:default\s+)?\w+\s*[(=][^\n]*?\{?\s*([\s\S]{0,900}?)\n\}\s*(?::|;|\{)/g)].slice(0, 1)
    .map((m) => m[1].split('\n').map((l) => l.trim()).filter((l) => /:.*=/.test(l)).join(' | ').slice(0, 500));
  // 3) CSS 自定义属性（宿主适配要动的钩子）
  const vars = [...new Set([...src.matchAll(/--[a-z0-9-]+/g)].map((m) => m[0]))].sort();
  // 4) 根元素类名
  const rootCls = [...new Set([...src.matchAll(/className=["'`]([^"'`]+)["'`]/g)].map((m) => m[1]))].slice(0, 6);
  console.log(`\n### ${name}`);
  console.log(`props: ${blocks[0] || '(未见独立 Props 类型，看签名)'}`);
  if (blocks.length > 1) blocks.slice(1).forEach((b, i) => console.log(`props#${i + 2}: ${b}`));
  if (defaults[0]) console.log(`defaults: ${defaults[0]}`);
  console.log(`css-vars(${vars.length}): ${vars.slice(0, 40).join(' ')}`);
  console.log(`classes: ${rootCls.join(' / ')}`);
}
