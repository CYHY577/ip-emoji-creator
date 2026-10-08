$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputRoot = Join-Path $projectRoot 'dist\tencent-function'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$zipPath = Join-Path $outputRoot 'ip-emoji-generation.zip'
$stream = [IO.File]::Open($zipPath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in @('server.js', 'package.json', 'scf_bootstrap')) {
    $content = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "scf\$name")).Replace("`r`n", "`n")
    $entry = $archive.CreateEntry($name)
    # ZIP 中保留 Linux 启动脚本的可执行权限。
    $entry.ExternalAttributes = $(if ($name -eq 'scf_bootstrap') { 33261 -shl 16 } else { 33188 -shl 16 })
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($content) } finally { $writer.Dispose() }
  }
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Output "Function package: $zipPath"
