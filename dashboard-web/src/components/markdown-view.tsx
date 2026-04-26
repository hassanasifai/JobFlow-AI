'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Render Career-ops evaluation reports — they're just markdown with
 * occasional tables, code, and emphasis. We add GFM (tables, strikethrough,
 * task lists) and use Tailwind's typography utility classes for styling.
 *
 * No external links override — reports may reference internal anchors and
 * external URLs interchangeably; we let the renderer use plain anchors.
 */
export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
