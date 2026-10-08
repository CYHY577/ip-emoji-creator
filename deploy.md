# 腾讯云部署指南

## 一、选购服务器

**推荐：腾讯云轻量应用服务器（Lighthouse）**
- 地域选「上海」或「广州」（国内访问快）
- 系统：Ubuntu 22.04 LTS
- 配置：1核2G 即可（约 24 元/月）
- 购买后记下「公网 IP」

## 二、本地打包上传

把以下文件打包成 zip（不需要其他文件）：

```
ip-emoji-creator.zip
├── index.html          ← 主页面（含提示词运营台）
├── server.js           ← Node.js 代理服务
├── package.json
└── prompts.html        ← 可选（本地备用）
```

**Windows PowerShell 打包命令：**
```
Compress-Archive -Path index.html, server.js, package.json, prompts.html -DestinationPath ip-emoji-creator.zip -Force
```

## 三、登录服务器并部署

**1. 用腾讯云控制台 → 轻量服务器 → 远程登录（OrcaTerm）**

或用 SSH（把 1.2.3.4 换成你的服务器 IP）：
```bash
ssh ubuntu@1.2.3.4
```

**2. 安装 Node.js 18**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 应显示 v18.x.x
```

**3. 上传并解压文件**

在腾讯云控制台用「文件上传」功能上传 zip，然后：
```bash
mkdir -p ~/app && cd ~/app
unzip ~/ip-emoji-creator.zip -d .
```

**4. 设置 API Key 并启动**
```bash
cd ~/app
export DASHSCOPE_API_KEY="sk-你的密钥粘贴在这里"
node server.js
```

此时 `http://你的IP:3000` 可访问，但关闭终端会停止。

**5. 用 PM2 保持后台运行**
```bash
sudo npm install -g pm2
cd ~/app
DASHSCOPE_API_KEY="sk-你的密钥" pm2 start server.js --name ip-emoji
pm2 save
pm2 startup    # 按提示执行返回的命令，实现开机自启
```

## 四、开放端口

腾讯云轻量服务器默认只开 22/80/443。

**控制台 → 轻量服务器 → 防火墙 → 添加规则：**
- 协议：TCP
- 端口：3000
- 来源：0.0.0.0/0

之后访问：`http://你的公网IP:3000`

## 五、（可选）绑定域名 + HTTPS

1. 腾讯云购买域名并备案（国内服务器必须备案）
2. 申请免费 SSL 证书（腾讯云→SSL 证书→申请免费版）
3. 在 server.js 中替换 `http.createServer` 为 `https.createServer`，或用 Nginx 做反向代理：

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name yourdomain.com;
    ssl_certificate     /etc/ssl/yourdomain.com.pem;
    ssl_certificate_key /etc/ssl/yourdomain.com.key;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 180s;
    }
}
```

## 六、常用维护命令

```bash
pm2 list              # 查看进程状态
pm2 logs ip-emoji     # 查看日志
pm2 restart ip-emoji  # 重启服务
pm2 stop ip-emoji     # 停止服务

# 更新代码后重启
cd ~/app && unzip -o ~/新包.zip && pm2 restart ip-emoji
```

## 七、安全提醒

- API Key 只存在服务器环境变量中，不写入任何文件
- 不要把 `.env` 文件提交到 git 或上传到公开地方
- 如需限制访问人员，可在 Nginx 中加 `auth_basic` 密码保护
