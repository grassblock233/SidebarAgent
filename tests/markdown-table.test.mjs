import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownTable, splitMarkdownTableRow } from "../shared/markdown-table.js";

test("splitMarkdownTableRow supports outer pipes, escaped pipes and inline code", () => {
  assert.deepEqual(
    splitMarkdownTableRow("| **名称** | a\\|b | `x|y` |"),
    ["**名称**", "a|b", "`x|y`"]
  );
});

test("parseMarkdownTable reads alignment and normalizes short rows", () => {
  const table = parseMarkdownTable([
    "| 名称 | 数量 | 说明 |",
    "| :--- | ---: | :---: |",
    "| 示例 | 2 | 正常 |",
    "| 缺少字段 | 1 |",
    "",
    "下一段"
  ], 0);
  assert.deepEqual(table, {
    headers: ["名称", "数量", "说明"],
    alignments: ["left", "right", "center"],
    rows: [["示例", "2", "正常"], ["缺少字段", "1", ""]],
    nextIndex: 4
  });
});

test("parseMarkdownTable rejects ordinary pipe text and invalid delimiters", () => {
  assert.equal(parseMarkdownTable(["a | b", "not a separator | ---"], 0), null);
  assert.equal(parseMarkdownTable(["plain text", "---"], 0), null);
});
