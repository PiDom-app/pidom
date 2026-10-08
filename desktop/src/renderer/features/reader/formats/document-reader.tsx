import { useEffect, useState } from 'react';
import { useConvex } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { parseDocument, type ParsedDocument } from './document-adapters';
import { ReaderError, ReaderLoading } from '../components/reader-states';

export function DocumentReader({
  documentId,
  format,
  title,
  onBack,
}: {
  documentId: Id<'documents'>;
  format: string;
  title: string;
  onBack: () => void;
}) {
  const convex = useConvex();
  const [state, setState] = useState<{
    url: string;
    content: ParsedDocument | null;
    error: string | null;
  }>({
    url: '',
    content: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let handle: string | null = null;
    void (async () => {
      try {
        let signedUrl = '';
        try {
          signedUrl =
            (await convex.mutation(api.library.downloadUrl, { documentId, what: 'document' })) ??
            '';
        } catch {
          // A local-only import can still be opened by main without a signed URL.
        }
        const opened = await window.pidom.reader.openDocument({
          documentId,
          signedUrl: signedUrl ?? '',
          documentKind: format,
        });
        handle = opened.handle;
        if (format === 'image') {
          if (!cancelled)
            setState({ url: opened.url, content: { kind: 'text', text: '' }, error: null });
          return;
        }
        const content = await parseDocument(opened.url, format);
        if (!cancelled) setState({ url: opened.url, content, error: null });
      } catch {
        if (!cancelled)
          setState({ url: '', content: null, error: 'This document could not be opened.' });
      }
    })();
    return () => {
      cancelled = true;
      if (handle) void window.pidom.reader.closeDocument(handle);
    };
  }, [convex, documentId, format]);

  if (state.error) return <ReaderError message={state.error} onBack={onBack} />;
  if (!state.content) return <ReaderLoading />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header
        className="flex h-12 shrink-0 items-center gap-3 px-4"
        style={{ borderBottom: '1px solid rgb(var(--border))' }}
      >
        <button onClick={onBack} className="rounded px-2 py-1 text-sm hover:bg-muted">
          Back
        </button>
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="ml-auto text-xs text-muted-foreground uppercase">{format}</span>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        {format === 'image' ? (
          <img
            src={state.url}
            alt={title}
            className="mx-auto max-h-full max-w-full object-contain"
          />
        ) : state.content.kind === 'html' ? (
          <article
            className="prose prose-invert mx-auto max-w-4xl"
            dangerouslySetInnerHTML={{ __html: state.content.html }}
          />
        ) : state.content.kind === 'table' ? (
          <div className="mx-auto max-w-6xl overflow-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {state.content.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) => (
                      <td className="border border-border px-2 py-1 align-top" key={cellIndex}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <pre className="mx-auto max-w-4xl whitespace-pre-wrap font-sans leading-7 text-foreground">
            {state.content.text}
          </pre>
        )}
      </main>
    </div>
  );
}
