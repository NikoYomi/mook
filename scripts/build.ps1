# Mook 一键构建脚本（Windows）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> 构建前端"
Push-Location (Join-Path $root "frontend")
npm install
npm run build
Pop-Location

Write-Host "==> 构建后端"
Push-Location (Join-Path $root "backend")
go mod tidy
$env:CGO_ENABLED = "0"
go build -ldflags="-s -w" -o mook.exe .
Pop-Location

Write-Host "==> 完成：后端产物 backend\mook.exe，前端产物 frontend\dist"
Write-Host "==> 运行：cd backend; .\mook.exe"