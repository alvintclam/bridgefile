// Lightweight syntax highlighter (no external deps)
// Tokens are emitted as HTML-safe strings with Tailwind color classes.

export type Language =
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'python'
  | 'shell'
  | 'yaml'
  | 'html'
  | 'css'
  | 'markdown'
  | 'sql'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'ruby'
  | 'php'
  | 'xml'
  | 'plain';

const EXT_MAP: Record<string, Language> = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.json': 'json',
  '.py': 'python',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.env': 'shell',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.md': 'markdown', '.markdown': 'markdown',
  '.sql': 'sql',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'c', '.hpp': 'c', '.cc': 'c', '.hh': 'c',
  '.rb': 'ruby',
  '.php': 'php',
  '.xml': 'xml', '.svg': 'xml',
};

const COMMON_KEYWORDS: Record<Language, string[]> = {
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'null', 'undefined', 'true', 'false', 'delete', 'void', 'yield', 'static'],
  typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'null', 'undefined', 'true', 'false', 'delete', 'void', 'yield', 'static', 'interface', 'type', 'enum', 'public', 'private', 'protected', 'readonly', 'abstract', 'implements', 'namespace', 'as', 'satisfies'],
  python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'pass', 'break', 'continue', 'global', 'nonlocal', 'async', 'await', 'self'],
  shell: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'in', 'export', 'local', 'unset', 'source'],
  go: ['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'return', 'go', 'defer', 'select', 'nil', 'true', 'false', 'iota'],
  rust: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl', 'pub', 'mod', 'use', 'crate', 'self', 'super', 'as', 'if', 'else', 'match', 'for', 'while', 'loop', 'return', 'break', 'continue', 'true', 'false', 'async', 'await', 'move', 'ref', 'where', 'dyn'],
  java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'static', 'final', 'abstract', 'void', 'int', 'long', 'boolean', 'double', 'float', 'char', 'byte', 'short', 'return', 'new', 'this', 'super', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'true', 'false', 'null', 'import', 'package'],
  c: ['int', 'long', 'short', 'char', 'float', 'double', 'void', 'unsigned', 'signed', 'const', 'static', 'extern', 'struct', 'union', 'enum', 'typedef', 'sizeof', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'goto', 'default', 'include', 'define', 'ifdef', 'ifndef', 'endif', 'class', 'namespace', 'public', 'private', 'protected', 'virtual', 'template', 'typename', 'true', 'false', 'nullptr', 'new', 'delete', 'this'],
  ruby: ['def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'case', 'when', 'then', 'while', 'until', 'for', 'in', 'do', 'return', 'yield', 'begin', 'rescue', 'ensure', 'raise', 'nil', 'true', 'false', 'self', 'require', 'include', 'extend', 'attr_reader', 'attr_writer', 'attr_accessor'],
  php: ['function', 'class', 'interface', 'trait', 'extends', 'implements', 'public', 'private', 'protected', 'static', 'abstract', 'final', 'return', 'if', 'else', 'elseif', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'use', 'namespace', 'true', 'false', 'null', 'require', 'include'],
  sql: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'INTO', 'VALUES', 'SET', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX', 'VIEW', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'CONSTRAINT'],
  yaml: [],
  json: [],
  html: [],
  css: [],
  markdown: [],
  xml: [],
  plain: [],
};

export function detectLanguage(fileName: string): Language {
  const lower = fileName.toLowerCase();
  const lastDot = lower.lastIndexOf('.');
  if (lastDot < 0) return 'plain';
  const ext = lower.slice(lastDot);
  return EXT_MAP[ext] ?? 'plain';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Token color classes (Tailwind)
const COLORS = {
  keyword: 'text-[#c084fc]',        // purple
  string: 'text-[#86efac]',          // green
  comment: 'text-[#71717a] italic',  // gray
  number: 'text-[#fbbf24]',          // amber
  operator: 'text-[#f87171]',        // red
  func: 'text-[#60a5fa]',            // blue
  property: 'text-[#93c5fd]',        // light blue
  tag: 'text-[#f472b6]',             // pink
  attr: 'text-[#c4b5fd]',            // violet
};

function tokenizeGeneric(src: string, language: Language): string {
  const keywords = new Set(COMMON_KEYWORDS[language] ?? []);
  const keywordMatch = language === 'sql' ? /\b([A-Z_]+)\b/g : /\b([A-Za-z_][A-Za-z_0-9]*)\b/g;

  // Process in one pass using a big alternation regex so we don't double-highlight inside comments/strings
  const patterns = [
    { name: 'lineComment', re: /\/\/[^\n]*/ },
    { name: 'blockComment', re: /\/\*[\s\S]*?\*\// },
    { name: 'hashComment', re: /#[^\n]*/ },
    { name: 'stringD', re: /"(?:[^"\\\n]|\\.)*"/ },
    { name: 'stringS', re: /'(?:[^'\\\n]|\\.)*'/ },
    { name: 'stringB', re: /`(?:[^`\\]|\\.)*`/ },
    { name: 'number', re: /\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    { name: 'word', re: /[A-Za-z_][A-Za-z_0-9]*/ },
  ];

  // For shell/python use # comments; for others use //
  const usesHash = language === 'shell' || language === 'python' || language === 'yaml';
  const activePatterns = patterns.filter((p) => {
    if (p.name === 'hashComment' && !usesHash) return false;
    if ((p.name === 'lineComment' || p.name === 'blockComment') && usesHash) return false;
    if (p.name === 'stringB' && !(language === 'javascript' || language === 'typescript')) return false;
    return true;
  });

  const combined = new RegExp(
    activePatterns.map((p) => `(${p.re.source})`).join('|'),
    'g',
  );

  let out = '';
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(src)) !== null) {
    if (m.index > lastIdx) {
      out += escapeHtml(src.slice(lastIdx, m.index));
    }
    const text = m[0];
    // Which group matched?
    let matchedName: string | null = null;
    for (let i = 0; i < activePatterns.length; i++) {
      if (m[i + 1] !== undefined) {
        matchedName = activePatterns[i].name;
        break;
      }
    }
    if (matchedName === 'lineComment' || matchedName === 'blockComment' || matchedName === 'hashComment') {
      out += `<span class="${COLORS.comment}">${escapeHtml(text)}</span>`;
    } else if (matchedName === 'stringD' || matchedName === 'stringS' || matchedName === 'stringB') {
      out += `<span class="${COLORS.string}">${escapeHtml(text)}</span>`;
    } else if (matchedName === 'number') {
      out += `<span class="${COLORS.number}">${escapeHtml(text)}</span>`;
    } else if (matchedName === 'word') {
      if (keywords.has(text)) {
        out += `<span class="${COLORS.keyword}">${escapeHtml(text)}</span>`;
      } else {
        out += escapeHtml(text);
      }
    } else {
      out += escapeHtml(text);
    }
    lastIdx = m.index + text.length;
    if (text.length === 0) break; // safety
  }
  out += escapeHtml(src.slice(lastIdx));
  return out;
}

function tokenizeJson(src: string): string {
  let out = '';
  const re = /"(?:[^"\\\n]|\\.)*"\s*:|"(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out += escapeHtml(src.slice(last, m.index));
    const t = m[0];
    if (t.endsWith(':')) {
      const key = t.replace(/:\s*$/, '');
      const trailing = t.slice(key.length);
      out += `<span class="${COLORS.property}">${escapeHtml(key)}</span>${escapeHtml(trailing)}`;
    } else if (t.startsWith('"')) {
      out += `<span class="${COLORS.string}">${escapeHtml(t)}</span>`;
    } else if (t === 'true' || t === 'false' || t === 'null') {
      out += `<span class="${COLORS.keyword}">${t}</span>`;
    } else {
      out += `<span class="${COLORS.number}">${t}</span>`;
    }
    last = m.index + t.length;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

function tokenizeYaml(src: string): string {
  const lines = src.split('\n');
  return lines.map((line) => {
    if (/^\s*#/.test(line)) {
      return `<span class="${COLORS.comment}">${escapeHtml(line)}</span>`;
    }
    const m = line.match(/^(\s*)([^:#]+)(:)(.*)$/);
    if (m) {
      const [, indent, key, colon, rest] = m;
      return `${indent}<span class="${COLORS.property}">${escapeHtml(key)}</span>${colon}${escapeHtml(rest)}`;
    }
    return escapeHtml(line);
  }).join('\n');
}

function tokenizeMarkdown(src: string): string {
  return src.split('\n').map((line) => {
    if (/^#{1,6}\s/.test(line)) return `<span class="${COLORS.keyword}">${escapeHtml(line)}</span>`;
    if (/^\s*[*-]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const bullet = line.match(/^(\s*)(\S+)(.*)/);
      if (bullet) return `${bullet[1]}<span class="${COLORS.keyword}">${escapeHtml(bullet[2])}</span>${escapeHtml(bullet[3])}`;
    }
    if (/^>/.test(line)) return `<span class="${COLORS.comment}">${escapeHtml(line)}</span>`;
    // inline code / bold / italic: keep it simple
    return escapeHtml(line)
      .replace(/`[^`]+`/g, (m) => `<span class="${COLORS.string}">${m}</span>`)
      .replace(/\*\*([^*]+)\*\*/g, (_m, p) => `<span class="${COLORS.keyword}">**${p}**</span>`);
  }).join('\n');
}

function tokenizeHtmlLike(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => `<span class="${COLORS.comment}">${escapeHtml(m)}</span>`)
    .replace(/<\/?([A-Za-z][A-Za-z0-9]*)((?:\s+[^<>]*?)?)\/?>/g, (m) => `<span class="${COLORS.tag}">${escapeHtml(m)}</span>`);
}

export function highlight(src: string, language: Language): string {
  try {
    switch (language) {
      case 'json':
        return tokenizeJson(src);
      case 'yaml':
        return tokenizeYaml(src);
      case 'markdown':
        return tokenizeMarkdown(src);
      case 'html':
      case 'xml':
        return tokenizeHtmlLike(src);
      case 'plain':
        return escapeHtml(src);
      default:
        return tokenizeGeneric(src, language);
    }
  } catch {
    return escapeHtml(src);
  }
}
