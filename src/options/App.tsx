import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Check, CircleAlert, Eye, EyeOff, KeyRound, Link2, LoaderCircle, Plus, RefreshCw, Save, Server, Trash2 } from "lucide-react";
import { removeOriginPermission, requestOriginPermission } from "../shared/chrome-api";
import { DEFAULT_PROVIDER_ID, MODEL_FETCH_TIMEOUT_MS } from "../shared/constants";
import { fetchModels } from "../shared/openai-client";
import { BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDERS, getOriginPattern, isCustomProviderId, resolveProvider } from "../shared/providers";
import { getSettings, isProviderConfigurationValid, normalizeProviderConfig, normalizeSettings, saveSettings } from "../shared/storage";
import type { CustomProviderConfig, ProviderConfig, ProviderId, SidebarAgentSettingsV2 } from "../shared/types";
import { initialOptionsState, optionsReducer } from "./state";
import styles from "./options.module.css";

function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }

export default function App() {
  const [state, dispatch] = useReducer(optionsReducer, initialOptionsState);
  const [showKey, setShowKey] = useState(false);
  const abortRef = useRef<{ controller: AbortController; reason: string } | null>(null);

  const fingerprint = (config: ProviderConfig, providerId = state.providerId): string => {
    const provider = resolveProvider(providerId, config);
    return provider ? [config.apiKey, provider.baseUrl, provider.modelsPath].join("\n") : "";
  };

  const loadProvider = (settings: SidebarAgentSettingsV2, providerId: ProviderId) => {
    const draft = normalizeProviderConfig(settings.providers[providerId], providerId);
    dispatch({ type: "load", settings, providerId, draft, fingerprint: draft.availableModels.length ? fingerprint(draft, providerId) : "" });
    setShowKey(false);
  };

  useEffect(() => {
    getSettings().then((loadedSettings) => {
      const providerId = loadedSettings.activeProviderId;
      const draft = normalizeProviderConfig(loadedSettings.providers[providerId], providerId);
      const descriptor = resolveProvider(providerId, draft);
      const savedFingerprint = draft.availableModels.length && descriptor ? [draft.apiKey, descriptor.baseUrl, descriptor.modelsPath].join("\n") : "";
      dispatch({ type: "load", settings: loadedSettings, providerId, draft, fingerprint: savedFingerprint });
    }).catch((error: unknown) => dispatch({ type: "status", message: `设置加载失败：${message(error, "未知错误")}`, error: true }));
    return () => abortRef.current?.controller.abort();
  }, []);

  const settings = state.settings;
  const custom = isCustomProviderId(state.providerId);
  const customDraft = state.draft as CustomProviderConfig;
  const provider = resolveProvider(state.providerId, state.draft);
  const busy = state.fetchState.status === "loading";
  const listTrusted = Boolean(state.draft.availableModels.length && state.validatedFingerprint === fingerprint(state.draft));
  const manual = state.draft.modelSelectionMode === "manual";
  const valid = isProviderConfigurationValid(state.draft, state.providerId) && (manual || listTrusted);
  const active = settings?.activeProviderId === state.providerId;

  const update = (values: Partial<ProviderConfig & CustomProviderConfig>, invalidate = false) => {
    dispatch({ type: "draft", draft: normalizeProviderConfig({ ...state.draft, ...values }, state.providerId), invalidate });
  };

  const providerEntries = useMemo(() => {
    if (!settings) return [];
    return Object.keys(settings.providers).filter(isCustomProviderId).map((id) => ({ id: id as ProviderId, name: (settings.providers[id] as CustomProviderConfig).name || "未命名提供商" }));
  }, [settings]);

  const ensurePermission = async (config: ProviderConfig): Promise<boolean> => {
    if (!isCustomProviderId(state.providerId)) return true;
    const origin = getOriginPattern((config as CustomProviderConfig).baseUrl);
    return Boolean(origin && await requestOriginPermission(origin));
  };

  const persist = async (activate = false) => {
    if (!settings || !valid || !provider) { dispatch({ type: "status", message: "请完成连接配置并选择或填写有效模型。", error: true }); return; }
    if (!await ensurePermission(state.draft)) { dispatch({ type: "status", message: "未获得自定义接口域名的访问权限。", error: true }); return; }
    const next = normalizeSettings({ ...settings, activeProviderId: activate ? state.providerId : settings.activeProviderId, providers: { ...settings.providers, [state.providerId]: state.draft } });
    await saveSettings(next);
    dispatch({ type: "persisted", settings: next });
    dispatch({ type: "status", message: activate ? `${provider.name}已设为当前提供商。` : `${provider.name}配置已保存。` });
  };

  const handleFetch = async () => {
    if (abortRef.current) { abortRef.current.reason = "user"; abortRef.current.controller.abort(); return; }
    if (!provider || !state.draft.apiKey) { dispatch({ type: "status", message: "请先填写有效的接口地址和 API Key。", error: true }); return; }
    if (!await ensurePermission(state.draft)) { dispatch({ type: "status", message: "未获得自定义接口域名的访问权限。", error: true }); return; }
    const controller = new AbortController();
    abortRef.current = { controller, reason: "" };
    dispatch({ type: "fetch", fetchState: { status: "loading" } });
    dispatch({ type: "status", message: `正在从${provider.name}获取模型…` });
    const timer = window.setTimeout(() => { if (abortRef.current) { abortRef.current.reason = "timeout"; controller.abort(); } }, MODEL_FETCH_TIMEOUT_MS);
    try {
      const models = await fetchModels({ provider, apiKey: state.draft.apiKey, signal: controller.signal });
      const missing = Boolean(state.draft.selectedModel && !models.includes(state.draft.selectedModel));
      const selectedModel = models.includes(state.draft.selectedModel) ? state.draft.selectedModel : !missing && models.includes(provider.defaultModel) ? provider.defaultModel : "";
      const draft = normalizeProviderConfig({ ...state.draft, availableModels: models, selectedModel, modelsFetchedAt: Date.now() }, state.providerId);
      dispatch({ type: "draft", draft });
      dispatch({ type: "persisted", settings: settings!, draft, fingerprint: fingerprint(draft) });
      dispatch({ type: "status", message: missing ? `原模型 ${state.draft.selectedModel} 已不可用，请重新选择。` : `已获取 ${models.length} 个${provider.name}模型。`, error: missing });
    } catch (error) {
      const reason = abortRef.current?.reason;
      dispatch({ type: "status", message: error instanceof DOMException && error.name === "AbortError" ? (reason === "timeout" ? "获取模型列表超时，可以改用手动模型。" : "已取消获取模型列表。") : `${message(error, "获取模型失败。")} 可以改用手动模型。`, error: reason === "timeout" || !(error instanceof DOMException && error.name === "AbortError") });
    } finally { window.clearTimeout(timer); abortRef.current = null; dispatch({ type: "fetch", fetchState: { status: "idle" } }); }
  };

  const addProvider = async () => {
    if (!settings) return;
    const id = `custom:${crypto.randomUUID()}` as const;
    const draft = normalizeProviderConfig({ type: "custom", name: "新自定义提供商", baseUrl: "", modelsPath: "/models", chatPath: "/chat/completions", supportsModelDiscovery: true, modelSelectionMode: "list" }, id);
    const next = normalizeSettings({ ...settings, providers: { ...settings.providers, [id]: draft } });
    await saveSettings(next);
    loadProvider(next, id);
  };

  const deleteProvider = async () => {
    if (!settings || !isCustomProviderId(state.providerId)) return;
    const origin = getOriginPattern(customDraft.baseUrl);
    const providers = { ...settings.providers };
    delete providers[state.providerId];
    const next = normalizeSettings({ ...settings, providers, activeProviderId: settings.activeProviderId === state.providerId ? DEFAULT_PROVIDER_ID : settings.activeProviderId });
    await saveSettings(next);
    if (origin && !Object.entries(next.providers).some(([id, config]) => isCustomProviderId(id) && getOriginPattern((config as CustomProviderConfig).baseUrl) === origin)) await removeOriginPermission(origin);
    loadProvider(next, next.activeProviderId);
    dispatch({ type: "status", message: "自定义提供商已删除。" });
  };

  const clearProvider = async () => {
    if (!settings) return;
    const cleared = normalizeProviderConfig(custom ? { type: "custom", name: customDraft.name, baseUrl: customDraft.baseUrl, modelsPath: customDraft.modelsPath, chatPath: customDraft.chatPath, supportsModelDiscovery: customDraft.supportsModelDiscovery } : null, state.providerId);
    const next = normalizeSettings({ ...settings, providers: { ...settings.providers, [state.providerId]: cleared } });
    await saveSettings(next);
    loadProvider(next, state.providerId);
    dispatch({ type: "status", message: "当前提供商的 API Key 和模型配置已清除。" });
  };

  if (!settings) return <main className={styles.loading}><LoaderCircle className={styles.spin} /><span>正在加载设置</span></main>;

  return <div className={styles.page}>
    <header className={styles.header}><div className={styles.brand}><img src="/assets/icon-48.png" alt="" /><div><h1>SidebarAgent</h1><p>连接与模型设置</p></div></div><a href="https://github.com/olu-py/SidebarAgent" target="_blank" rel="noreferrer">项目主页</a></header>
    <div className={styles.workspace}>
      <aside className={styles.providers} aria-label="AI 提供商">
        <div className={styles.asideTitle}><span>AI 提供商</span><button type="button" title="添加自定义提供商" aria-label="添加自定义提供商" onClick={() => void addProvider()}><Plus size={16} /></button></div>
        <nav>{BUILTIN_PROVIDER_IDS.map((id) => <button key={id} className={state.providerId === id ? styles.selectedProvider : ""} onClick={() => loadProvider(settings, id)}><Server size={15} /><span>{BUILTIN_PROVIDERS[id].name}</span>{settings.activeProviderId === id && <Check size={14} />}</button>)}
          {providerEntries.map((item) => <button key={item.id} className={state.providerId === item.id ? styles.selectedProvider : ""} onClick={() => loadProvider(settings, item.id)}><Link2 size={15} /><span>{item.name}</span>{settings.activeProviderId === item.id && <Check size={14} />}</button>)}</nav>
      </aside>
      <main className={styles.editor}>
        <div className={styles.editorHeader}><div><div className={styles.titleRow}><h2>{provider?.name || (custom ? customDraft.name || "自定义提供商" : "提供商设置")}</h2>{active && <span>当前使用</span>}</div><p>{provider ? `${provider.baseUrl}${provider.chatPath}` : "请填写有效的连接地址"}</p></div>{custom && <button className={styles.dangerIcon} title="删除自定义提供商" aria-label="删除自定义提供商" onClick={() => void deleteProvider()}><Trash2 size={17} /></button>}</div>
        <form onSubmit={(event) => { event.preventDefault(); void persist(false); }}>
          {custom && <section className={styles.section}><div className={styles.sectionIntro}><Link2 size={18} /><div><h3>连接配置</h3><p>OpenAI Chat Completions 兼容接口</p></div></div><div className={styles.fields}>
            <label>提供商名称<input value={customDraft.name} maxLength={60} onChange={(event) => update({ name: event.target.value })} /></label>
            <label>Base URL<input type="url" value={customDraft.baseUrl} placeholder="https://example.com/v1" onChange={(event) => update({ baseUrl: event.target.value }, true)} /></label>
            <div className={styles.fieldGrid}><label>Models Path<input value={customDraft.modelsPath} onChange={(event) => update({ modelsPath: event.target.value }, true)} /></label><label>Chat Path<input value={customDraft.chatPath} onChange={(event) => update({ chatPath: event.target.value })} /></label></div>
            <label className={styles.checkRow}><input type="checkbox" checked={customDraft.supportsModelDiscovery} onChange={(event) => update({ supportsModelDiscovery: event.target.checked, modelSelectionMode: event.target.checked ? state.draft.modelSelectionMode : "manual" }, true)} />接口支持获取模型列表</label>
          </div></section>}
          <section className={styles.section}><div className={styles.sectionIntro}><KeyRound size={18} /><div><h3>访问凭据</h3><p>密钥仅保存在当前浏览器</p></div></div><div className={styles.fields}><label>API Key<div className={styles.password}><input type={showKey ? "text" : "password"} value={state.draft.apiKey} autoComplete="off" onChange={(event) => update({ apiKey: event.target.value }, true)} /><button type="button" title={showKey ? "隐藏 API Key" : "显示 API Key"} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><p className={styles.note}>API Key 不会写入项目文件或发送给其他服务。</p></div></section>
          <section className={styles.section}><div className={styles.sectionIntro}><Server size={18} /><div><h3>模型</h3><p>侧边栏下一次请求使用的模型</p></div></div><div className={styles.fields}>
            <label className={styles.checkRow}><input type="checkbox" checked={manual} disabled={busy || provider?.supportsModelDiscovery === false} onChange={(event) => update({ modelSelectionMode: event.target.checked ? "manual" : "list" })} />手动输入模型</label>
            {manual ? <label>模型 ID<input value={state.draft.manualModel} placeholder={state.providerId === "volcengine" ? "模型 ID 或推理接入点 ID" : "模型 ID"} onChange={(event) => update({ manualModel: event.target.value })} /></label> : <div className={styles.modelRow}><label>当前模型<select value={state.draft.selectedModel} disabled={busy || !listTrusted} onChange={(event) => update({ selectedModel: event.target.value })}><option value="">请选择模型</option>{state.draft.availableModels.map((model) => <option key={model}>{model}</option>)}</select></label><button type="button" className={styles.secondary} disabled={!busy && (!provider || !state.draft.apiKey)} onClick={() => void handleFetch()}>{busy ? <><LoaderCircle className={styles.spin} size={16} />取消获取</> : <><RefreshCw size={16} />{state.draft.availableModels.length ? "刷新模型" : "获取模型"}</>}</button></div>}
            <p className={styles.note}>{manual ? "手动模型不会通过模型列表验证。" : !state.draft.apiKey ? "填写 API Key 后获取模型列表。" : !listTrusted ? "连接配置已变化，请重新获取模型列表。" : `已缓存 ${state.draft.availableModels.length} 个模型${state.draft.modelsFetchedAt ? ` · ${new Date(state.draft.modelsFetchedAt).toLocaleString("zh-CN")}` : ""}`}</p>
          </div></section>
          <footer className={styles.actions}><div><button className={styles.primary} type="submit" disabled={busy || !valid}><Save size={16} />保存配置</button><button className={styles.secondary} type="button" disabled={busy || !valid || active} onClick={() => void persist(true)}><Check size={16} />{active ? "当前提供商" : "设为当前"}</button></div><button className={styles.danger} type="button" disabled={busy} onClick={() => void clearProvider()}><Trash2 size={16} />清除配置</button></footer>
          <div className={`${styles.status} ${state.isError ? styles.statusError : ""}`} role="status" aria-live="polite">{state.status && (state.isError ? <CircleAlert size={15} /> : <Check size={15} />)}<span>{state.status}</span></div>
        </form>
      </main>
    </div>
  </div>;
}
