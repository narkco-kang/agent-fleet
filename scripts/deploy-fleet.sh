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
# taskkill node.exe 会连 modelgateway 一起杀（也是 node.exe），所以重启 device-agent 后必须同时重启 modelgateway 常驻任务
restart_win120() { ssh_win120 'taskkill /f /im node.exe 2>nul & ping -n 2 127.0.0.1 > nul & schtasks /run /tn AgentFleetDevice & schtasks /run /tn AgentFleetModelGateway & echo win120-dev 已重启' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"; }
restart_win165() { ssh_win165 'taskkill /f /im node.exe 2>nul & ping -n 2 127.0.0.1 > nul & schtasks /run /tn AgentFleetDevice & schtasks /run /tn AFDevModelGateway & echo win165-dev 已重启' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"; }

# schtasks /create 的 onstart 任务默认带 72h ExecutionTimeLimit：跑满即被杀，而 onstart 不会自拉 → 假常驻。
# 用 TaskScheduler cmdlet 把上限置 0（无限），device / modelgateway 两个任务都要设。
disable_task_time_limit() {
  local host="$1" user="$2" pass="$3" task="$4" needs_pw="${5:-}"
  local auth_args=""
  # 带 /rp 的后台任务（device-agent）二次提交 Settings 时必须重新给凭据，
  # 否则 Set-ScheduledTask 报 0x8007052e「用户名或密码不正确」→ 72h 上限没去掉。
  # modelgateway 是 /ru SYSTEM（无需密码），不传第 5 个参数即可。
  if [ -n "$needs_pw" ]; then
    # 固定 Administrator（两台的 home 都是 C:\Users\Administrator）；WIN165_USER 是小写，避免大小写歧义
    auth_args="-User Administrator -Password '$pass' "
  fi
  sshpass -p "$pass" ssh "${SSH_OPTS[@]}" "$user@$host" \
    "powershell -NoProfile -Command \"\$t = Get-ScheduledTask -TaskName $task; \$t.Settings.ExecutionTimeLimit = 'PT0S'; Set-ScheduledTask -TaskName $task ${auth_args}-Settings \$t.Settings\"" \
    2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
}

# ── Windows device-agent 常驻：.bat 启动文件（含环境变量 + 完整 node 路径）+ schtasks /create ──
# device-agent 需环境变量(RELAY_URL/DEVICE_NAME) + 用户目录(.agentfleet/registry.json)，
# 故 /ru Administrator（非 SYSTEM，SYSTEM 的 home 不在 C:\Users\Administrator，会读到不同 registry）。
# 关键踩坑 1：schtasks 的 /tr 若直接内联 node 命令，非交互环境 PATH 可能找不到 node（win165 node 在 af-node 目录），
#   且环境变量/重定向转义易错 → 统一走 .bat 文件（内写 cd + set + 完整 node 路径 + >> 日志）。
# 关键踩坑 2：/ru Administrator 不带 /rp 时任务被建成 "Interactive only"，SSH 会话无交互登录时
#   `schtasks /run` 根本不会真正启动进程。Win165 实测 Status=Ready / Last Result=267011（从未运行）/ 上次运行 1999/11/30，
#   设备靠手动 Start-Process 才上线，服务器一重启就掉；Win120 只是恰好有交互会话才 Running，属于运气。
#   → 必须补 /rp 密码，让任务变为后台可运行（Interactive/Background），同时保留 Administrator 的 home。
create_device_agent_task() {
  local label="$1" host="$2" user="$3" pass="$4" node_cmd="$5" device_name="$6"
  printf '@echo off\r\ncd /d C:\\Users\\Administrator\r\nset RELAY_URL=%s\r\nset DEVICE_NAME=%s\r\nset AGENTFLEET_NO_MDNS=1\r\n%s device-agent.cjs >> device-agent.log 2>&1\r\n' \
    "$RELAY_URL" "$device_name" "$node_cmd" > /tmp/start-device-agent.bat
  sshpass -p "$pass" scp "${SSH_OPTS[@]}" /tmp/start-device-agent.bat "$user@$host:C:/Users/Administrator/start-device-agent.bat" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
  # Win165 的 sshd 在同一轮 deploy 里连开多次会话时偶发 Permission denied（实测踩过一次），
  # 而 `/run` 的 "SUCCESS: Attempted to run" 只是「试图运行」、不能证明任务真起来了。
  # create 是关键动作：必须确认输出含成功字样，否则任务仍是旧的 Interactive only → 服务器重启后设备永不自启。
  local create_cmd="schtasks /create /f /tn AgentFleetDevice /tr \"cmd /c C:\\Users\\Administrator\\start-device-agent.bat\" /sc onstart /ru Administrator /rp \"$pass\" /rl highest"
  local create_out=""
  for attempt in 1 2 3; do
    create_out=$(sshpass -p "$pass" ssh "${SSH_OPTS[@]}" "$user@$host" "$create_cmd" 2>&1 \
      | grep -vE "post-quantum|store now|openssh.com/pq" || true)
    if printf '%s' "$create_out" | grep -qiE "SUCCESS|successfully|成功"; then
      break
    fi
    sleep 2
  done
  printf '%s\n' "$create_out"
  disable_task_time_limit "$host" "$user" "$pass" AgentFleetDevice 1
  echo "$label device-agent schtasks 已创建/更新（/rp 后台可运行 + 无 72h 上限）"
}

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
    # 创建/更新 Windows device-agent 常驻 schtasks（.bat 含环境变量 + 完整 node 路径 + /rp）
    create_device_agent_task "win120" "$WIN120_HOST" "$WIN120_USER" "$WIN120_PASS" "node" "win120-dev"
    create_device_agent_task "win165" "$WIN165_HOST" "$WIN165_USER" "$WIN165_PASS" "$WIN165_NODE" "win165-dev"
    # 清掉 Win165 上 11/05 改名前留下的旧任务（指向已废弃的 start-device.bat、/ru SYSTEM、Last Result=-1）
    ssh_win165 'schtasks /delete /tn AFDevSys /f' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    restart_ubuntu; restart_win120; restart_win165
    echo "[fleet] 部署 + 重启完成"
    ;;
  relay)
    echo "[fleet] 打包 relay..."
    (cd "$ROOT" && npm run build:deploy)
    scp_ubuntu "$ROOT/dist/relay.cjs" "$UBUNTU_USER@$UBUNTU_HOST:relay.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    # systemd-run 可靠常驻（setsid/nohup 在 ssh 退出后会被 SIGHUP 杀掉，真机踩过）。
    # 幂等：systemctl stop 停旧 unit → fuser -k 按端口清残留 → reset-failed → systemd-run --collect。
    # 关键：绝不能用 pkill -f（会匹配到执行本命令的 bash -c 进程 → 自杀），用 fuser -k 按端口杀。
    ssh_ubuntu "sudo systemctl stop agentfleet-relay 2>/dev/null; sudo fuser -k 4174/tcp 2>/dev/null; sleep 1; sudo systemctl reset-failed agentfleet-relay 2>/dev/null; sudo systemd-run --unit=agentfleet-relay --collect --setenv=RELAY_PORT=4174 \$HOME/.local/bin/node \$HOME/relay.cjs 2>&1; sleep 2; ss -tlnp 2>/dev/null | grep 4174 && echo relay-ok" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"
    ;;
  modelgateway)
    echo "[fleet] 打包 modelgateway..."
    (cd "$ROOT" && npm run build:deploy)
    echo "[fleet] 部署 modelgateway 到三台..."
    scp_ubuntu "$ROOT/dist/modelgateway.cjs" "$UBUNTU_USER@$UBUNTU_HOST:modelgateway.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win120 "$ROOT/dist/modelgateway.cjs" "$WIN120_USER@$WIN120_HOST:modelgateway.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win165 "$ROOT/dist/modelgateway.cjs" "$WIN165_USER@$WIN165_HOST:modelgateway.cjs" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true

    echo "[fleet] 启动 Ubuntu modelgateway（设备本地 responses/anthropic 转换网关）..."
    # 与 relay 同：fuser -k 按端口清残留（不用 pkill，会自杀）
    ssh_ubuntu "sudo systemctl stop agentfleet-modelgateway 2>/dev/null; sudo fuser -k 18765/tcp 2>/dev/null; sleep 1; sudo systemctl reset-failed agentfleet-modelgateway 2>/dev/null; sudo systemd-run --unit=agentfleet-modelgateway --collect --setenv=MODELGATEWAY_PORT=18765 \$HOME/.local/bin/node \$HOME/modelgateway.cjs 2>&1; sleep 2; ss -tlnp 2>/dev/null | grep 18765 && echo mg-ok" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq"

    echo "[fleet] Windows 设备 modelgateway 常驻（schtasks）..."
    # Win120：node 在 PATH，直接 node
    printf '@echo off\r\ncd /d C:\\Users\\Administrator\r\nnode modelgateway.cjs >> modelgateway.log 2>&1\r\n' > /tmp/start-modelgateway-win120.bat
    # Win165：node 不在 PATH，用完整路径
    printf '@echo off\r\ncd /d C:\\Users\\Administrator\r\n%s modelgateway.cjs >> modelgateway.log 2>&1\r\n' "$WIN165_NODE" > /tmp/start-modelgateway-win165.bat
    scp_win120 /tmp/start-modelgateway-win120.bat "$WIN120_USER@$WIN120_HOST:C:/Users/Administrator/start-modelgateway.bat" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    scp_win165 /tmp/start-modelgateway-win165.bat "$WIN165_USER@$WIN165_HOST:C:/Users/Administrator/start-modelgateway.bat" 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    ssh_win120 'schtasks /create /f /tn AgentFleetModelGateway /tr "cmd /c C:\Users\Administrator\start-modelgateway.bat" /sc onstart /ru SYSTEM 2>&1 && schtasks /run /tn AgentFleetModelGateway 2>&1' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    ssh_win165 'schtasks /create /f /tn AFDevModelGateway /tr "cmd /c C:\Users\Administrator\start-modelgateway.bat" /sc onstart /ru SYSTEM 2>&1 && schtasks /run /tn AFDevModelGateway 2>&1' 2>&1 | grep -vE "post-quantum|store now|openssh.com/pq" || true
    # 两台 modelgateway 任务同样要去掉 72h 上限，否则跑满三天被杀后 onstart 不会自拉
    disable_task_time_limit "$WIN120_HOST" "$WIN120_USER" "$WIN120_PASS" AgentFleetModelGateway
    disable_task_time_limit "$WIN165_HOST" "$WIN165_USER" "$WIN165_PASS" AFDevModelGateway
    echo "[fleet] modelgateway 部署完成（Ubuntu setsid + Win120/Win165 schtasks 常驻）"
    ;;
  *)
    echo "用法: bash scripts/deploy-fleet.sh {restart|status|deploy|relay|modelgateway}"
    exit 1
    ;;
esac
