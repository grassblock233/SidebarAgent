import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../options.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../options.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../options.css", import.meta.url), "utf8");

test("custom provider is selected from the provider menu", () => {
  assert.doesNotMatch(html, /id="addCustomButton"/);
  assert.match(js, /添加自定义提供商/);
  assert.match(js, /ADD_CUSTOM_PROVIDER/);
  assert.match(js, /customFields\.hidden = !isCustom/);
  assert.match(js, /configurationHeading\.textContent = isCustom/);
});

test("settings group credentials, models and commit actions", () => {
  assert.match(html, /shared\/theme\.css/);
  assert.match(html, /<h3>访问凭据<\/h3>/);
  assert.match(html, /<h3>模型<\/h3>/);
  assert.match(html, /class="model-control-row"[\s\S]*id="modelPickerButton"[\s\S]*id="modelPickerMenu"[\s\S]*id="modelSelect"[\s\S]*id="fetchModelsButton"/);
  assert.match(html, /class="commit-actions"[\s\S]*id="saveButton"[\s\S]*id="activateButton"/);
  assert.match(css, /\.field-group\s*\{[\s\S]*grid-template-columns:\s*176px minmax\(0, 1fr\)/);
});

test("settings model picker mirrors the accessible side-panel control", () => {
  assert.match(html, /id="modelPickerButton"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="modelPickerMenu"[^>]*role="listbox"/);
  assert.match(js, /className = "model-picker-option"/);
  assert.match(js, /setAttribute\("aria-selected"/);
  assert.match(js, /event\.key === "ArrowDown"/);
  assert.match(css, /\.model-picker-menu\s*\{[^}]*max-height: 240px;[^}]*overflow-y: auto;/);
});

test("settings footer links to the SidebarAgent GitHub repository", () => {
  assert.match(html, /class="project-link"[^>]*href="https:\/\/github\.com\/olu-py\/SidebarAgent"/);
  assert.match(html, /class="project-link"[\s\S]*<svg[\s\S]*<span>SidebarAgent<\/span>/);
});

test("settings collapse to one column on narrow screens", () => {
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.field-group\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.model-control-row\s*\{\s*grid-template-columns:\s*1fr/);
});

test("settings omit the data and privacy summary", () => {
  assert.doesNotMatch(html, /privacyHeading|数据与隐私|<dl>/);
});
