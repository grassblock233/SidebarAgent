export type BuiltinProviderId = "deepseek" | "qwen-cn" | "qwen-intl" | "volcengine";
export type CustomProviderId = `custom:${string}`;
export type ProviderId = BuiltinProviderId | CustomProviderId;

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  baseUrl: string;
  modelsPath: string;
  chatPath: string;
  defaultModel: string;
  supportsModelDiscovery: boolean;
}

export interface ProviderConfig {
  apiKey: string;
  modelSelectionMode: "list" | "manual";
  selectedModel: string;
  manualModel: string;
  availableModels: string[];
  modelsFetchedAt: number | null;
}

export interface CustomProviderConfig extends ProviderConfig {
  type: "custom";
  name: string;
  baseUrl: string;
  modelsPath: string;
  chatPath: string;
  supportsModelDiscovery: boolean;
}

export interface SidebarAgentSettingsV2 {
  version: 2;
  activeProviderId: ProviderId;
  providers: Record<string, ProviderConfig | CustomProviderConfig>;
}

export interface SourceContext {
  id: string;
  text: string;
  originalLength: number;
  truncated: boolean;
  html?: string;
  htmlTruncated?: boolean;
  contentType: "text/plain" | "text/html";
  title: string;
  url: string;
  createdAt: number;
  captureType?: "selection" | "viewport";
}

export type MessageRole = "user" | "assistant";

export interface PageContextSnapshot {
  text: string;
  title: string;
  url: string;
  contentType: "text/plain" | "text/html";
  captureType?: "selection" | "viewport";
  truncated: boolean;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  providerName?: string;
  pageContext?: PageContextSnapshot;
}

export interface ConversationSession {
  source: SourceContext | null;
  messages: ConversationMessage[];
  updatedAt: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type RequestState =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "streaming"; requestId: string; providerName: string }
  | { status: "stopped" }
  | { status: "error"; message: string };

export type CaptureState =
  | { status: "idle" }
  | { status: "requesting-permission" }
  | { status: "capturing" }
  | { status: "error"; message: string };

export type ModelFetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

export type CaptureVisibleTextResponse =
  | { ok: true; source: SourceContext }
  | { ok: false; error: string };
