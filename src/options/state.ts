import { DEFAULT_PROVIDER_ID } from "../shared/constants";
import { normalizeProviderConfig } from "../shared/storage";
import type { ModelFetchState, ProviderConfig, ProviderId, SidebarAgentSettingsV2 } from "../shared/types";

export interface OptionsState {
  settings: SidebarAgentSettingsV2 | null;
  providerId: ProviderId;
  draft: ProviderConfig;
  validatedFingerprint: string;
  fetchState: ModelFetchState;
  status: string;
  isError: boolean;
}

export const initialOptionsState: OptionsState = {
  settings: null,
  providerId: DEFAULT_PROVIDER_ID,
  draft: normalizeProviderConfig(null, DEFAULT_PROVIDER_ID),
  validatedFingerprint: "",
  fetchState: { status: "idle" },
  status: "",
  isError: false
};

export type OptionsAction =
  | { type: "load"; settings: SidebarAgentSettingsV2; providerId: ProviderId; draft: ProviderConfig; fingerprint: string }
  | { type: "draft"; draft: ProviderConfig; invalidate?: boolean }
  | { type: "fetch"; fetchState: ModelFetchState }
  | { type: "status"; message?: string; error?: boolean }
  | { type: "persisted"; settings: SidebarAgentSettingsV2; draft?: ProviderConfig; fingerprint?: string };

export function optionsReducer(state: OptionsState, action: OptionsAction): OptionsState {
  switch (action.type) {
    case "load": return { ...state, settings: action.settings, providerId: action.providerId, draft: action.draft, validatedFingerprint: action.fingerprint, status: "", isError: false };
    case "draft": return { ...state, draft: action.draft, validatedFingerprint: action.invalidate ? "" : state.validatedFingerprint, status: "", isError: false };
    case "fetch": return { ...state, fetchState: action.fetchState };
    case "status": return { ...state, status: action.message ?? "", isError: action.error ?? false };
    case "persisted": return { ...state, settings: action.settings, draft: action.draft ?? state.draft, validatedFingerprint: action.fingerprint ?? state.validatedFingerprint };
  }
}
