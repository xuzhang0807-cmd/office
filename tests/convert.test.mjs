import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlToDocxBuffer, docxBufferToHtml, docxBufferToText } from '../server/src/convert/docx.js';
import { modelToXlsxBuffer, xlsxBufferToModel, modelToCsv } from '../server/src/convert/xlsx.js';
import { blankModel, modelToPptxBuffer, outlineToModel, pptxBufferToModel } from '../server/src/convert/pptx.js';
import { createPdf, deletePages, extractPages, mergePdfs, pdfInfo, rotatePages, watermarkPdf } from '../server/src/convert/pdf.js';
import { parseHtml, textContent } from '../server/src/convert/html.js';
import { parseOutline } from '../server/src/ai.js';

describe('HTML 解析器', () => {
  it('处理嵌套、属性与实体', () => {
    const root = parseHtml('<div class="a"><p>Hello &amp; <strong>world</strong></p><br/><img src="x.png" /></div>');
    assert.equal(textContent(root).trim(), 'Hello & world');
    const imgs = [];
    const walk = (node) => {
      if (node.tag === 'img') imgs.push(node.attrs.src);
      (node.children || []).forEach(walk);
    };
    walk(root);
    assert.deepEqual(imgs, ['x.png']);
  });

  it('容忍未闭合标签与注释', () => {
    const root = parseHtml('<p>a<!-- c --><b>b</p><p>c');
    assert.equal(textContent(root).replace(/\s+/g, ''), 'abc');
  });
});

describe('DOCX 往返', () => {
  it('HTML → docx → HTML 保留标题/加粗/列表/表格', async () => {
    const html = `
      <h1>报告标题</h1>
      <p>正文含<strong>加粗</strong>与<em>斜体</em>。</p>
      <ul><li>要点 A</li><li>要点 B</li></ul>
      <table><tr><th>列1</th><th>列2</th></tr><tr><td>值1</td><td>值2</td></tr></table>
    `;
    const buffer = await htmlToDocxBuffer(html, { title: '报告' });
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');
    const back = await docxBufferToHtml(buffer);
    assert.match(back.html, /报告标题/);
    assert.match(back.html, /<strong>加粗<\/strong>|<strong>.*加粗/);
    assert.match(back.html, /要点 A/);
    assert.match(back.html, /<table/);
    const text = await docxBufferToText(buffer);
    assert.match(text, /正文含加粗与斜体/);
  });

  it('空文档也能生成合法 docx', async () => {
    const buffer = await htmlToDocxBuffer('', { title: '空' });
    const back = await docxBufferToHtml(buffer);
    assert.ok(back.html.length > 0);
  });
});

describe('XLSX 往返', () => {
  it('公式、样式、多表、列宽保留', async () => {
    const model = {
      sheets: [
        {
          name: '数据',
          colWidths: [120, 90],
          rows: [
            [{ v: '名称', s: { bold: true, fill: '#1E293B', color: '#FFFFFF' } }, { v: '数量' }],
            [{ v: '甲' }, { v: 12 }],
            [{ v: '乙' }, { v: 8 }],
            [{ v: '合计' }, { f: '=SUM(B2:B3)', v: 20 }],
          ],
        },
        { name: '第二页', rows: [[{ v: '备注' }]] },
      ],
    };
    const buffer = await modelToXlsxBuffer(model);
    const back = await xlsxBufferToModel(buffer);
    assert.equal(back.sheets.length, 2);
    assert.equal(back.sheets[0].name, '数据');
    assert.equal(back.sheets[0].rows[0][0].v, '名称');
    assert.equal(back.sheets[0].rows[0][0].s.bold, true);
    assert.equal(Number(back.sheets[0].rows[3][1].v), 20);
    assert.match(back.sheets[0].rows[3][1].f, /SUM\(B2:B3\)/);
  });

  it('CSV 导出转义逗号与引号', () => {
    const csv = modelToCsv({ sheets: [{ rows: [[{ v: 'a,b' }, { v: 'say "hi"' }], [{ v: 1 }, { v: 2 }]] }] });
    assert.equal(csv, '"a,b","say ""hi"""\n1,2');
  });
});

describe('PPTX 往返', () => {
  it('大纲模型可导出并解析回页数与文本', async () => {
    const model = outlineToModel(
      {
        title: '年度总结',
        slides: [
          { title: '成果', bullets: ['收入增长 20%', '成本下降 5%'] },
          { title: '计划', bullets: ['拓展新市场'] },
        ],
      },
      'paper',
    );
    assert.equal(model.slides.length, 3);
    const buffer = await modelToPptxBuffer(model, { title: '年度总结' });
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');
    const back = await pptxBufferToModel(buffer);
    assert.equal(back.slides.length, 3);
    const all = back.slides.flatMap((s) => s.elements.filter((e) => e.type === 'text').map((e) => e.text)).join('|');
    assert.match(all, /年度总结/);
    assert.match(all, /成果/);
    assert.match(all, /收入增长/);
  });

  it('空白演示文稿有封面页', () => {
    const model = blankModel('sunset');
    assert.equal(model.slides.length, 1);
    assert.equal(model.width, 1280);
  });
});

describe('PDF 操作', () => {
  it('新建、拆分、合并、旋转、水印、元数据', async () => {
    const a = await createPdf({ title: '文档A', pages: 3 });
    const info = await pdfInfo(a);
    assert.equal(info.pageCount, 3);
    assert.equal(info.pages[0].width, 595);

    const extracted = await extractPages(a, '1-2');
    assert.equal((await pdfInfo(extracted)).pageCount, 2);

    const deleted = await deletePages(a, '2');
    assert.equal((await pdfInfo(deleted)).pageCount, 2);

    const rotated = await rotatePages(a, '1', 90);
    assert.equal((await pdfInfo(rotated)).pages[0].rotation, 90);

    const marked = await watermarkPdf(a, { text: 'CONFIDENTIAL', opacity: 0.2 });
    assert.equal((await pdfInfo(marked)).pageCount, 3);

    const merged = await mergePdfs([a, extracted]);
    assert.equal((await pdfInfo(merged)).pageCount, 5);
  });

  it('中文水印在有字体时可用（无字体也不抛错）', async () => {
    const pdf = await createPdf({ title: '测试', pages: 1 });
    const out = await watermarkPdf(pdf, { text: '内部资料' });
    assert.equal((await pdfInfo(out)).pageCount, 1);
  });

  it('非法页范围被拒绝', async () => {
    const pdf = await createPdf({ pages: 2 });
    await assert.rejects(() => extractPages(pdf, '9-12'), /页范围无效/);
    await assert.rejects(() => deletePages(pdf, '1-2'), /不能删除全部页面/);
  });
});

describe('AI 大纲修复', () => {
  it('解析标准 JSON', () => {
    const out = parseOutline('{"title":"T","slides":[{"title":"A","bullets":["x","y"]}]}');
    assert.equal(out.title, 'T');
    assert.equal(out.slides.length, 1);
    assert.deepEqual(out.slides[0].bullets, ['x', 'y']);
    assert.equal(out.repaired, false);
  });

  it('去掉 Markdown 围栏', () => {
    const out = parseOutline('```json\n{"title":"T2","slides":[{"title":"B","bullets":["z"]}]}\n```');
    assert.equal(out.title, 'T2');
    assert.equal(out.slides[0].title, 'B');
  });

  it('截断 JSON 也能修复出可用结构', () => {
    const out = parseOutline('{"title":"T3","slides":[{"title":"C","bullets":["1","2"');
    assert.ok(out.slides.length >= 1);
    assert.equal(out.repaired, true);
  });

  it('完全非 JSON 时退化为要点大纲', () => {
    const out = parseOutline('这是一段普通文字。里面有若干句子。没有 JSON 结构。');
    assert.ok(out.slides.length >= 1);
    assert.ok(out.slides[0].bullets.length >= 1);
    assert.equal(out.repaired, true);
  });

  it('去重并过滤嵌套 JSON 碎片', () => {
    const messy = JSON.stringify({
      title: 'T4',
      slides: [
        { title: '同名', bullets: ['a'] },
        { title: '同名', bullets: ['b'] },
        { title: '不同', bullets: ['{"title":"x"}', 'ok'] },
      ],
    });
    const out = parseOutline(messy);
    assert.equal(out.slides.length, 2);
    assert.deepEqual(out.slides[1].bullets, ['ok']);
  });
});
