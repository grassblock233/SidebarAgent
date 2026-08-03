import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
const themeCss = fs.readFileSync(new URL("../shared/theme.css", import.meta.url), "utf8");

test("shared brand theme remains the SidebarAgent mint palette", () => {
  assert.match(themeCss, /--accent:\s*#86e3ce;/i);
  assert.match(themeCss, /--accent-hover:\s*#6fd4bd;/i);
  assert.match(themeCss, /--accent-soft:\s*#eafaf6;/i);
  assert.match(themeCss, /--accent-ink:\s*#174f44;/i);
  assert.match(themeCss, /--focus-ring:\s*0 0 0 3px rgba\(134, 227, 206, \.3\);/i);
  assert.match(css, /\.empty-capture-button\s*\{[^}]*background:\s*var\(--accent\);/);
  assert.match(css, /\.action-button\s*\{[^}]*background:\s*var\(--accent\);/);
});

test("side panel uses a compact workspace header and one action button", () => {
  assert.match(html, /id="actionButton"/);
  assert.doesNotMatch(html, /id="sendButton"|id="stopButton"/);
  assert.match(html, /class="workspace-header"/);
  assert.match(html, /class="product-mark"/);
  assert.match(html, /id="sourceDock"/);
  assert.match(html, /class="composer-dock"/);
  assert.match(html, /id="modelSelect"/);
  assert.match(html, /id="modelPickerButton"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="modelPickerMenu"[^>]*role="listbox"/);
  assert.doesNotMatch(html, /id="modelButton"/);
  assert.match(html, /class="header-tools"[\s\S]*id="captureViewportButton"[\s\S]*id="clearButton"[\s\S]*id="settingsButton"/);
  assert.match(html, /id="emptyCaptureButton"/);
  assert.match(html, /shared\/theme\.css/);
});

test("unconfigured state uses provider-neutral copy", () => {
  assert.doesNotMatch(html, /尚未配置 DeepSeek API Key/);
  assert.match(fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8"), /尚未配置 AI 提供商/);
});

test("viewport, conversation and composer use fixed shell constraints", () => {
  assert.match(css, /\.app-shell\s*\{[\s\S]*position: fixed;[\s\S]*inset: 0;/);
  assert.match(css, /grid-template-rows: 48px auto auto auto minmax\(0, 1fr\) 104px/);
  assert.match(css, /\.content\s*\{[^}]*grid-row: 5;[^}]*overflow-y: auto;/);
  assert.match(css, /\.composer-dock\s*\{[^}]*grid-row: 6;[^}]*height: 104px;/);
  assert.match(css, /\.composer textarea\s*\{[^}]*height: 34px !important;[^}]*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.composer-dock:(hover|focus-within) \.composer-surface/);
});

test("source expands only through its disclosure control", () => {
  assert.match(html, /id="toggleSourceButton"[^>]*aria-expanded="false"/);
  assert.match(html, /id="sourceLabel"[^>]*>选中文本</);
  assert.match(html, /id="sourceMeta"/);
  assert.doesNotMatch(html, /pin-icon/);
  assert.match(css, /\.source-dock\.is-expanded \.source-panel/);
  assert.match(css, /max-height: 44vh/);
  assert.match(css, /-webkit-line-clamp: 2/);
  assert.doesNotMatch(css, /\.source-dock:(hover|focus-within) \.source-panel|\.source-dock\.is-pinned/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.action-button\.is-generating/);
});

test("selection preview identifies its capture type, length and vertical overflow", () => {
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(js, /captureType === "viewport" \? "页面文字" : "选中文本"/);
  assert.match(js, /sourceMeta\.textContent/);
  assert.match(js, /sourceText\.scrollHeight > elements\.sourceText\.clientHeight/);
});

test("hidden side panel states cannot be overridden by component display rules", () => {
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(themeCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(js, /emptyState\.hidden = hasSource \|\| state\.messages\.length > 0/);
});

test("model picker exposes selected state and keyboard navigation", () => {
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(js, /className = "model-picker-option"/);
  assert.match(js, /setAttribute\("aria-selected"/);
  assert.match(js, /event\.key === "ArrowDown"/);
  assert.match(js, /event\.key === "Escape"/);
  assert.match(css, /\.model-picker-menu\s*\{[^}]*max-height: 240px;[^}]*overflow-y: auto;/);
});

test("quick actions remain visible in a responsive grid", () => {
  assert.equal((html.match(/data-action=/g) || []).length, 3);
  assert.match(css, /\.quick-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(html, /keyPoints|credibility|提取要点|判断可信度/);
});

test("message actions use accessible icon controls", () => {
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(js, /createMessageActionIcon/);
  assert.match(js, /button\.setAttribute\("aria-label", label\)/);
  assert.doesNotMatch(js, /event\.currentTarget\.textContent = "已复制"/);
});

test("markdown tables use the structured parser and a scrollable container", () => {
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(js, /parseMarkdownTable\(lines, index\)/);
  assert.match(js, /document\.createElement\("table"\)/);
  assert.match(css, /\.markdown-table-wrap\s*\{[^}]*overflow-x: auto;/);
});
