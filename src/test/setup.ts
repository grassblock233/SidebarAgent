import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

function storageArea(store: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, store[key]]));
    }),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(store, values); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; })
  };
}

export const chromeTestState = { localStore, sessionStore };

vi.stubGlobal("chrome", {
  storage: {
    local: storageArea(localStore),
    session: storageArea(sessionStore),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
  },
  runtime: { openOptionsPage: vi.fn(async () => undefined), sendMessage: vi.fn(), onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() } },
  tabs: { query: vi.fn(async () => [{ id: 1, url: "https://example.com/page", title: "Example" }]) },
  permissions: { request: vi.fn(async () => true), remove: vi.fn(async () => true) },
  contextMenus: { removeAll: vi.fn(async () => undefined), create: vi.fn(), onClicked: { addListener: vi.fn() } },
  sidePanel: { setPanelBehavior: vi.fn(async () => undefined), open: vi.fn(async () => undefined) },
  scripting: { executeScript: vi.fn() }
});
