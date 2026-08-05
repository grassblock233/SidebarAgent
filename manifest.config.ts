import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "SidebarAgent",
  version: "0.7.0",
  description: "在浏览网页时，将选中文字发送到 SidebarAgent，并使用所选 AI 提供商进行分析。",
  minimum_chrome_version: "116",
  permissions: ["activeTab", "contextMenus", "sidePanel", "scripting", "storage", "tabs"],
  host_permissions: [
    "https://api.deepseek.com/*",
    "https://dashscope.aliyuncs.com/*",
    "https://dashscope-intl.aliyuncs.com/*",
    "https://ark.cn-beijing.volces.com/*"
  ],
  optional_host_permissions: ["https://*/*", "http://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  action: {
    default_title: "打开 SidebarAgent",
    default_icon: { 16: "assets/icon-16.png", 32: "assets/icon-32.png" }
  },
  icons: {
    16: "assets/icon-16.png",
    32: "assets/icon-32.png",
    48: "assets/icon-48.png",
    128: "assets/icon-128.png"
  },
  side_panel: { default_path: "src/sidepanel/index.html" },
  options_ui: { page: "src/options/index.html", open_in_tab: true }
});
