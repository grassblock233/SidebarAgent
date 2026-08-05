import { DEFAULT_PROVIDER_ID } from "../shared/constants";
import type { CaptureState, ConversationMessage, ProviderId, RequestState, SidebarAgentSettingsV2, SourceContext } from "../shared/types";

export interface SidePanelState {
  source: SourceContext | null;
  messages: ConversationMessage[];
  settings: SidebarAgentSettingsV2 | null;
  sourceExpanded: boolean;
  input: string;
  request: RequestState;
  capture: CaptureState;
  status: string;
  error: string;
  modelSwitching: boolean;
}

export const initialState: SidePanelState = {
  source: null,
  messages: [],
  settings: null,
  sourceExpanded: false,
  input: "",
  request: { status: "idle" },
  capture: { status: "idle" },
  status: "",
  error: "",
  modelSwitching: false
};

export type SidePanelAction =
  | { type: "initialize"; source: SourceContext | null; messages: ConversationMessage[]; settings: SidebarAgentSettingsV2 }
  | { type: "settings"; settings: SidebarAgentSettingsV2 }
  | { type: "source"; source: SourceContext }
  | { type: "clear" }
  | { type: "toggle-source" }
  | { type: "input"; value: string }
  | { type: "messages"; messages: ConversationMessage[] }
  | { type: "append-delta"; id: string; delta: string }
  | { type: "request"; request: RequestState }
  | { type: "capture"; capture: CaptureState }
  | { type: "feedback"; status?: string; error?: string }
  | { type: "model-switching"; value: boolean };

export function sidePanelReducer(state: SidePanelState, action: SidePanelAction): SidePanelState {
  switch (action.type) {
    case "initialize": return { ...state, source: action.source, messages: action.messages, settings: action.settings };
    case "settings": return { ...state, settings: action.settings };
    case "source": return { ...state, source: action.source, messages: [], sourceExpanded: false, input: "", error: "", status: "" };
    case "clear": return { ...initialState, settings: state.settings };
    case "toggle-source": return { ...state, sourceExpanded: !state.sourceExpanded };
    case "input": return { ...state, input: action.value };
    case "messages": return { ...state, messages: action.messages };
    case "append-delta": return { ...state, messages: state.messages.map((message) => message.id === action.id ? { ...message, content: message.content + action.delta } : message) };
    case "request": return { ...state, request: action.request };
    case "capture": return { ...state, capture: action.capture };
    case "feedback": return { ...state, status: action.status ?? "", error: action.error ?? "" };
    case "model-switching": return { ...state, modelSwitching: action.value };
  }
}

export function activeProviderId(state: SidePanelState): ProviderId {
  return state.settings?.activeProviderId ?? DEFAULT_PROVIDER_ID;
}
