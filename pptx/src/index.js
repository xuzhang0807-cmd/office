import { startService } from '@office/shared/service';
import { ops } from './ops.js';

export const VERSION = '0.4.0';

startService({
  name: 'pptx',
  version: VERSION,
  ops,
  port: Number(process.env.OFFICE_PPTX_PORT) || 32203,
});
