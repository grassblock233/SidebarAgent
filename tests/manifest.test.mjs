import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest declares built-in and runtime custom provider hosts", () => {
  assert.equal(manifest.version, "0.5.0");
  assert.deepEqual(manifest.host_permissions, [
    "https://api.deepseek.com/*",
    "https://dashscope.aliyuncs.com/*",
    "https://dashscope-intl.aliyuncs.com/*",
    "https://ark.cn-beijing.volces.com/*"
  ]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://*/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ]);
});
