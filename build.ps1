# フロントエンドをビルドしてGoバイナリに埋め込む
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot\web
try {
    if (-not (Test-Path node_modules)) { npm install }
    npm run build
} finally { Pop-Location }
Push-Location $PSScriptRoot
try {
    go build -o reqgame.exe .
    Write-Host "`nビルド完了: reqgame.exe" -ForegroundColor Green
    Write-Host "起動するには: .\reqgame.exe" -ForegroundColor Green
} finally { Pop-Location }
