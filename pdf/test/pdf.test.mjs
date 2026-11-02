import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { ops } from '../src/ops.js';

const pdfPages = async (b64) => (await PDFDocument.load(Buffer.from(b64, 'base64'))).getPageCount();

async function makePdf(pages = 3, title = '文档') {
  const { buffer } = await ops.create.handler({ title, pages });
  return buffer;
}

describe('PDF 能力服务：基础', () => {
  it('create：生成合法 PDF', async () => {
    const buffer = await makePdf(2, '测试文档');
    assert.equal(Buffer.from(buffer, 'base64').slice(0, 5).toString('latin1'), '%PDF-');
    assert.equal(await pdfPages(buffer), 2);
  });

  it('info：页数与尺寸', async () => {
    const buffer = await makePdf(3);
    const { info } = await ops.info.handler({ buffer });
    assert.equal(info.pageCount, 3);
    assert.equal(info.pages[0].width, 595);
  });

  it('fonts：探测结果可读', async () => {
    const status = await ops.fonts.handler({});
    assert.equal(typeof status.available, 'boolean');
  });
});

describe('PDF 能力服务：页操作', () => {
  it('extract：提取 1-2 页', async () => {
    const buffer = await makePdf(4);
    const out = await ops.extract.handler({ buffer, pages: '1-2' });
    assert.equal(await pdfPages(out.buffer), 2);
  });

  it('delete：删除第 2 页', async () => {
    const buffer = await makePdf(3);
    const out = await ops.delete.handler({ buffer, pages: '2' });
    assert.equal(await pdfPages(out.buffer), 2);
  });

  it('delete：不允许删完', async () => {
    const buffer = await makePdf(2);
    await assert.rejects(() => ops.delete.handler({ buffer, pages: '1-2' }), /不能删除全部页面/);
  });

  it('merge：两份合并', async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const out = await ops.merge.handler({ buffers: [a, b] });
    assert.equal(await pdfPages(out.buffer), 5);
  });

  it('merge：空数组报错', async () => {
    await assert.rejects(() => ops.merge.handler({ buffers: [] }), /buffers 为空/);
  });

  it('rotate：旋转第 1 页', async () => {
    const buffer = await makePdf(2);
    const out = await ops.rotate.handler({ buffer, pages: '1', angle: 90 });
    const { info } = await ops.info.handler({ buffer: out.buffer });
    assert.equal(info.pages[0].rotation, 90);
  });

  it('watermark：中文水印不抛错', async () => {
    const buffer = await makePdf(2);
    const out = await ops.watermark.handler({ buffer, text: '内部资料', opacity: 0.2 });
    assert.equal(await pdfPages(out.buffer), 2);
  });

  it('reorder：反转页序', async () => {
    const buffer = await makePdf(3);
    const out = await ops.reorder.handler({ buffer, order: [2, 1, 0] });
    assert.equal(await pdfPages(out.buffer), 3);
  });

  it('reorder：缺页时报错', async () => {
    const buffer = await makePdf(3);
    await assert.rejects(() => ops.reorder.handler({ buffer, order: [0, 1] }), /页序必须包含全部页面/);
  });

  it('metadata：写入标题', async () => {
    const buffer = await makePdf(1, '原标题');
    const out = await ops.metadata.handler({ buffer, title: '新标题', author: '作者' });
    const { info } = await ops.info.handler({ buffer: out.buffer });
    assert.equal(info.title, '新标题');
    assert.equal(info.author, '作者');
  });
});

describe('PDF 能力服务：文字层', () => {
  it('text：读回中文标题', async () => {
    const buffer = await makePdf(1, '季度经营分析');
    const out = await ops.text.handler({ buffer });
    assert.match(out.text, /季度经营分析/);
    assert.equal(out.pageCount, 1);
  });

  it('pages：逐页切分', async () => {
    const buffer = await makePdf(3, '封面');
    const out = await ops.pages.handler({ buffer });
    assert.equal(out.pages.length, 3);
    assert.match(out.pages[0].text, /封面/);
  });

  it('text：坏文件明确抛错', async () => {
    await assert.rejects(() => ops.text.handler({ buffer: Buffer.from('not a pdf').toString('base64') }));
  });
});

describe('PDF 能力服务：排版', () => {
  it('fromHtml：DOCX 模型 → PDF', async () => {
    const out = await ops.fromHtml.handler({
      html: '<h1>标题</h1><p>正文</p><ul><li>要点</li></ul><table><tr><th>A</th></tr><tr><td>1</td></tr></table>',
      title: '排版测试',
    });
    assert.equal(out.ext, 'pdf');
    assert.equal(await pdfPages(out.buffer), 1);
  });

  it('fromHtml：长内容自动分页', async () => {
    const html = Array.from({ length: 120 }, (_, i) => `<p>第 ${i + 1} 段</p>`).join('');
    const out = await ops.fromHtml.handler({ html, title: '长文' });
    assert.ok((await pdfPages(out.buffer)) >= 2);
  });

  it('fromXlsx：多表各占一页', async () => {
    const out = await ops.fromXlsx.handler({
      model: {
        sheets: [
          { name: '预算', rows: [[{ v: '项目', s: { bold: true, fill: '#1E293B' } }, { v: '金额' }], [{ v: '收入' }, { v: 1000 }]] },
          { name: '备注', rows: [[{ v: '说明' }]] },
        ],
      },
      title: '预算',
    });
    assert.equal(await pdfPages(out.buffer), 2);
  });

  it('fromPptx：每页幻灯片一页 PDF', async () => {
    const out = await ops.fromPptx.handler({
      model: {
        width: 1280,
        height: 720,
        slides: [
          { background: '#0F172A', elements: [{ type: 'text', x: 80, y: 80, w: 900, h: 120, text: '标题', role: 'title', size: 44, color: '#F8FAFC', bold: true }] },
          { background: '#FFFFFF', elements: [{ type: 'text', x: 80, y: 80, w: 900, h: 120, text: '第二页', role: 'title', size: 40, color: '#0F172A' }] },
        ],
      },
    });
    assert.equal(await pdfPages(out.buffer), 2);
  });

  it('fromHtml：非字符串报错', async () => {
    await assert.rejects(() => ops.fromHtml.handler({ html: {} }), /html 必须是字符串/);
  });

  it('fromXlsx：缺 model 报错', async () => {
    await assert.rejects(() => ops.fromXlsx.handler({}), /缺少 model/);
  });
});
