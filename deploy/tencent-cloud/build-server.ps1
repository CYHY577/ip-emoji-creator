param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputRoot = Join-Path $projectRoot 'dist\tencent-server'
$stagingRoot = Join-Path $outputRoot ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

# 仅打包网站运行文件，不包含密钥、内部文档和旧压缩包。
foreach ($name in @('index.html', 'prompts.html', '404.html', 'server.js', 'package.json')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stagingRoot
}

$config = @'
window.IP_EMOJI_CONFIG = Object.freeze({
  mode: 'proxy',
  apiBaseUrl: '',
  requestTimeoutMs: 120000,
  maxUploadBytes: 4 * 1024 * 1024,
  maxUploadDimension: 1536,
  enableLocalDirectMode: false,
});
'@
[IO.File]::WriteAllText((Join-Path $stagingRoot 'app-config.js'), $config, [Text.UTF8Encoding]::new($false))

$readme = @'
腾讯云服务器部署包

创作页：/
运营页：/prompts.html
健康检查：/health
生成接口：/api/generate

在腾讯云服务器上解压后，通过服务管理器设置 DASHSCOPE_API_KEY 和 PORT 环境变量，运行 npm start。
域名反向代理到服务的 PORT（默认 3000）；前后端使用同一域名，无需填写独立 API 地址。
本包不包含 API Key。项目本地 .env 仅作为本地开发时的私密配置来源；线上请通过服务管理器或云平台环境变量注入。

当前运营页的提示词保存在浏览器 localStorage，只在同一浏览器生效。
上传运营页不会自动提供管理员登录、云端配置同步或云端历史。
'@
[IO.File]::WriteAllText((Join-Path $stagingRoot 'DEPLOY.txt'), $readme, [Text.UTF8Encoding]::new($false))
$zipPath = Join-Path $outputRoot 'ip-emoji-server.zip'
Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $zipPath -Force
Write-Output "Deployment package: $zipPath"
