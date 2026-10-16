// 把 src/data/index.json 注入 src/app.html，产出可双击打开的单 HTML。
//
// 用法: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TPL = path.join(ROOT, 'src', 'app.html');
const DATA = path.join(ROOT, 'src', 'data', 'index.json');
const OUT = path.join(ROOT, 'emoji-kitchen.html');
const MARKER = '/*__EK_DATA__*/';

const tpl = fs.readFileSync(TPL, 'utf8');
const payload = JSON.parse(fs.readFileSync(DATA, 'utf8'));
if (!tpl.includes(MARKER)) throw new Error(`模板缺少注入标记 ${MARKER}`);

// 数据以 JSON 字面量赋值，先自检能被解析且不含 </script> 片段
const json = JSON.stringify(payload);
if (/<\/script/i.test(json)) throw new Error('数据里出现了会截断 script 的片段');
const script = 'window.EK_RAW = ' + json + ';';

fs.writeFileSync(OUT, tpl.replace(MARKER, () => script));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const size = fs.statSync(OUT).size;
console.log('产物:', path.relative(ROOT, OUT), kb(size), `（表情数据 ${kb(json.length)} + 页面代码 ${kb(tpl.length - MARKER.length)}）`);
console.log('基 Emoji:', payload.bases.length, '| 日期批次:', payload.dates.length, '| 位流 base64:', kb(payload.records.length));
