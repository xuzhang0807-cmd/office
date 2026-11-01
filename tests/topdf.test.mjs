import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { htmlToPdfBuffer, pptxModelToPdfBuffer, xlsxModelToPdfBuffer, wrapText } from '../server/src/convert/topdf.js';

const fakeFont = { widthOfTextAtSize: (text, size) => String(text).length * size * 0.6 };

async function pageCount(buffer) {
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
}

describe('PDF 排版：换行', () => {
  it('中文按字断行，英文按词断行', () => {
    const lines = wrapText('这是一段较长的中文内容需要自动换行处理 English words here', fakeFont, 11, 100);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(line.length > 0);
    // 英文单词不应被拦腰截断
    const joined = lines.join(' ');
    assert.match(joined, /English words here/);
  });

  it('保留空行与制表符', () => {
    const lines = wrapText('a\n\nb\tc', fakeFont, 11, 500);
    assert.equal(lines.length, 3);
    assert.match(lines[2], /b\s+c/);
  });

  it('空输入返回一个空行而不是抛错', () => {
    assert.deepEqual(wrapText('', fakeFont, 11, 100), ['']);
  });
});

describe('PDF 排版：DOCX', () => {
  it('标题/正文/列表/表格/代码/引用都进 PDF', async () => {
    const html = `
      <h1>年度总结</h1>
      <p>正文段落。</p>
      <h2>一、数据</h2>
      <ul><li>要点一</li><li>要点二</li></ul>
      <ol><li>步骤一</li></ol>
      <table><tr><th>指标</th><th>值</th></tr><tr><td>可用性</td><td>99.95%</td></tr></table>
      <blockquote>结语</blockquote>
      <pre>npm run build</pre>
    `;
    const buffer = await htmlToPdfBuffer(html, { title: '年度总结' });
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
    assert.ok(buffer.length > 2000);
    assert.equal(await pageCount(buffer), 1);
  });

  it('超长内容自动分页', async () => {
    const html = Array.from({ length: 120 }, (_, i) => `<p>第 ${i + 1} 段内容，用于验证自动分页。</p>`).join('');
    const buffer = await htmlToPdfBuffer(html, { title: '长文' });
    assert.ok((await pageCount(buffer)) >= 2, '应当产生多页');
  });

  it('空文档也能生成合法 PDF', async () => {
    const buffer = await htmlToPdfBuffer('', { title: '' });
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
    assert.equal(await pageCount(buffer), 1);
  });

  it('坏图不会中断导出', async () => {
    const buffer = await htmlToPdfBuffer('<p>前</p><img src="data:image/png;base64,AAAA"/><p>后</p>');
    assert.equal(await pageCount(buffer), 1);
  });
});

describe('PDF 排版：XLSX', () => {
  it('多工作表各占一页，空行被跳过', async () => {
    const model = {
      sheets: [
        {
          name: '预算',
          rows: [
            [{ v: '项目', s: { bold: true, fill: '#1E293B' } }, { v: '金额' }],
            [{ v: '收入' }, { v: 1000 }],
            null,
            [{ v: '合计' }, { f: '=B2', v: 1000 }],
          ],
        },
        { name: '备注', rows: [[{ v: '说明' }]] },
      ],
    };
    const buffer = await xlsxModelToPdfBuffer(model, { title: '预算' });
    assert.equal(await pageCount(buffer), 2);
  });

  it('空模型不报错', async () => {
    const buffer = await xlsxModelToPdfBuffer({ sheets: [{ name: 'S', rows: [] }] });
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
  });
});

describe('PDF 排版：PPTX', () => {
  it('每页幻灯片一页 PDF，元素与背景都渲染', async () => {
    const model = {
      width: 1280,
      height: 720,
      slides: [
        {
          background: '#0F172A',
          elements: [
            { type: 'text', x: 80, y: 80, w: 1000, h: 120, text: '标题页', role: 'title', size: 44, color: '#F8FAFC', bold: true },
            { type: 'rect', x: 0, y: 0, w: 12, h: 720, fill: '#38BDF8' },
          ],
        },
        {
          background: '#FFFFFF',
          elements: [
            { type: 'text', x: 80, y: 80, w: 1000, h: 120, text: '第二页', role: 'title', size: 40, color: '#0F172A' },
            { type: 'table', x: 80, y: 240, w: 600, h: 120, rows: [['A', 'B'], ['1', '2']] },
          ],
        },
      ],
    };
    const buffer = await pptxModelToPdfBuffer(model, { title: '演示' });
    assert.equal(await pageCount(buffer), 2);
  });

  it('空演示文稿仍输出一页', async () => {
    const buffer = await pptxModelToPdfBuffer({ slides: [] });
    assert.equal(await pageCount(buffer), 1);
  });
});
