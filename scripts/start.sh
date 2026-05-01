#!/bin/bash
# Coze Coding 平台的项目目录
PROJECT_DIR="/tmp/workdir"
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
else
    cd "$(dirname "$0")/.."
fi
PORT=5000 HOST=0.0.0.0 ./node_modules/.bin/next start -p 5000 -H 0.0.0.0
