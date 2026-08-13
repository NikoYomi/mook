#!/usr/bin/env bash
# Mook 一键构建脚本（Linux / macOS）
set -e
cd "$(dirname "$0")/.."

echo "==> 构建前端"
cd frontend
npm install
npm run build
cd ..

echo "==> 构建后端"
cd backend
go mod tidy
CGO_ENABLED=0 go build -ldflags="-s -w" -o mook .
cd ..

echo "==> 完成：后端产物 backend/mook，前端产物 frontend/dist"
echo "==> 运行：cd backend && ./mook"