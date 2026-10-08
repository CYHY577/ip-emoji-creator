'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 9000;
const DASHSCOPE_API_KEY = String(process.env.DASHSCOPE_API_KEY || '').trim();
const ALLOWED_MODELS = new Set(['wan2.7-image', 'wan2.7-image-pro']);
const MAX_BODY_BYTES = 5.5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = Math.min(Number(process.env.REQUEST_TIMEOUT_MS) || 115000, 115000);
const RATE_LIMIT = Math.max(Number(process.env.MAX_REQUESTS_PER_10_MIN) || 20, 1);
const WINDOW_MS = 10 * 60 * 1000;
const rateBuckets = new Map();

function configuredOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function requestOrigin(req) {
  return String(req.headers.origin || '').replace(/\/$/, '');
}

function isOriginAllowed(req) {
  const origin = requestOrigin(req);
  if (!origin) return req.method === 'GET';
  const allowed = configuredOrigins();
  return allowed.includes('*') || allowed.includes(origin);
}

function corsHeaders(req) {
  const origin = requestOrigin(req);
  const allowed = configuredOrigins();
  const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : '');
  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function sendJson(req, res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...corsHeaders(req),
    ...extraHeaders,
  });
  res.end(body);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function takeRateToken(req) {
  const now = Date.now();
  const key = clientIp(req);
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (rateBuckets.size > 2000) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= WINDOW_MS) rateBuckets.delete(bucketKey);
    }
  }
  return current.count <= RATE_LIMIT;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(text || '{}'));
      } catch {
        reject(Object.assign(new Error('请求格式不正确'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function validateInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '请求格式不正确';
  if (typeof data.prompt !== 'string' || !data.prompt.trim()) return '生成指令不能为空';
  if (data.prompt.length > 5000) return '生成指令不能超过 5000 字';
  if (!ALLOWED_MODELS.has(data.model)) return '不支持该模型';
  if (data.referenceImage != null) {
    if (typeof data.referenceImage !== 'string') return '参考图格式不正确';
    const isDataImage = /^data:image\/(?:jpeg|png|webp);base64,/i.test(data.referenceImage);
    const isHttpsImage = /^https:\/\//i.test(data.referenceImage);
    if (!isDataImage && !isHttpsImage) return '参考图格式不正确';
    if (data.referenceImage.length > MAX_BODY_BYTES) return '参考图过大';
  }
  const blocked = /(色情|成人视频|裸体|血腥肢解|恐怖主义|仇恨言论)/i;
  if (blocked.test(data.prompt)) return '生成指令包含不支持的内容';
  return '';
}

function callDashScope(data) {
  const content = [{ text: data.prompt.trim() }];
  if (data.referenceImage) content.push({ image: data.referenceImage });
  const payload = JSON.stringify({
    model: data.model,
    input: { messages: [{ role: 'user', content }] },
    parameters: { size: '1K', n: 1, thinking_mode: false },
  });

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'dashscope.aliyuncs.com',
      port: 443,
      path: '/api/v1/services/aigc/multimodal-generation/generation',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-DashScope-Async': 'disable',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size <= 2 * 1024 * 1024) chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode < 200 || response.statusCode >= 300 || result.code) {
            const error = new Error('模型服务暂时无法完成请求');
            error.status = response.statusCode === 429 ? 429 : 502;
            error.upstreamCode = result.code || response.statusCode;
            reject(error);
            return;
          }
          const imageUrl = result?.output?.choices?.[0]?.message?.content?.[0]?.image;
          if (!imageUrl) throw new Error('missing image');
          resolve({ imageUrl, requestId: result.request_id || response.headers['x-request-id'] || '' });
        } catch (error) {
          if (error.status) reject(error);
          else reject(Object.assign(new Error('模型服务返回异常'), { status: 502 }));
        }
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('模型服务响应超时'), { status: 504 })));
    request.on('error', error => reject(Object.assign(error, { status: error.status || 502 })));
    request.end(payload);
  });
}

async function handler(req, res) {
  const requestId = crypto.randomUUID();
  const path = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname.replace(/\/$/, '') || '/';

  if (!isOriginAllowed(req)) {
    sendJson(req, res, 403, { error: { message: '当前网站来源未获授权', requestId } });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(req), 'Cache-Control': 'public, max-age=600' });
    res.end();
    return;
  }
  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    sendJson(req, res, 200, { ok: true, service: 'ip-emoji-generation', configured: Boolean(DASHSCOPE_API_KEY) });
    return;
  }
  if (req.method !== 'POST' || path !== '/api/generate') {
    sendJson(req, res, 404, { error: { message: '接口不存在', requestId } });
    return;
  }
  if (!DASHSCOPE_API_KEY) {
    sendJson(req, res, 503, { error: { message: '生成服务尚未完成配置', requestId } });
    return;
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendJson(req, res, 415, { error: { message: '仅支持 JSON 请求', requestId } });
    return;
  }
  if (!takeRateToken(req)) {
    sendJson(req, res, 429, { error: { message: '请求过于频繁，请稍后再试', requestId } }, { 'Retry-After': '600' });
    return;
  }

  try {
    const data = await readJson(req);
    const validationError = validateInput(data);
    if (validationError) {
      sendJson(req, res, 400, { error: { message: validationError, requestId } });
      return;
    }
    const result = await callDashScope(data);
    console.log(JSON.stringify({ level: 'info', event: 'generation_ok', requestId, upstreamRequestId: result.requestId }));
    sendJson(req, res, 200, { imageUrl: result.imageUrl, requestId });
  } catch (error) {
    const status = Number(error.status) || 500;
    const publicMessage = status === 413 ? '参考图或请求内容过大'
      : status === 429 ? '模型服务繁忙，请稍后重试'
      : status === 504 ? '模型服务响应超时，请稍后重试'
      : status >= 500 ? '生成服务暂时不可用，请稍后重试'
      : error.message || '请求失败';
    console.error(JSON.stringify({ level: 'error', event: 'generation_failed', requestId, status, upstreamCode: error.upstreamCode || '' }));
    sendJson(req, res, status, { error: { message: publicMessage, requestId } });
  }
}

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`ip-emoji-generation listening on 0.0.0.0:${PORT}`);
});
