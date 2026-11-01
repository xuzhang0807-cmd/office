import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * 服务端 PDF 文本提取。
 * pdf-lib 只能改结构、不能读文字，所以这里用 pdf.js 的 legacy build 在 Node 里跑。
 * 用途：PDF 编辑器的 AI 面板需要正文（浏览器里的 canvas 没有可选文字层）。
 */

const MAX_PAGES = 200;
const MAX_CHARS = 60_000;

/** 把同一行的 text item 拼回去：pdf.js 按字形/词块切分，直接 join 会出现空格乱插。 */
function joinItems(items) {
  const lines = [];
  let current = '';
  let lastY = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      if (current.trim()) lines.push(current.trimEnd());
      current = '';
    }
    current += item.str;
    if (item.hasEOL) {
      if (current.trim()) lines.push(current.trimEnd());
      current = '';
      lastY = null;
      continue;
    }
    lastY = y;
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

export async function pdfBufferToText(buffer, { maxPages = MAX_PAGES } = {}) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Node 里没有 worker，关掉它；也不需要字体/图片，只取文字层
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const doc = await task.promise;

  const pages = [];
  const total = Math.min(doc.numPages, maxPages);
  let chars = 0;
  for (let i = 1; i <= total; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = joinItems(content.items);
    const text = lines.join('\n');
    chars += text.length;
    pages.push({ index: i - 1, text });
    if (chars > MAX_CHARS) break;
  }
  try {
    await task.destroy();
  } catch {
    /* 老版本 pdf.js 没有 destroy，忽略 */
  }
  return { pageCount: doc.numPages, pages, truncated: total < doc.numPages };
}

export async function pdfBufferToPlainText(buffer, options) {
  const { pages, pageCount } = await pdfBufferToText(buffer, options);
  return { text: pages.map((p) => p.text).join('\n\n').slice(0, MAX_CHARS), pageCount };
}
