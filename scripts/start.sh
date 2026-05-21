#!/bin/bash
# 从脚本所在目录向上定位到项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 确保依赖已安装
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/next" ]; then
  echo "📦 安装依赖..."
  pnpm install --no-frozen-lockfile 2>/dev/null || npm install 2>/dev/null || {
    echo "❌ 依赖安装失败"
    exit 1
  }
fi

PORT=5000 HOST=0.0.0.0 ./node_modules/.bin/next start -p 5000 -H 0.0.0.0
