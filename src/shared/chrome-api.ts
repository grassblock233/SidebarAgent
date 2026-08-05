import type { CaptureVisibleTextResponse } from "./types";

export async function openOptionsPage(): Promise<void> {
  await chrome.runtime.openOptionsPage();
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

export async function requestOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [origin] });
}

export async function removeOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.remove({ origins: [origin] });
}

export async function requestVisibleText(): Promise<CaptureVisibleTextResponse> {
  return chrome.runtime.sendMessage({ type: "capture-visible-text" }) as Promise<CaptureVisibleTextResponse>;
}
