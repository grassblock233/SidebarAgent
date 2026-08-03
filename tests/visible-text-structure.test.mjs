import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const extractor = fs.readFileSync(new URL("../content/visible-text.js", import.meta.url), "utf8");
const sidepanel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");

test("viewport capture uses one-time DOM text extraction", () => {
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /content\/visible-text\.js/);
  assert.match(extractor, /createTreeWalker/);
  assert.match(extractor, /NodeFilter\.SHOW_TEXT/);
  assert.match(extractor, /getClientRects/);
  assert.doesNotMatch(extractor, /captureVisibleTab|getDisplayMedia|canvas|toDataURL|OCR/i);
});

test("viewport capture returns plain text and budgeted allowlisted HTML", () => {
  assert.match(extractor, /const allowedTags = new Set/);
  assert.match(extractor, /buildSanitizedTree\(parts\)/);
  assert.match(extractor, /serializeTreeWithinBudget/);
  assert.match(extractor, /html: structured\.html/);
  assert.match(extractor, /htmlTruncated: structured\.truncated/);
  assert.match(extractor, /contentType: structured\.html \? "text\/html" : "text\/plain"/);
  assert.match(extractor, /\["http:", "https:"\]\.includes\(href\.protocol\)/);
  assert.doesNotMatch(extractor, /\.innerHTML\s*=/);
});

test("side panel capture flows through the existing selection state", () => {
  assert.match(sidepanel, /captureViewportButton/);
  assert.match(sidepanel, /chrome\.permissions\.request\(\{ origins: \[origin\] \}\)/);
  assert.match(sidepanel, /capture-visible-text/);
  assert.match(sidepanel, /await applySelection\(response\.source\)/);
});

test("source preview stays plain while AI requests prefer sanitized HTML", () => {
  assert.match(sidepanel, /elements\.sourceText\.textContent = state\.source\.text/);
  assert.match(sidepanel, /const sourceContent = structuredHtml \|\| state\.source\.text/);
  assert.match(sidepanel, /JSON\.stringify\(sourceContent\)/);
  assert.match(sidepanel, /state\.source\.truncated \|\| state\.source\.htmlTruncated/);
  assert.doesNotMatch(sidepanel, /sourceText\.innerHTML/);
});
