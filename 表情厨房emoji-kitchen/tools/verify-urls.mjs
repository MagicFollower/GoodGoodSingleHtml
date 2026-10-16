// 判据：内嵌索引只存「基 Emoji 序号 + 日期序号 + 左右序」，图片 URL 必须能在运行时逐条重建，
// 且与官方 metadata.json 里的 gStaticUrl 完全一致。任何一条不一致就非零退出。
//
// 用法: node tools/verify-urls.mjs [metadata.json 路径]
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || 'C:/Users/webtu/AppData/Local/Temp/ek_meta.json';
const meta = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const data = meta.data;

// 每个码点分段各自加 u 前缀：263a-fe0f -> u263a-ufe0f
export const token = (cp) => cp.split('-').map((t) => 'u' + t).join('-');
export const comboUrl = (date, leftCp, rightCp) => {
  const L = token(leftCp), R = token(rightCp);
  return `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${L}/${L}_${R}.png`;
};

let total = 0, mismatch = 0;
const examples = [];
for (const cp of Object.keys(data)) {
  for (const list of Object.values(data[cp].combinations || {})) {
    for (const v of list) {
      total++;
      if (comboUrl(v.date, v.leftEmojiCodepoint, v.rightEmojiCodepoint) !== v.gStaticUrl) {
        mismatch++;
        if (examples.length < 5) examples.push([v.leftEmojiCodepoint, v.rightEmojiCodepoint, v.date, v.gStaticUrl]);
      }
    }
  }
}
console.log(`比对 ${total} 条 gStaticUrl，不一致 ${mismatch} 条`);
for (const e of examples) console.log('  反例:', ...e);
if (mismatch) process.exit(1);

// 顺带确认基 Emoji 的 Noto 2D 图 URL 规则（选择器格子用）
const sample = meta.knownSupportedEmoji.find((c) => c.includes('-'));
console.log('多段码点样例:', sample, '->', token(sample).replace(/^u/, ''));
console.log('OK: URL 重建规则对全量记录成立');
