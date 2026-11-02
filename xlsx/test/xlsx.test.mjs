import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ops } from '../src/ops.js';

const model = {
  version: 1,
  sheets: [
    {
      name: '数据',
      colWidths: [120, 90],
      rows: [
        [{ v: '名称', s: { bold: true, fill: '#1E293B' } }, { v: '数量' }],
        [{ v: '甲' }, { v: 12 }],
        [{ v: '乙' }, { v: 8 }],
        [{ v: '合计' }, { f: '=SUM(B2:B3)', v: 20 }],
      ],
    },
    { name: '第二页', rows: [[{ v: '备注' }]] },
  ],
};

describe('XLSX 能力服务', () => {
  it('export：模型 → 合法 xlsx', async () => {
    const out = await ops.export.handler({ model, title: '预算' });
    assert.equal(out.ext, 'xlsx');
    const buffer = Buffer.from(out.buffer, 'base64');
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');
  });

  it('import：xlsx → 模型保留公式/样式/多表', async () => {
    const { buffer } = await ops.export.handler({ model });
    const out = await ops.import.handler({ buffer });
    assert.equal(out.model.sheets.length, 2);
    assert.equal(out.model.sheets[0].name, '数据');
    assert.equal(out.model.sheets[0].rows[0][0].s.bold, true);
    assert.match(out.model.sheets[0].rows[3][1].f, /SUM\(B2:B3\)/);
    assert.equal(Number(out.model.sheets[0].rows[3][1].v), 20);
  });

  it('csv：转义逗号与引号', async () => {
    const out = await ops.csv.handler({
      model: { sheets: [{ rows: [[{ v: 'a,b' }, { v: 'say "hi"' }], [{ v: 1 }, { v: 2 }]] }] },
    });
    assert.equal(out.csv, '"a,b","say ""hi"""\n1,2');
  });

  it('csv：指定 sheetIndex', async () => {
    const out = await ops.csv.handler({ model, sheetIndex: 1 });
    assert.match(out.csv, /备注/);
  });

  it('bounds：估算有内容区域', async () => {
    const out = await ops.bounds.handler({ model });
    assert.ok(out.bounds.rows >= 4);
    assert.ok(out.bounds.cols >= 2);
  });

  it('缺少 model 明确报错', async () => {
    await assert.rejects(() => ops.export.handler({}), /缺少 model/);
    await assert.rejects(() => ops.csv.handler({}), /缺少 model/);
    await assert.rejects(() => ops.bounds.handler({}), /缺少 model/);
  });

  it('空模型导出不崩', async () => {
    const out = await ops.export.handler({ model: { sheets: [{ name: 'S', rows: [] }] } });
    assert.ok(out.bytes > 500);
  });
});
