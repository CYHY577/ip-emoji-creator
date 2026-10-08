# 表情包 IP 形象一致性创作工具

包含角色创作台、提示词运营页和腾讯云 CloudBase 部署脚本。

## 本地运行

1. 安装 Node.js（建议 20 或更高版本）。
2. 将 `.env.example` 复制为 `.env`，填入自己的 `DASHSCOPE_API_KEY`。
3. 运行 `npm start`，访问 `http://localhost:3000`。

## 项目结构

- `index.html`：角色和表情创作页面。
- `prompts.html`：提示词运营页；修改仅保存在当前浏览器，不会云端共享。
- `server.js`：Node.js 后端代理。
- `server.py`：Python 服务实现。
- `deploy/tencent-cloud/`：腾讯云部署说明、构建脚本和云函数代码。

## 部署与密钥

详见 `deploy/tencent-cloud/README.md`。线上 Key 配置在云函数环境变量中。不要将 `.env`、API Key 或含密钥的打包文件提交到仓库。

