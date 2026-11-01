import fs from 'node:fs';
import { htmlToPdfBuffer, pptxModelToPdfBuffer, xlsxModelToPdfBuffer } from '../server/src/convert/topdf.js';

const OUT = '/root/projects/office/.shots/pdf';
fs.mkdirSync(OUT, { recursive: true });

const html = `
  <h1>2026 年度工作总结</h1>
  <p>本年度围绕平台稳定性与交付效率两条主线推进，核心指标均有改善。</p>
  <h2>一、平台稳定性</h2>
  <ul>
    <li>可用性从 99.2% 提升到 99.95%</li>
    <li>P1 故障由 7 次降至 1 次，平均恢复时间 18 分钟</li>
    <li>完成全链路压测，峰值 QPS 从 3k 提升到 12k</li>
  </ul>
  <h2>二、关键数据</h2>
  <table>
    <tr><th>指标</th><th>去年</th><th>今年</th><th>变化</th></tr>
    <tr><td>可用性</td><td>99.2%</td><td>99.95%</td><td>+0.75pp</td></tr>
    <tr><td>平均响应</td><td>820ms</td><td>210ms</td><td>-74%</td></tr>
    <tr><td>P1 故障</td><td>7</td><td>1</td><td>-86%</td></tr>
  </table>
  <blockquote>下一年重点是成本优化与自动化，目标把单位请求成本压到现在的 60%。</blockquote>
  <pre>npm run deploy -- --env prod --tag v0.3.0</pre>
  <h2>三、下一步</h2>
  <ol><li>完成多区域容灾</li><li>把发布流程全自动化</li><li>建立成本看板</li></ol>
`;
fs.writeFileSync(`${OUT}/docx.pdf`, await htmlToPdfBuffer(html, { title: '年度总结' }));

fs.writeFileSync(
  `${OUT}/xlsx.pdf`,
  await xlsxModelToPdfBuffer(
    {
      sheets: [
        {
          name: '年度预算',
          colWidths: [150, 110, 110, 110, 110],
          rows: [
            [
              { v: '项目', s: { bold: true, fill: '#1E293B' } },
              { v: 'Q1', s: { bold: true, fill: '#1E293B' } },
              { v: 'Q2', s: { bold: true, fill: '#1E293B' } },
              { v: 'Q3', s: { bold: true, fill: '#1E293B' } },
              { v: 'Q4', s: { bold: true, fill: '#1E293B' } },
            ],
            [{ v: '营业收入' }, { v: 120000 }, { v: 132000 }, { v: 145000 }, { v: 180000 }],
            [{ v: '直接成本' }, { v: 52000 }, { v: 56000 }, { v: 60000 }, { v: 72000 }],
            [{ v: '人力费用' }, { v: 38000 }, { v: 40000 }, { v: 42000 }, { v: 48000 }],
            [{ v: '毛利', s: { bold: true, fill: '#ECFDF5' } }, { f: '=B2-B3-B4', v: 30000 }, { v: 36000 }, { v: 43000 }, { v: 60000 }],
            [{ v: '利润率', s: { bold: true } }, { v: '25.0%' }, { v: '27.3%' }, { v: '29.7%' }, { v: '33.3%' }],
          ],
        },
      ],
    },
    { title: '年度预算' },
  ),
);

fs.writeFileSync(
  `${OUT}/pptx.pdf`,
  await pptxModelToPdfBuffer(
    {
      width: 1280,
      height: 720,
      slides: [
        {
          background: '#0F172A',
          elements: [
            { type: 'rect', x: 0, y: 0, w: 1280, h: 8, fill: '#38BDF8' },
            { type: 'text', x: 96, y: 240, w: 1088, h: 160, text: '在线办公平台 · 季度汇报', role: 'title', size: 54, color: '#F8FAFC', bold: true },
            { type: 'text', x: 96, y: 400, w: 1088, h: 60, text: '2026-11', role: 'body', size: 18, color: '#CBD5E1' },
          ],
        },
        {
          background: '#0F172A',
          elements: [
            { type: 'rect', x: 0, y: 0, w: 10, h: 720, fill: '#38BDF8' },
            { type: 'text', x: 96, y: 72, w: 1088, h: 96, text: '本季度成果', role: 'title', size: 38, color: '#F8FAFC', bold: true },
            { type: 'text', x: 96, y: 200, w: 1088, h: 440, text: '• 收入环比增长 20%\n• 单位成本下降 5%\n• 用户满意度 4.8 / 5\n• 上线素材库与 AI 生图', role: 'body', size: 22, color: '#CBD5E1' },
          ],
        },
        {
          background: '#FFFFFF',
          elements: [
            { type: 'text', x: 96, y: 72, w: 1088, h: 96, text: '下季度计划', role: 'title', size: 38, color: '#0F172A', bold: true },
            { type: 'text', x: 96, y: 200, w: 1088, h: 440, text: '• 多区域容灾\n• 发布全自动化\n• 成本看板', role: 'body', size: 22, color: '#334155' },
          ],
        },
      ],
    },
    { title: '季度汇报' },
  ),
);

console.log('written to', OUT);
