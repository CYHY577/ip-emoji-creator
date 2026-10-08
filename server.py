"""
表情包 IP 创作台 · 本地后台服务
用法：
  1. 设置环境变量（推荐）：
       set DASHSCOPE_API_KEY=sk-xxxxx        (Windows CMD)
       $env:DASHSCOPE_API_KEY="sk-xxxxx"     (PowerShell)
  2. 或直接修改下方 API_KEY 变量（仅限本机，勿提交到 git）
  3. python server.py
  4. 浏览器打开 http://localhost:8080
"""

import http.server
import json
import os
import urllib.request
import urllib.error

# ── 配置 ──────────────────────────────────────────────────────────────
PORT = 8080
API_KEY = os.environ.get('DASHSCOPE_API_KEY', '')  # 优先读环境变量
DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
ALLOWED_MODELS = {'wan2.7-image', 'wan2.7-image-pro'}
# ─────────────────────────────────────────────────────────────────────


class Handler(http.server.SimpleHTTPRequestHandler):

    def send_head(self):
        if self.path.split('?', 1)[0] not in ('/', '/index.html', '/prompts.html', '/app-config.js', '/404.html'):
            self.send_error(404)
            return None
        return super().send_head()

    def do_OPTIONS(self):
        self._cors(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/generate':
            self._handle_generate()
        else:
            self.send_error(404)

    def _handle_generate(self):
        if not API_KEY:
            return self._json_err(500, '服务端未配置 API Key，请设置环境变量 DASHSCOPE_API_KEY')

        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            return self._json_err(400, '请求体不是合法 JSON')

        prompt = str(body.get('prompt', '')).strip()
        ref_image = body.get('referenceImage')  # base64 data URL or None
        model = str(body.get('model', 'wan2.7-image'))

        if not prompt:
            return self._json_err(400, 'prompt 不能为空')
        if model not in ALLOWED_MODELS:
            return self._json_err(400, f'不支持的模型：{model}')

        # 构造 DashScope 多模态请求
        content = [{'text': prompt}]
        if ref_image:
            content.append({'image': ref_image})

        ds_payload = json.dumps({
            'model': model,
            'input': {'messages': [{'role': 'user', 'content': content}]},
            'parameters': {'size': '1K', 'n': 1, 'thinking_mode': False},
        }).encode()

        req = urllib.request.Request(
            DASHSCOPE_URL,
            data=ds_payload,
            headers={
                'Authorization': f'Bearer {API_KEY}',
                'Content-Type': 'application/json',
                'X-DashScope-Async': 'disable',
            },
            method='POST',
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                ds_data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')
            return self._json_err(e.code, f'DashScope 错误：{msg[:300]}')
        except Exception as e:
            return self._json_err(502, f'上游请求失败：{e}')

        img_url = (ds_data.get('output', {})
                   .get('choices', [{}])[0]
                   .get('message', {})
                   .get('content', [{}])[0]
                   .get('image'))

        if not img_url:
            return self._json_err(502, '模型未返回图片：' + json.dumps(ds_data)[:200])

        self._cors(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'imageUrl': img_url}).encode())

    def _json_err(self, code, msg):
        body = json.dumps({'error': msg}).encode()
        self._cors(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self, code):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        print(f'[{self.address_string()}] {fmt % args}')


if __name__ == '__main__':
    if not API_KEY:
        print('⚠️  警告：未检测到 DASHSCOPE_API_KEY 环境变量')
        print('   请运行：$env:DASHSCOPE_API_KEY="sk-xxxxx"  (PowerShell)')
        print('   或直接编辑 server.py 中的 API_KEY 变量\n')
    server = http.server.HTTPServer(('', PORT), Handler)
    print(f'✅ 后台服务已启动：http://localhost:{PORT}')
    print('   按 Ctrl+C 停止\n')
    server.serve_forever()
