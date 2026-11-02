#!/bin/bash
# AgentFleet 本机一键启动（双击本文件即可，在 Terminal.app 里运行）
#
# 为什么用 .command 而不是在 IDE 内置终端里跑：
#   IDE / AI 宿主的内置终端会把 Node 子进程挂到自己的进程树下，并注入
#   输出管道 shim（NODE_OPTIONS=--require=...），守护进程会受宿主生命周期干扰。
#   这个脚本由 macOS Terminal 直接启动，是纯净的本地 shell 环境。
#
# 用法：
#   双击本文件                  → backend:4173 + frontend:5173 + 1 台设备
#   终端里 ./scripts/start-local.command --agent 3   → 起 3 台设备
#   终端里 ./scripts/start-local.command --no-agent  → 只起前后端

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

echo "──────────────────────────────────────────────"
echo " AgentFleet 本机启动"
echo " 目录: $ROOT"
echo "──────────────────────────────────────────────"

# 优先使用 nvm 里的 Node 24（better-sqlite3 按 v24 编译，Node 22 会报 ABI 错误）
if [ -d "$HOME/.nvm/versions/node/v24.22.1/bin" ]; then
  export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ "$NODE_MAJOR" != "24" ]; then
  echo "⚠️  当前 Node 版本: $(node -v 2>/dev/null || echo '未安装')"
  echo "    better-sqlite3 是按 Node 24 编译的，版本不符会报 NODE_MODULE_VERSION ABI 错误。"
  echo "    请先: nvm use 24   （或安装 Node 24）"
  echo
  read -r -p "仍要继续？(y/N) " reply
  case "$reply" in
    [yY]) ;;
    *) echo "已取消"; exit 1 ;;
  esac
fi

# 依赖未装则先装
if [ ! -d "$ROOT/node_modules" ]; then
  echo "首次运行，安装依赖..."
  npm install || { echo "依赖安装失败"; exit 1; }
fi

# 首次需要构建 shared（其他 workspace 依赖其产物）
if [ ! -d "$ROOT/shared/dist" ]; then
  echo "构建 shared 协议包..."
  npm run build:shared || { echo "shared 构建失败"; exit 1; }
fi

echo
exec npm run dev:local -- "$@"
