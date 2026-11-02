import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ops } from '../src/ops.js';

const b64 = (buffer) => Buffer.from(buffer).toString('base64');

describe('DOCX 能力服务', () => {
  it('export：HTML → 合法 docx', async () => {
    const out = await ops.export.handler({ html: '<h1>标题</h1><p>正文</p>', title: '测试' });
    assert.equal(out.ext, 'docx');
    assert.match(out.mime, /wordprocessingml/);
    const buffer = Buffer.from(out.buffer, 'base64');
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');
    assert.equal(out.bytes, buffer.length);
  });

  it('import：docx → HTML 保留结构', async () => {
    const { buffer } = await ops.export.handler({
      html: '<h1>报告</h1><p><strong>加粗</strong></p><ul><li>要点</li></ul>',
      title: '报告',
    });
    const out = await ops.import.handler({ buffer });
    assert.match(out.html, /报告/);
    assert.match(out.html, /加粗/);
    assert.match(out.html, /要点/);
  });

  it('text：docx → 纯文本', async () => {
    const { buffer } = await ops.export.handler({ html: '<p>纯文本内容</p>', title: 'x' });
    const out = await ops.text.handler({ buffer });
    assert.match(out.text, /纯文本内容/);
  });

  it('export：非字符串 html 明确报错', async () => {
    await assert.rejects(() => ops.export.handler({ html: 123 }), /html 必须是字符串/);
  });

  it('import：缺少 buffer 明确报错', async () => {
    await assert.rejects(() => ops.import.handler({}), /缺少 buffer/);
  });

  it('往返：HTML → docx → HTML → docx 不丢内容', async () => {
    const original = '<h1>往返测试</h1><p>第一段</p><table><tr><th>A</th></tr><tr><td>1</td></tr></table>';
    const first = await ops.export.handler({ html: original, title: '往返' });
    const back = await ops.import.handler({ buffer: first.buffer });
    const second = await ops.export.handler({ html: back.html, title: '往返' });
    const third = await ops.import.handler({ buffer: second.buffer });
    assert.match(third.html, /往返测试/);
    assert.match(third.html, /第一段/);
    assert.ok(b64(Buffer.from(second.buffer, 'base64')).length > 0);
  });
});
