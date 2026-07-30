import {
  MAX_SELECTION_CHARS,
  MENU_ID,
  PENDING_SELECTION_KEY
} from "./shared/constants.js";

async function createContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "用 DeepSeek 分析所选内容",
    contexts: ["selection"]
  });
}

async function enableActionSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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

  const selection = {
    id: crypto.randomUUID(),
    text: normalizedText.slice(0, MAX_SELECTION_CHARS),
    originalLength: normalizedText.length,
    truncated: normalizedText.length > MAX_SELECTION_CHARS,
    title: tab.title || "未命名网页",
    url: tab.url || info.pageUrl || "",
    createdAt: Date.now()
  };

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
