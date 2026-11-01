import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asciiSafe, extractSfntFromTtc, fontStatus, resolveFontPath } from '../server/src/convert/fonts.js';

function fakeTtc() {
  // 构造一个最小 TTC：头 + 一个表目录 + 一个 dummy 表
  const tableData = Buffer.from('ABCDEFGH');
  const numTables = 1;
  const dirOffset = 12 + 4; // ttcf header(12) + one offset(4)
  const headerSize = dirOffset + 12 + numTables * 16;
  const total = headerSize + tableData.length;
  const buf = Buffer.alloc(total);
  buf.write('ttcf', 0, 'latin1');
  buf.writeUInt32BE(0x00010000, 4);
  buf.writeUInt32BE(1, 8); // numFonts
  buf.writeUInt32BE(dirOffset, 12);
  buf.writeUInt32BE(0x00010000, dirOffset); // sfntVersion
  buf.writeUInt16BE(numTables, dirOffset + 4);
  const rec = dirOffset + 12;
  buf.write('head', rec, 'latin1');
  buf.writeUInt32BE(0, rec + 4);
  buf.writeUInt32BE(headerSize, rec + 8);
  buf.writeUInt32BE(tableData.length, rec + 12);
  tableData.copy(buf, headerSize);
  return buf;
}

describe('TTC 抽取', () => {
  it('非 TTC 原样返回', () => {
    const ttf = Buffer.from('0001000000', 'latin1');
    assert.equal(extractSfntFromTtc(ttf), ttf);
  });

  it('TTC 被抽成独立 sfnt 且表数据完整', () => {
    const ttc = fakeTtc();
    const sfnt = extractSfntFromTtc(ttc, 0);
    assert.notEqual(sfnt.toString('latin1', 0, 4), 'ttcf');
    assert.equal(sfnt.readUInt32BE(0), 0x00010000);
    assert.equal(sfnt.readUInt16BE(4), 1);
    assert.equal(sfnt.toString('latin1', 12, 16), 'head');
    const offset = sfnt.readUInt32BE(20);
    const length = sfnt.readUInt32BE(24);
    assert.equal(sfnt.toString('latin1', offset, offset + length), 'ABCDEFGH');
  });
});

describe('字体探测', () => {
  it('返回可用路径或 null，不抛错', () => {
    const path = resolveFontPath();
    assert.ok(path === null || typeof path === 'string');
    const status = fontStatus();
    assert.equal(typeof status.available, 'boolean');
    assert.equal(status.available, Boolean(path));
  });

  it('ASCII 兜底只替换无法编码字符', () => {
    assert.equal(asciiSafe('abc 123'), 'abc 123');
    assert.equal(asciiSafe('内部资料'), '????');
    assert.equal(asciiSafe('混合 mixed'), '?? mixed');
  });
});
