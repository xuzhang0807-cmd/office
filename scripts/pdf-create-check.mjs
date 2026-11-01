import { createPdf, pdfInfo } from '../server/src/convert/pdf.js';
import { fontStatus } from '../server/src/convert/fonts.js';

console.log('font', fontStatus());

for (const opts of [{ title: '', pages: 1 }, { title: '正式函件', pages: 1 }, { title: 'PDF 中文标题', pages: 2 }]) {
  try {
    const buf = await createPdf(opts);
    const info = await pdfInfo(buf);
    console.log('ok', JSON.stringify(opts), buf.length, 'pages', info.pageCount);
  } catch (error) {
    console.log('FAIL', JSON.stringify(opts), error.constructor.name, error.message);
    console.log(error.stack?.split('\n').slice(0, 6).join('\n'));
  }
}
