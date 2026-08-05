import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import type { ConversationMessage } from "../shared/types";
import styles from "./sidepanel.module.css";

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" className={styles.iconButton} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function safeUrl(url: string): string | undefined {
  try { return ["http:", "https:"].includes(new URL(url).protocol) ? url : undefined; } catch { return undefined; }
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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

export function MessageItem({ message, busy, onRegenerate, onCopied }: { message: ConversationMessage; busy: boolean; onRegenerate: () => void; onCopied: () => void }) {
  const copy = async () => { await navigator.clipboard.writeText(message.content); onCopied(); };
  return (
    <article className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`}>
      <header className={styles.messageHeader}>
        <span>{message.role === "user" ? "你" : message.providerName || "AI"}</span>
        <div className={styles.messageActions}>
          <IconButton label="复制内容" onClick={() => void copy()}><Copy size={14} /></IconButton>
          {message.role === "assistant" && <IconButton label="重新生成" onClick={onRegenerate} disabled={busy}><RefreshCw size={14} /></IconButton>}
        </div>
      </header>
      <div className={styles.markdown}>{message.role === "assistant" ? <MarkdownMessage content={message.content || "…"} /> : <p>{message.content}</p>}</div>
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
