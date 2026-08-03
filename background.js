// MV3 service worker: owns context-menu setup, side-panel opening and privileged
// page-script injection. API keys and captured page content are never logged here.
import {
  MAX_SELECTION_CHARS,
  MENU_ID,
  PENDING_SELECTION_KEY
} from "./shared/constants.js";

async function createContextMenu() {
  // Rebuild instead of appending so extension updates cannot leave duplicate entries.
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "用 SidebarAgent 分析所选内容",
    contexts: ["selection"]
  });
}

async function enableActionSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function captureVisibleText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("无法确定当前网页。");
  if (tab.url && !/^(https?|file):/i.test(tab.url)) {
    throw new Error("当前浏览器页面不允许读取文字，请切换到普通网页。");
  }

  // Script injection is kept behind a user action and a site-specific permission.
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/visible-text.js"]
  });
  const source = injection?.result;
  if (!source?.text) throw new Error("当前屏幕没有可读取的网页文字。");
  return source;
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu().catch(console.error);
  enableActionSidePanel().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu().catch(console.error);
  enableActionSidePanel().catch(console.error);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText || !tab?.id) return;

  const normalizedText = info.selectionText.trim();
  if (!normalizedText) return;

  // Store only the bounded text and enough origin metadata to reconstruct context.
  const selection = {
    id: crypto.randomUUID(),
    text: normalizedText.slice(0, MAX_SELECTION_CHARS),
    originalLength: normalizedText.length,
    truncated: normalizedText.length > MAX_SELECTION_CHARS,
    title: tab.title || "未命名网页",
    url: tab.url || info.pageUrl || "",
    createdAt: Date.now(),
    contentType: "text/plain"
  };

  // Opening the panel and persisting the selection can proceed independently.
  const storeSelection = chrome.storage.session.set({ [PENDING_SELECTION_KEY]: selection });
  try {
    await Promise.all([
      storeSelection,
      chrome.sidePanel.open({ tabId: tab.id })
    ]);
  } catch (error) {
    console.error("Unable to open side panel", error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "capture-visible-text") return false;
  captureVisibleText().then(
    (source) => sendResponse({ ok: true, source }),
    (error) => sendResponse({ ok: false, error: error.message || "读取当前屏幕文字失败。" })
  );
  // Returning true keeps the response channel open for the async capture result.
  return true;
});
