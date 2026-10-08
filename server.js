/**
 * 表情包 IP 创作台 · Node.js 代理服务
 * 启动: node server.js
 * 环境变量: DASHSCOPE_API_KEY=sk-xxxx  (必须)
 *          PORT=3000                    (可选，默认 3000)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 本地开发时读取项目根目录的 .env；线上环境继续以平台注入的环境变量为准。
// .env 已被 .gitignore 排除，绝不参与前端静态包构建。
function loadLocalEnv() {
  if (process.env.DASHSCOPE_API_KEY) return;
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

loadLocalEnv();
const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.DASHSCOPE_API_KEY || '';
const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const ALLOWED_MODELS = new Set(['wan2.7-image', 'wan2.7-image-pro']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

function jsonErr(res, code, msg) {
  const body = JSON.stringify({ error: msg });
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function dashscopeRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: 'dashscope.aliyuncs.com',
      path: '/api/v1/services/aigc/multimodal-generation/generation',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'disable',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (e) {
          reject(new Error('上游响应不是合法 JSON'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('上游请求超时')); });
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  // 健康检查
  if (pathname === '/health' && req.method === 'GET') {
    const body = JSON.stringify({ ok: true, configured: !!API_KEY });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // API 代理
  if (pathname === '/api/generate' && req.method === 'POST') {
    if (!API_KEY) return jsonErr(res, 500, '服务端未配置 API Key，请设置环境变量 DASHSCOPE_API_KEY');

    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { return jsonErr(res, 400, '请求体不是合法 JSON'); }

    const prompt = String(body.prompt || '').trim();
    const refImage = body.referenceImage || null;
    const model = String(body.model || 'wan2.7-image');

    if (!prompt) return jsonErr(res, 400, 'prompt 不能为空');
    if (!ALLOWED_MODELS.has(model)) return jsonErr(res, 400, `不支持的模型：${model}`);

    const content = [{ text: prompt }];
    if (refImage) content.push({ image: refImage });

    const payload = {
      model,
      input: { messages: [{ role: 'user', content }] },
      parameters: { size: '1K', n: 1, thinking_mode: false },
    };

    let result;
    try { result = await dashscopeRequest(payload); }
    catch (e) { return jsonErr(res, 502, `上游请求失败：${e.message}`); }

    if (result.status !== 200) {
      return jsonErr(res, result.status, `DashScope 错误：${JSON.stringify(result.data).slice(0, 300)}`);
    }
    if (result.data.code && result.data.code !== '200' && result.data.code !== 200) {
      return jsonErr(res, 400, `模型错误 [${result.data.code}]: ${result.data.message}`);
    }

    const imgUrl = result.data?.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!imgUrl) return jsonErr(res, 502, '模型未返回图片：' + JSON.stringify(result.data).slice(0, 300));

    const respBody = JSON.stringify({ imageUrl: imgUrl });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(respBody),
    });
    return res.end(respBody);
  }

  // 静态文件
  if (!['/', '/index.html', '/prompts.html', '/app-config.js', '/404.html'].includes(pathname)) {
    res.writeHead(404); return res.end('Not Found');
  }
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath.replace(/^\/+/, ''));

  // 安全：禁止路径穿越
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // 所有未知路径都回落到 index.html（SPA 模式）
      fs.readFile(path.join(__dirname, 'index.html'), (err2, d2) => {
        if (err2) { res.writeHead(404); return res.end('Not Found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  if (!API_KEY) {
    console.warn('⚠️  警告：未检测到 DASHSCOPE_API_KEY 环境变量，/api/generate 将返回 500');
    console.warn('   PowerShell: $env:DASHSCOPE_API_KEY="sk-xxxx"; node server.js');
    console.warn('   Linux/Mac:  DASHSCOPE_API_KEY=sk-xxxx node server.js\n');
  }
  console.log(`✅ 服务已启动：http://localhost:${PORT}`);
});
