"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function AssistantMarkdown({ text, streaming, onNavigate }: { text: string; streaming?: boolean; onNavigate: () => void }) {
  return <div className={cn("assistant-markdown min-w-0 text-sm leading-7", streaming && "is-streaming")}>
    <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
      // Recipe imagery belongs to the recipe UI. Do not automatically load
      // arbitrary remote images included in a model response.
      img: () => null,
      a: ({ href, children }) => {
        if (!href) return <span>{children}</span>;
        return href.startsWith("/") && !href.startsWith("//")
          ? <Link href={href} onClick={onNavigate}>{children}</Link>
          : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
      },
      ul: ({ children }) => <CopyableList ordered={false}>{children}</CopyableList>,
      ol: ({ children, start }) => <CopyableList ordered start={start}>{children}</CopyableList>,
      table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto rounded-xl border"><table>{children}</table></div>,
    }}>{text}</Markdown>
  </div>;
}

/** Lists (shopping lists, prep lists) copy on their own as plain lines. */
function CopyableList({ ordered, start, children }: { ordered: boolean; start?: number; children: React.ReactNode }) {
  const list = useRef<HTMLUListElement & HTMLOListElement>(null), [copied, setCopied] = useState(false);
  const items = Array.isArray(children) ? children.filter((child) => typeof child === "object" && child).length : 1;
  const Tag = ordered ? "ol" : "ul";
  if (items < 3) return <Tag ref={list} start={start}>{children}</Tag>;
  return <div className="group/list relative">
    <Tag ref={list} start={start}>{children}</Tag>
    <button type="button" aria-label={copied ? "List copied" : "Copy list"} title="Copy list" className="-mt-1 mb-1 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={async () => {
      const lines = Array.from(list.current?.children ?? []).map((item, index) => {
        const text = (item as HTMLElement).innerText.replace(/\s*\n\s*/g, " ").trim();
        const box = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
        return `${box ? (box.checked ? "- [x] " : "- [ ] ") : ordered ? `${(start ?? 1) + index}. ` : "- "}${text}`;
      });
      try { await navigator.clipboard.writeText(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      catch { /* The list stays selectable. */ }
    }}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy list"}</button>
  </div>;
}
