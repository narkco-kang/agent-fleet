#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AgentFleet 全功能 UI 拟人回归测试（Playwright）

按铁律：本机启动 AgentFleet（backend:4173 + frontend:5173 + 2 台设备），
用 Playwright 拟人操作（真实点击导航、逐步跳转），验证 10 页面 + 关键交互。

运行：python3 tests/ui_regression.py
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173"

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
    """拟人：点击侧边栏导航项（按文字）。"""
    # 先尝试侧边栏文字
    loc = page.locator(f"aside nav a:has-text('{label}')")
    if loc.count() == 0:
        # 移动端底部 tab
        loc = page.locator(f"a:has-text('{label}')")
    loc.first.click()
    page.wait_for_timeout(800)

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = ctx.new_page()

        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        print("== AgentFleet 全功能 UI 拟人回归测试 ==\n")

        # ── 首页：神经图 ──
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(2000)
        # 关闭新手引导遮罩（首次访问会弹出，z-50 拦截点击）
        overlay = page.locator("div.fixed.inset-0.z-50")
        if overlay.count() > 0:
            dismiss = page.locator("button:has-text('不再自动显示')")
            if dismiss.count() > 0:
                dismiss.first.click()
                page.wait_for_timeout(500)
                print("  ℹ️ 已关闭新手引导遮罩")
            else:
                # 点「开始使用」或直接跳过
                start = page.locator("button:has-text('开始使用')")
                if start.count() > 0:
                    start.first.click()
                    page.wait_for_timeout(500)
        check("首页 / 神经图 加载", page.locator("aside nav").count() > 0, "侧边栏未加载")
        check("顶栏连接状态可见", page.locator("header").count() > 0, "顶栏缺失")
        # 神经图 SVG 节点（d3-force 图）
        svg_count = page.locator("svg").count()
        check(f"神经图渲染 SVG 节点（{svg_count} 个 svg）", svg_count > 0, "无 SVG 图")

        # ── 逐页导航 ──
        pages = [
            ("设备", "/devices", "设备页"),
            ("任务", "/tasks", "任务页"),
            ("部署", "/deploy", "部署页"),
            ("平台模型", "/platform-models", "平台模型页"),
            ("资产", "/assets", "资产页"),
            ("记忆", "/memory", "记忆页"),
            ("路由网关", "/routing", "路由网关页"),
            ("蜂群团队", "/swarm", "蜂群团队页"),
            ("设置", "/settings", "设置页"),
        ]
        for label, path, name in pages:
            click_nav(page, label)
            page.wait_for_timeout(600)
            url_ok = path in page.url
            check(f"{name} 导航 → 路由正确", url_ok, f"url={page.url}")
            # 页面主体非空白
            body_text = page.locator("body").inner_text()
            check(f"{name} 内容非空白", len(body_text.strip()) > 20, f"body 文本长度={len(body_text)}")

        # ── 中英文切换 ──
        click_nav(page, "设置")
        # 顶栏语言按钮（title="中文 / English"，内容随语言变 EN/中文）
        lang_btn = page.locator("header button[title='中文 / English']")
        check("语言切换按钮存在", lang_btn.count() > 0, "找不到语言按钮")
        if lang_btn.count() > 0:
            before = lang_btn.locator("span").inner_text().strip()
            lang_btn.click()
            page.wait_for_timeout(600)
            after = lang_btn.locator("span").inner_text().strip()
            check(f"中英文切换生效（{before}→{after}）", before != after, "切换后按钮文字未变")
            # 导航文案变为英文
            nav_has_en = page.locator("aside nav a:has-text('Devices')").count() > 0 or page.locator("aside nav a:has-text('Graph')").count() > 0
            check("切换后导航显示英文", nav_has_en, "导航未变英文")
            # 切回中文
            lang_btn.click()
            page.wait_for_timeout(600)

        # ── 新建任务对话框 ──
        click_nav(page, "任务")
        new_task_btn = page.locator("button:has-text('新建任务')")
        if new_task_btn.count() == 0:
            new_task_btn = page.locator("button:has-text('New Task')")
        check("新建任务按钮存在", new_task_btn.count() > 0, "找不到新建任务按钮")
        if new_task_btn.count() > 0:
            new_task_btn.first.click()
            page.wait_for_timeout(800)
            dialog = page.locator("[role='dialog'], .MuiDialog-root")
            check("新建任务对话框弹出", dialog.count() > 0, "对话框未弹出")
            # 路由模式（auto/device/agent/swarm）
            dlg_text = page.locator("[role='dialog']").inner_text() if page.locator("[role='dialog']").count() > 0 else ""
            check("对话框含路由模式选项", ("自动" in dlg_text or "auto" in dlg_text.lower() or "Auto" in dlg_text), f"对话框文本={dlg_text[:120]}")
            # 关闭对话框
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)

        # ── 设备详情 ──
        click_nav(page, "设备")
        page.wait_for_timeout(600)
        device_link = page.locator("a[href*='/devices/']").first
        if device_link.count() > 0:
            device_link.click()
            page.wait_for_timeout(800)
            check("设备详情页打开（无白屏）", "/devices/" in page.url and len(page.locator("body").inner_text()) > 20, f"url={page.url}")

        # ── 任务详情（历史任务）──
        click_nav(page, "任务")
        page.wait_for_timeout(600)
        task_link = page.locator("a[href*='/tasks/']").first
        if task_link.count() > 0:
            task_link.click()
            page.wait_for_timeout(800)
            check("任务详情页打开（无白屏）", "/tasks/" in page.url and len(page.locator("body").inner_text()) > 20, f"url={page.url}")

        # ── 资产 CRUD（新建资产）──
        click_nav(page, "资产")
        page.wait_for_timeout(600)
        new_asset_btn = page.locator("button:has-text('新建资产')")
        if new_asset_btn.count() == 0:
            new_asset_btn = page.locator("button:has-text('New Asset')")
        if new_asset_btn.count() > 0:
            new_asset_btn.first.click()
            page.wait_for_timeout(800)
            check("新建资产对话框弹出", page.locator("[role='dialog'], .MuiDialog-root").count() > 0, "对话框未弹出")
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)

        # ── 记忆页摘要 ──
        click_nav(page, "记忆")
        page.wait_for_timeout(800)
        mem_text = page.locator("body").inner_text()
        check("记忆页显示账本信息", ("账本" in mem_text or "healthy" in mem_text or "区块" in mem_text or "Memory" in mem_text or "block" in mem_text.lower()), f"记忆页文本={mem_text[:100]}")

        browser.close()

    # 汇总
    print(f"\n== UI 结果: {passed} 通过 / {failed} 失败 ==")
    ce = [e for e in console_errors if e and "favicon" not in e.lower()]
    if ce:
        print(f"⚠️ console/page 错误 {len(ce)} 条：")
        for e in ce[:10]:
            print(f"   - {e[:160]}")
    else:
        print("✅ 无 console/page 错误")
    if failures:
        print("\n失败明细：")
        for f in failures:
            print(f"  ❌ {f}")
        sys.exit(1)
    print("\n全部通过 ✅")
    sys.exit(0)

if __name__ == "__main__":
    main()
