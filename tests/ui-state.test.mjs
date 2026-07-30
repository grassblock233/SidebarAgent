import test from "node:test";
import assert from "node:assert/strict";
import { getActionButtonState } from "../shared/ui-state.js";

test("action button is disabled until idle input is ready", () => {
  assert.equal(getActionButtonState({ busy: false, submitting: false, hasSource: false, hasText: true }).disabled, true);
  assert.equal(getActionButtonState({ busy: false, submitting: false, hasSource: true, hasText: false }).disabled, true);
  assert.equal(getActionButtonState({ busy: false, submitting: true, hasSource: true, hasText: true }).disabled, true);
  assert.equal(getActionButtonState({ busy: false, submitting: false, hasSource: true, hasText: true }).disabled, false);
});

test("action button becomes an enabled stop control while generating", () => {
  assert.deepEqual(getActionButtonState({
    busy: true,
    submitting: false,
    hasSource: true,
    hasText: false
  }), {
    disabled: false,
    generating: true,
    label: "停止生成"
  });
});
