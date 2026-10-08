# 腾讯云部署说明

## 推荐架构

```text
浏览器
  ├─ 创作页 /index.html
  ├─ 本地运营页 /prompts.html
  └─ HTTPS 请求
       ↓
腾讯云 SCF Web 函数（API Key、限流、校验、错误脱敏）
       ↓
阿里云 DashScope 图像生成 API
```

前端推荐放在腾讯云 CloudBase 静态托管；后端使用 SCF Web 函数。这个组合不需要维护服务器，并且不会把 DashScope API Key 暴露给访问者。

## 一、部署生成服务（SCF Web 函数）

1. 在腾讯云控制台创建 **Web 函数**，运行环境选择 Node.js 18 或更高版本。
2. 函数内需要监听 `0.0.0.0:9000`。本项目的 `scf/server.js` 已按此要求实现。
3. 把 `scf` 目录中的三个文件作为函数代码上传。若使用自定义启动文件，请确认 `scf_bootstrap` 在 Linux 环境具有可执行权限：`chmod 755 scf_bootstrap`。
4. 建议配置：内存 512 MB、执行超时 120 秒、单实例并发 1 起步，后续按监控数据调整。
5. 设置环境变量：

   - `DASHSCOPE_API_KEY`：必填，只能保存在云函数环境变量或密钥管理中。
   - `ALLOWED_ORIGINS`：必填，逗号分隔的前端 HTTPS 来源，例如 `https://emoji.example.com`。不要在生产环境使用 `*`。
   - `MAX_REQUESTS_PER_10_MIN`：可选，默认单个来源 IP 每 10 分钟 20 次。
   - `REQUEST_TIMEOUT_MS`：可选，默认并最高限制为 115000 毫秒。

6. 为 Web 函数创建 HTTPS 访问地址。确认下面两个地址均可访问：

   - `GET <云函数地址>/health`
   - `POST <云函数地址>/api/generate`

> SCF Web 函数的请求体上限为 6 MB。本项目将前端上传限制为 4 MB，并在发送前压缩大尺寸图片。

7. 在 API 网关或函数 URL 层再配置调用配额、费用告警和异常流量防护。代码内的 IP 限流是单实例的基础保护，不能替代网关级限流；CORS 也不能替代用户身份认证。

## 二、打包前端

在项目目录执行：

```powershell
.\deploy\tencent-cloud\build-frontend.ps1 -ApiBaseUrl "https://你的云函数HTTPS地址"
```

生成文件：`dist/tencent-cloud/ip-emoji-frontend.zip`。压缩包只包含：

- `index.html`：生成页面
- `prompts.html`：本地提示词运营页面
- `app-config.js`：云函数地址等非敏感配置
- `404.html`：错误页

不要把 PDF、Word、测试图片或 `deploy` 源码目录上传到静态网站。

## 三、部署 CloudBase 静态网站

1. 创建 CloudBase 环境并开通静态网站托管。
2. 上传并解压 `ip-emoji-frontend.zip`，确保四个文件位于网站根目录，而不是多套一层文件夹。
3. 首页设置为 `index.html`，错误页设置为 `404.html`。
4. 绑定自定义域名并启用 HTTPS。
5. 将最终前端域名写入云函数的 `ALLOWED_ORIGINS`，然后再次访问设置页确认“腾讯云生成服务连接正常”。
6. 对 `app-config.js` 使用“不缓存”或很短的缓存时间；HTML 建议短缓存，其他静态资源可以长缓存。

腾讯云官方资料：

- CloudBase 静态网站托管：https://cloud.tencent.com/document/product/876/46900
- SCF Web 函数：https://cloud.tencent.com/document/product/583/56124
- SCF 函数概述：https://cloud.tencent.com/document/product/583/19805
- COS 静态网站（备选）：https://cloud.tencent.com/document/product/436/32670

## 运营页面的边界

当前 `prompts.html` 已随包部署，但它是**单浏览器本地配置工具**：数据写入浏览器 `localStorage`，不会同步到其他设备或其他用户；页面也没有登录、角色权限和审计记录。它适合内部试运营和单人调参，不等同于真正的线上运营后台。

如果需要“运营人员保存一次、所有用户立即生效”，下一阶段需要增加：

1. 腾讯云身份认证或企业登录；
2. 服务端配置存储（数据库或 COS 私有对象）；
3. 提示词版本、灰度发布、回滚和操作审计；
4. 生成次数、成功率、耗时、模型成本和违规拦截统计。

在这些能力完成前，如果运营页只允许内部人员访问，应通过访问网关或独立受保护域名限制访问，而不是依赖前端密码。

## 上线验收清单

- 页面源码和浏览器网络请求中都不存在 DashScope API Key。
- 未授权域名调用云函数会返回 403。
- JPG、PNG、WebP 可以上传，其他类型和大于 4 MB 的图片会被拒绝。
- 云函数超时、模型限流、错误响应不会把上游原始信息暴露给用户。
- 电脑与手机尺寸下，创作页和运营页均无横向溢出。
- `prompts.html` 的“本地生效”提示与实际行为一致。
- CloudBase、SCF 和 DashScope 都已配置费用告警与调用量监控。
