#!/bin/bash
# 开发环境准备脚本
cd /workspace/projects
echo "开始安装依赖..."
pnpm install --no-frozen-lockfile 2>/dev/null || pnpm install
echo "依赖安装完成"
