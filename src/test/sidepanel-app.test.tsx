import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "../sidepanel/App";
import { createEmptySettings } from "../shared/storage";
import type { ConversationSession, SidebarAgentSettingsV2, SourceContext } from "../shared/types";

const mocks = vi.hoisted(() => ({
  clearConversationSession: vi.fn(),
  getConversationSession: vi.fn(),
  getPendingSelection: vi.fn(),
  getSettings: vi.fn(),
  saveConversationSession: vi.fn(),
  streamChat: vi.fn()
}));

vi.mock("../shared/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../shared/storage")>(),
  clearConversationSession: mocks.clearConversationSession,
  getConversationSession: mocks.getConversationSession,
  getPendingSelection: mocks.getPendingSelection,
  getSettings: mocks.getSettings,
  saveConversationSession: mocks.saveConversationSession
}));

vi.mock("../shared/openai-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../shared/openai-client")>(),
  streamChat: mocks.streamChat
}));

const source = (id = "source-one", text = "page text"): SourceContext => ({
  id,
  text,
  originalLength: text.length,
  truncated: false,
  contentType: "text/plain",
  title: `Page ${id}`,
  url: `https://example.com/${id}`,
  createdAt: 1,
  captureType: "viewport"
});

function configuredSettings(): SidebarAgentSettingsV2 {
  const settings = createEmptySettings();
  settings.providers.deepseek = {
    ...settings.providers.deepseek,
    apiKey: "key",
    availableModels: ["deepseek-chat"],
    selectedModel: "deepseek-chat"
  };
  return settings;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, reject, resolve };
}

async function renderInitialized(session: ConversationSession | null = { source: source(), messages: [], updatedAt: 1 }) {
  render(<App />);
  const input = await screen.findByPlaceholderText("输入问题，或询问当前页面…");
  if (session?.source) await waitFor(() => expect(input).toBeEnabled());
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue(configuredSettings());
  mocks.getConversationSession.mockResolvedValue({ source: source(), messages: [], updatedAt: 1 });
  mocks.getPendingSelection.mockResolvedValue(null);
  mocks.clearConversationSession.mockResolvedValue(undefined);
  mocks.saveConversationSession.mockResolvedValue(undefined);
  mocks.streamChat.mockResolvedValue(undefined);
});

it("allows chatting without a page source", async () => {
  mocks.getConversationSession.mockResolvedValueOnce(null);
  const input = await renderInitialized(null);

  expect(input).toBeEnabled();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  await userEvent.type(input, "general question");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => expect(mocks.streamChat).toHaveBeenCalledOnce());
  expect(mocks.streamChat).toHaveBeenCalledWith(expect.objectContaining({
    messages: expect.not.arrayContaining([expect.objectContaining({ content: expect.stringContaining("网页标题：") })])
  }));
  expect(mocks.saveConversationSession).toHaveBeenCalledWith(expect.objectContaining({ source: null }));
});

it("locks duplicate submits and allows stopping while preparing", async () => {
  const settingsRequest = deferred<SidebarAgentSettingsV2>();
  const input = await renderInitialized();
  mocks.getSettings.mockImplementationOnce(() => settingsRequest.promise);

  await userEvent.type(input, "question");
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });

  const stopButton = await screen.findByRole("button", { name: "停止生成" });
  expect(mocks.getSettings).toHaveBeenCalledTimes(2);
  await userEvent.click(stopButton);
  settingsRequest.resolve(configuredSettings());

  await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(mocks.streamChat).not.toHaveBeenCalled();
  expect(screen.getAllByText("question")).toHaveLength(1);
});

it("clears immediately during streaming without restoring stale output", async () => {
  mocks.streamChat.mockImplementation(async ({ signal, onDelta }: { signal: AbortSignal; onDelta: (delta: string) => void }) => {
    onDelta("partial answer");
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  const input = await renderInitialized();
  await userEvent.type(input, "question");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("partial answer");

  await userEvent.click(screen.getByRole("button", { name: "清空对话" }));

  await waitFor(() => expect(screen.queryByText("partial answer")).not.toBeInTheDocument());
  expect(screen.queryByText("question")).not.toBeInTheDocument();
  expect(screen.getByText("直接提问，或读取页面")).toBeInTheDocument();
  expect(mocks.clearConversationSession).toHaveBeenCalledOnce();
});

it("keeps a partial reply when the user stops streaming", async () => {
  mocks.streamChat.mockImplementation(async ({ signal, onDelta }: { signal: AbortSignal; onDelta: (delta: string) => void }) => {
    onDelta("partial answer");
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  const input = await renderInitialized();
  await userEvent.type(input, "question");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("partial answer");

  await userEvent.click(screen.getByRole("button", { name: "停止生成" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument());
  expect(screen.getByText("partial answer")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(mocks.saveConversationSession).toHaveBeenLastCalledWith(expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ role: "assistant", content: "partial answer" })]) }));
});

it("orders storage clearing after an in-flight session save", async () => {
  const pendingSave = deferred<void>();
  mocks.saveConversationSession.mockImplementationOnce(() => pendingSave.promise);
  const input = await renderInitialized();
  await userEvent.type(input, "question");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));
  await userEvent.click(screen.getByRole("button", { name: "清空对话" }));

  expect(mocks.clearConversationSession).not.toHaveBeenCalled();
  pendingSave.resolve();
  await waitFor(() => expect(mocks.clearConversationSession).toHaveBeenCalledOnce());
});

it("discards a streaming reply when a new source arrives", async () => {
  mocks.streamChat.mockImplementation(async ({ signal, onDelta }: { signal: AbortSignal; onDelta: (delta: string) => void }) => {
    onDelta("old answer");
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  const input = await renderInitialized();
  await userEvent.type(input, "question");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("old answer");
  const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)?.[0];
  const replacement = source("source-two", "replacement text");

  await act(async () => listener?.({ pendingSelection: { newValue: replacement } } as Record<string, chrome.storage.StorageChange>, "session"));

  await screen.findByText("replacement text");
  expect(screen.queryByText("old answer")).not.toBeInTheDocument();
  expect(screen.queryByText("question")).not.toBeInTheDocument();
});

it("follows streamed output only while the reader stays near the bottom", async () => {
  const streamFinished = deferred<void>();
  let pushDelta: ((delta: string) => void) | undefined;
  mocks.streamChat.mockImplementation(async ({ onDelta }: { onDelta: (delta: string) => void }) => { pushDelta = onDelta; await streamFinished.promise; });
  const input = await renderInitialized();
  const content = screen.getByRole("main");
  let scrollHeight = 500;
  Object.defineProperty(content, "clientHeight", { configurable: true, value: 200 });
  Object.defineProperty(content, "scrollHeight", { configurable: true, get: () => scrollHeight });
  content.scrollTop = 300;
  fireEvent.scroll(content);

  await userEvent.type(input, "question");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(pushDelta).toBeTypeOf("function"));
  expect(content.scrollTop).toBe(500);

  scrollHeight = 700;
  act(() => pushDelta?.("first"));
  expect(content.scrollTop).toBe(700);

  content.scrollTop = 100;
  fireEvent.scroll(content);
  scrollHeight = 800;
  act(() => pushDelta?.(" second"));
  expect(content.scrollTop).toBe(100);

  content.scrollTop = 600;
  fireEvent.scroll(content);
  scrollHeight = 900;
  act(() => pushDelta?.(" third"));
  expect(content.scrollTop).toBe(900);
  streamFinished.resolve();
});

it("keeps quick actions inside the composer dock, above the input", async () => {
  const input = await renderInitialized();
  const dock = input.closest("footer");
  expect(dock).not.toBeNull();
  expect(dock!.children).toHaveLength(2);
  const actions = within(dock!).getByRole("navigation", { name: "快捷操作" });
  expect(actions).toHaveTextContent("解释");
  expect(actions.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const surface = input.parentElement?.parentElement;
  expect(surface?.parentElement).toBe(dock);
  expect(surface?.querySelector("[role=status]")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送" }).parentElement).toBe(surface?.lastElementChild);
});

it("leaves no empty dock row when quick actions are hidden", async () => {
  mocks.getConversationSession.mockResolvedValueOnce(null);
  const input = await renderInitialized(null);
  const dock = input.closest("footer");
  expect(dock).not.toBeNull();
  expect(dock!.children).toHaveLength(1);
});

it("grows the input with its content up to the maximum height", async () => {
  const input = await renderInitialized();
  Object.defineProperty(input, "scrollHeight", { configurable: true, get: () => 50 });
  await userEvent.type(input, "line one{Shift>}{Enter}{/Shift}line two");
  expect(input.style.height).toBe("50px");
  Object.defineProperty(input, "scrollHeight", { configurable: true, get: () => 200 });
  await userEvent.type(input, "{Shift>}{Enter}{/Shift}line three");
  expect(input.style.height).toBe("96px");
  Object.defineProperty(input, "scrollHeight", { configurable: true, get: () => 30 });
  await userEvent.clear(input);
  expect(input.style.height).toBe("30px");
});

it("shows source disclosure only when the collapsed text overflows", async () => {
  await renderInitialized();
  expect(screen.queryByRole("button", { name: "展开" })).not.toBeInTheDocument();
  const sourceText = screen.getByText("page text");
  Object.defineProperty(sourceText, "clientHeight", { configurable: true, value: 20 });
  Object.defineProperty(sourceText, "scrollHeight", { configurable: true, value: 60 });

  fireEvent(window, new Event("resize"));

  const expand = await screen.findByRole("button", { name: "展开" });
  await userEvent.click(expand);
  expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(await screen.findByRole("button", { name: "展开" })).toHaveAttribute("aria-expanded", "false");
});
