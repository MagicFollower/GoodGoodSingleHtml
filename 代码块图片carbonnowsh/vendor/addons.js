/*!
 * vendor/addons.js — CodeMirror 5.65.5 addons，按依赖拓扑序拼接（classic script）
 * 本文件必须紧接 vendor/codemirror.min.js 之后、vendor/modes.js 之前加载。
 * 每个源文件是 CM5 三段式 UMD：浏览器下 typeof exports / typeof define 都不成立，
 * 因此只会命中最后的 else 分支 e(CodeMirror)，引用全局 CodeMirror。
 * 生成器: node tools/build-vendor.js（列表 = mode 递归发现的 addon + 运行时必需的 addon）
 * addon/edit/matchbrackets 与 addon/selection/mark-selection 未塞入：
  - tools/upstream/Carbon.js 第 156-172 行是 Carbon 传给 CodeMirror 的完整 options 对象
    (screenReaderLabel/lineNumbers/firstLineNumber/mode/theme/scrollbarStyle/viewportMargin/
     lineWrapping/smartIndent/extraKeys/readOnly/showInvisibles/autoCloseBrackets)，
    既无 matchBrackets 也无 styleSelectedText；
  - 对 tools/upstream/*.js 与 tools/upstream/src_*.txt 全量 grep "matchBrackets|styleSelectedText|mark-selection"
    命中 0 处。
  塞进 addon/edit/autoCloseBrackets 的替代品：Carbon 自带打过补丁的副本
  tools/upstream/autoCloseBrackets.js（Carbon.js 第 390 行 require('../lib/custom/autoCloseBrackets')），
  它自己调用 CodeMirror.defineOption('autoCloseBrackets', ...)，是 option 生效的唯一途径，
  上游 addon/edit/closebrackets 不需要重复加载。
 */

/*!-- addon mode/multiplex | https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.5/addon/mode/multiplex.min.js | 5.65.5 | 2331B | sha1 c09d42ed | deps=[] --*/
!function(e){"object"==typeof exports&&"object"==typeof module?e(require("../../lib/codemirror")):"function"==typeof define&&define.amd?define(["../../lib/codemirror"],e):e(CodeMirror)}(function(m){"use strict";m.multiplexingMode=function(d){var v=Array.prototype.slice.call(arguments,1);function f(e,n,t,i){if("string"==typeof n)return r=e.indexOf(n,t),i&&-1<r?r+n.length:r;var r=n.exec(t?e.slice(t):e);return r?r.index+t+(i?r[0].length:0):-1}return{startState:function(){return{outer:m.startState(d),innerActive:null,inner:null,startingInner:!1}},copyState:function(e){return{outer:m.copyState(d,e.outer),innerActive:e.innerActive,inner:e.innerActive&&m.copyState(e.innerActive.mode,e.inner),startingInner:e.startingInner}},token:function(e,n){if(n.innerActive){var t=n.innerActive,i=e.string;if(!t.close&&e.sol())return n.innerActive=n.inner=null,this.token(e,n);if((c=t.close&&!n.startingInner?f(i,t.close,e.pos,t.parseDelimiters):-1)==e.pos&&!t.parseDelimiters)return e.match(t.close),n.innerActive=n.inner=null,t.delimStyle&&t.delimStyle+" "+t.delimStyle+"-close";-1<c&&(e.string=i.slice(0,c));var r=t.mode.token(e,n.inner);return-1<c?e.string=i:e.pos>e.start&&(n.startingInner=!1),c==e.pos&&t.parseDelimiters&&(n.innerActive=n.inner=null),r=t.innerStyle?r?r+" "+t.innerStyle:t.innerStyle:r}for(var o=1/0,i=e.string,l=0;l<v.length;++l){var c,s,a,u=v[l];if((c=f(i,u.open,e.pos))==e.pos)return u.parseDelimiters||e.match(u.open),n.startingInner=!!u.parseDelimiters,n.innerActive=u,s=0,d.indent&&(a=d.indent(n.outer,"",""))!==m.Pass&&(s=a),n.inner=m.startState(u.mode,s),u.delimStyle&&u.delimStyle+" "+u.delimStyle+"-open";-1!=c&&c<o&&(o=c)}o!=1/0&&(e.string=i.slice(0,o));t=d.token(e,n.outer);return o!=1/0&&(e.string=i),t},indent:function(e,n,t){var i=e.innerActive?e.innerActive.mode:d;return i.indent?i.indent(e.innerActive?e.inner:e.outer,n,t):m.Pass},blankLine:function(e){var n=e.innerActive?e.innerActive.mode:d;if(n.blankLine&&n.blankLine(e.innerActive?e.inner:e.outer),e.innerActive)"\n"===e.innerActive.close&&(e.innerActive=e.inner=null);else for(var t=0;t<v.length;++t){var i=v[t];"\n"===i.open&&(e.innerActive=i,e.inner=m.startState(i.mode,n.indent?n.indent(e.outer,"",""):0))}},electricChars:d.electricChars,innerMode:function(e){return e.inner?{state:e.inner,mode:e.innerActive.mode}:{state:e.outer,mode:d}}}}});

;
/*!-- addon mode/overlay | https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.5/addon/mode/overlay.min.js | 5.65.5 | 1323B | sha1 5430aed6 | deps=[] --*/
!function(e){"object"==typeof exports&&"object"==typeof module?e(require("../../lib/codemirror")):"function"==typeof define&&define.amd?define(["../../lib/codemirror"],e):e(CodeMirror)}(function(o){"use strict";o.overlayMode=function(a,n,t){return{startState:function(){return{base:o.startState(a),overlay:o.startState(n),basePos:0,baseCur:null,overlayPos:0,overlayCur:null,streamSeen:null}},copyState:function(e){return{base:o.copyState(a,e.base),overlay:o.copyState(n,e.overlay),basePos:e.basePos,baseCur:null,overlayPos:e.overlayPos,overlayCur:null}},token:function(e,o){return(e!=o.streamSeen||Math.min(o.basePos,o.overlayPos)<e.start)&&(o.streamSeen=e,o.basePos=o.overlayPos=e.start),e.start==o.basePos&&(o.baseCur=a.token(e,o.base),o.basePos=e.pos),e.start==o.overlayPos&&(e.pos=e.start,o.overlayCur=n.token(e,o.overlay),o.overlayPos=e.pos),e.pos=Math.min(o.basePos,o.overlayPos),null==o.overlayCur?o.baseCur:null!=o.baseCur&&o.overlay.combineTokens||t&&null==o.overlay.combineTokens?o.baseCur+" "+o.overlayCur:o.overlayCur},indent:a.indent&&function(e,o,r){return a.indent(e.base,o,r)},electricChars:a.electricChars,innerMode:function(e){return{state:e.base,mode:a}},blankLine:function(e){var o,r;return a.blankLine&&(o=a.blankLine(e.base)),null==(r=n.blankLine?n.blankLine(e.overlay):r)?o:t&&null!=o?o+" "+r:r}}}});

;
/*!-- addon mode/simple | https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.5/addon/mode/simple.min.js | 5.65.5 | 4026B | sha1 dd29da7a | deps=[] --*/
!function(e){"object"==typeof exports&&"object"==typeof module?e(require("../../lib/codemirror")):"function"==typeof define&&define.amd?define(["../../lib/codemirror"],e):e(CodeMirror)}(function(v){"use strict";function h(e,t){if(!e.hasOwnProperty(t))throw new Error("Undefined state "+t+" in simple mode")}function k(e,t){if(!e)return/(?:)/;var n="";return e=e instanceof RegExp?(e.ignoreCase&&(n="i"),e.unicode&&(n+="u"),e.source):String(e),new RegExp((!1===t?"":"^")+"(?:"+e+")",n)}function g(e,t){(e.next||e.push)&&h(t,e.next||e.push),this.regex=k(e.regex),this.token=function(e){if(!e)return null;if(e.apply)return e;if("string"==typeof e)return e.replace(/\./g," ");for(var t=[],n=0;n<e.length;n++)t.push(e[n]&&e[n].replace(/\./g," "));return t}(e.token),this.data=e}v.defineSimpleMode=function(e,t){v.defineMode(e,function(e){return v.simpleMode(e,t)})},v.simpleMode=function(e,t){h(t,"start");var n,a={},o=t.meta||{},r=!1;for(n in t)if(n!=o&&t.hasOwnProperty(n))for(var i=a[n]=[],l=t[n],s=0;s<l.length;s++){var d=l[s];i.push(new g(d,t)),(d.indent||d.dedent)&&(r=!0)}var c,p,S,m,u={startState:function(){return{state:"start",pending:null,local:null,localState:null,indent:r?[]:null}},copyState:function(e){var t={state:e.state,pending:e.pending,local:e.local,localState:null,indent:e.indent&&e.indent.slice(0)};e.localState&&(t.localState=v.copyState(e.local.mode,e.localState)),e.stack&&(t.stack=e.stack.slice(0));for(var n=e.persistentStates;n;n=n.next)t.persistentStates={mode:n.mode,spec:n.spec,state:n.state==e.localState?t.localState:v.copyState(n.mode,n.state),next:t.persistentStates};return t},token:(m=e,function(e,t){var n,a;if(t.pending)return a=t.pending.shift(),0==t.pending.length&&(t.pending=null),e.pos+=a.text.length,a.token;if(t.local)return t.local.end&&e.match(t.local.end)?(n=t.local.endToken||null,t.local=t.localState=null):(n=t.local.mode.token(e,t.localState),t.local.endScan&&(a=t.local.endScan.exec(e.current()))&&(e.pos=e.start+a.index)),n;for(var o=S[t.state],r=0;r<o.length;r++){var i=o[r],l=(!i.data.sol||e.sol())&&e.match(i.regex);if(l){if(i.data.next?t.state=i.data.next:i.data.push?((t.stack||(t.stack=[])).push(t.state),t.state=i.data.push):i.data.pop&&t.stack&&t.stack.length&&(t.state=t.stack.pop()),i.data.mode){h=d=f=s=u=p=c=d=void 0;var s,d=m,c=t,p=i.data.mode,u=i.token;if(p.persistent)for(var f=c.persistentStates;f&&!s;f=f.next)(p.spec?function e(t,n){if(t===n)return!0;if(!t||"object"!=typeof t||!n||"object"!=typeof n)return!1;var a=0;for(var o in t)if(t.hasOwnProperty(o)){if(!n.hasOwnProperty(o)||!e(t[o],n[o]))return!1;a++}for(var o in n)n.hasOwnProperty(o)&&a--;return 0==a}(p.spec,f.spec):p.mode==f.mode)&&(s=f);var d=s?s.mode:p.mode||v.getMode(d,p.spec),h=s?s.state:v.startState(d);p.persistent&&!s&&(c.persistentStates={mode:d,spec:p.spec,state:h,next:c.persistentStates}),c.localState=h,c.local={mode:d,end:p.end&&k(p.end),endScan:p.end&&!1!==p.forceEnd&&k(p.end,!1),endToken:u&&u.join?u[u.length-1]:u}}i.data.indent&&t.indent.push(e.indentation()+m.indentUnit),i.data.dedent&&t.indent.pop();h=i.token;if(h&&h.apply&&(h=h(l)),2<l.length&&i.token&&"string"!=typeof i.token){for(var g=2;g<l.length;g++)l[g]&&(t.pending||(t.pending=[])).push({text:l[g],token:i.token[g-1]});return e.backUp(l[0].length-(l[1]?l[1].length:0)),h[0]}return h&&h.join?h[0]:h}}return e.next(),null}),innerMode:function(e){return e.local&&{mode:e.local.mode,state:e.localState}},indent:(c=S=a,function(e,t,n){if(e.local&&e.local.mode.indent)return e.local.mode.indent(e.localState,t,n);if(null==e.indent||e.local||p.dontIndentStates&&-1<function(e,t){for(var n=0;n<t.length;n++)if(t[n]===e)return!0}(e.state,p.dontIndentStates))return v.Pass;var a=e.indent.length-1,o=c[e.state];e:for(;;){for(var r=0;r<o.length;r++){var i=o[r];if(i.data.dedent&&!1!==i.data.dedentIfLineStart){var l=i.regex.exec(t);if(l&&l[0]){a--,(i.next||i.push)&&(o=c[i.next||i.push]),t=t.slice(l[0].length);continue e}}}break}return a<0?0:e.indent[a]})};if(p=o)for(var f in o)o.hasOwnProperty(f)&&(u[f]=o[f]);return u}});

;
/*!-- addon autoCloseBrackets | 原文件 tools/upstream/autoCloseBrackets.js（carbon-app/carbon lib/custom/autoCloseBrackets.js，文件头保留 "CodeMirror, copyright (c) by Marijn Haverbeke and others / MIT license"） | 6525B | sha1 36af5299 | 改造：剥掉 import CodeMirror from 'codemirror' → IIFE 形参注入全局。不加载上游 addon/edit/closebrackets，因为本副本自己 CodeMirror.defineOption('autoCloseBrackets', ...) --*/
(function (CodeMirror) {
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE
/* (tools/build-vendor.js) 已剥掉原第 3 行的 ESM 静态引入（codemirror → 全局），classic script 下无需改写变量名 */

let defaults = {
  pairs: '()[]{}\'\'""',
  closeBefore: ')]}\'":;>',
  triples: '',
  explode: '[]{}',
}

let Pos = CodeMirror.Pos

CodeMirror.defineOption('autoCloseBrackets', false, function (cm, val, old) {
  if (old && old != CodeMirror.Init) {
    cm.removeKeyMap(keyMap)
    cm.state.closeBrackets = null
  }
  if (val) {
    ensureBound(getOption(val, 'pairs'))
    cm.state.closeBrackets = val
    cm.addKeyMap(keyMap)
  }
})

function getOption(conf, name) {
  if (name == 'pairs' && typeof conf == 'string') return conf
  if (typeof conf == 'object' && conf[name] != null) return conf[name]
  return defaults[name]
}

let keyMap = { Backspace: handleBackspace, Enter: handleEnter }
function ensureBound(chars) {
  for (let i = 0; i < chars.length; i++) {
    let ch = chars.charAt(i),
      key = "'" + ch + "'"
    if (!keyMap[key]) keyMap[key] = handler(ch)
  }
}
ensureBound(defaults.pairs + '`')

function handler(ch) {
  return function (cm) {
    return handleChar(cm, ch)
  }
}

function getConfig(cm) {
  let deflt = cm.state.closeBrackets
  if (!deflt || deflt.override) return deflt
  let mode = cm.getModeAt(cm.getCursor())
  return mode.closeBrackets || deflt
}

function handleBackspace(cm) {
  let conf = getConfig(cm)
  if (!conf || cm.getOption('disableInput')) return CodeMirror.Pass

  let pairs = getOption(conf, 'pairs')
  let ranges = cm.listSelections()
  for (let i = 0; i < ranges.length; i++) {
    if (!ranges[i].empty()) return CodeMirror.Pass
    let around = charsAround(cm, ranges[i].head)
    if (!around || pairs.indexOf(around) % 2 != 0) return CodeMirror.Pass
  }
  for (let i = ranges.length - 1; i >= 0; i--) {
    let cur = ranges[i].head
    cm.replaceRange('', Pos(cur.line, cur.ch - 1), Pos(cur.line, cur.ch + 1), '+delete')
  }
}

function handleEnter(cm) {
  let conf = getConfig(cm)
  let explode = conf && getOption(conf, 'explode')
  if (!explode || cm.getOption('disableInput')) return CodeMirror.Pass

  let ranges = cm.listSelections()
  for (let i = 0; i < ranges.length; i++) {
    if (!ranges[i].empty()) return CodeMirror.Pass
    let around = charsAround(cm, ranges[i].head)
    if (!around || explode.indexOf(around) % 2 != 0) return CodeMirror.Pass
  }
  cm.operation(function () {
    let linesep = cm.lineSeparator() || '\n'
    cm.replaceSelection(linesep + linesep, null)
    moveSel(cm, -1)
    ranges = cm.listSelections()
    for (let i = 0; i < ranges.length; i++) {
      let line = ranges[i].head.line
      cm.indentLine(line, null, true)
      cm.indentLine(line + 1, null, true)
    }
  })
}

function moveSel(cm, dir) {
  let newRanges = [],
    ranges = cm.listSelections(),
    primary = 0
  for (let i = 0; i < ranges.length; i++) {
    let range = ranges[i]
    if (range.head == cm.getCursor()) primary = i
    let pos =
      range.head.ch || dir > 0
        ? { line: range.head.line, ch: range.head.ch + dir }
        : { line: range.head.line - 1 }
    newRanges.push({ anchor: pos, head: pos })
  }
  cm.setSelections(newRanges, primary)
}

function contractSelection(sel) {
  let inverted = CodeMirror.cmpPos(sel.anchor, sel.head) > 0
  return {
    anchor: new Pos(sel.anchor.line, sel.anchor.ch + (inverted ? -1 : 1)),
    head: new Pos(sel.head.line, sel.head.ch + (inverted ? 1 : -1)),
  }
}

function handleChar(cm, ch) {
  let conf = getConfig(cm)
  if (!conf || cm.getOption('disableInput')) return CodeMirror.Pass

  let pairs = getOption(conf, 'pairs')
  let pos = pairs.indexOf(ch)
  if (pos == -1) return CodeMirror.Pass

  let closeBefore = getOption(conf, 'closeBefore')

  let triples = getOption(conf, 'triples')

  let identical = pairs.charAt(pos + 1) == ch
  let ranges = cm.listSelections()
  let opening = pos % 2 == 0

  let type
  for (let i = 0; i < ranges.length; i++) {
    let range = ranges[i],
      cur = range.head,
      curType
    let next = cm.getRange(cur, Pos(cur.line, cur.ch + 1))
    if (opening && !range.empty()) {
      curType = 'surround'
    } else if ((identical || !opening) && next == ch) {
      if (identical && stringStartsAfter(cm, cur)) curType = 'both'
      else if (
        triples.indexOf(ch) >= 0 &&
        cm.getRange(cur, Pos(cur.line, cur.ch + 3)) == ch + ch + ch
      )
        curType = 'skipThree'
      else curType = 'skip'
    } else if (
      identical &&
      cur.ch > 1 &&
      triples.indexOf(ch) >= 0 &&
      cm.getRange(Pos(cur.line, cur.ch - 2), cur) == ch + ch
    ) {
      if (cur.ch > 2 && /\bstring/.test(cm.getTokenTypeAt(Pos(cur.line, cur.ch - 2))))
        return CodeMirror.Pass
      curType = 'addFour'
    } else if (identical) {
      let prev = cur.ch == 0 ? ' ' : cm.getRange(Pos(cur.line, cur.ch - 1), cur)
      if (!CodeMirror.isWordChar(next) && prev != ch && !CodeMirror.isWordChar(prev))
        curType = 'both'
      else return CodeMirror.Pass
    } else if (
      opening &&
      (next.length === 0 || /\s/.test(next) || closeBefore.indexOf(next) > -1)
    ) {
      curType = 'both'
    } else {
      return CodeMirror.Pass
    }
    if (!type) type = curType
    else if (type != curType) return CodeMirror.Pass
  }

  let left = pos % 2 ? pairs.charAt(pos - 1) : ch
  let right = pos % 2 ? ch : pairs.charAt(pos + 1)
  cm.operation(function () {
    if (type == 'skip') {
      moveSel(cm, 1)
    } else if (type == 'skipThree') {
      moveSel(cm, 3)
    } else if (type == 'surround') {
      let sels = cm.getSelections()
      for (let i = 0; i < sels.length; i++) sels[i] = left + sels[i] + right
      cm.replaceSelections(sels, 'around')
      sels = cm.listSelections().slice()
      for (let i = 0; i < sels.length; i++) sels[i] = contractSelection(sels[i])
      cm.setSelections(sels)
    } else if (type == 'both') {
      cm.replaceSelection(left + right, null)
      cm.triggerElectric(left + right)
      moveSel(cm, -1)
    } else if (type == 'addFour') {
      cm.replaceSelection(left + left + left + left, 'before')
      moveSel(cm, 1)
    }
  })
}

function charsAround(cm, pos) {
  let str = cm.getRange(Pos(pos.line, pos.ch - 1), Pos(pos.line, pos.ch + 1))
  return str.length == 2 ? str : null
}

function stringStartsAfter(cm, pos) {
  let token = cm.getTokenAt(Pos(pos.line, pos.ch + 1))
  return (
    /\bstring/.test(token.type) &&
    token.start == pos.ch &&
    (pos.ch == 0 || !/\bstring/.test(cm.getTokenTypeAt(pos)))
  )
}
})(CodeMirror)
