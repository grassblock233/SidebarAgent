import type {
  BuiltinProviderId,
  CustomProviderConfig,
  ProviderConfig,
  ProviderDescriptor,
  ProviderId
} from "./types";

export const BUILTIN_PROVIDERS: Record<BuiltinProviderId, ProviderDescriptor> = {
  deepseek: { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", modelsPath: "/models", chatPath: "/chat/completions", defaultModel: "deepseek-chat", supportsModelDiscovery: true },
  "qwen-cn": { id: "qwen-cn", name: "千问（国内）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelsPath: "/models", chatPath: "/chat/completions", defaultModel: "qwen-plus", supportsModelDiscovery: true },
  "qwen-intl": { id: "qwen-intl", name: "千问（国际）", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", modelsPath: "/models", chatPath: "/chat/completions", defaultModel: "qwen-plus", supportsModelDiscovery: true },
  volcengine: { id: "volcengine", name: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", modelsPath: "/models", chatPath: "/chat/completions", defaultModel: "", supportsModelDiscovery: true }
};

export const BUILTIN_PROVIDER_IDS = Object.keys(BUILTIN_PROVIDERS) as BuiltinProviderId[];

export function isCustomProviderId(providerId: unknown): providerId is `custom:${string}` {
  return typeof providerId === "string" && providerId.startsWith("custom:");
}

export function normalizeApiPath(path: unknown, fallback: string): string {
  const value = typeof path === "string" ? path.trim() : "";
  if (!value) return fallback;
  return value.startsWith("/") ? value : `/${value}`;
}

export function normalizeBaseUrl(baseUrl: unknown): string {
  return typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
}

export function validateCustomBaseUrl(baseUrl: unknown): { valid: true; url: URL } | { valid: false; message: string } {
  let url: URL;
  try {
    url = new URL(normalizeBaseUrl(baseUrl));
  } catch {
    return { valid: false, message: "Base URL 格式不正确。" };
  }
  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    return { valid: false, message: "远程自定义接口必须使用 HTTPS；HTTP 仅允许本机地址。" };
  }
  return { valid: true, url };
}

export function getOriginPattern(baseUrl: string): string {
  const validation = validateCustomBaseUrl(baseUrl);
  return validation.valid ? `${validation.url.protocol}//${validation.url.hostname}/*` : "";
}

export function resolveProvider(providerId: ProviderId, providerConfig?: ProviderConfig | CustomProviderConfig): ProviderDescriptor | null {
  if (providerId in BUILTIN_PROVIDERS) return BUILTIN_PROVIDERS[providerId as BuiltinProviderId];
  if (!isCustomProviderId(providerId) || !providerConfig) return null;
  const custom = providerConfig as CustomProviderConfig;
  const validation = validateCustomBaseUrl(custom.baseUrl);
  if (!validation.valid) return null;
  return {
    id: providerId,
    name: custom.name?.trim() || "自定义提供商",
    baseUrl: normalizeBaseUrl(custom.baseUrl),
    modelsPath: normalizeApiPath(custom.modelsPath, "/models"),
    chatPath: normalizeApiPath(custom.chatPath, "/chat/completions"),
    defaultModel: "",
    supportsModelDiscovery: custom.supportsModelDiscovery !== false
  };
}

export function buildApiUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${normalizeApiPath(path, "")}`;
}
