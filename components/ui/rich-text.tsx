import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type RichTextProps = {
  content: string;
  dark?: boolean;
  className?: string;
};

export function RichText({ content, dark = true, className }: RichTextProps) {
  return (
    <div
      className={`prose max-w-none whitespace-normal prose-h2:mb-2 prose-h2:mt-4 prose-h2:text-base prose-h2:font-semibold prose-h3:mb-2 prose-h3:mt-3 prose-h3:text-sm prose-h3:font-semibold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-table:my-3 prose-table:w-full prose-th:border prose-th:border-zinc-300 prose-th:bg-zinc-100 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-zinc-300 prose-td:px-2 prose-td:py-1 prose-blockquote:border-l-4 prose-blockquote:border-zinc-300 prose-blockquote:pl-3 prose-blockquote:text-zinc-700 prose-code:rounded prose-code:bg-zinc-200 prose-code:px-1 prose-code:py-0.5 prose-pre:my-3 prose-pre:overflow-x-auto prose-pre:rounded-md prose-pre:bg-zinc-900 prose-pre:p-3 prose-pre:text-zinc-100 prose-a:break-all prose-a:text-blue-600 prose-a:underline ${dark ? "prose-invert dark:prose-th:border-zinc-700 dark:prose-th:bg-zinc-900 dark:prose-td:border-zinc-700 dark:prose-blockquote:border-zinc-600 dark:prose-blockquote:text-zinc-300 dark:prose-code:bg-zinc-700 dark:prose-code:text-zinc-100 dark:prose-a:text-blue-300" : ""} ${className ?? ""}`.trim()}
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
