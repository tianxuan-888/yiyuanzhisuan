#!/bin/bash
# 从脚本所在目录向上定位到项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

PORT=5000 HOST=0.0.0.0 ./node_modules/.bin/next start -p 5000 -H 0.0.0.0
