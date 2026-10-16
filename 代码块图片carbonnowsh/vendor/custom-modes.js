/*!
 * vendor/custom-modes.js — Carbon 自带 / npm 补充的 CodeMirror 自定义 mode（classic script）
 * 加载顺序：codemirror.min.js → addons.js → modes.js → custom-modes.js（本文件）。
 * 这些 mode 只用到 core 的 defineMode/defineMIME（vm 实测无 addon 依赖，见 vendor/README.md 的 API 调用记录）。
 * 剔除 graphql: codemirror-graphql@2.2.9 无 UMD/global 产物：main=index.js(CJS)+esm/index.js(ESM)，mode.js → utils/mode-factory.js → require("graphql-language-service")（本身又依赖 graphql parser 与 vscode-languageserver-types）。要当 classic script 用必须打包 graphql-js，超出 vendor 范畴。影响显示名：GraphQL（LANGUAGES 中 {name:"GraphQL",mode:"graphql"}，无 short、无 highlight → 只丢 CM 着色，不丢 hljs 自动检测）。CM5 对未知 mode 不抛错，实测 getMode({},"graphql") 返回 null mode → 该语言显示为无高亮纯文本。
 * 生成器: node tools/build-vendor.js
 */

/*!-- custom mode apache | 原文件 apache.js（carbon-app/carbon lib/custom/modes） | 3381B | sha1 f046ffa5 | CodeMirror Apache mode (作者 gloony，文件头 "Distributed under an MIT license") | 改造：剥离 require('codemirror') → IIFE 形参注入全局 CodeMirror --*/
(function (CodeMirror) {
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE
// Apache mode by gloony


CodeMirror.defineMode('apache', function (/* config */) {
  return {
    token: function (stream, state) {
      var sol = stream.sol() || state.afterSection
      var eol = stream.eol()

      state.afterSection = false

      if (sol) {
        if (state.nextMultiline) {
          state.inMultiline = true
          state.nextMultiline = false
        } else {
          state.position = 'def'
        }
      }

      if (eol && !state.nextMultiline) {
        state.inMultiline = false
        state.position = 'def'
      }

      if (sol) {
        while (stream.eatSpace()) {
          /* pass */
        }
      }

      var ch = stream.next()

      if (sol && ch === '#') {
        state.position = 'comment'
        stream.skipToEnd()
        return 'comment'
      } else if (ch === '!' && stream.peek() !== ' ') {
        return 'number'
      } else if (ch === ' ') {
        if (stream.peek() === '[') {
          if (stream.skipTo(']')) {
            stream.next()
          } else {
            stream.skipToEnd()
          }
          return 'keyword'
        } else if (stream.peek() === '(') {
          if (stream.skipTo(')')) {
            stream.next()
          } else {
            stream.skipToEnd()
          }
          return 'string'
        } else {
          state.position = 'unit'
          return 'unit'
        }
      } else if (ch === '"') {
        if (stream.skipTo('"')) {
          stream.next()
        } else {
          stream.skipToEnd()
        }
        return 'quote'
      } else if (sol && ch === '<') {
        if (stream.skipTo('>')) {
          stream.next()
        } else {
          stream.skipToEnd()
        }
        return 'meta'
      } else if (ch === '%') {
        if (stream.peek() === '{') {
          if (stream.skipTo('}')) {
            stream.next()
          } else {
            stream.skipToEnd()
          }
          return 'operator'
        }
      } else if (ch === '$') {
        if (!isNaN(stream.peek()) && stream.peek() !== ' ') {
          while (!isNaN(stream.peek()) && stream.peek() !== ' ') {
            stream.next()
          }
          return 'operator'
        }
      } else if (ch === '\\') {
        if (stream.peek() === '.') {
          if (stream.skipTo(' ')) {
            stream.next()
          } else {
            stream.skipToEnd()
          }
          return 'string'
        }
      } else if (ch === '.') {
        if (stream.peek() === '*') {
          if (stream.skipTo(' ')) {
            stream.next()
          } else {
            stream.skipToEnd()
          }
          return 'string'
        }
      } else if (ch === '^') {
        if (stream.skipTo(' ')) {
          stream.next()
        } else {
          stream.skipToEnd()
        }
        return 'string'
      }

      return state.position
    },

    // electricInput: /<\/[\s\w:]+>$/,
    lineComment: '#',
    fold: 'brace',

    startState: function () {
      return {
        position: 'def',
        nextMultiline: false,
        inMultiline: false,
        afterSection: false,
      }
    },
  }
})

CodeMirror.defineMIME('text/apache', 'apache')
CodeMirror.defineMIME('text/htaccess', 'apache')
})(CodeMirror)

;
/*!-- custom mode nim | 原文件 nim.js（carbon-app/carbon lib/custom/modes） | 12453B | sha1 15cf806f | CodeMirror Nim mode | 改造：剥离 require('codemirror') → IIFE 形参注入全局 CodeMirror --*/
(function (CodeMirror) {
CodeMirror.defineMode('nim', function (conf, parserConf) {
  var ERRORCLASS = 'error'

  function wordRegexp(words) {
    return new RegExp('^((' + words.join(')|(') + '))\\b')
  }

  var ops = [
    '=',
    '+',
    '-',
    '*',
    '/',
    '<',
    '>',
    '@',
    '$',
    '~',
    '&',
    '%',
    '|',
    '?',
    '^',
    ':',
    '\\',
    '[',
    ']',
    '(',
    ')',
    ',',
    '{',
    '}',
    '.\\.',
    '.',
  ]
  var operators = new RegExp(
    ops
      .map(function (op) {
        return '\\' + op
      })
      .join('|')
  )
  var identifiers = new RegExp('^[_A-Za-z][_A-Za-z0-9]*')

  var commonkeywords = [
    'addr',
    'asm',
    'atomic',
    'bind',
    'block',
    'break',
    'case',
    'cast',
    'const',
    'continue',
    'converter',
    'discard',
    'distinct',
    'do',
    'elif',
    'else',
    'end',
    'enum',
    'except',
    'export',
    'finally',
    'for',
    'from',
    'generic',
    'if',
    'import',
    'include',
    'interface',
    'iterator',
    'lambda',
    'let',
    'macro',
    'method',
    'mixin',
    'nil',
    'object',
    'out',
    'proc',
    'ptr',
    'raise',
    'ref',
    'return',
    'shared',
    'static',
    'template',
    'try',
    'tuple',
    'type',
    'using',
    'var',
    'when',
    'while',
    'with',
    'without',
    'yield',

    // keyword operators
    'shl',
    'shr',
    'and',
    'or',
    'xor',
    'not',
    'div',
    'mod',
    'is',
    'isnot',
    'in',
    'as',
    'of',
  ]

  var commonBuiltins = [
    'int',
    'int8',
    'int16',
    'int32',
    'int64',
    'uint',
    'uint8',
    'uint16',
    'uint32',
    'uint64',
    'float',
    'float32',
    'float64',
    'bool',
    'char',
    'string',
    'cstring',
    'pointer',
    'range',
    'array',
    'openarray',
    'seq',
    'set',
    'Byte',
    'Natural',
    'Positive',
    'TObject',
    'PObject',
    'Conversion',
    'TResult',
    'TAddress',
    'BiggestInt',
    'BiggestFloat',
    'cchar',
    'cschar',
    'cshort',
    'cint',
    'csize',
    'cuchar',
    'cushort',
    'clong',
    'clonglong',
    'cfloat',
    'cdouble',
    'clongdouble',
    'cuint',
    'culong',
    'culonglong',
    'cchar',
    'cstringArray',
    'TEndian',
    'PFloat32',
    'PFloat64',
    'PInt64',
    'PInt32',
    'TGC_Strategy',
    'TFile',
    'TFileMode',
    'TFileHandle',
    'isMainModule',
    'CompileDate',
    'CompileTime',
    'cpuEndian',
    'hostOS',
    'hostCPU',
    'inf',
    'neginf',
    'nan',
    'QuitSuccess',
    'QuitFailure',
    'dbgLineHook',
    'stdin',
    'stdout',
    'stderr',
    'defined',
    'new',
    'high',
    'low',
    'sizeof',
    'succ',
    'pred',
    'inc',
    'dec',
    'newSeq',
    'len',
    'incl',
    'excl',
    'card',
    'ord',
    'chr',
    'ze',
    'ze64',
    'toU8',
    'toU16',
    'toU32',
    'abs',
    'min',
    'max',
    'add',
    'repr',
    'contains',
    'toFloat',
    'toBiggestFloat',
    'toInt',
    'toBiggestInt',
    'addQuitProc',
    'copy',
    'setLen',
    'newString',
    'zeroMem',
    'copyMem',
    'moveMem',
    'equalMem',
    'alloc',
    'alloc0',
    'realloc',
    'dealloc',
    'setLen',
    'assert',
    'swap',
    'getRefcount',
    'getCurrentException',
    'Msg',
    'getOccupiedMem',
    'getFreeMem',
    'getTotalMem',
    'isNil',
    'seqToPtr',
    'find',
    'pop',
    'GC_disable',
    'GC_enable',
    'GC_fullCollect',
    'GC_setStrategy',
    'GC_enableMarkAnd',
    'Sweep',
    'GC_disableMarkAnd',
    'Sweep',
    'GC_getStatistics',
    'GC_ref',
    'GC_ref',
    'GC_ref',
    'GC_unref',
    'GC_unref',
    'GC_unref',
    'quit',
    'OpenFile',
    'OpenFile',
    'CloseFile',
    'EndOfFile',
    'readChar',
    'FlushFile',
    'readFile',
    'write',
    'readLine',
    'writeln',
    'writeln',
    'getFileSize',
    'ReadBytes',
    'ReadChars',
    'readBuffer',
    'writeBytes',
    'writeChars',
    'writeBuffer',
    'setFilePos',
    'getFilePos',
    'fileHandle',
    'countdown',
    'countup',
    'items',
    'lines',
    'true',
    'false',

    // exceptions
    'E_Base',
    'EAsynch',
    'ESynch',
    'ESystem',
    'EIO',
    'EOS',
    'ERessourceExhausted',
    'EArithmetic',
    'EDivByZero',
    'EOverflow',
    'EAccessViolation',
    'EAssertionFailed',
    'EControlC',
    'EInvalidValue',
    'EOutOfMemory',
    'EInvalidIndex',
    'EInvalidField',
    'EOutOfRange',
    'EStackOverflow',
    'ENoExceptionToReraise',
    'EInvalidObjectAssignment',
    'EInvalidObject',
    'EInvalidLibrary',
    'EInvalidKey',
    'EInvalidObjectConversion',
    'EFloatingPoint',
    'EFloatInvalidOp',
    'EFloatDivByZero',
    'EFloatOverflow',
    'EFloatInexact',
    'EDeadThrea',
  ]

  if (parserConf.extra_keywords != undefined)
    commonkeywords = commonkeywords.concat(parserConf.extra_keywords)

  if (parserConf.extra_builtins != undefined)
    commonBuiltins = commonBuiltins.concat(parserConf.extra_builtins)

  var keywords = wordRegexp(commonkeywords)
  var builtins = wordRegexp(commonBuiltins)

  var indentInfo = null

  var stringPrefixes = new RegExp('^((\'{3}|"{3}|[\'"]))', 'i')

  // tokenizers
  function tokenBase(stream, state) {
    // Handle scope changes
    if (stream.sol()) {
      var scopeOffset = state.scopes[0].offset
      if (stream.eatSpace()) {
        var lineOffset = stream.indentation()
        if (lineOffset > scopeOffset) {
          indentInfo = 'indent'
        } else if (lineOffset < scopeOffset) {
          indentInfo = 'dedent'
        }
        return null
      } else {
        if (scopeOffset > 0) {
          dedent(stream, state)
        }
      }
    }

    if (stream.eatSpace()) return null

    var ch = stream.peek()

    // Handle Comments
    if (ch === '#') {
      stream.skipToEnd()
      return 'comment'
    }

    // Handle Number Literals
    if (stream.match(/^[0-9.]/, false)) {
      var floatLiteral = false
      // Floats
      if (stream.match(/^\d*\.\d+(e[+-]?\d+)?/i)) {
        floatLiteral = true
      }
      if (stream.match(/^\d+\.\d*/)) {
        floatLiteral = true
      }
      if (stream.match(/^\.\d+/)) {
        floatLiteral = true
      }
      if (floatLiteral) {
        // Float literals may be "imaginary"
        stream.eat(/J/i)
        return 'number'
      }
      // Integers
      var intLiteral = false
      // Hex
      if (stream.match(/^0x[0-9a-f]+/i)) {
        intLiteral = true
      }
      // Binary
      if (stream.match(/^0b[01]+/i)) {
        intLiteral = true
      }
      // Octal
      if (stream.match(/^0o[0-7]+/i)) {
        intLiteral = true
      }
      // Decimal
      if (stream.match(/^[1-9]\d*(e[+-]?\d+)?/)) {
        // Decimal literals may be "imaginary"
        stream.eat(/J/i)
        intLiteral = true
      }
      // Zero by itself with no other piece of number.
      if (stream.match(/^0(?![\dx])/i)) {
        intLiteral = true
      }
      if (intLiteral) {
        // Integer literals may be "long"
        stream.eat(/L/i)
        return 'number'
      }
    }

    // Handle Strings
    if (stream.match(stringPrefixes)) {
      state.tokenize = tokenStringFactory(stream.current())
      return state.tokenize(stream, state)
    }

    if (stream.match(operators)) return 'operator'

    if (stream.match(keywords)) return 'keyword'

    if (stream.match(builtins)) return 'builtin'

    if (stream.match(identifiers)) {
      if (
        state.lastToken != null &&
        state.lastToken.match(/proc|iterator|macro|template|class|converter/)
      ) {
        return 'def'
      }

      return 'variable'
    }

    // Handle non-detected items
    stream.next()
    return ERRORCLASS
  }

  function tokenStringFactory(delimiter) {
    var singleline = delimiter.length == 1
    var OUTCLASS = 'string'

    function tokenString(stream, state) {
      while (!stream.eol()) {
        stream.eatWhile(/[^'"\\]/)
        if (stream.eat('\\')) {
          stream.next()
          if (singleline && stream.eol()) {
            return OUTCLASS
          }
        } else if (stream.match(delimiter)) {
          state.tokenize = tokenBase
          return OUTCLASS
        } else {
          stream.eat(/['"]/)
        }
      }
      if (singleline) {
        if (parserConf.singleLineStringErrors) {
          return ERRORCLASS
        } else {
          state.tokenize = tokenBase
        }
      }
      return OUTCLASS
    }

    tokenString.isString = true
    return tokenString
  }

  function indent(stream, state, type) {
    type = type || 'nim'
    var indentUnit = 0
    if (type === 'nim') {
      if (state.scopes[0].type !== 'nim') {
        state.scopes[0].offset = stream.indentation()
        return
      }
      for (var i = 0; i < state.scopes.length; ++i) {
        if (state.scopes[i].type === 'nim') {
          indentUnit = state.scopes[i].offset + conf.indentUnit
          break
        }
      }
    } else {
      indentUnit = stream.column() + stream.current().length
    }

    state.scopes.unshift({
      offset: indentUnit,
      type: type,
    })
  }

  function dedent(stream, state, type) {
    type = type || 'nim'
    if (state.scopes.length == 1) return
    if (state.scopes[0].type === 'nim') {
      var _indent = stream.indentation()
      var _indent_index = -1
      for (var i = 0; i < state.scopes.length; ++i) {
        if (_indent === state.scopes[i].offset) {
          _indent_index = i
          break
        }
      }
      if (_indent_index === -1) {
        return true
      }
      while (state.scopes[0].offset !== _indent) {
        state.scopes.shift()
      }
      return false
    } else {
      if (type === 'nim') {
        state.scopes[0].offset = stream.indentation()
        return false
      } else {
        if (state.scopes[0].type != type) {
          return true
        }
        state.scopes.shift()
        return false
      }
    }
  }

  function tokenLexer(stream, state) {
    indentInfo = null
    var style = state.tokenize(stream, state)
    var current = stream.current()

    // Handle '.' connected identifiers
    if (current === '.') {
      style = stream.match(identifiers, false) ? null : ERRORCLASS
      if (style === null && state.lastStyle === 'meta') {
        // Apply 'meta' style to '.' connected identifiers when
        // appropriate.
        style = 'meta'
      }
      return style
    }

    if ((style === 'variable' || style === 'builtin') && state.lastStyle === 'meta') {
      style = 'meta'
    }

    // Handle scope changes.
    if (current.match(/return|break|continue|raise/) || (current === 'discard' && stream.eol()))
      state.dedent += 1

    if (current === 'lambda' || current === 'proc') state.lambda = true

    var delimiter_index = '[({'.indexOf(current)

    if (delimiter_index !== -1) {
      indent(stream, state, '])}'.slice(delimiter_index, delimiter_index + 1))
    } else if (stream.eol() && current.match(/=|:|import|include|type|const|var|let/)) {
      indent(stream, state)
    }

    if (indentInfo === 'dedent') {
      if (dedent(stream, state)) {
        return ERRORCLASS
      }
    }

    delimiter_index = '])}'.indexOf(current)
    if (delimiter_index !== -1) {
      if (dedent(stream, state, current)) {
        return ERRORCLASS
      }
    }

    if (state.dedent > 0 && stream.eol() && state.scopes[0].type == 'nim') {
      if (state.scopes.length > 1) state.scopes.shift()
      state.dedent -= 1
    }

    return style
  }

  var external = {
    startState: function (basecolumn) {
      return {
        tokenize: tokenBase,
        scopes: [{ offset: basecolumn || 0, type: 'nim' }],
        lastStyle: null,
        lastToken: null,
        lambda: false,
        dedent: 0,
      }
    },

    token: function (stream, state) {
      var style = tokenLexer(stream, state)

      state.lastStyle = style

      var current = stream.current()
      if (current && style) state.lastToken = current

      if (stream.eol() && state.lambda) state.lambda = false

      return style
    },

    indent: function (state) {
      if (state.tokenize != tokenBase) return state.tokenize.isString ? CodeMirror.Pass : 0

      return state.scopes[0].offset
    },

    lineComment: '#',
    fold: 'indent',
  }

  return external
})

CodeMirror.defineMIME('text/x-nim', 'nim')
})(CodeMirror)

;
/*!-- custom mode riscv | 原文件 riscv.js（carbon-app/carbon lib/custom/modes） | 12831B | sha1 a0ed1ef2 | RISC-V mode，源自 kvvakil/venus（文件头注明 fork by matthewnielsen27） | 改造：剥离 require('codemirror') → IIFE 形参注入全局 CodeMirror --*/
(function (CodeMirror) {
/*
  RISC-V Code Mirror Mode

  Based on the mode present in the Venus Simulator
    Author: kvakil
    Source: https://github.com/kvakil/venus

  Forked by Matthew Nielsen (github.com/matthewnielsen27)
*/


CodeMirror.defineMode('riscv', function (/* config */) {
  function regexFromWords(words, ins) {
    return new RegExp('^(?:' + words.join('|') + ')$', ins)
  }

  // Instructions
  // Part 1) Base Integer Instructions
  //        a) Loads
  //        b) Stores
  //        c) Shifts
  //        d) Arithmetic
  //        e) Logical
  //        f) Compare
  //        g) Branches
  //        h) Jump & Link
  //        i) Synch
  //        j) System
  //        k) Counters
  // Part 2) RV Privileged Instructions
  //        a) CSR Access
  //        b) Change Level
  //        c) Trap Redirect
  // Part 3) Optional Multiply-Divide Instruction Extension: RVM
  //        a) Multiply
  //        b) Divide
  //        c) Remainder
  // Part 4) Pseudo Instructions
  //        a) Standard
  //        b) Non-Standard
  // Part 5) Optional Compressed (16-bit) Instruction Extension: RVC
  //        a) Loads
  //        b) Stores
  //        c) Arithmetic
  //        d) Shifts
  //        e) Branches
  //        f) Jump
  //        g) Jump & Link
  //        h) System
  // Part 6) Optional Atomic Instruction Extension: RVA
  //        a) Load
  //        b) Store
  //        c) Swap
  //        d) Add
  //        e) Logical
  //        f) Min\Max
  // Part 7) Optional Floating-Point Instruction Extension: RVF, RVD, & RVQ
  //        a) Move
  //        b) Convert
  //        c) Load
  //        d) Store
  //        e) Arithmetic
  //        f) Mui-Add
  //        g) Sign Inject
  //        h) Min/Max
  //        i) Compare
  //        j) Categorization
  //        k) Configuration
  var instructions = regexFromWords(
    [
      // Part 1) Base Integer Instructions
      //        a) Loads
      //          I) RV32I
      'lb',
      'lh',
      'lw',
      'lbu',
      'lhu',
      //          II) RV64I and RV128I
      'ld',
      'lq',
      'lwu',
      'ldu',
      //        b) Stores
      //          I) RV32I
      'sb',
      'sh',
      'sw',
      //          II) RV64I and RV128I
      'sd',
      'sq',
      //        c) Shifts
      //          I) RV32I
      'sll',
      'slli',
      'srl',
      'srli',
      'sra',
      'srai',
      //          II) RV64I and RV128I
      'sllw',
      'slliw',
      'srlw',
      'srliw',
      'sraw',
      'sraiw',
      'slld',
      'sllid',
      'srld',
      'srlid',
      'srad',
      'sraid',
      //        d) Arithmetic
      //          I) RV32I
      'add',
      'addi',
      'sub',
      'lui',
      'auipc',
      //          II) RV64I and RV128I
      'addw',
      'addiw',
      'subw',
      'addd',
      'addid',
      'subd',
      //        e) Logical
      'xor',
      'xori',
      'or',
      'ori',
      'and',
      'andi',
      //        f) Compare
      'slt',
      'slti',
      'sltu',
      'sltiu',
      //        g) Branches
      'beq',
      'bne',
      'blt',
      'bge',
      'bltu',
      'bgeu',
      //        h) Jump & Link
      'jal',
      'jalr',
      //        i) Synch
      'fence',
      'fence.i',
      //        j) System
      'scall',
      'sbreak',
      //        k) Counters
      'rdcycle',
      'rdcycleh',
      'rdtime',
      'rdtimeh',
      'rdinstret',
      'rdinstreth',

      // Part 2) RV Privileged Instructions
      //        a) CSR Access
      'csrrw',
      'csrrs',
      'csrrc',
      'csrrwi',
      'csrrsi',
      'csrrci',
      //        b) Change Level
      'ecall',
      'ebreak',
      'eret',
      //        c) Trap Redirect
      'mrts',
      'mrth',
      'hrts',

      // Part 3) Optional Multiply-Divide Instruction Extension: RVM
      //        a) Multiply
      //          I) RV32M
      'mul',
      'mulh',
      'mulhsu',
      //          II) RV64M and RV128M
      'mulw',
      'muld',
      //        b) Divide
      //          I) RV32M
      'div',
      'divu',
      //          II) RV64M and RV128M
      'divw',
      'divd',
      //        c) Remainder
      //          I) RV32M
      'rem',
      'remu',
      //          II) RV64M and RV128M
      'remw',
      'remuw',
      'remd',
      'remud',

      // Part 4) Pseudo Instructions
      //        a) Standard Pseudo Instructions
      'beqz',
      'bgez',
      'bgt',
      'bgtu',
      'bgtz',
      'ble',
      'bleu',
      'blez',
      'bltz',
      'bnez',
      'call',
      'j',
      'jr',
      'la',
      'li',
      'mv',
      'neg',
      'nop',
      'ret',
      'not',
      'ret',
      'seqz',
      'sgtz',
      'sltz',
      'snez',
      'tail',
      //        b) Non-Standard Pseudo Instructions
      'seq',
      'sge',
      'sgeu',
      'sgt',
      'sgtu',
      'sle',
      'sleu',
      'sne',
      // Part 5) Optional Compressed (16-bit) Instruction Extension: RVC
      //        a) Loads
      'c.lw',
      'c.lwsp',
      'c.ld',
      'c.ldsp',
      'c.lq',
      'c.lqsp',
      //        b) Stores
      'c.sw',
      'c.swsp',
      'c.sd',
      'c.sdsp',
      'c.sq',
      'c.sqsp',
      //        c) Arithmetic
      'c.add',
      'c.addw',
      'c.addi',
      'c.addiw',
      'c.addi16sp',
      'c.addi2spn',
      'c.li',
      'c.lui',
      'c.mv',
      'c.sub',
      //        d) Shifts
      'c.slli',
      //        e) Branches
      'c.beqz',
      'c.bnez',
      //        f) Jump
      'c.j',
      'c.jr',
      //        g) Jump & Link
      'c.jal',
      'c.jalr',
      //        h) System
      'c.ebreak',
      // Part 6) Optional Atomic Instruction Extrnsion: RVA
      //        a) Load
      //          I) RV32A
      'lr.w',
      //          II) RV64A and RV128A
      'lr.d',
      'lr.q',
      //        b) Store
      //          I) RV32A
      'sc.w',
      //          II) RV64A and RV128A
      'sc.d',
      'sc.q',
      //        c) Swap
      //          I) RV32A
      'amoswap.w',
      //          II) RV64A and RV128A
      'amoswap.d',
      'amoswap.q',
      //        d) Add
      //          I) RV32A
      'amoadd.w',
      //          II) RV64A and RV128A
      'amoadd.d',
      'amoadd.q',
      //        e) Logical
      //          I) RV32A
      'amoxor.w',
      'amoand.w',
      'amoor.w',
      //          II) RV64A and RV128A
      'amoxor.d',
      'amoand.d',
      'amoor.d',
      'amoxor.q',
      'amoand.q',
      'amoor.q',
      //        f) Min\Max
      //          I) RV32A
      'amomin.w',
      'amomax.w',
      'amominu.w',
      'amomax.w',
      //          II) RV64A and RV128A
      'amomin.d',
      'amomax.d',
      'amominu.d',
      'amomax.d',
      'amomin.q',
      'amomax.q',
      'amominu.q',
      'amomax.q',
      // Part 7) Optional Floating-Point Instruction Extension: RVF, RVD, & RVQ
      //        a) Move
      //          I) RV32-
      'fmv.h.x',
      'fmv.s.s',
      'fmv.x.h',
      'fmv.x.s',
      //          II) RV64- and RV128-
      'fmv.d.x',
      'fmv.q.s',
      'fmv.d.h',
      'fmv.q.s',
      //        b) Convert
      //          I) RV32-
      'fcvt.h.w',
      'fcvt.s.w',
      'fcvt.d.w',
      'fcvt.q.w',
      'fcvt.h.wu',
      'fcvt.s.wu',
      'fcvt.d.wu',
      'fcvt.q.wu',
      'fcvt.w.h',
      'fcvt.w.s',
      'fcvt.w.d',
      'fcvt.w.q',
      'fcvt.wu.h',
      'fcvt.w.s',
      'fcvt.w.d',
      'fcvt.w.q',
      //          II) RV64- and RV128-
      'fcvt.h.l',
      'fcvt.h.t',
      'fcvt.h.lu',
      'fcvt.h.tu',
      'fcvt.s.l',
      'fcvt.s.t',
      'fcvt.s.lu',
      'fcvt.s.tu',
      'fcvt.d.l',
      'fcvt.d.t',
      'fcvt.d.lu',
      'fcvt.d.tu',
      'fcvt.q.l',
      'fcvt.q.t',
      'fcvt.q.lu',
      'fcvt.q.tu',
      'fcvt.l.h',
      'fcvt.t.h',
      'fcvt.lu.h',
      'fcvt.tu.h',
      'fcvt.l.s',
      'fcvt.t.s',
      'fcvt.lu.s',
      'fcvt.tu.s',
      'fcvt.l.d',
      'fcvt.t.d',
      'fcvt.lu.d',
      'fcvt.tu.d',
      'fcvt.l.q',
      'fcvt.t.q',
      'fcvt.lu.q',
      'fcvt.tu.q',
      //        c) Load
      'flw',
      'fld',
      'flq',
      //        d) Store
      'fsw',
      'fsd',
      'fsq',
      //        e) Arithmetic
      'fadd.s',
      'fsub.s',
      'fmul.s',
      'fdiv.s',
      'fsqrt.s',
      'fadd.d',
      'fsub.d',
      'fmul.d',
      'fdiv.d',
      'fsqrt.d',
      'fadd.q',
      'fsub.q',
      'fmul.q',
      'fdiv.q',
      'fsqrt.q',
      //        f) Mul-Add
      'fmadd.d',
      'fmsub.d',
      'fnmsub.d',
      'fnmadd.d',
      'fmadd.d',
      'fmsub.d',
      'fnmsub.d',
      'fnmadd.d',
      'fmadd.q',
      'fmsub.q',
      'fnmsub.q',
      'fnmadd.q',
      //        g) Sign Inject
      'fsgnj.s',
      'fsgnjn.s',
      'fsgnjx.s',
      'fsgnj.d',
      'fsgnjn.d',
      'fsgnjx.d',
      'fsgnj.q',
      'fsgnjn.q',
      'fsgnjx.q',
      //        h) Min/Max
      'fmin.s',
      'fmax.s',
      'fmin.d',
      'fmax.d',
      'fmin.q',
      'fmax.q',
      //        i) Compare
      'feq.s',
      'flt.s',
      'fle.s',
      'feq.d',
      'flt.d',
      'fle.d',
      'feq.q',
      'flt.q',
      'fle.q',
      //        j) Categorization
      'fclass.s',
      'fclass.d',
      'fclass.q',
      //        k) Configuration
      'frcsr',
      'frrm',
      'frflags',
      'fscsr',
      'fsrm',
      'fsflags',
      'fsrmi',
      'fsflagsi',
    ],
    'i'
  )

  // Registers
  // Part 1) Actual Register Values
  // Part 2) Application Binary Interface
  var registers = regexFromWords(
    [
      // Part 1) Actual Register Values
      'x0',
      'x1',
      'x2',
      'x3',
      'x4',
      'x5',
      'x6',
      'x7',
      'x8',
      'x9',
      'x10',
      'x11',
      'x12',
      'x13',
      'x14',
      'x15',
      'x16',
      'x17',
      'x18',
      'x19',
      'x20',
      'x21',
      'x22',
      'x23',
      'x24',
      'x25',
      'x26',
      'x27',
      'x28',
      'x29',
      'x30',
      'x31',

      // Part 2) Application Binary Interface
      'zero',
      'ra',
      'sp',
      'gp',
      'tp',
      't0',
      't1',
      't2',
      's0',
      's1',
      'a0',
      'a1',
      'a2',
      'a3',
      'a4',
      'a5',
      'a6',
      'a7',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
      's8',
      's9',
      's10',
      's11',
      't3',
      't4',
      't5',
      't6',
      'pc',
    ],
    ''
  )

  // Keywords
  // Part 1) Pseudo Operations
  var keywords = regexFromWords(
    [
      // Part 1) Pseudo Operations
      '.align',
      '.file',
      '.globl',
      '.local',
      '.comm',
      '.common',
      '.ident',
      '.section',
      '.size',
      '.text',
      '.data',
      '.rodata',
      '.bss',
      '.string',
      '.asciz',
      '.asciiz',
      '.equ',
      '.macro',
      '.endm',
      '.type',
      '.option',
      '.byte',
      '.2byte',
      '.half',
      '.short',
      '.4byte',
      '.word',
      '.long',
      '.8byte',
      '.dword',
      '.quad',
      '.dtprelword',
      '.dtpreldword',
      '.sleb128',
      '.uleb128',
      '.p2align',
      '.balign',
      '.zero',
      '.float',
      '.double',
    ],
    'i'
  )

  function normal(stream, state) {
    var ch = stream.next()

    if (ch == '#') {
      stream.skipToEnd()

      return 'comment'
    }

    if (ch == '"' || ch == "'") {
      state.cur = string(ch)

      return state.cur(stream, state)
    }

    if (/\d/.test(ch)) {
      stream.eatWhile(/[\w.%]/)

      // Handle numeric labels
      if (stream.peek() === ':') {
        return 'variable'
      }

      return 'number'
    }

    if (/[.\w_]/.test(ch)) {
      stream.eatWhile(/[\w\\\-_.]/)

      return 'variable'
    }

    return null
  }

  function string(quote) {
    return function (stream, state) {
      var escaped = false,
        ch

      while ((ch = stream.next()) != null) {
        if (ch == quote && !escaped) break

        escaped = !escaped && ch == '\\'
      }
      if (!escaped) state.cur = normal

      return 'string'
    }
  }

  return {
    startState: function (basecol) {
      return { basecol: basecol || 0, indentDepth: 0, cur: normal }
    },

    token: function (stream, state) {
      if (stream.eatSpace()) return null

      var style = state.cur(stream, state)

      var word = stream.current()

      if (style == 'variable') {
        if (keywords.test(word)) style = 'keyword'
        else if (instructions.test(word)) style = 'builtin'
        else if (registers.test(word)) style = 'variable-2'
      }
      return style
    },
  }
})

CodeMirror.defineMIME('text/riscv', 'riscv')
})(CodeMirror)

;
/*!-- custom mode solidity | 原文件 solidity.js（carbon-app/carbon lib/custom/modes） | 15213B | sha1 c35564cf | codemirror-solidity by alincode（文件头 "Distributed under MIT"） | 改造：剥离 require('codemirror') → IIFE 形参注入全局 CodeMirror --*/
(function (CodeMirror) {
/**
 * codemirror-solidity by alincode — https://github.com/alincode/codemirror-solidity
 * Distributed under MIT
 */
/* eslint-disable */
'use strict'

CodeMirror.defineMode('solidity', function (config) {
  let indentUnit = config.indentUnit

  // let functionKeyword = 'function'
  // let functionNameKeyword = 'Name'
  // let leftBracketSign = '('
  // let rightBracketSign = ')'
  // let functionVariableName = 'variable'
  // let keyWordContract = 'contract'

  let keywords = {
    pragma: true,
    solidity: true,
    import: true,
    as: true,
    from: true,
    contract: true,
    constructor: true,
    is: true,
    function: true,
    modifier: true,
    // modifiers
    pure: true,
    view: true,
    payable: true,
    constant: true,
    anonymous: true,
    indexed: true,
    returns: true,
    return: true,
    event: true,
    struct: true,
    mapping: true,
    interface: true,
    using: true,
    library: true,
    storage: true,
    memory: true,
    calldata: true,
    public: true,
    private: true,
    external: true,
    internal: true,
    emit: true,
    assembly: true,
    abstract: true,
    after: true,
    catch: true,
    final: true,
    in: true,
    inline: true,
    let: true,
    match: true,
    null: true,
    of: true,
    relocatable: true,
    static: true,
    try: true,
    typeof: true,
    var: true,
  }

  let keywordsSpecial = {
    pragma: true,
    returns: true,
    address: true,
    contract: true,
    function: true,
    struct: true,
  }

  let keywordsEtherUnit = {
    wei: true,
    szabo: true,
    finney: true,
    ether: true,
  }
  let keywordsTimeUnit = {
    seconds: true,
    minutes: true,
    hours: true,
    days: true,
    weeks: true,
  }
  let keywordsBlockAndTransactionProperties = {
    ['block']: ['coinbase', 'difficulty', 'gaslimit', 'number', 'timestamp'],
    ['msg']: ['data', 'sender', 'sig', 'value'],
    ['tx']: ['gasprice', 'origin'],
  }
  let keywordsMoreBlockAndTransactionProperties = {
    now: true,
    gasleft: true,
    blockhash: true,
  }
  let keywordsErrorHandling = {
    assert: true,
    require: true,
    revert: true,
    throw: true,
  }
  let keywordsMathematicalAndCryptographicFuctions = {
    addmod: true,
    mulmod: true,
    keccak256: true,
    sha256: true,
    ripemd160: true,
    ecrecover: true,
  }
  let keywordsContractRelated = {
    this: true,
    selfdestruct: true,
    super: true,
  }
  let keywordsTypeInformation = { type: true }
  let keywordsContractList = {}

  let keywordsControlStructures = {
    if: true,
    else: true,
    while: true,
    do: true,
    for: true,
    break: true,
    continue: true,
    switch: true,
    case: true,
    default: true,
  }

  let keywordsValueTypes = {
    bool: true,
    byte: true,
    string: true,
    enum: true,
    address: true,
  }

  let keywordsV0505NewReserve = {
    alias: true,
    apply: true,
    auto: true,
    copyof: true,
    define: true,
    immutable: true,
    implements: true,
    macro: true,
    mutable: true,
    override: true,
    partial: true,
    promise: true,
    reference: true,
    sealed: true,
    sizeof: true,
    supports: true,
    typedef: true,
    unchecked: true,
  }

  let keywordsAbiEncodeDecodeFunctions = {
    ['abi']: ['decode', 'encodePacked', 'encodeWithSelector', 'encodeWithSignature', 'encode'],
  }

  let keywordsMembersOfAddressType = [
    'transfer',
    'send',
    'balance',
    'call',
    'delegatecall',
    'staticcall',
  ]

  let natSpecTags = ['title', 'author', 'notice', 'dev', 'param', 'return']

  // let functionStructureStage = [{
  //   function: ['function', 'returns']
  // },
  //   leftBracketSign,
  //   parameterName,
  //   parameterValue,
  //   rightBracketSign,
  // ];

  let atoms = {
    delete: true,
    new: true,
    true: true,
    false: true,
    //  "iota": true, "nil": true, "append": true,
    // "cap": true, "close": true, "complex": true, "copy": true, "imag": true,
    // "make": true,  "panic": true, "print": true,
    // "println": true, "real": true, "recover": true
  }

  let isOperatorChar = /[+\-*&^%:=<>!|\/~]/
  let isNegativeChar = /[-]/

  let curPunc

  function tokenBase(stream, state) {
    let ch = stream.next()

    if (ch == '"' || ch == "'" || ch == '`') {
      state.tokenize = tokenString(ch)
      return state.tokenize(stream, state)
    }

    if (isVersion(stream, state)) return 'version'

    if (
      ch == '.' &&
      keywordsMembersOfAddressType.some(function (item) {
        return stream.match(`${item}`)
      })
    )
      return 'addressFunction'

    if (isNumber(ch, stream)) return 'number'

    if (/[\[\]{}\(\),;\:\.]/.test(ch)) {
      return updateGarmmer(ch, state)
    }

    if (ch == '/') {
      if (stream.eat('*')) {
        state.tokenize = tokenComment
        return tokenComment(stream, state)
      }
      if (stream.match(/\/{2}/)) {
        while ((ch = stream.next())) {
          if (ch == '@') {
            stream.backUp(1)
            state.grammar = 'doc'
            break
          }
        }
        return 'doc'
      }

      if (stream.eat('/')) {
        stream.skipToEnd()
        return 'comment'
      }
    }

    if (isNegativeChar.test(ch)) {
      if (isNumber(stream.peek(), stream)) return 'number'
      return 'operator'
    }

    if (isOperatorChar.test(ch)) {
      stream.eatWhile(isOperatorChar)
      return 'operator'
    }
    stream.eatWhile(/[\w\$_\xa1-\uffff]/)

    let cur = stream.current()

    if (state.grammar == 'doc') {
      if (
        natSpecTags.some(function (item) {
          return cur == `@${item}`
        })
      )
        return 'docReserve'
      return 'doc'
    }

    if (cur === 'solidity' && state.lastToken == 'pragma') {
      state.lastToken = state.lastToken + ' ' + cur
    }

    if (keywords.propertyIsEnumerable(cur)) {
      if (cur == 'case' || cur == 'default') curPunc = 'case'
      if (keywordsSpecial.propertyIsEnumerable(cur)) state.lastToken = cur
      //if (cur == 'function' && state.para == 'parameterMode')
      return 'keyword'
    }

    if (keywordsEtherUnit.propertyIsEnumerable(cur)) return 'etherUnit'
    if (keywordsContractRelated.propertyIsEnumerable(cur)) return 'contractRelated'
    if (
      keywordsControlStructures.propertyIsEnumerable(cur) ||
      keywordsTypeInformation.propertyIsEnumerable(cur) ||
      keywordsV0505NewReserve.propertyIsEnumerable(cur)
    )
      return 'keyword'
    if (
      keywordsValueTypes.propertyIsEnumerable(cur) ||
      keywordsTimeUnit.propertyIsEnumerable(cur) ||
      isValidInteger(cur) ||
      isValidBytes(cur) ||
      isValidFixed(cur)
    ) {
      state.lastToken = state.lastToken + 'variable'
      return 'keyword'
    }

    if (atoms.propertyIsEnumerable(cur)) return 'atom'
    if (keywordsErrorHandling.propertyIsEnumerable(cur)) return 'errorHandling'
    if (keywordsMathematicalAndCryptographicFuctions.propertyIsEnumerable(cur))
      return 'mathematicalAndCryptographic'

    if (
      keywordsMoreBlockAndTransactionProperties.propertyIsEnumerable(cur) ||
      (keywordsBlockAndTransactionProperties.hasOwnProperty(cur) &&
        keywordsBlockAndTransactionProperties[cur].some(function (item) {
          return stream.match(`.${item}`)
        }))
    )
      return 'variable-2'

    if (
      keywordsAbiEncodeDecodeFunctions.hasOwnProperty(cur) &&
      keywordsAbiEncodeDecodeFunctions[cur].some(function (item) {
        return stream.match(`.${item}`)
      })
    )
      return 'abi'

    let style = updateHexLiterals(cur, stream)
    if (style != null) return style

    if (
      (state.lastToken == 'functionName(' || state.lastToken == 'returns(') &&
      keywordsContractList.propertyIsEnumerable(cur)
    ) {
      state.lastToken += 'variable'
      return 'variable'
    }
    if (state.lastToken == 'function') {
      state.lastToken = 'functionName'
      if (state.para == null) {
        state.grammar = 'function'
        state.para = ''
      }
      //state.parasMode = isNaN(state.parasMode) ? 1 : state.functionLayerCount++;
      state.para += 'functionName'
      return 'functionName'
    }

    if (state.lastToken == 'functionName(variable') {
      state.lastToken = 'functionName('
      return 'parameterValue'
    }

    if (state.lastToken == 'returns(variable') {
      state.lastToken = 'returns('
      return 'parameterValue'
    }

    if (state.lastToken == 'address' && cur == 'payable') {
      state.lastToken = 'address payable'
    }
    if (state.lastToken == 'contract' || state.lastToken == 'struct') {
      keywordsContractList[cur] = true
      state.lastToken = null
    }
    if (state.grammar == 'function') {
      return 'parameterValue'
    }

    return 'variable'
  }

  function tokenString(quote) {
    return function (stream, state) {
      let escaped = false,
        next,
        end = false
      while ((next = stream.next()) != null) {
        if (next == quote && !escaped) {
          end = true
          break
        }
        escaped = !escaped && quote != '`' && next == '\\'
      }
      if (end || !(escaped || quote == '`')) state.tokenize = tokenBase
      return 'string'
    }
  }

  function tokenComment(stream, state) {
    let maybeEnd = false,
      ch
    while ((ch = stream.next())) {
      if (ch == '/' && maybeEnd) {
        state.tokenize = tokenBase
        break
      }
      maybeEnd = ch == '*'
    }
    return 'comment'
  }

  function isVersion(stream, state) {
    if (state.lastToken == 'pragma solidity') {
      state.lastToken = null
      return (
        !state.startOfLine &&
        (stream.match(/[\^{0}][0-9\.]+/) ||
          stream.match(/[\>\=]+?[\s]*[0-9\.]+[\s]*[\<]?[\s]*[0-9\.]+/))
      )
    }
  }

  function isNumber(ch, stream) {
    if (/[\d\.]/.test(ch)) {
      if (ch == '.') {
        stream.match(/^[0-9]+([eE][\-+]?[0-9]+)?/)
      } else if (ch == '0') {
        stream.match(/^[xX][0-9a-fA-F]+/) || stream.match(/^0[0-7]+/)
      } else {
        stream.match(/^[0-9]*\.?[0-9]*([eE][\-+]?[0-9]+)?/)
      }
      return true
    }
  }

  function isValidInteger(token) {
    if (token.match(/^[u]?int/)) {
      if (token.indexOf('t') + 1 == token.length) return true
      let numberPart = token.substr(token.indexOf('t') + 1, token.length)
      return numberPart % 8 === 0 && numberPart <= 256
    }
  }

  function isValidBytes(token) {
    if (token.match(/^bytes/)) {
      if (token.indexOf('s') + 1 == token.length) return true
      let bytesPart = token.substr(token.indexOf('s') + 1, token.length)
      return bytesPart <= 32
    }
  }

  function isValidFixed(token) {
    if (token.match(/^[u]?fixed([0-9]+x[0-9]+)?/)) {
      if (token.indexOf('d') + 1 == token.length) return true
      let numberPart = token.substr(token.indexOf('d') + 1, token.length).split('x')
      return numberPart[0] % 8 === 0 && numberPart[0] <= 256 && numberPart[1] <= 80
    }
  }

  function updateHexLiterals(token, stream) {
    if (token.match(/^hex/) && stream.peek() == '"') {
      let maybeEnd = false,
        ch,
        hexValue = '',
        stringAfterHex = ''
      while ((ch = stream.next())) {
        stringAfterHex += ch
        if (ch == '"' && maybeEnd) {
          hexValue = stringAfterHex.substring(1, stringAfterHex.length - 1)
          if (hexValue.match(/^[0-9a-fA-F]+$/)) {
            return 'number'
          } else {
            stream.backUp(stringAfterHex.length)
          }
          break
        }
        maybeEnd = maybeEnd || ch == '"'
      }
    }
  }

  function updateGarmmer(ch, state) {
    if (ch == ',' && state.para == 'functionName(variable') {
      state.para = 'functionName('
    }
    if (state.para != null && state.para.startsWith('functionName')) {
      if (ch == ')') {
        if (state.para.endsWith('(')) {
          state.para = state.para.substr(0, state.para.length - 1)
          if (state.para == 'functionName') state.grammar = ''
        }
      } else if (ch == '(') {
        state.para += ch
      }
    }

    if (ch == '(' && state.lastToken == 'functionName') {
      state.lastToken += ch
    } else if (ch == ')' && state.lastToken == 'functionName(') {
      state.lastToken = null
    } else if (ch == '(' && state.lastToken == 'returns') {
      state.lastToken += ch
    } else if (
      ch == ')' &&
      (state.lastToken == 'returns(' || state.lastToken == 'returns(variable')
    ) {
      state.lastToken = null
    }
    if (ch == '(' && state.lastToken == 'address') {
      state.lastToken += ch
    }
    curPunc = ch
    return null
  }

  function Context(indented, column, type, align, prev) {
    this.indented = indented
    this.column = column
    this.type = type
    this.align = align
    this.prev = prev
  }
  function pushContext(state, col, type) {
    return (state.context = new Context(state.indented, col, type, null, state.context))
  }
  function popContext(state) {
    if (!state.context.prev) return
    let t = state.context.type
    if (t == ')' || t == ']' || t == '}') state.indented = state.context.indented
    return (state.context = state.context.prev)
  }

  // Interface
  return {
    startState: function (basecolumn) {
      return {
        tokenize: null,
        context: new Context((basecolumn || 0) - indentUnit, 0, 'top', false),
        indented: 0,
        startOfLine: true,
      }
    },

    token: function (stream, state) {
      let ctx = state.context
      if (stream.sol()) {
        if (ctx.align == null) ctx.align = false
        state.indented = stream.indentation()
        state.startOfLine = true
        if (ctx.type == 'case') ctx.type = '}'
        if (state.grammar == 'doc') state.grammar = null
      }
      if (stream.eatSpace()) return null
      curPunc = null
      let style = (state.tokenize || tokenBase)(stream, state)

      if (style == 'comment') return style
      if (ctx.align == null) ctx.align = true

      if (curPunc == '{') pushContext(state, stream.column(), '}')
      else if (curPunc == '[') pushContext(state, stream.column(), ']')
      else if (curPunc == '(') pushContext(state, stream.column(), ')')
      else if (curPunc == 'case') ctx.type = 'case'
      else if (curPunc == '}' && ctx.type == '}') popContext(state)
      else if (curPunc == ctx.type) popContext(state)
      state.startOfLine = false
      return style
    },

    indent: function (state, textAfter) {
      if (state.tokenize != tokenBase && state.tokenize != null) return CodeMirror.Pass
      let ctx = state.context,
        firstChar = textAfter && textAfter.charAt(0)
      if (ctx.type == 'case' && /^(?:case|default)\b/.test(textAfter)) {
        state.context.type = '}'
        return ctx.indented
      }
      let closing = firstChar == ctx.type
      if (ctx.align) return ctx.column + (closing ? 0 : 1)
      else return ctx.indented + (closing ? 0 : indentUnit)
    },

    electricChars: '{}):',
    closeBrackets: '()[]{}\'\'""``',
    fold: 'brace',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    lineComment: '//',
  }
})

CodeMirror.defineMIME('text/x-solidity', 'solidity')
})(CodeMirror)

;
/*!-- custom mode elixir | https://registry.npmmirror.com/codemirror-mode-elixir/-/codemirror-mode-elixir-1.1.2.tgz 内 dist/codemirror-mode-elixir.umd.js | v1.1.2 | 4909B | sha1 52200e5b | MIT (npm codemirror-mode-elixir@1.1.2 LICENSE: "MIT License / Copyright (c) 2016 Ian Walter") | 改造：UMD 浏览器分支 t(e.codemirror) → t(e.CodeMirror)（原产物取 window.codemirror 小写，classic 下为 undefined 会 TypeError），并删掉 sourceMappingURL 注释 --*/
!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(require("codemirror")):"function"==typeof define&&define.amd?define(["codemirror"],t):t(e.CodeMirror)}(this,function(e){(e=e&&e.hasOwnProperty("default")?e.default:e).defineMode("elixir",function(e){var t,n=function(e){for(var t={},n=0,r=e.length;n<r;++n)t[e[n]]=!0;return t},r=n(["alias","case","cond","def","defmodule","defp","defstruct","defprotocol","defimpl","defmacro","quote","unquote","receive","fn","do","else","else if","end","false","if","in","next","rescue","for","true","unless","when","nil","raise","throw","try","catch","after","with","require","use","__MODULE__","__FILE__","__DIR__","__ENV__","__CALLER__"]),o=n(["def","defmodule","defp","case","cond","rescue","try","catch","->"]),i=n(["end"]),a={"[":"]","{":"}","(":")"},u=function(e,t,n){return n.tokenize.push(e),e(t,n)},f=function(e,n){if(e.sol()&&e.match('"""')&&e.eol())return n.tokenize.push(p),"comment";if(e.eatSpace())return null;var r,o=e.next();if("'"===o||'"'===o)return u(l(o,"string",'"'===o),e,n);if("/"===o){var i=e.current().length;if(e.skipTo("/")){var f=e.current().length,d=0;for(e.backUp(e.current().length-i);e.current().length<f;){var c=e.next();if("("===c?d+=1:")"===c&&(d-=1),d<0)break}if(e.backUp(e.current().length-i),0===d)return u(l(o,"string-2",!0),e,n)}return"operator"}if("%"===o){var k="string",m=!0;e.eat("s")?k="atom":e.eat(/[WQ]/)?k="string":e.eat(/[r]/)?k="string-2":e.eat(/[wxq]/)&&(k="string",m=!1);var h=e.eat(/[^\w\s=]/);return h?(a.propertyIsEnumerable(h)&&(h=a[h]),u(l(h,k,m,!0),e,n)):"operator"}if("#"===o)return e.skipToEnd(),"comment";if("<"===o&&(r=e.match(/^<-?[\`\"\']?([a-zA-Z_?]\w*)[\`\"\']?(?:;|$)/)))return u(s(r[1]),e,n);if("0"===o)return e.eat("x")?e.eatWhile(/[\da-fA-F]/):e.eat("b")?e.eatWhile(/[01]/):e.eatWhile(/[0-7]/),"number";if(/\d/.test(o))return e.match(/^[\d_]*(?:\.[\d_]+)?(?:[eE][+\-]?[\d_]+)?/),"number";if("?"===o){for(;e.match(/^\\[CM]-/););return e.eat("\\")?e.eatWhile(/\w/):e.next(),"string"}return":"===o?e.eat("'")?u(l("'","atom",!1),e,n):e.eat('"')?u(l('"',"atom",!0),e,n):e.eat(/[\<\>]/)?(e.eat(/[\<\>]/),"atom"):e.eat(/[\+\-\*\/\&\|\:\!]/)?"atom":e.eat(/[a-zA-Z$@_\xa1-\uffff]/)?(e.eatWhile(/[\w$\xa1-\uffff]/),e.eat(/[\?\!\=]/),"atom"):"operator":"@"===o&&e.match(/^@?[a-zA-Z_\xa1-\uffff]/)?(e.eat("@"),e.eatWhile(/[\w\xa1-\uffff]/),"variable-2"):"$"===o?(e.eat(/[a-zA-Z_]/)?e.eatWhile(/[\w]/):e.eat(/\d/)?e.eat(/\d/):e.next(),"variable-3"):/[a-zA-Z_\xa1-\uffff]/.test(o)?(e.eatWhile(/[\w\xa1-\uffff]/),e.eat(/[\?\!]/),e.eat(":")?"atom":"ident"):"|"!==o||!n.varList&&"{"!==n.lastTok&&"do"!==n.lastTok?/[\(\)\[\]{}\\;]/.test(o)?(t=o,null):"-"===o&&e.eat(">")?"arrow":"|"===o&&e.eat(">")?"pipe":/[=+\-\/*:\.^%<>~|]/.test(o)?("."!==o||e.eatWhile(/[=+\-\/*:\.^%<>~|]/)||(t="."),"operator"):null:(t="|",null)},d=function(e){return e||(e=1),function(t,n){if("}"===t.peek()){if(1===e)return n.tokenize.pop(),n.tokenize[n.tokenize.length-1](t,n);n.tokenize[n.tokenize.length-1]=d(e-1)}else"{"===t.peek()&&(n.tokenize[n.tokenize.length-1]=d(e+1));return f(t,n)}},c=function(){var e=!1;return function(t,n){return e?(n.tokenize.pop(),n.tokenize[n.tokenize.length-1](t,n)):(e=!0,f(t,n))}},l=function(e,t,n,r){return function(o,i){var a,u=!1;for("read-quoted-paused"===i.context.type&&(i.context=i.context.prev,o.eat("}"));null!=(a=o.next());){if(a===e&&(r||!u)){i.tokenize.pop();break}if(n&&"#"===a&&!u){if(o.eat("{")){"}"===e&&(i.context={prev:i.context,type:"read-quoted-paused"}),i.tokenize.push(d());break}if(/[@\$]/.test(o.peek())){i.tokenize.push(c());break}}u=!u&&"\\"===a}return t}},s=function(e){return function(t,n){return t.match(e)?n.tokenize.pop():t.skipToEnd(),"string"}},p=function(e,t){return e.sol()&&e.match('"""')&&e.eol()&&t.tokenize.pop(),e.skipToEnd(),"comment"};return{startState:function(){return{tokenize:[f],indented:0,context:{type:"top",indented:-e.indentUnit},continuedLine:!1,lastTok:null,varList:!1}},token:function(e,n){t=null;var a,u=n.tokenize[n.tokenize.length-1](e,n),f=t;if("ident"===u){var d=e.current();u="."===n.lastTok?"property":r.propertyIsEnumerable(e.current())?"keyword":/^[A-Z]/.test(d)?"tag":"def"===n.lastTok||"class"===n.lastTok||n.varList?"def":"variable";var c=e.column()===e.indentation();"keyword"===u&&(f=d,o.propertyIsEnumerable(d)?a="indent":i.propertyIsEnumerable(d)?a="dedent":"if"!==d&&"unless"!==d||!c?"do"===d&&n.context.indented<n.indented&&(a="indent"):a="indent")}return(t||u&&"comment"!==u)&&(n.lastTok=f),"|"===t&&(n.varList=!n.varList),"indent"===a||/[\(\[\{]/.test(t)?n.context={prev:n.context,type:t||u,indented:n.indented}:("dedent"===a||/[\)\]\}]/.test(t))&&n.context.prev&&(n.context=n.context.prev),e.eol()&&(n.continuedLine="\\"===t||"operator"===u),u},electricInput:/^\s*(?:end|rescue|else if|else|catch\})$/,lineComment:"#"}}),e.defineMIME("text/x-elixir","elixir")});
