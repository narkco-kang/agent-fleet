#!/usr/bin/env bash
# 本机 AgentFleet modelgateway 启动器（前台运行；可被手动执行或由 launchd 托管常驻）。
#
# 配置来源：
#   - .env                                      → 密钥（DEEPSEEK_API_KEY 等）
#   - .workbuddy-ai/modelgateway-providers.json → 付费 provider，apiKey 用 ${ENV_VAR} 引用
#   - .workbuddy-ai/modelgateway-aliases.json   → 业务模型 ref → 真实上游模型
# 三个文件均被 .gitignore 忽略，不会进仓库。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# better-sqlite3 等原生依赖按 Node 24 ABI 编译，必须固定 Node 24。
if [ -x "$HOME/.nvm/versions/node/v24.22.1/bin/node" ]; then
  export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
fi

cd "$ROOT"
exec node "$ROOT/node_modules/tsx/dist/cli.mjs" "$ROOT/modelgateway/src/index.ts"
