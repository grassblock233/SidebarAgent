import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownMessage, MessageItem, ModelPicker } from "../sidepanel/components";
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

it("shows one page-text body, removes a duplicated title line, and toggles expansion", async () => {
  const text = "Article title\nFirst line\nSecond line\nThird line\nFourth line";
  render(<MessageItem message={{ id: "user-1", role: "user", content: "Summarize", pageContext: { text, title: "Article title", url: "https://example.com/article", contentType: "text/plain", captureType: "viewport", truncated: false } }} busy={false} onRegenerate={vi.fn()} />);

  const toggle = screen.getByRole("button", { name: /页面文字.*Article title/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getAllByText("Article title")).toHaveLength(1);
  expect(screen.getByText(/First line/)).toBeInTheDocument();

  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/Fourth line/)).toBeInTheDocument();
  expect(screen.getAllByText("Article title")).toHaveLength(1);
});

it("keeps non-matching title text and rejects unsafe page links", () => {
  render(<MessageItem message={{ id: "user-2", role: "user", content: "Question", pageContext: { text: "Different first line\nBody", title: "Article title", url: "javascript:alert(1)", contentType: "text/plain", truncated: false } }} busy={false} onRegenerate={vi.fn()} />);
  expect(screen.getByText(/Different first line/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /打开来源页面/ })).not.toBeInTheDocument();
});

it("marks only newly streamed Markdown text for fading", () => {
  const { container } = render(<MarkdownMessage content="已完成，**新内容**" animateFrom={4} />);

  expect(container).toHaveTextContent("已完成，新内容");
  expect(container.querySelector("table")).not.toBeInTheDocument();
  const fadingText = container.querySelector('[class*="streamingDelta"]');
  expect(fadingText).toHaveTextContent("新内容");
  expect(fadingText?.parentElement).toHaveTextContent("新内容");
  expect(container.querySelector("p")?.firstChild).toHaveTextContent("已完成，");
});

it("keeps GFM table rendering while marking a streamed cell", () => {
  const content = "| A | B |\n|---|---|\n| 1 | 2 |";
  const { container } = render(<MarkdownMessage content={content} animateFrom={content.lastIndexOf("2")} />);

  expect(container.querySelector("table")).toBeInTheDocument();
  expect(container.querySelector('[class*="streamingDelta"]')).toHaveTextContent("2");
});
