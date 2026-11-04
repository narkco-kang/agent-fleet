#!/usr/bin/env bash
#
# 真实设备舰队一键管理脚本（三台云服务器）。
#
# 用法：
#   bash scripts/deploy-fleet.sh restart   # 重启三台设备的 device-agent（backend 重启后必做）
#   bash scripts/deploy-fleet.sh status    # 查三台设备 device-agent 进程/日志
#   bash scripts/deploy-fleet.sh deploy    # 重新打包 + 部署 device-agent 到三台
#   bash scripts/deploy-fleet.sh relay     # 重新打包 + 部署中继到 Ubuntu
#
# 依赖：sshpass + scp + ssh（远程已装 Node ≥ 20）
set -euo pipefail

# ── 三台服务器凭据（康提供，2026-11-04，别再忘） ──
UBUNTU_HOST="118.194.233.141"
UBUNTU_USER="ubuntu"
UBUNTU_PASS="AYjQKtrwV5nq3Hl@BU"

WIN120_HOST="120.79.8.108"
WIN120_USER="Administrator"
WIN120_PASS="Nba2005@@"

WIN165_HOST="165.154.1.120"
WIN165_USER="administrator"
WIN165_PASS="8oetmU8rRFDAa*9Ux4"

# Win165 的 node 不在 PATH（之前 curl 解压目录），用完整路径
WIN165_NODE='C:\Users\Administrator\AppData\Local\af-node\node-v20.19.0-win-x64\node.exe'

RELAY_URL="ws://118.194.233.141:4174"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=12 -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive)

ssh_ubuntu() { sshpass -p "$UBUNTU_PASS" ssh "${SSH_OPTS[@]}" "$UBUNTU_USER@$UBUNTU_HOST" "$@"; }
ssh_win120() { sshpass -p "$WIN120_PASS" ssh "${SSH_OPTS[@]}" "$WIN120_USER@$WIN120_HOST" "$@"; }
ssh_win165() { sshpass -p "$WIN165_PASS" ssh "${SSH_OPTS[@]}" "$WIN165_USER@$WIN165_HOST" "$@"; }
scp_ubuntu() { sshpass -p "$UBUNTU_PASS" scp "${SSH_OPTS[@]}" "$@"; }
scp_win120() { sshpass -p "$WIN120_PASS" scp "${SSH_OPTS[@]}" "$@"; }
scp_win165() { sshpass -p "$WIN165_PASS" scp "${SSH_OPTS[@]}" "$@"; }

restart_ubuntu() { ssh_ubuntu "sudo systemctl restart agentfleet-device && echo ubuntu-dev 已重启" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"; }
restart_win120() { ssh_win120 'taskkill /f /im node.exe 2>nul & ping -n 2 127.0.0.1 > nul & schtasks /run /tn AgentFleetDevice & echo win120-dev 已重启' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"; }
restart_win165() { ssh_win165 'taskkill /f /im node.exe 2>nul & ping -n 2 127.0.0.1 > nul & powershell -NoProfile -Command "Start-ScheduledTask -TaskName AFDevSys" & echo win165-dev 已重启' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"; }

case "${1:-}" in
  restart)
    echo "[fleet] 重启三台设备的 device-agent..."
    restart_ubuntu
    restart_win120
    restart_win165
    echo "[fleet] 完成。等 ~20s 后在看板确认三台 online"
    ;;
  status)
    echo "=== Ubuntu 设备 ==="
    ssh_ubuntu 'systemctl is-active agentfleet-device; tail -3 ~/device-agent.log 2>/dev/null' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"
    echo "=== Win120 设备 ==="
    ssh_win120 'tasklist | findstr /i node & type device-agent.log 2>nul' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" | tail -5
    echo "=== Win165 设备 ==="
    ssh_win165 'tasklist | findstr /i node & type device-agent.log 2>nul' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" | tail -5
    ;;
  deploy)
    echo "[fleet] 打包 device-agent..."
    (cd "$ROOT" && npm run build:deploy)
    echo "[fleet] 部署 device-agent 到三台..."
    scp_ubuntu "$ROOT/dist/device-agent.cjs" "$UBUNTU_USER@$UBUNTU_HOST:device-agent.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win120 "$ROOT/dist/device-agent.cjs" "$WIN120_USER@$WIN120_HOST:device-agent.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win165 "$ROOT/dist/device-agent.cjs" "$WIN165_USER@$WIN165_HOST:device-agent.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    restart_ubuntu; restart_win120; restart_win165
    echo "[fleet] 部署 + 重启完成"
    ;;
  relay)
    echo "[fleet] 打包 relay..."
    (cd "$ROOT" && npm run build:deploy)
    scp_ubuntu "$ROOT/dist/relay.cjs" "$UBUNTU_USER@$UBUNTU_HOST:relay.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    ssh_ubuntu "pkill -f relay.cjs 2>/dev/null; sleep 1; export PATH=\$HOME/.local/bin:\$PATH; setsid env RELAY_PORT=4174 node ~/relay.cjs > ~/relay.log 2>&1 < /dev/null & sleep 2; ss -tlnp 2>/dev/null | grep 4174 && echo relay-ok" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"
    ;;
  modelgateway)
    echo "[fleet] 打包 modelgateway..."
    (cd "$ROOT" && npm run build:deploy)
    echo "[fleet] 部署 modelgateway 到三台..."
    scp_ubuntu "$ROOT/dist/modelgateway.cjs" "$UBUNTU_USER@$UBUNTU_HOST:modelgateway.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win120 "$ROOT/dist/modelgateway.cjs" "$WIN120_USER@$WIN120_HOST:modelgateway.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win165 "$ROOT/dist/modelgateway.cjs" "$WIN165_USER@$WIN165_HOST:modelgateway.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true

    echo "[fleet] 启动 Ubuntu modelgateway（设备本地 responses/anthropic 转换网关）..."
    ssh_ubuntu "pkill -f modelgateway.cjs 2>/dev/null; sleep 1; export PATH=\$HOME/.local/bin:\$PATH; setsid env MODELGATEWAY_PORT=18765 node ~/modelgateway.cjs > ~/modelgateway.log 2>&1 < /dev/null & sleep 2; ss -tlnp 2>/dev/null | grep 18765 && echo mg-ok" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"

    echo "[fleet] Windows 设备 modelgateway 常驻（schtasks）..."
    # Win120：node 在 PATH，直接 node
    printf '@echo off\r\ncd /d C:\\Users\\Administrator\r\nnode modelgateway.cjs >> modelgateway.log 2>&1\r\n' > /tmp/start-modelgateway-win120.bat
    # Win165：node 不在 PATH，用完整路径
    printf '@echo off\r\ncd /d C:\\Users\\Administrator\r\n%s modelgateway.cjs >> modelgateway.log 2>&1\r\n' "$WIN165_NODE" > /tmp/start-modelgateway-win165.bat
    scp_win120 /tmp/start-modelgateway-win120.bat "$WIN120_USER@$WIN120_HOST:C:/Users/Administrator/start-modelgateway.bat" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win165 /tmp/start-modelgateway-win165.bat "$WIN165_USER@$WIN165_HOST:C:/Users/Administrator/start-modelgateway.bat" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    ssh_win120 'schtasks /create /f /tn AgentFleetModelGateway /tr "cmd /c C:\Users\Administrator\start-modelgateway.bat" /sc onstart /ru SYSTEM 2>&1 && schtasks /run /tn AgentFleetModelGateway 2>&1' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    ssh_win165 'schtasks /create /f /tn AFDevModelGateway /tr "cmd /c C:\Users\Administrator\start-modelgateway.bat" /sc onstart /ru SYSTEM 2>&1 && schtasks /run /tn AFDevModelGateway 2>&1' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    echo "[fleet] modelgateway 部署完成（Ubuntu setsid + Win120/Win165 schtasks 常驻）"
    ;;
  *)
    echo "用法: bash scripts/deploy-fleet.sh {restart|status|deploy|relay|modelgateway}"
    exit 1
    ;;
esac
