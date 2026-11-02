import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateFormula, indexToCol, parseRef, recalcSheet, refOf } from '../portal/web/src/lib/formula.js';

function sheetWith(rows) {
  return { name: 'S', rows };
}

describe('引用换算', () => {
  it('列号与字母互转', () => {
    assert.equal(indexToCol(0), 'A');
    assert.equal(indexToCol(25), 'Z');
    assert.equal(indexToCol(26), 'AA');
    assert.equal(indexToCol(701), 'ZZ');
    assert.equal(refOf(0, 0), 'A1');
    assert.equal(refOf(9, 27), 'AB10');
  });

  it('解析引用（含 $ 绝对引用）', () => {
    assert.deepEqual(parseRef('A1'), { row: 0, col: 0 });
    assert.deepEqual(parseRef('$B$3'), { row: 2, col: 1 });
    assert.equal(parseRef('1A'), null);
  });
});

describe('公式求值', () => {
  const sheet = sheetWith([
    [{ v: 10 }, { v: 5 }],
    [{ v: 32 }, { v: 2 }],
    [{ v: '苹果' }, { v: 3 }],
    [{ v: '' }, { v: '' }],
  ]);

  it('四则运算与优先级', () => {
    assert.equal(evaluateFormula('=1+2*3', sheet), 7);
    assert.equal(evaluateFormula('=(1+2)*3', sheet), 9);
    assert.equal(evaluateFormula('=10/4', sheet), 2.5);
    assert.equal(evaluateFormula('=2^10', sheet), 1024);
    assert.equal(evaluateFormula('=-A1+5', sheet), -5);
  });

  it('单元格与区间引用', () => {
    assert.equal(evaluateFormula('=A1', sheet), 10);
    assert.equal(evaluateFormula('=A1+B1', sheet), 15);
    assert.equal(evaluateFormula('=SUM(A1:A2)', sheet), 42);
    assert.equal(evaluateFormula('=SUM(A1:B2)', sheet), 49);
  });

  it('常用函数', () => {
    assert.equal(evaluateFormula('=AVERAGE(A1:A2)', sheet), 21);
    assert.equal(evaluateFormula('=MAX(A1:B2)', sheet), 32);
    assert.equal(evaluateFormula('=MIN(A1:B2)', sheet), 2);
    assert.equal(evaluateFormula('=COUNT(A1:A2)', sheet), 2);
    assert.equal(evaluateFormula('=COUNTA(A1:A3)', sheet), 3);
    assert.equal(evaluateFormula('=ROUND(3.14159,2)', sheet), 3.14);
    assert.equal(evaluateFormula('=ABS(-8)', sheet), 8);
    assert.equal(evaluateFormula('=LEN(A3)', sheet), 2);
    assert.equal(evaluateFormula('=UPPER("abc")', sheet), 'ABC');
    assert.equal(evaluateFormula('=CONCAT("a","b",A1)', sheet), 'ab10');
  });

  it('条件与逻辑', () => {
    assert.equal(evaluateFormula('=IF(A1>5,"大","小")', sheet), '大');
    assert.equal(evaluateFormula('=IF(A1<5,"大","小")', sheet), '小');
    assert.equal(evaluateFormula('=AND(A1>5,B1<10)', sheet), true);
    assert.equal(evaluateFormula('=OR(A1<5,B1<10)', sheet), true);
    assert.equal(evaluateFormula('=NOT(A1>5)', sheet), false);
    assert.equal(evaluateFormula('=COUNTIF(A1:A2,">20")', sheet), 1);
    assert.equal(evaluateFormula('=SUMIF(A1:A2,">20")', sheet), 32);
  });

  it('查找函数', () => {
    assert.equal(evaluateFormula('=VLOOKUP("苹果",A3:B3,2,FALSE)', sheet), 3);
    assert.equal(evaluateFormula('=INDEX(A1:B2,2,1)', sheet), 32);
    assert.equal(evaluateFormula('=MATCH("苹果",A1:A3,0)', sheet), 3);
    assert.equal(evaluateFormula('=IFERROR(1/0,"零")', sheet), '零');
    assert.equal(evaluateFormula('=IFERROR(5,"零")', sheet), 5);
  });
  it('错误处理', () => {
    assert.equal(evaluateFormula('=1/0', sheet), '#DIV/0!');
    assert.equal(evaluateFormula('=NOSUCHFN(1)', sheet), '#NAME?');
    assert.equal(evaluateFormula('=A1+', sheet), '#ERROR');
    assert.equal(evaluateFormula('', sheet), '');
  });

  it('循环引用被识别而非死循环', () => {
    const cyclic = sheetWith([[{ f: '=A2', v: 0 }], [{ f: '=A1', v: 0 }]]);
    const cache = { values: new Map(), computing: new Set() };
    const value = evaluateFormula('=A1', cyclic, cache);
    assert.ok(String(value).startsWith('#'));
  });
});

describe('整表重算', () => {
  it('把公式结果写回单元格并保留样式', () => {
    const sheet = sheetWith([
      [{ v: 100, s: { bold: true } }],
      [{ v: 40 }],
      [{ f: '=A1-A2', v: 0, s: { fill: '#eee' } }],
      [{ f: '=A3*2', v: 0 }],
    ]);
    const next = recalcSheet(sheet);
    assert.equal(next.rows[2][0].v, 60);
    assert.equal(next.rows[3][0].v, 120);
    assert.deepEqual(next.rows[2][0].s, { fill: '#eee' });
    assert.deepEqual(next.rows[0][0].s, { bold: true });
    // 原表不被修改
    assert.equal(sheet.rows[2][0].v, 0);
  });
});
