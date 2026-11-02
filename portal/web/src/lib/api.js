const JSON_HEADERS = { 'content-type': 'application/json' };

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { ok: false, error: { message: text.slice(0, 300) || '响应解析失败' } };
  }
  if (!res.ok || body?.ok === false) {
    const message = body?.error?.message || `请求失败（${res.status}）`;
    throw new ApiError(message, { status: res.status, code: body?.error?.code });
  }
  return body?.data ?? body;
}

export const api = {
  get(path) {
    return fetch(path, { credentials: 'same-origin' }).then(parse);
  },
  post(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify(body ?? {}),
    }).then(parse);
  },
  put(path, body) {
    return fetch(path, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify(body ?? {}),
    }).then(parse);
  },
  patch(path, body) {
    return fetch(path, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify(body ?? {}),
    }).then(parse);
  },
  del(path) {
    return fetch(path, { method: 'DELETE', credentials: 'same-origin' }).then(parse);
  },
  upload(path, formData) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', body: formData }).then(parse);
  },
  async download(path, body, fallbackName) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const data = await parse(res);
      throw new ApiError(data?.error?.message || '导出失败', { status: res.status });
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const plain = /filename="([^"]+)"/i.exec(disposition);
    const filename = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallbackName || 'download';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return filename;
  },
};

export const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
};

export const formatTime = (ts) => {
  if (!ts) return '';
  const date = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const KIND_META = {
  docx: { label: '文档', ext: 'DOCX', color: '#2563eb', icon: 'W' },
  xlsx: { label: '表格', ext: 'XLSX', color: '#059669', icon: 'X' },
  pptx: { label: '演示', ext: 'PPTX', color: '#ea580c', icon: 'P' },
  pdf: { label: 'PDF', ext: 'PDF', color: '#dc2626', icon: 'F' },
};
