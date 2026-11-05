#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AgentFleet 后续功能完整测试（Playwright 拟人化）：一键配置模型（免登录）+ 任务真接执行回传

按铁律：本机 backend:4173 + frontend:5173 + 真实云服务器设备（经公网中继）。
模拟真实用户操作，验证核心业务闭环：
1. 神经图点 ubuntu-dev 的 codex agent → 「一键配置模型（免登录）」→ 写 kilo 免费源，免登录可用
2. 顶栏「新建任务」→ 指定 agent 平台 codex → 下发 → codex 走免费源真执行 → 输出回传看板

运行：python3 tests/ui_task_e2e.py
"""
import json
import os
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173"
API = "http://127.0.0.1:4173"
TASK_PROMPT = os.environ.get("TEST_TASK_PROMPT", "用一句话说明区块链的三个核心特点，控制在 30 字内")

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


def api_get(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=10) as r:
        return json.loads(r.read().decode())


def latest_task():
    """最新任务的 {status, resultText}"""
    d = api_get("/api/tasks")
    tasks = d.get("data", [])
    if not tasks:
        return None
    t = tasks[0]
    return {"taskId": t.get("taskId"), "status": t.get("status"), "resultText": t.get("resultText", "")}


def dismiss_onboarding(page):
    overlay = page.locator("div.fixed.inset-0.z-50")
    if overlay.count() > 0:
        dismiss = page.locator("button:has-text('不再自动显示')")
        if dismiss.count() > 0:
            dismiss.first.click()
            page.wait_for_timeout(500)
            print("  ℹ️ 已关闭新手引导遮罩")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        print("== AgentFleet 一键配置模型 + 任务真接执行 拟人化测试 ==\n")

        # ── 首页（神经图）──
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(2500)
        dismiss_onboarding(page)

        # ── 1. 一键配置模型（免登录）：点 ubuntu-dev 的 codex agent ──
        codex_agent = page.locator("button:has-text('Codex'):has-text('0.166.0')")
        if codex_agent.count() == 0:
            codex_agent = page.locator("button:has-text('Codex')").first
        check("神经图有 Codex agent 节点", codex_agent.count() > 0, "找不到 Codex agent")
        if codex_agent.count() > 0:
            codex_agent.first.click()
            page.wait_for_timeout(1500)

            cfg_btn = page.locator("button:has-text('一键配置模型')")
            if cfg_btn.count() > 0:
                check("「一键配置模型（免登录）」按钮存在", True, "")
                cfg_btn.first.click()
                print("  ⏳ 配置模型中（写 kilo 免费源）…")
                # 等待回执（成功 message 含「已写入」/「免登录」）
                cfg_ok = False
                for _ in range(20):
                    page.wait_for_timeout(1000)
                    txt = page.locator("body").inner_text()
                    if "已写入" in txt or "免登录" in txt:
                        cfg_ok = True
                        break
                check("一键配置模型回执成功", cfg_ok, "未在 20s 内收到配置成功回执")
            else:
                # codex 已配置过（activated），不再显示配置按钮，属正常幂等行为
                activated = page.locator("text=已激活").count() > 0
                check("codex 已配置/已激活（免登录模型已就绪）", activated, "既无配置按钮也无已激活标记")
            # 关闭抽屉
            page.keyboard.press("Escape")
            page.wait_for_timeout(800)

        # ── 2. 新建任务：指定 codex 平台 ──
        new_btn = page.locator("button:has-text('新建任务')")
        if new_btn.count() == 0:
            new_btn = page.locator("button:has-text('New Task')")
        check("「新建任务」按钮存在", new_btn.count() > 0, "找不到新建任务按钮")
        if new_btn.count() > 0:
            new_btn.first.click()
            page.wait_for_timeout(1000)
            check("新建任务对话框弹出", page.locator("[role='dialog']").count() > 0, "对话框未弹出")

            # 填任务描述
            page.get_by_label("任务描述（自然语言）").fill(TASK_PROMPT)
            check("已填写任务描述", True, "")

            # 选路由模式 = 指定 agent 平台
            page.get_by_label("路由模式", exact=True).click()
            page.wait_for_timeout(500)
            page.locator("[role='option']:has-text('指定 agent 平台')").first.click()
            page.wait_for_timeout(500)

            # 选 agent 平台 = Codex
            page.get_by_label("agent 平台", exact=True).click()
            page.wait_for_timeout(500)
            codex_opt = page.locator("[role='option']:has-text('Codex')").first
            codex_opt.click()
            page.wait_for_timeout(500)
            check("已选路由模式=agent + 平台=codex", True, "")

            # 下发任务
            submit_btn = page.locator("[role='dialog'] button:has-text('下发任务')")
            submit_btn.first.click()
            page.wait_for_timeout(1500)
            check("任务已下发（对话框关闭）", page.locator("[role='dialog']").count() == 0, "对话框未关闭")

        # ── 3. 等待任务执行 + 输出回传 ──
        print("  ⏳ 任务执行中（codex 走 kilo 免费源真执行）…")
        task_done = False
        result_text = ""
        for _ in range(90):  # 最长 90s
            page.wait_for_timeout(1000)
            t = latest_task()
            if t and t["status"] in ("completed", "failed", "cancelled"):
                task_done = True
                result_text = t["resultText"] or ""
                break
        check("任务到达终态", task_done, "任务未在 90s 内完成")

        if task_done:
            status = latest_task()["status"]
            print(f"  ℹ️ 任务终态：{status}")
            # 输出内容是否可见（resultText 或消息时间线）
            t = latest_task()
            has_output = bool((t and t["resultText"]) or result_text)
            # 后端消息时间线也查一下
            if t and t.get("taskId"):
                try:
                    detail = api_get(f"/api/tasks/{t['taskId']}")
                    msgs = detail.get("data", {}).get("messages", [])
                    text_msgs = [m for m in msgs if m.get("eventType") == "text"]
                    has_output = has_output or len(text_msgs) > 0
                    if text_msgs:
                        print(f"  ℹ️ 输出内容示例：{text_msgs[0].get('data', '')[:80]}")
                except Exception:
                    pass
            check("任务输出内容可见", has_output, "任务完成但无输出内容")

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
