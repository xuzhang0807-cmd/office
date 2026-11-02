import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ops } from '../src/ops.js';

const deck = {
  version: 1,
  width: 1280,
  height: 720,
  theme: 'midnight',
  slides: [
    {
      id: 'sl_1',
      background: '#0F172A',
      elements: [
        { id: 'el_1', type: 'text', x: 80, y: 80, w: 900, h: 120, text: '季度汇报', role: 'title', size: 44, color: '#F8FAFC', bold: true },
        { id: 'el_2', type: 'text', x: 80, y: 240, w: 900, h: 300, text: '• 增长 20%', role: 'body', size: 22, color: '#CBD5E1' },
      ],
    },
    {
      id: 'sl_2',
      background: '#FFFFFF',
      elements: [{ id: 'el_3', type: 'text', x: 80, y: 80, w: 900, h: 120, text: '第二页', role: 'title', size: 40, color: '#0F172A', bold: true }],
    },
  ],
};

describe('PPTX 能力服务', () => {
  it('export：模型 → 合法 pptx', async () => {
    const out = await ops.export.handler({ model: deck, title: '汇报' });
    assert.equal(out.ext, 'pptx');
    assert.equal(Buffer.from(out.buffer, 'base64').slice(0, 2).toString('latin1'), 'PK');
  });

  it('import：pptx → 模型保留页数与文本', async () => {
    const { buffer } = await ops.export.handler({ model: deck });
    const out = await ops.import.handler({ buffer });
    assert.equal(out.model.slides.length, 2);
    const texts = out.model.slides.flatMap((s) => s.elements.filter((e) => e.type === 'text').map((e) => e.text));
    assert.ok(texts.some((t) => t.includes('季度汇报')), JSON.stringify(texts));
    assert.ok(texts.some((t) => t.includes('第二页')));
  });

  it('outline：结构化大纲 → 封面 + N 页', async () => {
    const out = await ops.outline.handler({
      outline: { title: '年度总结', slides: [{ title: '成果', bullets: ['收入增长 20%'] }, { title: '计划', bullets: ['拓展市场'] }] },
      theme: 'paper',
    });
    assert.equal(out.model.slides.length, 3);
    assert.equal(out.model.theme, 'paper');
  });

  it('blank：空白演示有封面页', async () => {
    const out = await ops.blank.handler({ theme: 'sunset' });
    assert.equal(out.model.slides.length, 1);
    assert.equal(out.model.width, 1280);
    assert.equal(out.model.theme, 'sunset');
  });

  it('text：逐页文本', async () => {
    const out = await ops.text.handler({ model: deck });
    assert.equal(out.pageCount, 2);
    assert.match(out.text, /第 1 页/);
    assert.match(out.text, /季度汇报/);
  });

  it('outline：缺 slides 明确报错', async () => {
    await assert.rejects(() => ops.outline.handler({ outline: {} }), /outline.slides 缺失/);
  });

  it('export：缺 model 明确报错', async () => {
    await assert.rejects(() => ops.export.handler({}), /缺少 model/);
  });
});
