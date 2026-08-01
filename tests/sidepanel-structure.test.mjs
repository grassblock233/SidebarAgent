import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");

test("side panel uses one action button and no internal brand header", () => {
  assert.match(html, /id="actionButton"/);
  assert.doesNotMatch(html, /id="sendButton"|id="stopButton"/);
  assert.doesNotMatch(html, /class="app-header"|class="brand"/);
  assert.match(html, /id="sourceDock"/);
  assert.match(html, /class="composer-dock"/);
  assert.match(html, /id="modelSelect"/);
  assert.doesNotMatch(html, /id="modelButton"/);
  assert.match(html, /class="composer-tools"[\s\S]*id="clearButton"[\s\S]*id="settingsButton"/);
});

test("unconfigured state uses provider-neutral copy", () => {
  assert.doesNotMatch(html, /尚未配置 DeepSeek API Key/);
  assert.match(fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8"), /尚未配置 AI 提供商/);
});

test("viewport, conversation and composer use fixed shell constraints", () => {
  assert.match(css, /\.app-shell\s*\{[\s\S]*position: fixed;[\s\S]*inset: 0;/);
  assert.match(css, /grid-template-rows: auto auto auto minmax\(0, 1fr\) 80px/);
  assert.match(css, /\.content\s*\{[^}]*grid-row: 4;[^}]*overflow-y: auto;/);
  assert.match(css, /\.composer-dock\s*\{[^}]*grid-row: 5;[^}]*height: 80px;/);
  assert.match(css, /\.composer textarea\s*\{[^}]*height: 28px !important;[^}]*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.composer-dock:(hover|focus-within) \.composer-surface/);
});

test("source overlay and reduced-motion fallback remain available", () => {
  assert.match(css, /\.source-dock:hover \.source-panel/);
  assert.match(css, /\.source-dock\.is-pinned \.source-panel/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.action-button\.is-generating/);
});

test("hidden side panel states cannot be overridden by component display rules", () => {
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(js, /emptyState\.hidden = hasSource \|\| state\.messages\.length > 0/);
});
