// @vitest-environment node
import { expect, it } from "vitest";
import manifest from "../../manifest.config";

it("preserves the MV3 permission and entry-point contract", () => {
  const value = manifest as unknown as chrome.runtime.Manifest;
  expect(value.manifest_version).toBe(3);
  expect(value.version).toBe("0.7.0");
  expect(value.permissions).toEqual(["activeTab", "contextMenus", "sidePanel", "scripting", "storage", "tabs"]);
  expect(value.background).toEqual({ service_worker: "src/background/index.ts", type: "module" });
  expect(value.side_panel).toEqual({ default_path: "src/sidepanel/index.html" });
  expect(value.options_ui).toEqual({ page: "src/options/index.html", open_in_tab: true });
});
