#!/bin/bash
set -e

# 从脚本所在目录向上定位到项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 检查必需的环境变量
if [ -z "$PGDATABASE_URL" ] && [ -z "$DATABASE_URL" ]; then
  echo "⚠️  警告: PGDATABASE_URL 和 DATABASE_URL 均未设置，数据库连接将失败"
fi

if [ -z "$JWT_SECRET" ]; then
  echo "⚠️  警告: JWT_SECRET 未设置，将使用默认值（不安全）"
fi

# 确保依赖已安装
pnpm install --no-frozen-lockfile 2>/dev/null || true

# 构建（禁用 Turbopack）
NEXT_TURBOPACK=0 ./node_modules/.bin/next build
