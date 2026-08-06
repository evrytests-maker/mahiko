#!/usr/bin/env python3
"""Runs exhaustive local Playwright QA against a bundle built from the project sources."""
from __future__ import annotations

import json
import re
import traceback
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BUILD_ROOT = ROOT / "artifacts/verification/browser-build/current"
BEFORE_SCREENSHOTS = ROOT / "artifacts/ui-before"
SCREENSHOTS = ROOT / "artifacts/ui-after"
REPORT_DIR = ROOT / "artifacts/verification/browser"
BEFORE_SCREENSHOTS.mkdir(parents=True, exist_ok=True)
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)


def inline_html(bundle_dir: Path) -> str:
    def script_text(name: str) -> str:
        return (bundle_dir / name).read_text(encoding="utf-8").replace("</script", "<\\/script")

    styles = (bundle_dir / "styles.css").read_text(encoding="utf-8")
    bootstrap = r'''
window.__capturedConsoleErrors = [];
window.__qaClipboard = "";
window.__qaWindowOpenCalls = 0;
const originalOpen = window.open;
window.open = (...args) => { window.__qaWindowOpenCalls += 1; return originalOpen?.(...args) ?? null; };
window.addEventListener("error", event => window.__capturedConsoleErrors.push(String(event.error?.stack || event.message)));
window.addEventListener("unhandledrejection", event => window.__capturedConsoleErrors.push(String(event.reason?.stack || event.reason)));
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.__qaClipboard = String(text); } } });
const registry = Object.create(null);
const chunks = [];
chunks.push = function(payload) { Object.assign(registry, payload[1]); return Array.prototype.push.call(this, payload); };
self.webpackChunk_JUPYTERLAB_CORE_OUTPUT = chunks;
window.__verificationWebpackRegistry = registry;
'''
    runtime = r'''
const cache = Object.create(null);
function webpackRequire(id) {
  if (id === 78156) id = 27378;
  if (cache[id]) return cache[id].exports;
  const factory = window.__verificationWebpackRegistry[id];
  if (!factory) throw new Error("Missing verification webpack module " + id);
  const module = { exports: {} };
  cache[id] = module;
  factory(module, module.exports, webpackRequire);
  return module.exports;
}
const React = webpackRequire(27378);
const ReactDOM = webpackRequire(31542);
function jsx(type, props, key) {
  const next = key === undefined ? props : Object.assign({}, props, { key });
  return React.createElement(type, next);
}
window.__verificationReact = React;
window.__verificationReactDOM = ReactDOM;
window.__verificationJsxRuntime = { Fragment: React.Fragment, jsx, jsxs: jsx };
'''
    return (
        '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<style>{styles}</style></head><body><div id=\"root\"></div>"
        f"<script>{bootstrap}</script>"
        f"<script>{script_text('react.chunk.js')}</script>"
        f"<script>{script_text('react-dom.chunk.js')}</script>"
        f"<script>{runtime}</script>"
        f"<script>{script_text('app.js')}</script>"
        "</body></html>"
    )


class Qa:
    def __init__(self) -> None:
        self.results: list[dict[str, Any]] = []
        self.console: list[str] = []

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.results.append({"name": name, "status": "pass" if condition else "fail", "detail": detail})
        print(f"{'PASS' if condition else 'FAIL'} {name}{f': {detail}' if detail else ''}", flush=True)
        if not condition:
            raise AssertionError(f"{name}: {detail or 'condition is false'}")

    def attach(self, page: Page) -> None:
        page.on("console", lambda message: self.console.append(f"console:{message.type}:{message.text}"))
        page.on("pageerror", lambda error: self.console.append(f"pageerror:{error}"))

    def verify_clean_console(self, page: Page, name: str) -> None:
        captured = page.evaluate("window.__capturedConsoleErrors || []")
        errors = [line for line in self.console if line.startswith("pageerror:") or line.startswith("console:error:")]
        self.check(name, not captured and not errors, f"captured={captured}; console={errors}")


def load(page: Page, html: str) -> None:
    page.set_default_timeout(6_000)
    page.set_content(html, wait_until="load")
    page.get_by_role("heading", name="Чем помочь?").wait_for()
    page.wait_for_timeout(120)


def last_activity(page: Page):
    return page.locator(".activity-stream").last


def wait_terminal(activity, status: str, timeout: int = 7_000) -> None:
    activity.locator(f".activity-final-{status}").wait_for(timeout=timeout)


def go_chat(page: Page) -> None:
    if page.get_by_role("heading", name="Чем помочь?").count():
        return
    page.keyboard.press("Escape")
    page.get_by_role("heading", name="Чем помочь?").wait_for()


def slash(page: Page, command: str) -> None:
    box = page.get_by_role("textbox", name="Сообщение ma-hi-ko")
    box.fill(command)
    box.press("Enter")


def run() -> int:
    qa = Qa()
    failure: str | None = None
    current_html = inline_html(BUILD_ROOT)

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path="/usr/bin/chromium",
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )

            page = browser.new_page(viewport={"width": 1280, "height": 800})
            qa.attach(page)
            load(page, current_html)
            page.screenshot(path=str(SCREENSHOTS / "after-initial-1280x800.png"), full_page=True)

            # Initial visual hierarchy and accessibility.
            qa.check("baseline comparison screenshot is preserved", (BEFORE_SCREENSHOTS / "before-1280x800.png").exists())
            qa.check("initial chat renders", page.get_by_role("heading", name="Чем помочь?").is_visible())
            qa.check("left navigation is visible by default", page.get_by_role("complementary", name="Навигация и проекты").is_visible())
            qa.check("right review is visible by default", page.get_by_role("complementary", name="Проверка изменений").is_visible())
            qa.check("activity is absent before submit", page.locator(".activity-stream").count() == 0)
            qa.check("single app chrome contains no File/Edit/View menu", not re.search(r"\bFile\s+Edit\s+View\b", page.locator("body").inner_text()))
            header_geometry = page.evaluate("""() => {
              const header = document.querySelector('.workspace-header')?.getBoundingClientRect();
              const project = document.querySelector('.workspace-project')?.getBoundingClientRect();
              const title = document.querySelector('.workspace-title h1');
              const titleStyle = title ? getComputedStyle(title) : null;
              return {
                contained: !!header && !!project && project.top >= header.top && project.bottom <= header.bottom + 0.5,
                header: header ? { top: header.top, bottom: header.bottom, height: header.height } : null,
                project: project ? { top: project.top, bottom: project.bottom, height: project.height } : null,
                titleFont: titleStyle?.fontSize ?? '',
                titleMargin: titleStyle?.margin ?? '',
              };
            }""")
            qa.check("workspace title and project stay inside header", header_geometry["contained"], str(header_geometry))
            qa.check("workspace title uses compact TUI typography", float(header_geometry["titleFont"].removesuffix("px")) <= 16 and header_geometry["titleMargin"] == "0px", str(header_geometry))
            qa.check("sidebar exposes /MCP", page.get_by_role("button", name="/MCP", exact=True).is_visible())
            qa.check("sidebar exposes Skills next to /MCP", page.get_by_role("button", name="Скиллы", exact=True).is_visible())
            nav_labels = page.locator(".primary-nav button").evaluate_all("els => els.map(el => el.getAttribute('aria-label'))")
            qa.check("/MCP and Skills are adjacent", nav_labels.index("/MCP") + 1 == nav_labels.index("Скиллы"), str(nav_labels))
            review_text = page.get_by_role("complementary", name="Проверка изменений").inner_text().lower()
            qa.check("right pane contains review workflow", "diff" in review_text and "локальные изменения" in review_text)
            qa.check("right pane does not duplicate model controls", "модель" not in review_text and "reasoning" not in review_text)
            qa.check("right pane does not duplicate context controls", "контекст" not in review_text and "runtime" not in review_text)

            pi_marks = page.locator(".pi-spectrum")
            qa.check("π assistant marks render", pi_marks.count() >= 3, f"count={pi_marks.count()}")
            pi_style = pi_marks.first.evaluate("el => ({bg:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage,width:el.getBoundingClientRect().width})")
            qa.check("π has no tile background", pi_style["bg"] in {"rgba(0, 0, 0, 0)", "transparent"}, str(pi_style))
            qa.check("π uses a multicolor OMP spectrum", "gradient" in pi_style["image"] and pi_style["width"] < 40, str(pi_style))

            unnamed_buttons = page.locator("button").evaluate_all(
                "els => els.filter(el => !(el.getAttribute('aria-label') || el.innerText.trim() || el.title)).length"
            )
            qa.check("all initial buttons have accessible names", unnamed_buttons == 0, f"unnamed={unnamed_buttons}")
            tiny_controls = page.locator(".workspace-header .workbench-icon, .runtime-state, .new-chat, .primary-nav button, .sidebar-heading button, .recent-list button, .sidebar-project, .project-tools button, .sidebar-footer button").evaluate_all(
                "els => els.filter(el => { const r=el.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(el => ({text:el.innerText,label:el.getAttribute('aria-label'),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))"
            )
            qa.check("high-frequency controls meet 44px target", not tiny_controls, str(tiny_controls))
            undersized_menu_controls = page.locator(".workspace-header button, .workspace-sidebar button").evaluate_all(
                "els => els.filter(el => { const r=el.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(el => ({text:el.innerText,label:el.getAttribute('aria-label'),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))"
            )
            qa.check("all main-menu controls meet WCAG 24px minimum", not undersized_menu_controls, str(undersized_menu_controls))
            low_contrast_menu_text = page.locator(".sidebar-brand small, .new-chat kbd, .primary-nav button, .recent-list button span, .recent-list button small, .sidebar-project strong, .sidebar-project small, .project-tools button, .project-tools small, .sidebar-footer button").evaluate_all(r"""els => {
              const channels = value => (value.match(/[\d.]+/g) || []).map(Number);
              const luminance = rgb => {
                const linear = rgb.slice(0, 3).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4); });
                return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
              };
              const ratio = (a, b) => { const l1 = luminance(a); const l2 = luminance(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
              const background = element => {
                let node = element;
                while (node) {
                  const rgba = channels(getComputedStyle(node).backgroundColor);
                  if (rgba.length >= 3 && (rgba.length < 4 || rgba[3] > .95)) return rgba;
                  node = node.parentElement;
                }
                return [17, 20, 23];
              };
              return els.map(el => ({
                label: el.getAttribute('aria-label') || el.textContent.trim(),
                ratio: ratio(channels(getComputedStyle(el).color), background(el))
              })).filter(item => item.ratio < 4.5);
            }""")
            qa.check("main-menu text contrast reaches 4.5:1", not low_contrast_menu_text, str(low_contrast_menu_text))
            chats_nav = page.get_by_role("button", name="Чаты", exact=True)
            chats_nav.focus()
            focus_style = chats_nav.evaluate("el => ({width:parseFloat(getComputedStyle(el).outlineWidth),style:getComputedStyle(el).outlineStyle,color:getComputedStyle(el).outlineColor,active:document.activeElement===el})")
            qa.check("main-menu focus ring is visible and 2px", focus_style["active"] and focus_style["width"] >= 2 and focus_style["style"] != "none", str(focus_style))
            page.keyboard.press("Tab")
            qa.check("main-menu follows native keyboard order", page.evaluate("document.activeElement?.getAttribute('aria-label')") == "Проекты")
            hover_nav = page.get_by_role("button", name="Проекты", exact=True)
            normal_background = hover_nav.evaluate("el => getComputedStyle(el).backgroundColor")
            hover_nav.hover()
            hover_background = hover_nav.evaluate("el => getComputedStyle(el).backgroundColor")
            qa.check("main-menu rows expose a hover state", normal_background != hover_background, f"normal={normal_background}; hover={hover_background}")
            page.mouse.move(700, 400)
            qa.check("active route has current marker", chats_nav.get_attribute("aria-current") == "page" and chats_nav.evaluate("el => getComputedStyle(el).boxShadow !== 'none'"))
            desktop_menu_geometry = page.evaluate("""() => {
              const action = document.querySelector('[aria-label="Открыть окно пулл-реквеста"]')?.getBoundingClientRect();
              const footer = document.querySelector('.sidebar-footer')?.getBoundingClientRect();
              const history = document.querySelector('.recent-list');
              return {
                projectActionVisible: !!action && !!footer && action.top >= 0 && action.bottom <= footer.top + .5,
                historyOverflow: history ? getComputedStyle(history).overflowY : '',
                action: action ? { top: action.top, bottom: action.bottom } : null,
                footer: footer ? { top: footer.top, bottom: footer.bottom } : null,
              };
            }""")
            qa.check("desktop menu keeps project actions above settings", desktop_menu_geometry["projectActionVisible"], str(desktop_menu_geometry))
            qa.check("desktop menu scrolls chat history independently", desktop_menu_geometry["historyOverflow"] == "auto", str(desktop_menu_geometry))
            qa.verify_clean_console(page, "initial console is clean")

            # Left navigation and chat creation.
            chat_count = page.locator(".recent-list button").count()
            page.get_by_role("button", name=re.compile("Новый чат")).first.click()
            qa.check("New chat button adds a chat", page.locator(".recent-list button").count() == chat_count + 1)
            qa.check("new chat receives active state", page.locator(".recent-list button.active").inner_text().startswith("Новый чат"))
            page.wait_for_function("document.activeElement?.getAttribute('aria-label') === 'Сообщение ma-hi-ko'")
            qa.check("New chat restores composer focus", page.evaluate("document.activeElement?.getAttribute('aria-label')") == "Сообщение ma-hi-ko")
            chat_count = page.locator(".recent-list button").count()
            page.keyboard.press("Control+n")
            qa.check("Ctrl+N adds a chat", page.locator(".recent-list button").count() == chat_count + 1)
            page.get_by_role("button", name=re.compile("Рабочая сессия")).click()
            qa.check("chat history switches active session", "Рабочая сессия" in page.locator(".recent-list button.active").inner_text())

            for label, expected in [
                ("Проекты", "Проекты"),
                ("Изменения", "Локальные изменения"),
                ("Запланировано", "Запланировано"),
                ("/MCP", "/MCP"),
                ("Скиллы", "Скиллы"),
            ]:
                page.get_by_role("button", name=label, exact=True).click()
                qa.check(f"sidebar route {label} renders", page.get_by_text(expected, exact=True).count() >= 1)
                page.keyboard.press("Escape")
                page.get_by_role("heading", name="Чем помочь?").wait_for()
            qa.check("desktop Escape keeps persistent sidebars", page.get_by_role("complementary", name="Навигация и проекты").is_visible() and page.get_by_role("complementary", name="Проверка изменений").is_visible())

            # Internal attached workbench tools.
            branch_trigger = page.get_by_role("button", name="Открыть окно ветки main")
            branch_trigger.click()
            branch_dialog = page.get_by_role("dialog", name="Ветка main")
            branch_dialog.wait_for()
            qa.check("branch opens inside the main workspace", branch_dialog.evaluate("el => el.closest('.workspace-main') !== null"))
            qa.check("branch tool receives focus", branch_dialog.evaluate("el => document.activeElement === el"))
            commit = branch_dialog.get_by_role("textbox", name="Сообщение коммита")
            branch_action = branch_dialog.get_by_role("button", name="Подготовить коммит")
            qa.check("branch action starts disabled", branch_action.is_disabled())
            commit.fill("Переработать OMP workbench")
            qa.check("branch action enables after input", not branch_action.is_disabled())
            branch_action.click()
            qa.check("branch action reports local preparation", "Подготовлена команда commit" in branch_dialog.locator("footer").inner_text())
            branch_dialog.get_by_role("button", name=re.compile("Закрыть окно")).click()
            branch_dialog.wait_for(state="hidden")

            page.get_by_role("button", name="Открыть окно дерева файлов").click()
            files_dialog = page.get_by_role("dialog", name="Дерево проекта")
            files_dialog.wait_for()
            qa.check("file tree is an attached internal dialog", files_dialog.evaluate("el => el.closest('.workspace-main') !== null"))
            qa.check("file tree exposes real project rows", files_dialog.get_by_role("treeitem").count() >= 4)
            files_dialog.get_by_role("treeitem").filter(has_text="src/renderer/App.tsx").click()
            page.get_by_role("region", name="Файл src/renderer/App.tsx").wait_for()
            qa.check("file opens from attached tree", page.get_by_text("import { useState }", exact=False).is_visible())
            page.keyboard.press("Escape")
            page.get_by_role("heading", name="Чем помочь?").wait_for()

            page.get_by_role("button", name="Открыть окно пулл-реквеста").click()
            pr_dialog = page.get_by_role("dialog", name="Пулл-реквест")
            pr_dialog.wait_for()
            qa.check("pull request opens inside the workspace", pr_dialog.evaluate("el => el.closest('.workspace-main') !== null"))
            pr_title = pr_dialog.get_by_role("textbox", name="Заголовок пулл-реквеста")
            pr_body = pr_dialog.get_by_role("textbox", name="Описание пулл-реквеста")
            pr_action = pr_dialog.get_by_role("button", name="Подготовить черновик")
            qa.check("PR action starts disabled", pr_action.is_disabled())
            pr_title.fill("OMP workbench UI")
            pr_body.fill("Новая навигация, review и context popover")
            pr_action.click()
            qa.check("PR action reports local draft", "Черновик pull request" in pr_dialog.locator("footer").inner_text())
            page.keyboard.press("Escape")
            pr_dialog.wait_for(state="hidden")
            qa.check("attached tools never call window.open", page.evaluate("window.__qaWindowOpenCalls") == 0)

            # Review panel interactions.
            review = page.get_by_role("complementary", name="Проверка изменений")
            collapse = review.get_by_role("button", name="Свернуть список файлов")
            collapse.click()
            qa.check("review file list collapses", review.get_by_role("listbox", name="Изменённые файлы").count() == 0)
            expand = review.get_by_role("button", name="Развернуть список файлов")
            qa.check("review collapse exposes inverse action", expand.get_attribute("aria-expanded") == "false")
            expand.click()
            review_files = review.get_by_role("listbox", name="Изменённые файлы")
            review_files.wait_for()
            options = review_files.get_by_role("option")
            qa.check("review exposes changed files", options.count() >= 2)
            options.nth(2).click()
            selected_path = options.nth(2).locator("span").nth(1).inner_text()
            qa.check("review selection updates diff path", selected_path in review.locator(".diff-path").inner_text())
            review.get_by_role("button", name="Копировать патч").click()
            review.get_by_role("button", name="✓ Скопировано").wait_for()
            qa.check("review copies a unified patch", page.evaluate("window.__qaClipboard").startswith("--- a/"))
            review.get_by_role("button", name="Открыть файл").click()
            page.get_by_role("region", name=re.compile("Файл ")).wait_for()
            qa.check("review opens selected file", selected_path in page.get_by_role("region", name=re.compile("Файл ")).get_attribute("aria-label"))
            page.get_by_role("button", name="Вернуться в чат").click()
            page.get_by_role("heading", name="Чем помочь?").wait_for()
            review = page.get_by_role("complementary", name="Проверка изменений")
            review.get_by_role("button", name="Скрыть проверку изменений").click()
            review.wait_for(state="hidden")
            qa.check("review close updates header state", page.get_by_role("button", name="Показать проверку изменений").get_attribute("aria-expanded") == "false")
            page.get_by_role("button", name="Показать проверку изменений").click()
            page.get_by_role("complementary", name="Проверка изменений").wait_for()

            # Sidebar open/close and large buttons.
            sidebar = page.get_by_role("complementary", name="Навигация и проекты")
            sidebar.get_by_role("button", name="Скрыть боковую панель").click()
            sidebar.wait_for(state="hidden")
            nav_trigger = page.locator("#environment-trigger")
            qa.check("sidebar close updates aria-expanded", nav_trigger.get_attribute("aria-expanded") == "false")
            qa.check("sidebar trigger announces show action", nav_trigger.get_attribute("aria-label") == "Показать боковую панель")
            nav_trigger.click()
            page.get_by_role("complementary", name="Навигация и проекты").wait_for()
            qa.check("sidebar trigger announces hide action", nav_trigger.get_attribute("aria-label") == "Скрыть боковую панель")
            qa.check("sidebar trigger remains 44px", nav_trigger.evaluate("el => { const r=el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }"))

            # Runtime-backed model/reasoning selectors.
            model_trigger = page.get_by_role("button", name="Выбрать модель: GPT-5.6 Sol")
            model_trigger.click()
            model_list = page.get_by_role("listbox", name="Выбор модели")
            model_list.wait_for()
            qa.check("model trigger reports expanded state", model_trigger.get_attribute("aria-expanded") == "true")
            page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
            model_trigger = page.get_by_role("button", name="Выбрать модель: GPT-5.6 Luna")
            qa.check("model keyboard selection works", model_trigger.is_visible())
            page.wait_for_function("document.activeElement?.id === 'model-picker-trigger'")
            qa.check("model selection restores focus", page.evaluate("document.activeElement?.id") == "model-picker-trigger")

            thinking_trigger = page.get_by_role("button", name="Выбрать уровень рассуждения: xhigh")
            thinking_trigger.click()
            thinking_list = page.get_by_role("listbox", name="Уровень рассуждения")
            thinking_list.wait_for()
            qa.check("reasoning options come through OMP runtime surface", thinking_list.get_by_text("OMP runtime", exact=True).is_visible())
            qa.check("reasoning selector exposes all OMP levels", thinking_list.get_by_role("option").count() == 6)
            qa.check("reasoning trigger reports expanded state", thinking_trigger.get_attribute("aria-expanded") == "true")
            page.keyboard.press("ArrowUp")
            page.keyboard.press("Enter")
            thinking_trigger = page.get_by_role("button", name="Выбрать уровень рассуждения: high")
            qa.check("reasoning keyboard selection works", thinking_trigger.is_visible())
            page.wait_for_function("document.activeElement?.id === 'thinking-picker-trigger'")
            qa.check("reasoning selection restores focus", page.evaluate("document.activeElement?.id") == "thinking-picker-trigger")
            qa.check("status identifies OMP source", "OMP:high" in thinking_trigger.inner_text())

            # Context/auto-compact popover.
            context_trigger = page.get_by_role("button", name="Настроить контекст и автосжатие")
            qa.check("status no longer contains the word кратко", "кратко" not in page.locator(".status-segments").inner_text().lower())
            context_trigger.click()
            context_dialog = page.get_by_role("dialog", name="Настройки контекста")
            context_dialog.wait_for()
            qa.check("context trigger reports expanded state", context_trigger.get_attribute("aria-expanded") == "true")
            auto_toggle = context_dialog.get_by_role("button", name=re.compile("Автосжатие"))
            qa.check("auto compact starts enabled", auto_toggle.get_attribute("aria-pressed") == "true")
            auto_toggle.click()
            qa.check("auto compact toggles off", auto_toggle.get_attribute("aria-pressed") == "false")
            slider = context_dialog.get_by_role("slider", name="Порог автосжатия")
            slider.fill("90")
            qa.check("context threshold is editable", slider.input_value() == "90")
            aggressive = context_dialog.get_by_role("button", name="Агрессивно")
            aggressive.click()
            qa.check("context strategy is selectable", aggressive.get_attribute("aria-pressed") == "true")
            context_dialog.get_by_role("button", name="Сжать сейчас").click()
            qa.check("manual compact gives visible state", context_dialog.get_by_text("Контекст сжат вручную", exact=False).is_visible())
            page.keyboard.press("Escape")
            context_dialog.wait_for(state="hidden")
            page.wait_for_function("document.activeElement?.id === 'context-settings-trigger'")
            qa.check("context Escape restores trigger focus", page.evaluate("document.activeElement?.id") == "context-settings-trigger")
            qa.check("auto badge disappears after disabling", page.locator(".status-context em").count() == 0)

            # Settings overlay: readable full labels and keyboard operation.
            page.get_by_role("textbox", name="Сообщение ma-hi-ko").focus()
            page.keyboard.press("Control+,")
            settings = page.get_by_role("dialog", name="Настройки OMP")
            settings.wait_for()
            tabs = settings.get_by_role("tab")
            qa.check("settings expose eleven full sections", tabs.count() == 11)
            tab_texts = tabs.all_inner_texts()
            qa.check("settings tabs use readable labels", all(len(text.strip()) > 3 for text in tab_texts), str(tab_texts))
            qa.check("settings have no cryptic SH/TO strip", not re.search(r"\b(?:SH|TO|TA|PR|PL)\b", " ".join(tab_texts)))
            first_tab = settings.get_by_role("tab", name="Интерфейс")
            first_tab.focus()
            first_tab.press("End")
            plugins_tab = settings.get_by_role("tab", name="/MCP и скиллы")
            qa.check("settings End moves to final section", plugins_tab.get_attribute("aria-selected") == "true")
            qa.check("/MCP settings no longer say Plugins", settings.get_by_text("Единая точка расширения OMP", exact=False).is_visible())
            plugins_tab.press("Home")
            qa.check("settings Home returns to first section", first_tab.get_attribute("aria-selected") == "true")
            context_tab = settings.get_by_role("tab", name="Контекст")
            context_tab.click()
            qa.check("settings panel heading follows selected section", settings.get_by_role("heading", name="Контекст").is_visible())
            auto_row = settings.get_by_role("button", name=re.compile("Автосжатие"))
            before_pressed = auto_row.get_attribute("aria-pressed")
            auto_row.click()
            qa.check("boolean setting toggles by pointer", auto_row.get_attribute("aria-pressed") != before_pressed)
            settings.get_by_role("button", name="Закрыть настройки").click()
            settings.wait_for(state="hidden")
            page.wait_for_function("document.activeElement?.getAttribute('aria-label') === 'Сообщение ma-hi-ko'")
            qa.check("settings close restores composer focus", page.evaluate("document.activeElement?.getAttribute('aria-label')") == "Сообщение ma-hi-ko")

            # Command palette and slash routes.
            page.keyboard.press("Control+k")
            palette = page.get_by_role("dialog", name="Палитра команд")
            palette.wait_for()
            palette.get_by_role("textbox", name="Фильтр команд").fill("mcp")
            qa.check("command palette filters", palette.get_by_role("option").count() >= 1)
            page.keyboard.press("Enter")
            page.locator(".workspace-content").get_by_role("heading", name="/MCP", exact=True).wait_for()
            qa.check("palette opens /MCP", page.get_by_role("button", name=re.compile("Добавить сервер")).is_disabled())
            page.keyboard.press("Escape")
            page.get_by_role("heading", name="Чем помочь?").wait_for()

            slash(page, "/skills")
            page.locator(".workspace-content").get_by_role("heading", name="Скиллы", exact=True).wait_for()
            skill_search = page.get_by_role("textbox", name="Поиск навыков")
            skill_search.fill("react-best")
            skill_row = page.get_by_role("button", name=re.compile("react-best-practices"))
            skill_row.click()
            install_trigger = page.get_by_role("button", name=re.compile("Установить"))
            install_trigger.click()
            install_dialog = page.get_by_role("dialog", name="Установка react-best-practices")
            install_dialog.wait_for()
            qa.check("skill install dialog receives focus", install_dialog.evaluate("el => document.activeElement === el"))
            project_scope = install_dialog.get_by_role("button", name=re.compile("Проект"))
            qa.check("project skill scope is available", not project_scope.is_disabled())
            project_scope.click()
            qa.check("project scope removes global flag", " -g" not in install_dialog.locator("pre").inner_text())
            install_dialog.get_by_role("button", name="Проверить установку").click()
            page.get_by_text(re.compile("Команда проверена; файлы не изменены")).wait_for()
            qa.check("skill dry-run reports result", page.get_by_text(re.compile("Команда проверена; файлы не изменены")).is_visible())
            page.keyboard.press("Escape")
            page.get_by_role("heading", name="Чем помочь?").wait_for()

            for command, expected in [
                ("/mcp list", "/MCP"),
                ("/tools", "Инструменты"),
                ("/memory", "Память"),
                ("/usage", "Использование"),
                ("/changelog full", "История изменений"),
            ]:
                slash(page, command)
                route_heading = page.locator(".workspace-content").get_by_role("heading", name=expected, exact=True)
                route_heading.wait_for()
                qa.check(f"slash route {command} renders", route_heading.is_visible())
                page.keyboard.press("Escape")
                page.get_by_role("heading", name="Чем помочь?").wait_for()

            slash(page, "/login")
            provider_search = page.get_by_role("textbox", name="Поиск провайдеров")
            provider_search.fill("Anthropic")
            page.get_by_role("button", name=re.compile("Anthropic")).click()
            qa.check("provider action gives feedback", page.get_by_text(re.compile("Anthropic.*выбран")).is_visible())
            provider_search.fill("нет-провайдера")
            qa.check("provider search exposes empty state", page.get_by_text("Провайдеры не найдены").is_visible())
            page.keyboard.press("Escape")
            page.get_by_role("heading", name="Чем помочь?").wait_for()

            # Activity lifecycle: running, cancelled, success, error, retry.
            composer = page.get_by_role("textbox", name="Сообщение ma-hi-ko")
            composer.fill("Проверь интерфейс и покажи activity")
            page.get_by_role("button", name="Отправить сообщение").click()
            activity = last_activity(page)
            activity.wait_for()
            qa.check("composer disables during run", composer.is_disabled())
            qa.check("transcript exposes busy state", page.get_by_label("Транскрипт сессии").get_attribute("aria-busy") == "true")
            qa.check("Stop is immediately available", activity.get_by_role("button", name=re.compile("Остановить")).is_visible())
            page.wait_for_timeout(650)
            qa.check("current operation is visible", activity.get_by_text("Готовлю локальное изменение интерфейса", exact=True).count() >= 1)
            read_toggle = activity.get_by_role("button", name=re.compile("Читаю контракты и компоненты transcript"))
            read_toggle.click()
            qa.check("running command details expand", activity.get_by_text("sed -n '1,240p'", exact=False).is_visible())
            page.screenshot(path=str(SCREENSHOTS / "after-running-1280x800.png"), full_page=True)

            page.keyboard.press("Escape")
            wait_terminal(activity, "cancelled")
            qa.check("Escape cancels run", activity.get_by_text("Операция остановлена пользователем", exact=True).count() >= 1)
            qa.check("cancel keeps planned denominator", bool(re.search(r"\d/7 шагов", activity.inner_text())))
            cancelled_text = activity.inner_text()
            assistant_count = page.locator(".assistant-message").count()
            page.wait_for_timeout(450)
            qa.check("cancel publishes no late success", activity.inner_text() == cancelled_text and page.locator(".assistant-message").count() == assistant_count)
            qa.check("composer re-enables after cancel", not composer.is_disabled())
            page.screenshot(path=str(SCREENSHOTS / "after-cancelled-1280x800.png"), full_page=True)

            activity.get_by_role("button", name=re.compile("Повторить")).click()
            wait_terminal(activity, "success")
            qa.check("retry reuses one activity entry", page.locator(".activity-stream").count() == 1)
            qa.check("retry increments attempt", "попытка 2" in activity.inner_text())
            qa.check("retry reaches 7/7", "7/7 шагов" in activity.inner_text())
            qa.check("success appends one assistant recap", page.locator(".assistant-message").count() == 1)
            more = activity.get_by_role("button", name=re.compile("Ещё"))
            if more.count():
                more.click()
            command_toggle = activity.get_by_role("button", name=re.compile("Запускаю локальную проверочную команду"))
            command_toggle.click()
            details = page.locator(f"#{command_toggle.get_attribute('aria-controls')}")
            output = details.locator("pre").inner_text().splitlines()
            qa.check("command output is capped to twenty lines", len(output) == 20, f"lines={len(output)}")
            qa.check("command output keeps the tail", output[0].startswith("09  ") and output[-1].startswith("28  "))
            qa.check("successful exit code is visible", "КОД ЗАВЕРШЕНИЯ\n0" in details.inner_text().upper())
            activity.get_by_role("button", name=re.compile("Копировать детали")).click()
            activity.get_by_role("button", name=re.compile("Скопировано")).wait_for()
            copied = page.evaluate("window.__qaClipboard")
            qa.check("activity copy is safe and structured", "Activity:" in copied and "Код завершения: 0" in copied and "chain-of-thought" not in copied.lower())
            page.screenshot(path=str(SCREENSHOTS / "after-success-details-1280x800.png"), full_page=True)

            composer.fill("Покажи error state и восстановление")
            page.get_by_role("button", name="Отправить сообщение").click()
            error_activity = last_activity(page)
            wait_terminal(error_activity, "error")
            qa.check("error state is visible", error_activity.locator(".activity-final-error").is_visible())
            qa.check("error progress keeps denominator", "5/7 шагов" in error_activity.inner_text())
            more = error_activity.get_by_role("button", name=re.compile("Ещё"))
            if more.count():
                more.click()
            verify_toggle = error_activity.get_by_role("button", name=re.compile("Проверка типов обнаружила"))
            verify_toggle.click()
            verify_details = page.locator(f"#{verify_toggle.get_attribute('aria-controls')}")
            qa.check("error details expose exit code 1", "КОД ЗАВЕРШЕНИЯ\n1" in verify_details.inner_text().upper())
            qa.check("error details expose recovery", "Следующий шаг:" in verify_details.inner_text())
            page.screenshot(path=str(SCREENSHOTS / "after-error-1280x800.png"), full_page=True)
            error_activity.get_by_role("button", name=re.compile("Повторить")).click()
            wait_terminal(error_activity, "success")
            qa.check("error retry succeeds", "попытка 2" in error_activity.inner_text() and "7/7 шагов" in error_activity.inner_text())

            # Scroll boundary and long content.
            transcript = page.get_by_label("Транскрипт сессии")
            page.evaluate("el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); }", transcript.element_handle())
            long_token = "very-long-path-" + "x" * 150
            composer.fill(f"Проверь {long_token}")
            page.get_by_role("button", name="Отправить сообщение").click()
            page.wait_for_timeout(250)
            new_events = page.get_by_role("button", name=re.compile("К новым событиям"))
            qa.check("manual scroll-up is preserved", new_events.is_visible() and transcript.evaluate("el => el.scrollTop") < 8)
            qa.check("long prompt does not overflow", page.locator(".user-message").last.evaluate("el => el.scrollWidth <= el.clientWidth + 1"))
            new_events.click()
            qa.check("new-events control returns to latest", transcript.evaluate("el => el.scrollHeight - el.scrollTop - el.clientHeight") <= 3)
            page.keyboard.press("Escape")
            wait_terminal(last_activity(page), "cancelled")

            # Responsive overlays and screenshots.
            for width, height, filename in [
                (1024, 700, "after-1024x700.png"),
                (760, 720, "after-760x720.png"),
                (1440, 900, "after-1440x900.png"),
                (1920, 1080, "after-1920x1080.png"),
            ]:
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(140)
                qa.check(f"{width}px layout has no document overflow", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
                page.screenshot(path=str(SCREENSHOTS / filename), full_page=True)
            page.set_viewport_size({"width": 1024, "height": 700})
            page.keyboard.press("Escape")
            qa.check("responsive Escape closes overlay sidebars", page.get_by_role("complementary", name="Навигация и проекты").count() == 0 and page.get_by_role("complementary", name="Проверка изменений").count() == 0)

            nav_trigger = page.locator("#environment-trigger")
            qa.check("responsive nav trigger exposes open action", nav_trigger.get_attribute("aria-label") == "Показать боковую панель")
            nav_trigger.click()
            sidebar = page.get_by_role("complementary", name="Навигация и проекты")
            sidebar.wait_for()
            qa.check("responsive sidebar remains inside viewport", sidebar.evaluate("el => { const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }"))
            qa.check("responsive nav excludes review", page.get_by_role("complementary", name="Проверка изменений").count() == 0)
            scrim = page.locator(".workbench-scrim")
            scrim_style = scrim.evaluate("el => ({visible:getComputedStyle(el).display !== 'none',background:getComputedStyle(el).backgroundColor,z:getComputedStyle(el).zIndex,tabIndex:el.tabIndex})")
            qa.check("responsive nav has a non-focusable dark scrim", scrim_style["visible"] and scrim_style["background"] not in {"rgba(0, 0, 0, 0)", "transparent"} and int(scrim_style["z"]) == 33 and scrim_style["tabIndex"] == -1, str(scrim_style))
            page.wait_for_function("document.activeElement?.closest('#environment-panel') !== null")
            qa.check("responsive nav receives focus", sidebar.evaluate("el => el.contains(document.activeElement)"))
            sidebar_body = sidebar.locator(".sidebar-body")
            qa.check("short-window main menu uses one scroll container", sidebar_body.evaluate("el => getComputedStyle(el).overflowY === 'auto'"))
            short_targets = sidebar.locator(".new-chat, .primary-nav button, .sidebar-heading button, .recent-list button, .sidebar-project, .project-tools button, .sidebar-footer button").evaluate_all(
                "els => els.filter(el => { const r=el.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(el => ({label:el.getAttribute('aria-label'),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))"
            )
            qa.check("short-window main-menu targets stay 44px", not short_targets, str(short_targets))
            last_project_action = sidebar.get_by_role("button", name="Открыть окно пулл-реквеста")
            last_project_action.scroll_into_view_if_needed()
            qa.check("short-window menu reaches project actions by scrolling", last_project_action.evaluate("el => { const r=el.getBoundingClientRect(); const p=el.closest('aside').getBoundingClientRect(); return r.top >= p.top && r.bottom <= p.bottom; }"))
            qa.check("sidebar footer stays visible while menu scrolls", sidebar.locator(".sidebar-footer").evaluate("el => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }"))
            page.screenshot(path=str(SCREENSHOTS / "after-main-menu-1024x700.png"), full_page=True)
            sidebar.get_by_role("button", name="Скрыть боковую панель").click()
            sidebar.wait_for(state="hidden")
            page.wait_for_function("document.activeElement?.id === 'environment-trigger'")
            qa.check("responsive nav close restores trigger focus", page.evaluate("document.activeElement?.id") == "environment-trigger")

            review_trigger = page.get_by_role("button", name="Показать проверку изменений")
            review_trigger.click()
            responsive_review = page.get_by_role("complementary", name="Проверка изменений")
            responsive_review.wait_for()
            qa.check("responsive review remains inside viewport", responsive_review.evaluate("el => { const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }"))
            qa.check("responsive review excludes nav", page.get_by_role("complementary", name="Навигация и проекты").count() == 0)
            page.wait_for_function("document.activeElement?.closest('#review-panel') !== null")
            qa.check("responsive review receives focus", responsive_review.evaluate("el => el.contains(document.activeElement)"))
            review_scrim = page.locator(".workbench-scrim")
            qa.check("responsive review reuses the dark scrim", review_scrim.is_visible() and review_scrim.get_attribute("tabindex") == "-1")
            page.screenshot(path=str(SCREENSHOTS / "after-review-1024x700.png"), full_page=True)
            review_scrim.click(position={"x": 4, "y": 4})
            responsive_review.wait_for(state="hidden")
            page.wait_for_function("document.activeElement?.getAttribute('aria-label') === 'Показать проверку изменений'")
            qa.check("scrim close restores review trigger focus", page.evaluate("document.activeElement?.getAttribute('aria-label')") == "Показать проверку изменений")
            qa.verify_clean_console(page, "full interaction console is clean")
            page.close()

            # Reduced-motion branch.
            qa.console.clear()
            reduced_context = browser.new_context(viewport={"width": 1024, "height": 720}, reduced_motion="reduce")
            reduced = reduced_context.new_page()
            qa.attach(reduced)
            load(reduced, current_html)
            if reduced.locator(".workbench-scrim").count():
                reduced.get_by_role("complementary", name="Навигация и проекты").get_by_role("button", name="Скрыть боковую панель").click()
                reduced.locator(".workbench-scrim").wait_for(state="detached")
            reduced.get_by_role("textbox", name="Сообщение ma-hi-ko").fill("Проверка reduced motion")
            reduced.get_by_role("button", name="Отправить сообщение").click()
            stop = reduced.get_by_role("button", name=re.compile("Остановить"))
            stop.wait_for()
            transition = stop.evaluate("el => getComputedStyle(el).transitionDuration")
            qa.check("reduced motion removes activity transitions", all(part.strip() in {"0s", "0ms"} for part in transition.split(",")), transition)
            stop.click()
            wait_terminal(last_activity(reduced), "cancelled")
            qa.verify_clean_console(reduced, "reduced-motion console is clean")
            reduced_context.close()
            browser.close()

    except Exception:
        failure = traceback.format_exc()

    report = {
        "summary": {
            "passed": sum(item["status"] == "pass" for item in qa.results),
            "failed": sum(item["status"] == "fail" for item in qa.results) + (1 if failure else 0),
        },
        "results": qa.results,
        "console": qa.console,
        "failure": failure,
    }
    (REPORT_DIR / "browser-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (REPORT_DIR / "browser-console.txt").write_text("\n".join(qa.console) or "No console or page errors captured.\n", encoding="utf-8")
    failure_path = REPORT_DIR / "browser-qa-failure.txt"
    if failure:
        failure_path.write_text(failure, encoding="utf-8")
        print(failure)
    elif failure_path.exists():
        failure_path.unlink()
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 1 if failure or report["summary"]["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(run())
