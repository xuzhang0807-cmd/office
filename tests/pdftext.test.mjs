import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPdf, watermarkPdf } from '../server/src/convert/pdf.js';
import { pdfBufferToPlainText, pdfBufferToText } from '../server/src/convert/pdftext.js';

describe('PDF 文字层提取', () => {
  it('读回新建 PDF 的标题', async () => {
    const buffer = await createPdf({ title: '季度报告 2026', pages: 1 });
    const { text, pageCount } = await pdfBufferToPlainText(buffer);
    assert.equal(pageCount, 1);
    assert.match(text, /季度报告 2026/);
  });

  it('多页按页切分', async () => {
    const buffer = await createPdf({ title: '封面', pages: 3 });
    const out = await pdfBufferToText(buffer);
    assert.equal(out.pageCount, 3);
    assert.equal(out.pages.length, 3);
    assert.match(out.pages[0].text, /封面/);
    assert.equal(out.pages[2].text, '');
  });

  it('水印文字也能被提取（说明不是图片）', async () => {
    const pdf = await createPdf({ title: '正文', pages: 1 });
    const marked = await watermarkPdf(pdf, { text: '内部资料', opacity: 0.3 });
    const { text } = await pdfBufferToPlainText(marked);
    assert.match(text, /内部资料/);
  });

  it('maxPages 限制生效', async () => {
    const buffer = await createPdf({ title: 'x', pages: 4 });
    const out = await pdfBufferToText(buffer, { maxPages: 2 });
    assert.equal(out.pages.length, 2);
    assert.equal(out.truncated, true);
  });

  it('损坏的 PDF 明确抛错而不是静默返回空', async () => {
    await assert.rejects(() => pdfBufferToPlainText(Buffer.from('not a pdf')));
  });
});
