// Offline code coloring: splits code into comment, string, number, keyword and plain tokens. The
// renderer turns each token into a text node inside a <span>; no HTML is ever built from code.
// Plain script: loaded by index.html (global functions) and by the tests through require().

interface Token {
  t: string; // the text, exactly as in the source
  k: '' | 'com' | 'str' | 'num' | 'kw';
}
interface Lang {
  line: string[]; // line comment starts
  block: [string, string][]; // block comment start/end
  strings: string[]; // string delimiters, longest first
  keywords: Set<string>;
  hashWord?: boolean; // css: #abc is a color, not a comment
}

const words = (s: string) => new Set(s.split(' '));
const C_LIKE = { line: ['//'], block: [['/*', '*/']] as [string, string][], strings: ['"', "'"] };
const LANGS: Record<string, Lang> = {
  js: { ...C_LIKE, strings: ['`', '"', "'"], keywords: words('async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield interface type enum implements readonly public private protected as declare namespace abstract') },
  python: { line: ['#'], block: [], strings: ['"""', "'''", '"', "'"], keywords: words('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self') },
  json: { line: [], block: [], strings: ['"'], keywords: words('true false null') },
  bash: { line: ['#'], block: [], strings: ['"', "'"], keywords: words('if then else elif fi for while until do done case esac in function return exit export local readonly echo cd set unset source') },
  html: { line: [], block: [['<!--', '-->']], strings: ['"', "'"], keywords: words('') },
  css: { line: [], block: [['/*', '*/']], strings: ['"', "'"], keywords: words('important inherit initial unset none auto'), hashWord: true },
  c: { ...C_LIKE, keywords: words('auto bool break case char class const constexpr continue default delete do double else enum extern false float for friend goto if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while NULL include define') },
  java: { ...C_LIKE, keywords: words('abstract boolean break byte case catch char class const continue default do double else enum extends false final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws true try var void volatile while') },
  rust: { ...C_LIKE, strings: ['"'], keywords: words('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while') },
  go: { ...C_LIKE, strings: ['`', '"', "'"], keywords: words('break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var') },
  sql: { line: ['--'], block: [['/*', '*/']], strings: ["'", '"'], keywords: words('select from where and or not null is in as join left right inner outer on group by order having limit offset insert into values update set delete create table alter drop index view primary key foreign references distinct union all case when then else end asc desc count sum avg min max') },
};
const ALIASES: Record<string, string> = {
  javascript: 'js', jsx: 'js', ts: 'js', tsx: 'js', typescript: 'js', mjs: 'js', py: 'python', python3: 'python', sh: 'bash', shell: 'bash', zsh: 'bash',
  xml: 'html', svg: 'html', scss: 'css', 'c++': 'c', cpp: 'c', h: 'c', hpp: 'c', cc: 'c', rs: 'rust', golang: 'go', jsonc: 'json',
};
const MAX_HIGHLIGHT_LINES = 2000;

/** The language name to show and its rules (null: unknown, shown without colors). */
function langOf(name: string): Lang | null {
  const n = name.trim().toLowerCase();
  return LANGS[ALIASES[n] ?? n] ?? null;
}

/** Split code into tokens. The token texts joined together are always exactly the input. */
function tokenize(code: string, name: string): Token[] {
  const lang = langOf(name);
  if (!lang || code.split('\n').length > MAX_HIGHLIGHT_LINES) return [{ t: code, k: '' }];
  const out: Token[] = [];
  const push = (t: string, k: Token['k']) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.k === k) last.t += t;
    else out.push({ t, k });
  };
  const sql = lang === LANGS.sql;
  let i = 0;
  while (i < code.length) {
    const rest = code.startsWith.bind(code);
    const block = lang.block.find(([a]) => rest(a, i));
    if (block) {
      const end = code.indexOf(block[1], i + block[0].length);
      const stop = end < 0 ? code.length : end + block[1].length;
      push(code.slice(i, stop), 'com');
      i = stop;
      continue;
    }
    if (lang.line.some((a) => rest(a, i)) && !(lang === LANGS.bash && i > 0 && /[\w$]/.test(code[i - 1]))) {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? code.length : end;
      push(code.slice(i, stop), 'com');
      i = stop;
      continue;
    }
    const q = lang.strings.find((a) => rest(a, i));
    if (q) {
      let j = i + q.length;
      const multi = q.length === 3 || q === '`';
      while (j < code.length && !rest(q, j)) {
        if (code[j] === '\\') j++;
        else if (code[j] === '\n' && !multi) break; // an unclosed string ends with its line
        j++;
      }
      const stop = Math.min(code.length, rest(q, j) ? j + q.length : j);
      push(code.slice(i, stop), 'str');
      i = stop;
      continue;
    }
    const ch = code[i];
    if (/[0-9]/.test(ch) && !(i > 0 && /[\w$]/.test(code[i - 1]))) {
      const m = /^(0[xX][0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)[a-zA-Z%]*/.exec(code.slice(i, i + 64))!;
      push(m[0], 'num');
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch) || (lang.hashWord && ch === '#')) {
      const m = /^[#A-Za-z_$][\w$-]*/.exec(code.slice(i, i + 128))!;
      const w = lang.hashWord ? m[0] : m[0].replace(/-.*$/, '') || m[0];
      push(w, lang.keywords.has(sql ? w.toLowerCase() : w) ? 'kw' : '');
      i += w.length;
      continue;
    }
    push(ch, '');
    i++;
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { tokenize, langOf };
