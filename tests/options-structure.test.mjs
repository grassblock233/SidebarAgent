import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../options.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../options.js", import.meta.url), "utf8");

test("custom provider is selected from the provider menu", () => {
  assert.doesNotMatch(html, /id="addCustomButton"/);
  assert.match(js, /添加自定义提供商/);
  assert.match(js, /ADD_CUSTOM_PROVIDER/);
  assert.match(js, /customFields\.hidden = !isCustom/);
  assert.match(js, /configurationHeading\.textContent = isCustom/);
});
