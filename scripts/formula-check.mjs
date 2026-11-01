import { evaluateFormula, recalcSheet, parseRef } from '../web/src/lib/formula.js';

const sheet = {
  name: 'S',
  rows: [
    [{ v: 10 }],
    [{ v: 32 }],
    [{ f: '=A1+A2', v: 0 }],
    [{ f: '=SUM(A1:A2)', v: 0 }],
    [{ f: '=IF(A1>5,"大","小")', v: 0 }],
    [{ f: '=A1*2+3', v: 0 }],
  ],
};

for (const cell of sheet.rows) {
  if (cell[0]?.f) {
    try {
      console.log(cell[0].f, '=>', evaluateFormula(cell[0].f, sheet));
    } catch (error) {
      console.log(cell[0].f, '=> THROW', error.message);
    }
  }
}
console.log('recalc', JSON.stringify(recalcSheet(sheet).rows));
console.log('parseRef', parseRef('A1'));
