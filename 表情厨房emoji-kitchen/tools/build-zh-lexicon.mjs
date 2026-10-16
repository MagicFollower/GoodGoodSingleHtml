// 把中文/拼音/英文别名表固化成工程内种子 src/data/zh-lexicon.json。
//
// 词源：offline-emoji-picker 预制词表 picker.json（其 n 数组来自 CLDR 中文表情派生关键词，
// 混排了中文词、全拼/首字母与英文名），这里只做「按码点重排 + 只留本工程用得到的 619 项」。
//
// 用法: node tools/build-zh-lexicon.mjs [picker.json 路径]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CANDIDATES = [
  process.argv[2],
  path.join(ROOT, 'raw', 'picker.json'),
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.qoder-cn', 'skills',
    'offline-emoji-picker', 'assets', 'data', 'picker.json'),
].filter(Boolean);

const SRC = CANDIDATES.find((p) => fs.existsSync(p));
if (!SRC) {
  console.error('找不到词表输入。请把 picker.json 放到 raw/picker.json，或用参数指定路径。');
  process.exit(1);
}

const picker = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'index.json'), 'utf8'));

// 词表键与工程内码点都要归一化：丢掉变体选择符 fe0f，统一小写
const norm = (cp) => String(cp).toLowerCase().split('-').filter((t) => t && t !== 'fe0f').join('-');
const padded = (cp) => norm(cp).split('-').map((t) => ('0000' + t).slice(-4)).join('-');

const table = new Map();
let rows = 0;
for (const list of Object.values(picker.emojis || {})) {
  for (const e of list) {
    rows++;
    const words = Array.isArray(e.n) ? e.n : [];
    for (const key of new Set([norm(e.u), padded(e.u)])) {
      if (!table.has(key)) table.set(key, new Set());
      for (const w of words) table.get(key).add(String(w));
    }
  }
}

const lex = {};
const missing = [];
let dropped = 0;
for (const b of index.bases) {
  const cp = b[0];
  const hit = table.get(norm(cp)) || table.get(padded(cp));
  if (!hit) { missing.push(cp + '/' + b[1]); continue; }
  // 英文名/英文关键词索引里已经有了（row[1] 名称 + row[4] 关键词），这里只留增量：中文词与拼音
  const en = new Set([b[1], ...(b[4] || '').split(' ')].map((w) => w.toLowerCase().replace(/_/g, ' ')).filter(Boolean));
  const extra = [];
  for (const w of hit) {
    const k = w.toLowerCase();
    if (/[\u3400-\u9fff]/.test(w)) { extra.push(w); continue; }      // 含汉字的一律保留
    if (k.length > 18) { dropped++; continue; }                       // 词表里的拼接噪声（grinninggrinning…）
    if (en.has(k) || en.has(k.replace(/ /g, '_'))) { dropped++; continue; }
    extra.push(w);
  }
  lex[cp] = extra.join(' ');
}

const OUT = path.join(ROOT, 'src', 'data', 'zh-lexicon.json');
fs.writeFileSync(OUT, JSON.stringify(lex));

console.log(`词表输入 ${SRC}`);
console.log(`  条目 ${rows} 行 / 归一化键 ${table.size} 个 → 命中 ${Object.keys(lex).length} / ${index.bases.length}`);
if (missing.length) {
  console.error('  未命中:', missing.join('  '));
  process.exit(1);
}
console.log('  产物:', path.relative(ROOT, OUT), ((fs.statSync(OUT).size) / 1024).toFixed(1) + ' KB');
