// 从官方 metadata.json 生成单 HTML 用的压缩索引。
// 输出 src/data/*.json：基 Emoji 元数据 + 日期表 + 位打包配对流。
//
// 用法: node tools/build-index.mjs [metadata.json 路径]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.argv[2] || 'C:/Users/webtu/AppData/Local/Temp/ek_meta.json';
const OUT = path.join(ROOT, 'src', 'data');

const meta = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const bases = meta.knownSupportedEmoji;
const data = meta.data;

const LEX = path.join(OUT, 'zh-lexicon.json');
if (!fs.existsSync(LEX)) {
  console.error('缺少中文词表种子 src/data/zh-lexicon.json，先跑 node tools/build-zh-lexicon.mjs');
  process.exit(1);
}
const zhLex = JSON.parse(fs.readFileSync(LEX, 'utf8'));

const idxOf = new Map(bases.map((cp, i) => [cp, i]));
const categories = new Map();

// 基 Emoji 元数据：[codepoint, 英文名, 字符, 分类, 英文关键词, 中文/拼音别名]
const baseRows = bases.map((cp) => {
  const e = data[cp];
  if (!e) throw new Error(`metadata.data 缺少基 Emoji: ${cp}`);
  const cat = e.category || 'other';
  categories.set(cat, (categories.get(cat) || 0) + 1);
  const kw = new Set([...(e.keywords || []), e.alt]);
  const zh = zhLex[cp];
  if (!zh) throw new Error(`词表缺少 ${cp}/${e.alt}，重跑 build-zh-lexicon.mjs`);
  return [cp, e.alt, e.emoji, cat, [...kw].join(' '), zh];
});

// 日期表（升序，定长 8 字符）
const dates = new Set();
for (const cp of bases) {
  for (const list of Object.values(data[cp].combinations || {})) {
    for (const v of list) dates.add(v.date);
  }
}
const dateList = [...dates].sort();
const dateIdx = new Map(dateList.map((d, i) => [d, i]));

const DATE_BITS = Math.ceil(Math.log2(dateList.length));
const BASE_BITS = Math.ceil(Math.log2(bases.length));
const REC_BITS = BASE_BITS + DATE_BITS + 1;
if (BASE_BITS > 10 || DATE_BITS > 6) throw new Error(`位宽超预算: base=${BASE_BITS} date=${DATE_BITS}`);

// 配对记录：只存 i<j 的一份（组合严格对称），同一 (i,j) 的多版本按日期降序相邻。
const records = [];
const seen = new Set();
const pairsByBase = new Array(bases.length).fill(0);

const pending = new Map(); // i -> Map(j -> versions[])
for (const cp of bases) {
  const i = idxOf.get(cp);
  for (const [otherCp, list] of Object.entries(data[cp].combinations || {})) {
    const j = idxOf.get(otherCp);
    if (j === undefined) throw new Error(`组合指向未知基 Emoji: ${otherCp}`);
    const key = i < j ? `${i}|${j}` : `${j}|${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lo = i < j ? i : j;
    const bucket = pending.get(lo) || new Map();
    pending.set(lo, bucket);
    bucket.set(i < j ? j : i, list);
  }
}

for (let i = 0; i < bases.length; i++) {
  const bucket = pending.get(i);
  if (!bucket) continue;
  for (const j of [...bucket.keys()].sort((a, b) => a - b)) {
    const list = bucket.get(j).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const v of list) {
      const bi = bases[i], bj = bases[j];
      if (v.leftEmojiCodepoint !== bi && v.leftEmojiCodepoint !== bj) throw new Error(`左右码点不属于该配对: ${v.alt}`);
      if (v.rightEmojiCodepoint !== bi && v.rightEmojiCodepoint !== bj) throw new Error(`左右码点不属于该配对: ${v.alt}`);
      // orient=1 表示 gstatic 文件名以伙伴为左（u{j}_u{i}）；自身配对恒为 0
      const o = v.leftEmojiCodepoint === bj && bj !== bi ? 1 : 0;
      records.push({ j, d: dateIdx.get(v.date), o });
      pairsByBase[i]++;
    }
  }
}

// 位打包：每条记录 BASE_BITS(伙伴) + DATE_BITS(日期) + 1(左右序)，MSB 优先写入字节流。
const totalBits = records.length * REC_BITS;
const bytes = new Uint8Array(Math.ceil(totalBits / 8));
let bitPos = 0;
const put = (value, bits) => {
  for (let b = bits - 1; b >= 0; b--) {
    if ((value >> b) & 1) bytes[bitPos >> 3] |= 0x80 >> (bitPos & 7);
    bitPos++;
  }
};
for (const r of records) {
  put(r.j, BASE_BITS);
  put(r.d, DATE_BITS);
  put(r.o, 1);
}
if (bitPos !== totalBits) throw new Error('位流长度不一致');

// 每基 Emoji 的记录条数（uint16 大端）
const counts = new Uint16Array(pairsByBase);
const countBytes = new Uint8Array(counts.byteLength);
new DataView(countBytes.buffer).setUint16(0, 0);
for (let i = 0; i < counts.length; i++) countBytes[i * 2] = counts[i] >> 8, countBytes[i * 2 + 1] = counts[i] & 255;
for (const c of counts) if (c > 65535) throw new Error('单基 Emoji 记录数溢出 uint16');

const b64 = (u8) => Buffer.from(u8).toString('base64');
fs.mkdirSync(OUT, { recursive: true });
const payload = {
  bases: baseRows,
  dates: dateList,
  counts: b64(countBytes),
  records: b64(bytes),
  bits: { base: BASE_BITS, date: DATE_BITS },
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(payload));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('基 Emoji:', bases.length, '| 唯一配对:', seen.size, '| 含历史版本记录:', records.length);
console.log('日期版本:', dateList.length, '| 位宽:', `${BASE_BITS}+${DATE_BITS}+1=${REC_BITS}bit`);
console.log('分类分布:', [...categories].map(([k, v]) => `${k}:${v}`).join('  '));
console.log('产物:', path.join(OUT, 'index.json'), kb(fs.statSync(path.join(OUT, 'index.json')).size));
console.log('  ├ bases JSON:', kb(JSON.stringify(baseRows).length), ' └ records base64:', kb(payload.records.length));
