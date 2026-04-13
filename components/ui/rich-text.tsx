import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type RichTextProps = {
  content: string;
  dark?: boolean;
  className?: string;
};

export function RichText({ content, className }: RichTextProps) {
  return (
    <div
      className={`prose max-w-none whitespace-normal prose-h2:mb-2 prose-h2:mt-4 prose-h2:text-base prose-h2:font-semibold prose-h3:mb-2 prose-h3:mt-3 prose-h3:text-sm prose-h3:font-semibold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-table:my-3 prose-table:w-full prose-th:border prose-th:border-border prose-th:bg-surface-secondary prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-blockquote:border-l-4 prose-blockquote:border-border prose-blockquote:pl-3 prose-blockquote:text-muted prose-code:rounded prose-code:bg-surface-secondary prose-code:px-1 prose-code:py-0.5 prose-pre:my-3 prose-pre:overflow-x-auto prose-pre:rounded-md prose-pre:bg-zinc-900 prose-pre:p-3 prose-pre:text-zinc-100 prose-a:break-all prose-a:text-accent prose-a:underline prose-invert ${className ?? ""}`.trim()}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
