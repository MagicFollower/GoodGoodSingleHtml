/*!
 * data/settings.js — 由 node tools/build-data.js 生成，请勿手改
 * 上游: github.com/carbon-app/carbon @ main (v4.9.10, MIT) — lib/constants.js 与 components/svg/*.js 原样数值
 * 字段与上游 DEFAULT_SETTINGS/DEFAULT_WIDTHS/COLORS/EXPORT_SIZES 一一对应。
 */

window.CARBON = window.CARBON || {}
CARBON.DEFAULT_SETTINGS = {
  "paddingVertical": "56px",
  "paddingHorizontal": "56px",
  "backgroundImage": null,
  "backgroundImageSelection": null,
  "backgroundMode": "color",
  "backgroundColor": "rgba(171, 184, 195, 1)",
  "dropShadow": true,
  "dropShadowOffsetY": "20px",
  "dropShadowBlurRadius": "68px",
  "theme": "seti",
  "windowTheme": "none",
  "language": "auto",
  "fontFamily": "Hack",
  "fontSize": "14px",
  "lineHeight": "133%",
  "windowControls": true,
  "widthAdjustment": true,
  "lineNumbers": false,
  "firstLineNumber": 1,
  "exportSize": "2x",
  "watermark": false,
  "squaredImage": false,
  "hiddenCharacters": false,
  "name": "",
  "width": 680
};
CARBON.DEFAULT_WIDTHS = {"minWidth":320,"maxWidth":1280};
CARBON.COLORS = {
  "BLACK": "#121212",
  "PRIMARY": "#F8E81C",
  "SECONDARY": "#fff",
  "GRAY": "#858585",
  "DARK_GRAY": "#393939",
  "HOVER": "#1F1F1F",
  "PURPLE": "#C198FB",
  "DARK_PURPLE": "#55436F",
  "RED": "#ff5f56",
  "BLUE": "#57b5f9",
  "GREEN": "#37b589"
};
CARBON.EXPORT_SIZES = [{"id":"1x","name":"1x","value":1},{"id":"2x","name":"2x","value":2},{"id":"4x","name":"4x","value":4}];
CARBON.HIGHLIGHT_KEYS = ["background","text","variable","attribute","definition","keyword","operator","property","number","string","comment","meta"];
CARBON.DEFAULT_BG_COLOR = undefined;
CARBON.BG_PRESETS = ["#D0021B","#F5A623","#F8E71C","#8B572A","#7ED321","#417505","#BD10E0","#9013FE","#4A90E2","#50E3C2","#B8E986","#000000","#4A4A4A","#9B9B9B","#FFFFFF"];
CARBON.FONTS = [
  {
    "id": "Anonymous Pro",
    "name": "Anonymous Pro"
  },
  {
    "id": "Cascadia Code",
    "name": "Cascadia Code"
  },
  {
    "id": "Droid Sans Mono",
    "name": "Droid Sans Mono"
  },
  {
    "id": "Fantasque Sans Mono",
    "name": "Fantasque Sans Mono"
  },
  {
    "id": "Fira Code",
    "name": "Fira Code"
  },
  {
    "id": "Hack",
    "name": "Hack"
  },
  {
    "id": "IBM Plex Mono",
    "name": "IBM Plex Mono"
  },
  {
    "id": "Inconsolata",
    "name": "Inconsolata"
  },
  {
    "id": "JetBrains Mono",
    "name": "JetBrains Mono"
  },
  {
    "id": "Monoid",
    "name": "Monoid"
  },
  {
    "id": "Source Code Pro",
    "name": "Source Code Pro"
  },
  {
    "id": "Space Mono",
    "name": "Space Mono"
  },
  {
    "id": "Ubuntu Mono",
    "name": "Ubuntu Mono"
  }
];
CARBON.FONT_FALLBACKS = {
  "Anonymous Pro": "'Anonymous Pro', Consolas, monospace",
  "Cascadia Code": "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  "Droid Sans Mono": "'Droid Sans Mono', Consolas, monospace",
  "Fantasque Sans Mono": "'Fantasque Sans Mono', Consolas, monospace",
  "Fira Code": "'Fira Code', Consolas, monospace",
  "Hack": "Hack, 'JetBrains Mono', Consolas, monospace",
  "IBM Plex Mono": "'IBM Plex Mono', Consolas, monospace",
  "Inconsolata": "Inconsolata, Consolas, monospace",
  "JetBrains Mono": "'JetBrains Mono', Consolas, monospace",
  "Monoid": "Monoid, Consolas, monospace",
  "Source Code Pro": "'Source Code Pro', Consolas, monospace",
  "Space Mono": "'Space Mono', Consolas, monospace",
  "Ubuntu Mono": "'Ubuntu Mono', Consolas, monospace"
};
CARBON.DEFAULT_CODE = "const pluckDeep = key => obj => key.split('.').reduce((accum, key) => accum[key], obj)\n\nconst compose = (...fns) => res => fns.reduce((accum, next) => next(accum), res)\n\nconst unfold = (f, seed) => {\n  const go = (f, seed, acc) => {\n    const res = f(seed)\n    return res ? go(f, res[1], acc.concat([res[0]])) : acc\n  }\n  return go(f, seed, [])\n}";
