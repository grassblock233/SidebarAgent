import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { MarkdownMessage, ModelPicker } from "../sidepanel/components";
import { initialState, sidePanelReducer } from "../sidepanel/state";
import { initialOptionsState, optionsReducer } from "../options/state";
import { createEmptySettings } from "../shared/storage";

describe("side panel reducer", () => {
  it("replaces the conversation when a new source arrives", () => {
    const source = { id: "one", text: "text", originalLength: 4, truncated: false, contentType: "text/plain" as const, title: "Page", url: "https://example.com", createdAt: 1 };
    const state = sidePanelReducer({ ...initialState, messages: [{ id: "old", role: "user", content: "old" }] }, { type: "source", source });
    expect(state.source).toBe(source);
    expect(state.messages).toEqual([]);
  });

  it("applies deltas only to their request message", () => {
    const state = sidePanelReducer({ ...initialState, messages: [{ id: "a", role: "assistant", content: "A" }] }, { type: "append-delta", id: "a", delta: "B" });
    expect(state.messages[0].content).toBe("AB");
  });
});

it("keeps options draft separate from persisted settings", () => {
  const settings = createEmptySettings();
  const changed = optionsReducer({ ...initialOptionsState, settings }, { type: "draft", draft: { ...initialOptionsState.draft, apiKey: "draft" }, invalidate: true });
  expect(changed.draft.apiKey).toBe("draft");
  expect(changed.settings?.providers.deepseek.apiKey).toBe("");
});

it("renders GFM tables and never interprets raw HTML", () => {
  const { container } = render(<MarkdownMessage content={"| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>"} />);
  expect(container.querySelector("table")).toBeInTheDocument();
  expect(container.querySelector("script")).not.toBeInTheDocument();
  expect(container).toHaveTextContent("<script>alert(1)</script>");
});

it("supports accessible model selection and Escape", async () => {
  const onChange = vi.fn();
  render(<ModelPicker providerName="DeepSeek" model="a" models={["a", "b"]} disabled={false} onChange={onChange} />);
  const trigger = screen.getByRole("button", { name: /DeepSeek/ });
  await userEvent.click(trigger);
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("option", { name: /b/ }));
  expect(onChange).toHaveBeenCalledWith("b");
});

it("closes the model menu when the picker becomes disabled", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<ModelPicker providerName="DeepSeek" model="a" models={["a", "b"]} disabled={false} onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: /DeepSeek/ }));
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  rerender(<ModelPicker providerName="DeepSeek" model="a" models={["a", "b"]} disabled onChange={onChange} />);
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
});

it("pins conditional side panel regions to stable grid rows", () => {
  const css = fs.readFileSync("src/sidepanel/sidepanel.module.css", "utf8");
  expect(css).toMatch(/grid-template-rows:\s*46px auto auto minmax\(0, 1fr\) auto/);
  expect(css).toMatch(/\.content\s*\{[^}]*grid-row:\s*4/);
  expect(css).toMatch(/\.composerDock\s*\{[^}]*grid-row:\s*5/);
});

it("hides the composer scrollbar while keeping the input scrollable and multi-line friendly", () => {
  const css = fs.readFileSync("src/sidepanel/sidepanel.module.css", "utf8");
  expect(css).toMatch(/\.composer textarea\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/);
  expect(css).toMatch(/\.composer textarea::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  expect(css).toMatch(/\.composer textarea:focus-visible\s*\{[^}]*box-shadow:\s*none/);
});

it("styles quick actions as a floating rounded pill docked above the input", () => {
  const css = fs.readFileSync("src/sidepanel/sidepanel.module.css", "utf8");
  expect(css).toMatch(/\.quickActions\s*\{[^}]*border-radius:\s*999px[^}]*box-shadow:\s*var\(--shadow\)/);
  expect(css).toMatch(/\.quickActions\s*\{[^}]*background:\s*var\(--surface-raised\)/);
});

it("styles the composer as an inset floating card", () => {
  const css = fs.readFileSync("src/sidepanel/sidepanel.module.css", "utf8");
  expect(css).toMatch(/\.composerDock\s*\{[^}]*border-top:\s*0[^}]*background:\s*transparent/);
  expect(css).toMatch(/\.composerSurface\s*\{[^}]*border:\s*1px solid var\(--border\)[^}]*border-radius:\s*16px[^}]*background:\s*var\(--surface-raised\)[^}]*box-shadow:\s*var\(--shadow\)/);
  expect(css).toMatch(/\.composerSurface:focus-within\s*\{[^}]*border-color:\s*var\(--accent-hover\)[^}]*box-shadow:\s*var\(--shadow\),\s*var\(--focus-ring\)/);
  expect(css).toMatch(/\.composer\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/);
  expect(css).not.toMatch(/\.composerDock\.hasQuickActions/);
});

it("collapses the composer dock to actual content when quick actions are absent", () => {
  const css = fs.readFileSync("src/sidepanel/sidepanel.module.css", "utf8");
  expect(css).toMatch(/\.composerDock\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  expect(css).toMatch(/\.composerMeta\s*\{[^}]*height:\s*32px[^}]*grid-template-columns:\s*minmax\(88px,\s*1fr\)\s+auto\s+32px/);
});

it("places the send button as a compact themed circular control in the composer meta row", () => {
  const css = fs.readFileSync("src/sidepanel/sidepanel.module.css", "utf8");
  expect(css).toMatch(/\.sendButton\s*\{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*border-radius:\s*50%[^}]*background:\s*var\(--surface-raised\)[^}]*color:\s*var\(--accent-ink\)[^}]*transform:\s*translateY\(-2px\)/);
  expect(css).toMatch(/\.sendButton:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--surface-muted\)/);
});

it("keeps the model arrow beside the model name and animates the menu upward", () => {
  const css = fs.readFileSync("src/sidepanel/sidepanel.module.css", "utf8");
  expect(css).toMatch(/\.modelButton\s*\{[^}]*display:\s*flex[^}]*gap:\s*5px/);
  expect(css).toMatch(/\.modelButton\s*>\s*svg\s*\{[^}]*flex:\s*none/);
  expect(css).toMatch(/\.modelName\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/);
  expect(css).toMatch(/@keyframes\s+modelMenuEnter\s*\{[^}]*translateY\(5px\)\s+scale\(\.98\)[^}]*}/);
  expect(css).toMatch(/\.modelMenu\s*\{[^}]*transform-origin:\s*bottom left[^}]*animation:\s*modelMenuEnter\s+\.16s\s+ease-out\s+both/);
  expect(css).toMatch(/\.modelMenu\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*150px[^}]*max-width:\s*min\(300px,\s*calc\(100vw - 20px\)\)/);
  expect(css).toMatch(/\.modelMenu button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
});
