import { startService } from '@office/shared/service';
import { ops } from './ops.js';

export const VERSION = '0.4.0';

startService({
  name: 'docx',
  version: VERSION,
  ops,
  port: Number(process.env.OFFICE_DOCX_PORT) || 32201,
});
