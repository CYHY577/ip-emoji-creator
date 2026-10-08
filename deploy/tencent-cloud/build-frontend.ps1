param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://')]
  [string]$ApiBaseUrl
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$distRoot = Join-Path $projectRoot 'dist\tencent-cloud'
$frontendRoot = Join-Path $distRoot 'frontend'
$zipPath = Join-Path $distRoot 'ip-emoji-frontend.zip'

if (Test-Path -LiteralPath $distRoot) {
  $resolvedDist = (Resolve-Path -LiteralPath $distRoot).Path
  $expectedDist = Join-Path $projectRoot 'dist\tencent-cloud'
  if ($resolvedDist -ne $expectedDist) { throw '拒绝清理非预期目录。' }
  Remove-Item -LiteralPath $resolvedDist -Recurse -Force
}

New-Item -ItemType Directory -Path $frontendRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'index.html') -Destination $frontendRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'prompts.html') -Destination $frontendRoot
Copy-Item -LiteralPath (Join-Path $projectRoot '404.html') -Destination $frontendRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'app-config.js') -Destination $frontendRoot

$configPath = Join-Path $frontendRoot 'app-config.js'
$escapedUrl = $ApiBaseUrl.TrimEnd('/').Replace("'", "\'")
$configText = Get-Content -LiteralPath $configPath -Raw
$configText = $configText -replace "mode:\s*'[^']*'", "mode: 'proxy'"
$configText = $configText -replace 'enableLocalDirectMode:\s*true', 'enableLocalDirectMode: false'
$configText = $configText -replace "apiBaseUrl:\s*'[^']*'", "apiBaseUrl: '$escapedUrl'"
Set-Content -LiteralPath $configPath -Value $configText -Encoding utf8

Compress-Archive -Path (Join-Path $frontendRoot '*') -DestinationPath $zipPath -Force
Write-Host "Frontend ready: $zipPath"
