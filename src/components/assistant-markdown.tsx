import Link from "next/link";
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
      table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto rounded-xl border"><table>{children}</table></div>,
    }}>{text}</Markdown>
  </div>;
}
