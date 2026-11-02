import { startService } from '@office/shared/service';
import { ops } from './ops.js';

export const VERSION = '0.4.0';

startService({
  name: 'pdf',
  version: VERSION,
  ops,
  port: Number(process.env.OFFICE_PDF_PORT) || 32204,
  // 合并多份 PDF 时 base64 会比较大
  jsonLimit: 128 * 1024 * 1024,
});
