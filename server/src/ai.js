import { config } from './config.js';
import * as store from './db.js';
import { HttpError, dayKey, truncate } from './util.js';

/**
 * muse2api 网关。
 * 设计约束：API Key 只在服务端存在，浏览器永远拿不到；配额在服务端按天统计；
 * 上游失败时返回结构化错误码，前端可降级（例如改用素材库已有图）。
 */

const ROLE_QUOTA = {
  guest: { chat: 0, image: 0 },
  member: { chat: config.quota.member.chat, image: config.quota.member.image },
  admin: { chat: Infinity, image: Infinity },
};

export function quotaFor(role) {
  return ROLE_QUOTA[role] || ROLE_QUOTA.guest;
}

export function quotaSnapshot({ user, guestKey }) {
  const role = user?.role || 'guest';
  const limits = quotaFor(role);
  const usedChat = store.usageToday({ userId: user?.id, guestKey, kind: 'chat' });
  const usedImage = store.usageToday({ userId: user?.id, guestKey, kind: 'image' });
  return {
    role,
    chat: { used: usedChat, limit: Number.isFinite(limits.chat) ? limits.chat : -1 },
    image: { used: usedImage, limit: Number.isFinite(limits.image) ? limits.image : -1 },
    day: dayKey(),
  };
}

function assertQuota(kind, ctx) {
  const role = ctx.user?.role || 'guest';
  const limits = quotaFor(role);
  const limit = limits[kind];
  if (limit === 0) {
    throw new HttpError(403, '当前账号等级未开通 AI 能力，请联系管理员提升权限', 'AI_NOT_ENABLED');
  }
  if (!Number.isFinite(limit)) return;
  const used = store.usageToday({ userId: ctx.user?.id, guestKey: ctx.guestKey, kind });
  if (used >= limit) {
    throw new HttpError(429, `今日 ${kind === 'image' ? '生图' : '对话'}额度已用完（${limit} 次/天）`, 'QUOTA_EXCEEDED');
  }
}

async function callUpstream(path, body, timeoutMs) {
  if (!config.muse.apiKey) {
    throw new HttpError(503, '服务端未配置 muse2api 密钥（OFFICE_MUSE_KEY）', 'AI_NOT_CONFIGURED');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.muse.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.muse.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: truncate(text, 800) };
    }
    if (!response.ok) {
      const detail = data?.detail || data?.error?.message || data?.raw || `HTTP ${response.status}`;
      const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
      throw new HttpError(
        response.status === 401 ? 502 : response.status >= 500 ? 502 : response.status,
        `上游模型返回错误：${truncate(message, 300)}`,
        'AI_UPSTREAM_ERROR',
      );
    }
    return data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.name === 'AbortError') {
      throw new HttpError(504, '模型响应超时，请稍后重试或缩短内容', 'AI_TIMEOUT');
    }
    throw new HttpError(502, `无法连接模型服务：${truncate(error.message, 200)}`, 'AI_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}

function logUsage(ctx, { kind, status, latencyMs, detail, units = 1, model }) {
  store.recordUsage({
    userId: ctx.user?.id,
    guestKey: ctx.guestKey,
    kind,
    model,
    status,
    latencyMs,
    units,
    day: dayKey(),
    detail: truncate(detail, 500),
  });
}

/** 文档助手：润色 / 摘要 / 翻译 / 续写 / 表格公式 / 幻灯片大纲。 */
export async function chat(ctx, { task, text, locale = 'zh-CN', extra = '' }) {
  assertQuota('chat', ctx);
  const prompts = {
    polish: '你是中文公文与商务写作编辑。在保持原意与事实的前提下润色下面的文字：修正语病、统一术语、提升可读性。只输出润色后的正文，不要解释。',
    summarize: '你是文档摘要助手。用不超过 5 条要点概括下面的内容，每条一行，以「- 」开头。只输出要点。',
    expand: '你是写作助手。基于下面的要点扩写成连贯的段落，保持原有信息，不要编造数据。只输出正文。',
    translate: `你是专业翻译。把下面的内容翻译成${locale === 'en' ? '英文' : '简体中文'}，保留专有名词与数字。只输出译文。`,
    outline: '你是演示文稿策划。根据下面的主题/材料输出 JSON：{"title":"...","slides":[{"title":"...","bullets":["..."]}]}，6-10 页，中文，不要额外文字。',
    formula: '你是 Excel 专家。根据描述给出可直接粘贴的公式（以 = 开头），并另起一行用一句话解释。不要输出其他内容。',
    analyze: '你是数据分析助手。阅读给出的表格样本，指出趋势、异常与建议，用不超过 6 条要点回答。',
  };
  const system = prompts[task];
  if (!system) throw new HttpError(400, `不支持的 AI 任务：${task}`, 'BAD_TASK');
  const userContent = extra ? `${text}\n\n补充要求：${extra}` : String(text || '');
  if (!userContent.trim()) throw new HttpError(400, '内容为空', 'EMPTY_INPUT');
  if (userContent.length > 24000) throw new HttpError(413, '内容过长（上限 24000 字符）', 'TOO_LONG');

  const started = Date.now();
  try {
    const data = await callUpstream(
      '/v1/chat/completions',
      {
        model: config.muse.chatModel,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      },
      config.muse.chatTimeoutMs,
    );
    const content = data?.choices?.[0]?.message?.content ?? data?.output_text ?? '';
    if (!content) throw new HttpError(502, '模型返回为空', 'AI_EMPTY');
    logUsage(ctx, { kind: 'chat', status: 'ok', latencyMs: Date.now() - started, detail: `${task}: ${truncate(text, 80)}`, model: config.muse.chatModel });
    return { task, content: String(content).trim(), model: config.muse.chatModel, latencyMs: Date.now() - started };
  } catch (error) {
    logUsage(ctx, {
      kind: 'chat',
      status: 'error',
      latencyMs: Date.now() - started,
      detail: `${task}: ${error.message}`,
      model: config.muse.chatModel,
    });
    throw error;
  }
}

/** 生图：返回可持久化的二进制与元数据，由调用方落到素材库。 */
export async function generateImage(ctx, { prompt, size = '16:9', count = 1 }) {
  assertQuota('image', ctx);
  if (!String(prompt || '').trim()) throw new HttpError(400, '提示词为空', 'EMPTY_PROMPT');
  const aspect = ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(size) ? size : '16:9';
  const started = Date.now();
  try {
    const data = await callUpstream(
      '/v1/images/generations',
      {
        model: config.muse.imageModel,
        prompt: String(prompt).slice(0, 2000),
        n: Math.min(Math.max(Number(count) || 1, 1), 4),
        aspect_ratio: aspect,
        response_format: 'b64_json',
      },
      config.muse.imageTimeoutMs,
    );
    const items = Array.isArray(data?.data) ? data.data : [];
    const images = [];
    for (const item of items) {
      if (item.b64_json) {
        images.push({ buffer: Buffer.from(item.b64_json, 'base64'), revisedPrompt: item.revised_prompt || prompt });
      } else if (item.url) {
        images.push({ url: item.url, revisedPrompt: item.revised_prompt || prompt });
      }
    }
    if (!images.length) throw new HttpError(502, '模型未返回图片', 'AI_EMPTY');
    logUsage(ctx, {
      kind: 'image',
      status: 'ok',
      latencyMs: Date.now() - started,
      detail: truncate(prompt, 120),
      units: images.length,
      model: config.muse.imageModel,
    });
    return { images, model: config.muse.imageModel, aspect, latencyMs: Date.now() - started };
  } catch (error) {
    logUsage(ctx, {
      kind: 'image',
      status: 'error',
      latencyMs: Date.now() - started,
      detail: truncate(prompt, 120) + ' | ' + error.message,
      model: config.muse.imageModel,
    });
    throw error;
  }
}

/**
 * 大纲生成：模型偶尔会输出带重复片段或截断的 JSON，这里做一次“解析 + 修复 + 兜底”，
 * 保证前端拿到的永远是可直接渲染的 {title, slides:[{title,bullets:[]}]}。
 */
export async function generateOutline(ctx, { topic, pages = 8, tone = '商务简洁' }) {
  const prompt = [
    `主题：${String(topic || '').slice(0, 2000)}`,
    `页数：约 ${Math.min(Math.max(Number(pages) || 8, 3), 20)} 页（不含封面）`,
    `风格：${tone}`,
    '严格输出 JSON，不要 Markdown 代码块，不要解释：',
    '{"title":"演示标题","slides":[{"title":"页标题","bullets":["要点1","要点2"]}]}',
  ].join('\n');
  const result = await chat(ctx, { task: 'outline', text: prompt });
  const parsed = parseOutline(result.content, topic);
  return { ...result, outline: parsed, repaired: parsed.repaired === true };
}

function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  // 截断的情况：补足右括号再试一次
  return `${cleaned.slice(start)}${'}'.repeat(Math.max(depth, 0))}`;
}

export function parseOutline(raw, topic = '演示文稿') {
  const candidate = extractJson(raw);
  let data = null;
  if (candidate) {
    try {
      data = JSON.parse(candidate);
    } catch {
      try {
        data = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        data = null;
      }
    }
  }
  const slides = [];
  const seen = new Set();
  for (const item of Array.isArray(data?.slides) ? data.slides : []) {
    if (!item || typeof item !== 'object') continue;
    const title = String(item.title || '').trim().slice(0, 80);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    let bullets = item.bullets;
    if (typeof bullets === 'string') bullets = bullets.split(/[\n;；]+/);
    if (!Array.isArray(bullets)) bullets = [];
    const cleaned = bullets
      .map((b) => String(b ?? '').replace(/^[-•·\s]+/, '').trim())
      .filter((b) => b && !b.startsWith('{') && !b.startsWith('"title"'))
      .slice(0, 8);
    slides.push({ title, bullets: cleaned });
    if (slides.length >= 20) break;
  }

  if (!slides.length) {
    // 兜底：把原文按句切分成要点，至少给出一页可用大纲
    const sentences = String(raw || topic)
      .replace(/[{}\[\]"]/g, ' ')
      .split(/[。\n；;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3)
      .slice(0, 12);
    const chunks = [];
    for (let i = 0; i < sentences.length; i += 4) chunks.push(sentences.slice(i, i + 4));
    slides.push(
      ...(chunks.length ? chunks : [['（模型未返回结构化大纲，请补充主题后重试）']]).map((bullets, index) => ({
        title: index === 0 ? '内容要点' : `要点 ${index + 1}`,
        bullets,
      })),
    );
  }

  const title = String(data?.title || topic || '演示文稿').trim().slice(0, 80) || '演示文稿';
  return { title, slides, repaired: !data || slides.length !== (data?.slides?.length || 0) };
}

/** 供前端展示的模型清单，隐藏 key 与内部地址。 */
export async function modelCatalog() {
  const models = [
    { id: config.muse.chatModel, kind: 'chat', label: 'Muse 文本模型', note: '润色 / 摘要 / 翻译 / 大纲' },
    { id: config.muse.imageModel, kind: 'image', label: 'Muse 生图模型', note: '文生图 / 参考图编辑' },
  ];
  let healthy = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${config.muse.baseUrl}/healthz`, { signal: controller.signal });
    healthy = response.ok;
    clearTimeout(timer);
  } catch {
    healthy = false;
  }
  return { models, healthy, baseUrlConfigured: Boolean(config.muse.apiKey) };
}
