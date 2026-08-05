import visibleTextScript from "../content/visible-text?script&iife";
import { MAX_SELECTION_CHARS, MENU_ID, PENDING_SELECTION_KEY } from "../shared/constants";
import type { SourceContext } from "../shared/types";

async function createContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_ID, title: "用 SidebarAgent 分析所选内容", contexts: ["selection"] });
}

async function enableActionSidePanel(): Promise<void> {
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
}

function isSourceContext(value: unknown): value is SourceContext {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<SourceContext>;
  return typeof source.id === "string" && typeof source.text === "string" && typeof source.title === "string" && typeof source.url === "string";
}

async function captureVisibleText(): Promise<SourceContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("无法确定当前网页。");
  if (tab.url && !/^(https?|file):/i.test(tab.url)) throw new Error("当前浏览器页面不允许读取文字，请切换到普通网页。");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [visibleTextScript] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const scope = globalThis as typeof globalThis & { __SIDEBAR_AGENT_CAPTURE__?: unknown };
      const result = scope.__SIDEBAR_AGENT_CAPTURE__;
      delete scope.__SIDEBAR_AGENT_CAPTURE__;
      return result;
    }
  });
  if (!isSourceContext(injection?.result) || !injection.result.text) throw new Error("当前屏幕没有可读取的网页文字。");
  return injection.result;
}

function initializeExtension(): void {
  createContextMenu().catch((error: unknown) => console.error("Unable to create context menu", error));
  enableActionSidePanel().catch((error: unknown) => console.error("Unable to configure side panel", error));
}

chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText || !tab?.id) return;
  const normalizedText = info.selectionText.trim();
  if (!normalizedText) return;
  const selection: SourceContext = {
    id: crypto.randomUUID(),
    text: normalizedText.slice(0, MAX_SELECTION_CHARS),
    originalLength: normalizedText.length,
    truncated: normalizedText.length > MAX_SELECTION_CHARS,
    title: tab.title || "未命名网页",
    url: tab.url || info.pageUrl || "",
    createdAt: Date.now(),
    contentType: "text/plain",
    captureType: "selection"
  };
  try {
    await Promise.all([
      chrome.storage.session.set({ [PENDING_SELECTION_KEY]: selection }),
      chrome.sidePanel.open({ tabId: tab.id })
    ]);
  } catch (error) {
    console.error("Unable to open side panel", error);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "capture-visible-text") return false;
  captureVisibleText().then(
    (source) => sendResponse({ ok: true, source }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "读取当前屏幕文字失败。" })
  );
  return true;
});
