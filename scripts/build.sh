#!/bin/bash
set -e
# Coze Coding 平台的项目目录
PROJECT_DIR="/tmp/workdir"
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
else
    # 回退：从 scripts 目录向上找
    cd "$(dirname "$0")/.."
fi

# 设置环境变量（如果平台未提供）
export COZE_SUPABASE_URL="${COZE_SUPABASE_URL:-https://yhpuqkngvdmjokkrfumu.supabase.co}"
export COZE_SUPABASE_ANON_KEY="${COZE_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlocHVxa2tuZ3ZkbWpva2tyZnVtdSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzQ2Mjc1MjAwLCJleHAiOjE5NjE4NTEyMDB9.cg3Iqsx718y6nPhA1wKtGwUDizmx2K}"
export JWT_SECRET="${JWT_SECRET:-huaneng_gpu_2024_secure_jwt_secret_key}"

# 确保依赖已安装
pnpm install --no-frozen-lockfile 2>/dev/null || true

# 构建（禁用 Turbopack）
NEXT_TURBOPACK=0 ./node_modules/.bin/next build
