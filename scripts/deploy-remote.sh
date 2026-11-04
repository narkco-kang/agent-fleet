#!/usr/bin/env bash
#
# 部署 device-agent / relay 单文件产物到真实服务器（真实设备测试）。
#
# 依赖：sshpass + scp + ssh（远程需已装 Node.js ≥ 20）。
# 安全：SSH 密码经 SSHPASS 环境变量传入，绝不写入文件/命令行历史。
#
# 用法：
#   SSHPASS=<密码> bash scripts/deploy-remote.sh relay  <host> <user> [relay_port]
#   SSHPASS=<密码> bash scripts/deploy-remote.sh device <host> <user> <relay_url> [device_name]
#
# 示例（先起中继，再起设备）：
#   export SSHPASS=xxx
#   bash scripts/deploy-remote.sh relay  118.194.233.141 ubuntu 4174
#   bash scripts/deploy-remote.sh device 165.154.1.120 Administrator ws://118.194.233.141:4174 win-dev-1
set -euo pipefail

ROLE="${1:-}"
HOST="${2:-}"
USER="${3:-}"
ARG4="${4:-}"
ARG5="${5:-}"

if [[ -z "$ROLE" || -z "$HOST" || -z "$USER" ]]; then
  echo "用法:"
  echo "  SSHPASS=<密码> bash scripts/deploy-remote.sh relay  <host> <user> [relay_port]"
  echo "  SSHPASS=<密码> bash scripts/deploy-remote.sh device <host> <user> <relay_url> [device_name]"
  exit 1
fi

if [[ -z "${SSHPASS:-}" ]]; then
  echo "错误: 请通过 SSHPASS 环境变量提供 SSH 密码（避免密码写入脚本/历史）"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[deploy] 打包单文件产物（device-agent + relay）..."
npm run build:deploy

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=10)
SCP() { sshpass -e scp "${SSH_OPTS[@]}" "$@"; }
SSH() { sshpass -e ssh "${SSH_OPTS[@]}" "$@"; }

# 检测远程 OS（Windows 的 OpenSSH 通常返回 MINGW/MSYS/CYGWIN 或 Windows_NT）
OS="$(SSH "$USER@$HOST" 'uname -s 2>/dev/null || echo Windows_NT' 2>/dev/null || echo unknown)"
echo "[deploy] 远程 OS 探测: $OS"

is_windows() {
  [[ "$OS" == *"MINGW"* || "$OS" == *"MSYS"* || "$OS" == *"CYGWIN"* || "$OS" == *"Windows"* ]]
}

if [[ "$ROLE" == "relay" ]]; then
  PORT="${ARG4:-4174}"
  echo "[deploy] 部署 relay 到 $USER@$HOST（端口 $PORT）"
  SCP dist/relay.cjs "$USER@$HOST:relay.cjs"
  if is_windows; then
    SSH "$USER@$HOST" "powershell -Command \"\$env:RELAY_PORT='$PORT'; Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'relay.cjs' -WorkingDirectory \$env:USERPROFILE\""
  else
    SSH "$USER@$HOST" "RELAY_PORT=$PORT nohup node ~/relay.cjs > ~/relay.log 2>&1 & echo relay-started"
  fi
  echo "[deploy] ✅ relay 已启动，中继地址 ws://$HOST:$PORT"

elif [[ "$ROLE" == "device" ]]; then
  RELAY_URL="${ARG4:-}"
  if [[ -z "$RELAY_URL" ]]; then
    echo "错误: device 角色需要 <relay_url>（如 ws://中继IP:4174）"
    exit 1
  fi
  DEVICE_NAME="${ARG5:-$(echo "$HOST" | tr '.' '-')}"
  echo "[deploy] 部署 device-agent 到 $USER@$HOST（relay=$RELAY_URL name=$DEVICE_NAME）"
  SCP dist/device-agent.cjs "$USER@$HOST:device-agent.cjs"
  if is_windows; then
    SSH "$USER@$HOST" "powershell -Command \"\$env:RELAY_URL='$RELAY_URL'; \$env:DEVICE_NAME='$DEVICE_NAME'; \$env:AGENTFLEET_NO_MDNS='1'; Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'device-agent.cjs' -WorkingDirectory \$env:USERPROFILE\""
  else
    SSH "$USER@$HOST" "RELAY_URL='$RELAY_URL' DEVICE_NAME='$DEVICE_NAME' AGENTFLEET_NO_MDNS=1 nohup node ~/device-agent.cjs > ~/device-agent.log 2>&1 & echo device-started"
  fi
  echo "[deploy] ✅ device-agent 已启动，等待经中继上线"

else
  echo "错误: 角色必须是 relay 或 device"
  exit 1
fi

echo "[deploy] 完成后到看板「设备」页确认设备 online；日志在远程 ~/relay.log 或 ~/device-agent.log"
