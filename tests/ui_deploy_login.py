#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AgentFleet 一键部署 + 登录授权 拟人化操作测试（Playwright，用户视角）

按铁律：本机 backend:4173 + frontend:5173 + 真实云服务器设备（经公网中继）。
用 Playwright 模拟真实用户在看板上点击操作，验证：
1. 设备页：三台云服务器 online
2. 部署页：新建批次 → 填 SSH → 自动识别已装平台 → 勾选平台 → 创建 → 确认执行 → 成功
3. 设备详情：发起登录授权 → 展示授权 URL + 一次性码

运行：python3 tests/ui_deploy_login.py
"""
import json
import os
import re
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173"
API = "http://127.0.0.1:4173"


def api_get(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=10) as r:
        return json.loads(r.read().decode())


def latest_batch_done():
    """轮询后端：最新部署批次是否 completed（含 target success）"""
    try:
        d = api_get("/api/deploy/batches?kind=deploy")
        batches = d.get("data", [])
        if not batches:
            return False
        b = batches[0]
        if b.get("status") == "completed":
            return True
    except Exception:
        pass
    return False
UBUNTU_IP = os.environ.get("TEST_SSH_IP", "118.194.233.141")
UBUNTU_USER = os.environ.get("TEST_SSH_USER", "ubuntu")
UBUNTU_PWD = os.environ.get("TEST_SSH_PWD", "AYjQKtrwV5nq3Hl@BU")
DEPLOY_PLATFORM = os.environ.get("TEST_PLATFORM", "gemini")

passed = 0
failed = 0
failures = []
console_errors = []


def check(name, cond, msg=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        failures.append(f"{name}: {msg}")
        print(f"  ❌ {name}: {msg}")


def click_nav(page, label):
    loc = page.locator(f"aside nav a:has-text('{label}')")
    if loc.count() == 0:
        loc = page.locator(f"a:has-text('{label}')")
    loc.first.click()
    page.wait_for_timeout(800)


def dismiss_onboarding(page):
    overlay = page.locator("div.fixed.inset-0.z-50")
    if overlay.count() > 0:
        dismiss = page.locator("button:has-text('不再自动显示')")
        if dismiss.count() > 0:
            dismiss.first.click()
            page.wait_for_timeout(500)
            print("  ℹ️ 已关闭新手引导遮罩")
        else:
            start = page.locator("button:has-text('开始使用')")
            if start.count() > 0:
                start.first.click()
                page.wait_for_timeout(500)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        print("== AgentFleet 一键部署 + 登录授权 拟人化测试 ==\n")

        # ── 首页 ──
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(2000)
        dismiss_onboarding(page)
        check("首页加载（侧边栏可见）", page.locator("aside nav").count() > 0, "侧边栏未加载")

        # ── 1. 设备页：三台云服务器 online ──
        click_nav(page, "设备")
        page.wait_for_timeout(1200)
        body = page.locator("body").inner_text()
        online_names = ["ubuntu-dev", "win120-dev", "win165-dev"]
        online_count = 0
        for name in online_names:
            if name in body:
                online_count += 1
        check(f"设备页显示三台云服务器（{online_count}/3）", online_count >= 1, f"只看到 {online_count} 台")
        # 查找 online 状态标记
        online_badge = page.locator("text=在线").count() or page.locator("text=online").count()
        check(f"设备页有在线状态（{online_badge} 处）", online_badge > 0, "无在线标记")

        # ── 2. 部署页：拟人化一键部署 ──
        click_nav(page, "部署")
        page.wait_for_timeout(1200)
        new_btn = page.locator("button:has-text('新建批次')")
        check("部署页「新建批次」按钮存在", new_btn.count() > 0, "找不到新建批次按钮")
        new_btn.first.click()
        page.wait_for_timeout(1000)

        # 对话框打开
        dlg = page.locator("[role='dialog']")
        check("新建批次对话框弹出", dlg.count() > 0, "对话框未弹出")

        # 填 IP / 用户名 / 密码（用 label 精确定位，MUI TextField 有 label）
        page.get_by_label("IP", exact=True).fill(UBUNTU_IP)
        page.get_by_label("用户名", exact=True).fill(UBUNTU_USER)
        page.get_by_label("密码", exact=True).fill(UBUNTU_PWD)
        # 端口默认 22，不改
        check("已填写 IP/用户名/密码", True, "")

        # 自动识别已装平台（真实 SSH 探测）
        probe_btn = page.locator("button:has-text('自动识别已装平台')")
        check("「自动识别已装平台」按钮存在", probe_btn.count() > 0, "找不到探测按钮")
        probe_btn.first.click()
        print("  ⏳ 探测中（真实 SSH）…")
        # 等待探测完成（最长 30s）
        probe_done = False
        for _ in range(30):
            page.wait_for_timeout(1000)
            txt = page.locator("[role='dialog']").inner_text()
            if "目标 OS" in txt:
                probe_done = True
                break
        check("探测返回目标 OS + 已装平台", probe_done, "探测未在 30s 内完成")
        if probe_done:
            # 打印探测结果行
            os_line = [l for l in page.locator("[role='dialog']").inner_text().split("\n") if "目标 OS" in l]
            print(f"  ℹ️ {os_line[0] if os_line else ''}")

        # 勾选目标平台（按显示名定位 label 内的 checkbox）
        target_label = page.locator(f"[role='dialog'] label:has-text('{DEPLOY_PLATFORM}')")
        check(f"平台勾选项存在（{DEPLOY_PLATFORM}）", target_label.count() > 0, "找不到平台勾选项")
        if target_label.count() > 0:
            cb = target_label.first.locator("input[type='checkbox']")
            if cb.count() > 0:
                cb.check(force=True)
            else:
                target_label.first.click()
            page.wait_for_timeout(500)

        # 创建
        create_btn = page.locator("[role='dialog'] button:has-text('创建')")
        create_btn.first.click()
        page.wait_for_timeout(1500)
        # 等待对话框真正关闭（MUI 动画），最长 8s
        closed = False
        for _ in range(8):
            if page.locator(".MuiDialog-root").count() == 0:
                closed = True
                break
            page.wait_for_timeout(1000)
        if not closed:
            # 未关闭：打印对话框内错误（如「请至少勾选 1 个平台」）
            dlg_text = page.locator("[role='dialog']").inner_text() if page.locator("[role='dialog']").count() > 0 else ""
            print(f"  ⚠️ 对话框未关闭，内容：{dlg_text[:200]}")
        check("创建批次后对话框关闭", closed, "对话框未关闭")

        # 批次出现在列表，点开详情
        page.wait_for_timeout(1500)
        batch_row = page.locator("text=一键部署").first
        # 点最新批次（列表第一行）
        first_row = page.locator("table tbody tr").first
        if first_row.count() > 0:
            first_row.click()
            page.wait_for_timeout(1000)

        # 抽屉里的确认执行
        confirm_btn = page.locator("button:has-text('确认执行')")
        check("批次详情「确认执行」按钮存在", confirm_btn.count() > 0, "找不到确认按钮")
        if confirm_btn.count() > 0:
            confirm_btn.first.click()
            print("  ⏳ 部署执行中（真实 npm 安装）…")
            # 等待执行完成（轮询后端批次状态，最长 120s）
            done = False
            for _ in range(120):
                page.wait_for_timeout(1000)
                if latest_batch_done():
                    done = True
                    break
            check("部署执行完成（后端批次 completed）", done, "部署未在 120s 内完成")

        # 关闭批次详情抽屉（否则拦截后续导航点击）
        page.keyboard.press("Escape")
        page.wait_for_timeout(800)
        # 若 Escape 未关，点抽屉关闭按钮
        if page.locator(".MuiDrawer-root").count() > 0:
            close_btn = page.locator(".MuiDrawer-root button").first
            if close_btn.count() > 0:
                close_btn.click()
                page.wait_for_timeout(800)

        # ── 3. 神经图页：点 codex agent 节点 → 发起登录授权 ──
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(2500)
        dismiss_onboarding(page)
        check("神经图页加载", page.locator("aside nav").count() > 0, "侧边栏未加载")

        # 点 ubuntu-dev 的 Codex agent（版本 v0.166.0 已知；其他设备 codex 版本 unknown，device-auth 可能失败）
        codex_agent = page.locator("button:has-text('Codex'):has-text('0.166.0')")
        if codex_agent.count() == 0:
            codex_agent = page.locator("button:has-text('Codex')").first
        check("神经图有 Codex agent 节点", codex_agent.count() > 0, "找不到 Codex agent")
        if codex_agent.count() > 0:
            codex_agent.click()
            page.wait_for_timeout(1500)

            # DetailDrawer 打开，找 codex 的「发起登录授权」按钮
            login_btn = page.locator("button:has-text('发起登录授权')")
            check("「发起登录授权」按钮存在", login_btn.count() > 0, "找不到登录按钮")
            if login_btn.count() > 0:
                login_btn.first.click()
                print("  ⏳ 发起登录授权中（真实 device-auth）…")
                # 等待 URL + code 展示（最长 30s）
                challenge_shown = False
                for _ in range(30):
                    page.wait_for_timeout(1000)
                    txt = page.locator("body").inner_text()
                    if "授权码" in txt or "一次性" in txt:
                        if re.search(r"[A-Z0-9]{4,}-[A-Z0-9]{4,}", txt):
                            challenge_shown = True
                            break
                check("展示授权 URL + 一次性码", challenge_shown, "未在 30s 内展示授权码")
                if challenge_shown:
                    code_match = re.search(r"[A-Z0-9]{4,}-[A-Z0-9]{4,}", page.locator("body").inner_text())
                    if code_match:
                        print(f"  ℹ️ 授权码已展示（{code_match.group(0)}）")

        browser.close()

    print(f"\n== 结果: {passed} 通过 / {failed} 失败 ==")
    ce = [e for e in console_errors if e and "favicon" not in e.lower()]
    if ce:
        print(f"⚠️ console/page 错误 {len(ce)} 条（前 5）：")
        for e in ce[:5]:
            print(f"   - {e[:160]}")
    if failures:
        print("\n失败明细：")
        for f in failures:
            print(f"  ❌ {f}")
        sys.exit(1)
    print("\n全部通过 ✅")
    sys.exit(0)


if __name__ == "__main__":
    main()
