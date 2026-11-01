import { htmlToDocxBuffer } from './convert/docx.js';
import { modelToXlsxBuffer } from './convert/xlsx.js';
import { outlineToModel, modelToPptxBuffer } from './convert/pptx.js';
import { createPdf } from './convert/pdf.js';
import * as blobs from './blobs.js';
import * as store from './db.js';

/**
 * 内置模板库：不依赖外部素材，随服务启动自动落库。
 * 全部由代码生成，避免仓库里塞二进制文件，也保证模板与导出链路始终一致。
 */

const DOCX_TEMPLATES = [
  {
    slug: 'contract-service',
    title: '服务合同（标准版）',
    category: 'contract',
    tags: '合同,服务,甲方乙方',
    description: '甲乙双方服务合作的标准条款框架，含金额、期限、违约责任与签署栏。',
    featured: 1,
    html: `
      <h1 style="text-align: center">服务合作协议</h1>
      <p style="text-align: center">合同编号：__________</p>
      <p><strong>甲方（委托方）：</strong>____________________</p>
      <p><strong>乙方（服务方）：</strong>____________________</p>
      <p>甲乙双方本着平等自愿、诚实信用的原则，就甲方委托乙方向其提供技术服务事宜，经协商一致，订立本协议。</p>
      <h2>第一条 服务内容</h2>
      <p>1.1 乙方向甲方提供以下服务：____________________。</p>
      <p>1.2 服务交付形式：____________________。</p>
      <p>1.3 服务周期：自 ______ 年 ____ 月 ____ 日起至 ______ 年 ____ 月 ____ 日止。</p>
      <h2>第二条 服务费用与支付</h2>
      <p>2.1 服务总费用为人民币（大写）____________________ 元（¥__________）。</p>
      <p>2.2 支付方式：甲方于本协议生效后 ____ 个工作日内支付 ____%，验收合格后支付剩余款项。</p>
      <p>2.3 乙方应在收款前向甲方开具等额增值税发票。</p>
      <h2>第三条 双方权利义务</h2>
      <p>3.1 甲方应按约定提供必要的资料、场地与配合人员。</p>
      <p>3.2 乙方应按约定标准与进度完成服务，并对服务成果的质量负责。</p>
      <p>3.3 双方对合作过程中知悉的对方商业秘密负有保密义务，保密期限为协议终止后 ____ 年。</p>
      <h2>第四条 验收与违约责任</h2>
      <p>4.1 甲方应在收到服务成果后 ____ 个工作日内完成验收，逾期未提出异议视为验收合格。</p>
      <p>4.2 任何一方违约，应向守约方支付合同总额 ____% 的违约金；造成损失的，还应赔偿实际损失。</p>
      <h2>第五条 争议解决</h2>
      <p>因本协议引起的争议，双方应友好协商解决；协商不成的，提交____________仲裁委员会仲裁。</p>
      <p>本协议一式两份，甲乙双方各执一份，自双方签字盖章之日起生效。</p>
      <table>
        <tr><th>甲方（盖章）</th><th>乙方（盖章）</th></tr>
        <tr><td>授权代表：__________</td><td>授权代表：__________</td></tr>
        <tr><td>日期：____年__月__日</td><td>日期：____年__月__日</td></tr>
      </table>
    `,
  },
  {
    slug: 'report-weekly',
    title: '周工作报告',
    category: 'report',
    tags: '周报,汇报,工作总结',
    description: '本周完成、下周计划、风险与支持需求的四段式周报骨架。',
    html: `
      <h1>周工作报告</h1>
      <p>姓名：__________　　部门：__________　　周期：____ 月 ____ 日 — ____ 月 ____ 日</p>
      <h2>一、本周完成事项</h2>
      <ul>
        <li>完成 ____________________，进度 ____%。</li>
        <li>推进 ____________________，已交付 ____________________。</li>
        <li>配合 ____________________，输出 ____________________。</li>
      </ul>
      <h2>二、关键数据</h2>
      <table>
        <tr><th>指标</th><th>目标</th><th>实际</th><th>达成率</th></tr>
        <tr><td>任务完成数</td><td></td><td></td><td></td></tr>
        <tr><td>缺陷修复数</td><td></td><td></td><td></td></tr>
        <tr><td>用户反馈处理</td><td></td><td></td><td></td></tr>
      </table>
      <h2>三、下周计划</h2>
      <ol>
        <li>____________________</li>
        <li>____________________</li>
        <li>____________________</li>
      </ol>
      <h2>四、风险与需要支持</h2>
      <p>风险：____________________；影响：____________________；建议：____________________。</p>
    `,
  },
  {
    slug: 'resume-general',
    title: '通用简历',
    category: 'hr',
    tags: '简历,求职,模板',
    description: '一页式简历结构：个人信息、求职意向、经历、项目、技能与教育。',
    html: `
      <h1>张三</h1>
      <p>求职意向：前端工程师　|　电话：138-0000-0000　|　邮箱：name@example.com　|　城市：杭州</p>
      <h2>个人概述</h2>
      <p>3 年 Web 前端开发经验，熟悉 React 生态与工程化体系，主导过中后台系统从 0 到 1 的建设，关注性能与可维护性。</p>
      <h2>工作经历</h2>
      <p><strong>某某科技有限公司</strong>　前端工程师　2022.03 — 至今</p>
      <ul>
        <li>负责管理后台重构，首屏加载时间从 4.2s 降至 1.1s。</li>
        <li>搭建组件库与 CI 流程，需求平均交付周期缩短 30%。</li>
      </ul>
      <h2>项目经历</h2>
      <p><strong>在线协作文档平台</strong>　核心开发</p>
      <ul>
        <li>实现富文本编辑与版本对比，支撑日均 2 万次编辑。</li>
        <li>设计增量保存协议，弱网环境下内容零丢失。</li>
      </ul>
      <h2>技能</h2>
      <p>JavaScript / TypeScript / React / Node.js / Vite / Docker / SQL</p>
      <h2>教育背景</h2>
      <p>某某大学　计算机科学与技术　本科　2018 — 2022</p>
    `,
  },
  {
    slug: 'notice-meeting',
    title: '会议通知',
    category: 'admin',
    tags: '通知,会议,行政',
    description: '标准会议通知模板，含时间地点、议题、参会要求。',
    html: `
      <h1 style="text-align: center">关于召开 ____________________ 会议的通知</h1>
      <p>各部门、各位同事：</p>
      <p>经研究决定，定于 ______ 年 ____ 月 ____ 日（星期____）____:____ 召开 ____________________ 会议，现将有关事项通知如下：</p>
      <h2>一、会议时间</h2>
      <p>______ 年 ____ 月 ____ 日 ____:____ — ____:____</p>
      <h2>二、会议地点</h2>
      <p>____________________ 会议室 / 线上会议链接：____________________</p>
      <h2>三、参会人员</h2>
      <p>____________________</p>
      <h2>四、会议议题</h2>
      <ol>
        <li>____________________</li>
        <li>____________________</li>
        <li>____________________</li>
      </ol>
      <h2>五、有关要求</h2>
      <p>请参会人员提前 5 分钟到场，携带相关材料；如因故不能参加，请提前向会务联系人请假。</p>
      <p style="text-align: right">____________________（部门）<br/>______ 年 ____ 月 ____ 日</p>
    `,
  },
];

const XLSX_TEMPLATES = [
  {
    slug: 'budget-annual',
    title: '年度预算表（含公式）',
    category: 'finance',
    tags: '预算,财务,公式',
    description: '按月列示收入、成本、费用，自动汇总合计与利润率。',
    featured: 1,
    sheets: [
      {
        name: '年度预算',
        colWidths: [150, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110],
        rows: [
          [
            { v: '项目', s: { bold: true, fill: '#1E293B', color: '#FFFFFF', align: 'center' } },
            ...['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'].map((m) => ({
              v: m,
              s: { bold: true, fill: '#1E293B', color: '#FFFFFF', align: 'center' },
            })),
          ],
          [
            { v: '营业收入', s: { bold: true } },
            ...[120000, 125000, 130000, 132000, 140000, 145000, 150000, 152000, 158000, 165000, 170000, 180000].map((v) => ({ v })),
          ],
          [
            { v: '直接成本', s: { bold: true } },
            ...[52000, 53000, 55000, 56000, 58000, 60000, 62000, 63000, 65000, 67000, 69000, 72000].map((v) => ({ v })),
          ],
          [
            { v: '人力费用', s: { bold: true } },
            ...[38000, 38000, 40000, 40000, 42000, 42000, 44000, 44000, 46000, 46000, 48000, 48000].map((v) => ({ v })),
          ],
          [
            { v: '市场费用', s: { bold: true } },
            ...[8000, 9000, 10000, 9000, 11000, 12000, 12000, 13000, 13000, 14000, 15000, 16000].map((v) => ({ v })),
          ],
          [
            { v: '其他费用', s: { bold: true } },
            ...[4000, 4000, 4200, 4200, 4400, 4400, 4600, 4600, 4800, 4800, 5000, 5000].map((v) => ({ v })),
          ],
          [
            { v: '费用合计', s: { bold: true, fill: '#F1F5F9' } },
            ...Array.from({ length: 12 }, (_, i) => {
              const col = String.fromCharCode(66 + i);
              return { f: `=SUM(${col}3:${col}6)`, v: 0, s: { fill: '#F1F5F9', numFmt: '#,##0' } };
            }),
          ],
          [
            { v: '毛利', s: { bold: true, fill: '#ECFDF5' } },
            ...Array.from({ length: 12 }, (_, i) => {
              const col = String.fromCharCode(66 + i);
              return { f: `=${col}2-${col}7`, v: 0, s: { fill: '#ECFDF5', numFmt: '#,##0' } };
            }),
          ],
          [
            { v: '利润率', s: { bold: true, fill: '#EFF6FF' } },
            ...Array.from({ length: 12 }, (_, i) => {
              const col = String.fromCharCode(66 + i);
              return { f: `=IF(${col}2=0,0,${col}8/${col}2)`, v: 0, s: { fill: '#EFF6FF', numFmt: '0.0%' } };
            }),
          ],
          [{ v: '' }],
          [
            { v: '全年合计', s: { bold: true } },
            { v: '营业收入', s: { bold: true } },
            { f: '=SUM(B2:M2)', v: 0, s: { numFmt: '#,##0' } },
          ],
          [
            { v: '' },
            { v: '费用合计', s: { bold: true } },
            { f: '=SUM(B7:M7)', v: 0, s: { numFmt: '#,##0' } },
          ],
          [
            { v: '' },
            { v: '毛利', s: { bold: true } },
            { f: '=SUM(B8:M8)', v: 0, s: { numFmt: '#,##0' } },
          ],
        ],
        merges: [],
      },
    ],
  },
  {
    slug: 'inventory-tracker',
    title: '库存管理台账',
    category: 'ops',
    tags: '库存,进销存,台账',
    description: '商品出入库记录，自动计算结存与库存金额。',
    sheets: [
      {
        name: '库存台账',
        colWidths: [100, 160, 110, 90, 90, 110, 110, 110, 120],
        rows: [
          [
            { v: 'SKU', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '商品名称', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '规格', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '期初库存', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '入库', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '出库', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '结存', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '单价', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
            { v: '库存金额', s: { bold: true, fill: '#0F172A', color: '#FFFFFF' } },
          ],
          [{ v: 'SKU-0001' }, { v: '示例商品 A' }, { v: '标准装' }, { v: 120 }, { v: 80 }, { v: 45 }, { f: '=D2+E2-F2', v: 0 }, { v: 39.9, s: { numFmt: '0.00' } }, { f: '=G2*H2', v: 0, s: { numFmt: '#,##0.00' } }],
          [{ v: 'SKU-0002' }, { v: '示例商品 B' }, { v: '大包装' }, { v: 60 }, { v: 0 }, { v: 12 }, { f: '=D3+E3-F3', v: 0 }, { v: 128, s: { numFmt: '0.00' } }, { f: '=G3*H3', v: 0, s: { numFmt: '#,##0.00' } }],
          [{ v: '' }],
          [
            { v: '合计', s: { bold: true, fill: '#F1F5F9' } },
            { v: '' },
            { v: '' },
            { f: '=SUM(D2:D3)', v: 0, s: { bold: true } },
            { f: '=SUM(E2:E3)', v: 0, s: { bold: true } },
            { f: '=SUM(F2:F3)', v: 0, s: { bold: true } },
            { f: '=SUM(G2:G3)', v: 0, s: { bold: true } },
            { v: '' },
            { f: '=SUM(I2:I3)', v: 0, s: { bold: true, numFmt: '#,##0.00' } },
          ],
        ],
        merges: [],
      },
    ],
  },
  {
    slug: 'project-schedule',
    title: '项目进度表',
    category: 'pm',
    tags: '项目,进度,甘特',
    description: '任务、负责人、起止日期、状态与完成度，含自动统计。',
    sheets: [
      {
        name: '进度',
        colWidths: [200, 110, 110, 110, 100, 100],
        rows: [
          [
            { v: '任务', s: { bold: true, fill: '#1D4ED8', color: '#FFFFFF' } },
            { v: '负责人', s: { bold: true, fill: '#1D4ED8', color: '#FFFFFF' } },
            { v: '开始', s: { bold: true, fill: '#1D4ED8', color: '#FFFFFF' } },
            { v: '结束', s: { bold: true, fill: '#1D4ED8', color: '#FFFFFF' } },
            { v: '状态', s: { bold: true, fill: '#1D4ED8', color: '#FFFFFF' } },
            { v: '完成度', s: { bold: true, fill: '#1D4ED8', color: '#FFFFFF' } },
          ],
          [{ v: '需求调研' }, { v: '张三' }, { v: '2026-01-05' }, { v: '2026-01-12' }, { v: '已完成' }, { v: 1, s: { numFmt: '0%' } }],
          [{ v: '原型设计' }, { v: '李四' }, { v: '2026-01-12' }, { v: '2026-01-22' }, { v: '进行中' }, { v: 0.6, s: { numFmt: '0%' } }],
          [{ v: '开发实现' }, { v: '王五' }, { v: '2026-01-22' }, { v: '2026-02-20' }, { v: '未开始' }, { v: 0, s: { numFmt: '0%' } }],
          [{ v: '测试验收' }, { v: '赵六' }, { v: '2026-02-20' }, { v: '2026-03-05' }, { v: '未开始' }, { v: 0, s: { numFmt: '0%' } }],
          [{ v: '' }],
          [{ v: '平均完成度', s: { bold: true } }, { f: '=AVERAGE(F2:F5)', v: 0, s: { bold: true, numFmt: '0%' } }],
          [{ v: '任务总数', s: { bold: true } }, { f: '=COUNTA(A2:A5)', v: 0, s: { bold: true } }],
        ],
        merges: [],
      },
    ],
  },
];

const PPTX_TEMPLATES = [
  {
    slug: 'deck-business-plan',
    title: '商业计划书',
    category: 'business',
    tags: '商业计划,融资,路演',
    description: '10 页商业计划书结构，深色主题，含市场、产品、模式与财务规划。',
    featured: 1,
    theme: 'midnight',
    outline: {
      title: '商业计划书',
      slides: [
        { title: '市场机会', bullets: ['目标市场规模与增速', '客户痛点与现有方案缺口', '为什么是现在'] },
        { title: '解决方案', bullets: ['产品核心能力', '与竞品的差异化', '关键技术与壁垒'] },
        { title: '目标客户', bullets: ['核心客群画像', '典型使用场景', '早期种子客户'] },
        { title: '商业模式', bullets: ['收入结构：订阅 + 增值', '定价策略与客单价', '获客成本与回收周期'] },
        { title: '竞争格局', bullets: ['主要玩家与定位', '我们的优势区间', '防御策略'] },
        { title: '增长路径', bullets: ['0-1 验证阶段', '1-10 规模化', '关键里程碑'] },
        { title: '财务规划', bullets: ['三年收入预测', '成本结构与盈亏平衡点', '资金用途'] },
        { title: '团队', bullets: ['核心成员背景', '顾问与资源', '组织规划'] },
        { title: '融资需求', bullets: ['融资金额与估值', '资金用途拆解', '投资回报预期'] },
      ],
    },
  },
  {
    slug: 'deck-work-report',
    title: '季度工作汇报',
    category: 'report',
    tags: '汇报,季度,总结',
    description: '季度汇报结构：成果、数据、问题、下季计划。',
    theme: 'paper',
    outline: {
      title: '季度工作汇报',
      slides: [
        { title: '本季度概览', bullets: ['整体目标达成情况', '关键里程碑', '团队投入'] },
        { title: '核心成果', bullets: ['业务指标增长', '重点项目交付', '流程与效率改进'] },
        { title: '数据表现', bullets: ['关键指标对比', '同比与环比', '异常与归因'] },
        { title: '问题与复盘', bullets: ['未达成项及原因', '过程中的教训', '已采取的纠正措施'] },
        { title: '下季度计划', bullets: ['重点目标', '资源需求', '风险预案'] },
      ],
    },
  },
  {
    slug: 'deck-training',
    title: '培训课件',
    category: 'training',
    tags: '培训,课件,教学',
    description: '培训课件骨架：目标、知识要点、案例、练习与总结。',
    theme: 'forest',
    outline: {
      title: '培训课程',
      slides: [
        { title: '课程目标', bullets: ['学完能做什么', '适用人群', '课程结构'] },
        { title: '核心概念', bullets: ['基础定义', '关键模型', '常见误区'] },
        { title: '操作演示', bullets: ['步骤一', '步骤二', '步骤三'] },
        { title: '案例分析', bullets: ['背景', '做法', '结果与启示'] },
        { title: '练习与作业', bullets: ['课堂练习', '课后作业', '评估标准'] },
        { title: '总结', bullets: ['要点回顾', '延伸阅读', '答疑方式'] },
      ],
    },
  },
];

const PDF_TEMPLATES = [
  { slug: 'pdf-blank-a4', title: '空白 A4 页面', category: 'basic', tags: '空白,A4', description: '标准 A4 空白页，可直接用于签署或打印。', options: { title: '', pages: 1 } },
  { slug: 'pdf-cover-letter', title: '正式函件封面', category: 'letter', tags: '函件,封面,公文', description: '带标题的 A4 函件首页，适合打印后手写或叠加内容。', options: { title: '正式函件', pages: 1 } },
];

export async function seedTemplates({ force = false } = {}) {
  const existing = store.listTemplates({ limit: 500 });
  if (existing.length && !force) return { created: 0, skipped: existing.length };

  let created = 0;
  const failed = [];
  /** 单个模板失败不能拖垮整批：记下来继续，下次启动会补。 */
  const guard = async (label, fn) => {
    try {
      await fn();
      created += 1;
    } catch (error) {
      failed.push(`${label}: ${error.message}`);
      console.error(`[office] 模板生成失败 ${label}:`, error.message);
    }
  };

  for (const tpl of DOCX_TEMPLATES) {
    await guard(tpl.slug, async () => {
      const buffer = await htmlToDocxBuffer(tpl.html, { title: tpl.title });
      const stored = blobs.storeContent(buffer, 'docx');
      store.upsertTemplate({
        slug: tpl.slug,
        kind: 'docx',
        title: tpl.title,
        category: tpl.category,
        description: tpl.description,
        tags: tpl.tags,
        blobKey: stored.key,
        preview: previewFromHtml(tpl.html),
        size: buffer.length,
        featured: tpl.featured,
      });
    });
  }
  for (const tpl of XLSX_TEMPLATES) {
    await guard(tpl.slug, async () => {
      const buffer = await modelToXlsxBuffer({ sheets: tpl.sheets });
      const stored = blobs.storeContent(buffer, 'xlsx');
      store.upsertTemplate({
        slug: tpl.slug,
        kind: 'xlsx',
        title: tpl.title,
        category: tpl.category,
        description: tpl.description,
        tags: tpl.tags,
        blobKey: stored.key,
        preview: previewFromSheets(tpl.sheets),
        size: buffer.length,
        featured: tpl.featured,
      });
    });
  }
  for (const tpl of PPTX_TEMPLATES) {
    await guard(tpl.slug, async () => {
      const model = outlineToModel(tpl.outline, tpl.theme);
      const buffer = await modelToPptxBuffer(model, { title: tpl.title });
      const stored = blobs.storeContent(buffer, 'pptx');
      store.upsertTemplate({
        slug: tpl.slug,
        kind: 'pptx',
        title: tpl.title,
        category: tpl.category,
        description: tpl.description,
        tags: tpl.tags,
        blobKey: stored.key,
        preview: `${tpl.outline.slides.length + 1} 页 · 主题 ${tpl.theme}`,
        size: buffer.length,
        featured: tpl.featured,
      });
    });
  }
  for (const tpl of PDF_TEMPLATES) {
    await guard(tpl.slug, async () => {
      const buffer = await createPdf(tpl.options);
      const stored = blobs.storeContent(buffer, 'pdf');
      store.upsertTemplate({
        slug: tpl.slug,
        kind: 'pdf',
        title: tpl.title,
        category: tpl.category,
        description: tpl.description,
        tags: tpl.tags,
        blobKey: stored.key,
        preview: 'A4 · 1 页',
        size: buffer.length,
      });
    });
  }
  return { created, skipped: 0, failed };
}

function previewFromHtml(html) {
  const text = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 140);
}

function previewFromSheets(sheets) {
  const sheet = sheets[0];
  const header = (sheet.rows[0] || []).map((cell) => cell?.v).filter(Boolean).join(' / ');
  return `${sheets.length} 个工作表 · 列：${header}`.slice(0, 140);
}
