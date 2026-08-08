import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronDown, Copy, ExternalLink, RefreshCw } from "lucide-react";
import type { ConversationMessage } from "../shared/types";
import styles from "./sidepanel.module.css";

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" className={styles.iconButton} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function safeUrl(url: string): string | undefined {
  try { return ["http:", "https:"].includes(new URL(url).protocol) ? url : undefined; } catch { return undefined; }
}

function displayPageText(text: string, title: string): string {
  const lines = text.split("\\n");
  if (lines.length && lines[0].trim() === title.trim() && title.trim()) return lines.slice(1).join("\\n").replace(/^\\n+/, "");
  return text;
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: Record<string, unknown>;
}

function streamingDeltaPlugin(animateFrom: number) {
  return () => (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || typeof child.value !== "string") {
          visit(child);
          return [child];
        }
        const start = child.position?.start?.offset;
        const end = child.position?.end?.offset;
        if (start === undefined || end === undefined || end <= animateFrom) return [child];
        const wrap = (value: string): MarkdownNode => ({
          type: "strong",
          children: [{ type: "text", value }],
          data: { hName: "span", hProperties: { className: [styles.streamingDelta] } }
        });
        if (start >= animateFrom) return [wrap(child.value)];
        const splitAt = Math.max(0, Math.min(child.value.length, animateFrom - start));
        return splitAt === 0 ? [wrap(child.value)] : [{ ...child, value: child.value.slice(0, splitAt) }, wrap(child.value.slice(splitAt))];
      });
    };
    visit(tree);
  };
}

export function MarkdownMessage({ content, animateFrom }: { content: string; animateFrom?: number }) {
  const previousLength = animateFrom ?? content.length;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, ...(animateFrom === undefined ? [] : [streamingDeltaPlugin(previousLength)])]}
      components={{
        a: ({ href, children }) => {
          const safeHref = href ? safeUrl(href) : undefined;
          return safeHref ? <a href={safeHref} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
        },
        table: ({ children }) => <div className={styles.tableWrap}><table>{children}</table></div>
      }}
    >{content}</ReactMarkdown>
  );
}

export function MessageItem({ message, busy, streaming = false, onRegenerate }: { message: ConversationMessage; busy: boolean; streaming?: boolean; onRegenerate: () => void }) {
  const copy = async () => { await navigator.clipboard.writeText(message.content); };
  const pageContext = message.role === "user" ? message.pageContext : undefined;
  const pageLabel = pageContext?.captureType === "selection" ? "选中文本" : "页面文字";
  const pageUrl = pageContext ? safeUrl(pageContext.url) : undefined;
  const [pageExpanded, setPageExpanded] = useState(false);
  const previousContentLengthRef = useRef(0);
  const animateFrom = streaming ? previousContentLengthRef.current : undefined;
  useEffect(() => { previousContentLengthRef.current = message.content.length; }, [message.content.length]);
  const displayText = pageContext ? displayPageText(pageContext.text, pageContext.title) : "";
  return (
    <article className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`}>
      <header className={styles.messageHeader}>
        <span>{message.role === "user" ? "你" : message.providerName || "AI"}</span>
        <div className={styles.messageActions}>
          <IconButton label="复制内容" onClick={() => void copy()}><Copy size={14} /></IconButton>
          {message.role === "assistant" && <IconButton label="重新生成" onClick={onRegenerate} disabled={busy}><RefreshCw size={14} /></IconButton>}
        </div>
      </header>
      <div className={styles.markdown}>
        {message.role === "assistant" ? <MarkdownMessage content={message.content || "…"} animateFrom={message.content ? animateFrom : undefined} /> : <>
          <p>{message.content}</p>
          {pageContext && <div className={`${styles.pageAttachment} ${pageExpanded ? styles.pageAttachmentExpanded : ""}`}>
            <button className={styles.pageAttachmentSummary} type="button" aria-expanded={pageExpanded} onClick={() => setPageExpanded((expanded) => !expanded)}>
              <span className={styles.pageAttachmentHeading}><span className={styles.pageAttachmentLabel}>{pageLabel}</span><span className={styles.pageAttachmentTitle}>{pageContext.title || "未命名页面"}</span></span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div className={styles.pageAttachmentBody}>
              <p className={styles.pageAttachmentPreview}>{displayText}</p>
              {pageContext.truncated && <span className={styles.pageAttachmentNote}>内容已截取</span>}
              {pageUrl && <a className={styles.pageAttachmentLink} href={pageUrl} target="_blank" rel="noreferrer"><span>打开来源页面</span><ExternalLink size={12} aria-hidden="true" /></a>}
            </div>
          </div>}
        </>}
      </div>
    </article>
  );
}

export function ModelPicker({ providerName, model, models, disabled, onChange }: { providerName: string; model: string; models: string[]; disabled: boolean; onChange: (model: string) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled, model, models, providerName]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
      options[next]?.focus();
    } else if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
  };
  return (
    <div className={styles.modelPicker}>
      <button ref={buttonRef} type="button" className={styles.modelButton} aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (["ArrowDown", "Enter", " "].includes(event.key)) { event.preventDefault(); setOpen(true); queueMicrotask(() => menuRef.current?.querySelector<HTMLButtonElement>("[role=option]")?.focus()); } }}>
        <span className={styles.modelDot} /><span className={styles.modelProvider}>{providerName}</span><span className={styles.modelName}>{model || "未配置模型"}</span><ChevronDown size={14} />
      </button>
      {open && <div ref={menuRef} className={styles.modelMenu} role="listbox" aria-label="可用模型" onKeyDown={onKeyDown}>
        {models.map((item) => <button key={item} type="button" role="option" aria-selected={item === model} disabled={disabled} onClick={() => { if (!disabled) onChange(item); setOpen(false); }}>{item}<Check size={14} className={item === model ? "" : styles.hiddenCheck} /></button>)}
      </div>}
    </div>
  );
}
