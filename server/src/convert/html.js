/**
 * 极简容错 HTML 解析器。
 * 只覆盖办公文档里真实会出现的标签，避免为一个编辑器引入完整 DOM 依赖。
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'hr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style']);

function decode(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = re.exec(raw))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decode(value);
  }
  return attrs;
}

export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const source = String(html || '');
  let index = 0;

  const pushText = (text) => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    const decoded = decode(text);
    const last = parent.children[parent.children.length - 1];
    if (last && last.tag === '#text') last.text += decoded;
    else parent.children.push({ tag: '#text', text: decoded });
  };

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt < 0) {
      pushText(source.slice(index));
      break;
    }
    if (lt > index) pushText(source.slice(index, lt));

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      index = end < 0 ? source.length : end + 1;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt < 0) {
      pushText(source.slice(lt));
      break;
    }
    const inner = source.slice(lt + 1, gt);
    index = gt + 1;

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].tag === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const tag = (space < 0 ? body : body.slice(0, space)).toLowerCase();
    const attrs = space < 0 ? {} : parseAttrs(body.slice(space));

    if (RAW_TEXT_TAGS.has(tag)) {
      const close = source.toLowerCase().indexOf(`</${tag}`, index);
      index = close < 0 ? source.length : source.indexOf('>', close) + 1 || source.length;
      continue;
    }

    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node);
  }

  return root;
}

function findTagEnd(source, start) {
  let quote = null;
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

export function textContent(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text;
  return (node.children || []).map(textContent).join('');
}

export function findNodes(node, tag, out = []) {
  if (!node) return out;
  if (node.tag === tag) out.push(node);
  for (const child of node.children || []) findNodes(child, tag, out);
  return out;
}

export function childrenOf(node, tag) {
  return (node?.children || []).filter((child) => child.tag === tag);
}

/** 把行内节点压平为带样式的 run 列表。 */
export function inlineRuns(node, inherited = {}) {
  const runs = [];
  const walk = (current, style) => {
    if (current.tag === '#text') {
      if (current.text) runs.push({ text: current.text, ...style });
      return;
    }
    if (current.tag === 'br') {
      runs.push({ text: '\n', ...style });
      return;
    }
    const next = { ...style };
    switch (current.tag) {
      case 'strong':
      case 'b':
        next.bold = true;
        break;
      case 'em':
      case 'i':
        next.italic = true;
        break;
      case 'u':
        next.underline = true;
        break;
      case 's':
      case 'strike':
      case 'del':
        next.strike = true;
        break;
      case 'code':
        next.code = true;
        break;
      case 'a':
        next.link = current.attrs?.href || undefined;
        break;
      case 'span': {
        const styleAttr = current.attrs?.style || '';
        const size = /font-size:\s*([\d.]+)px/i.exec(styleAttr);
        if (size) next.size = Number(size[1]);
        const color = /color:\s*(#[0-9a-fA-F]{3,8})/.exec(styleAttr);
        if (color) next.color = color[1].replace('#', '');
        break;
      }
      default:
        break;
    }
    for (const child of current.children || []) walk(child, next);
  };
  for (const child of node.children || []) walk(child, inherited);
  return runs;
}

export function mergeRuns(runs) {
  const out = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (
      last &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.underline === run.underline &&
      last.strike === run.strike &&
      last.code === run.code &&
      last.link === run.link
    ) {
      last.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

export const HTML = { parseHtml, textContent, findNodes, childrenOf, inlineRuns, mergeRuns, BLOCK_TAGS, VOID_TAGS };
