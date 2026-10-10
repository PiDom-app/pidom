import { useEffect, useMemo, useRef, useState } from 'react';
import { useConvex, useQuery } from 'convex/react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Cloud, Image as ImageIcon, LockKeyhole, RotateCw, Save, Undo2 } from 'lucide-react';
import type { Id } from '@convex/dataModel';
import { api } from '@convex/api';
import {
  parseDocumentBytes,
  serializeCsvRows,
  type ParsedDocument,
} from '@/features/reader/formats/document-adapters';
import { applyOfficeTextReplacements } from '@/features/reader/formats/office-writer';
import { applyPdfEdits } from '@/features/reader/pdf/editor';
import { buttonGhostClass } from '@/lib/ui';

const OFFICE = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp']);
const EDITABLE_BINARY = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'odt']);
const RECOVERY_MAX = 2_000_000;
type EditableFormat = 'txt' | 'md' | 'csv' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'odt';

function asEditableFormat(value: string): EditableFormat | null {
  return value === 'txt' ||
    value === 'md' ||
    value === 'csv' ||
    EDITABLE_BINARY.has(value)
    ? (value as EditableFormat)
    : null;
}

function isOfficeEditable(value: EditableFormat): value is 'docx' | 'odt' | 'xlsx' | 'pptx' {
  return value === 'docx' || value === 'odt' || value === 'xlsx' || value === 'pptx';
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export function DocumentEditor({ documentId }: { documentId: Id<'documents'> }) {
  const convex = useConvex();
  const navigate = useNavigate();
  const meta = useQuery(api.library.document, { documentId });
  const history = useQuery(api.editor.history, { documentId });
  const format = meta?.documentKind ?? 'txt';
  const editableFormat = asEditableFormat(format);
  const editable = editableFormat !== null;
  const [handle, setHandle] = useState<string | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [content, setContent] = useState<ParsedDocument | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [officeSourceText, setOfficeSourceText] = useState('');
  const [pdfAnnotation, setPdfAnnotation] = useState('');
  const [pdfRotation, setPdfRotation] = useState<0 | 90 | 180 | 270>(0);
  const [draft, setDraft] = useState('');
  const [savedDraft, setSavedDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [imageRotation, setImageRotation] = useState(0);
  const [cloudVersion, setCloudVersion] = useState<number | null>(null);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dirty =
    editable &&
    (draft !== savedDraft ||
      imageRotation !== 0 ||
      pdfAnnotation.trim().length > 0 ||
      pdfRotation !== 0);

  useEffect(() => {
    let cancelled = false;
    let openedHandle: string | null = null;
    void (async () => {
      try {
        const signedUrl =
          (await convex.mutation(api.library.downloadUrl, { documentId, what: 'document' })) ?? '';
        const opened = await window.pidom.reader.openDocument({
          documentId,
          signedUrl,
          documentKind: format,
        });
        openedHandle = opened.handle;
        const bytes = new Uint8Array(await (await fetch(opened.url)).arrayBuffer());
        const parsed = parseDocumentBytes(bytes, format);
        if (cancelled) return;
        setHandle(opened.handle);
        setContentHash(opened.contentHash);
        setContent(parsed);
        setSourceBytes(bytes);
        setOfficeSourceText(parsed.kind === 'text' ? parsed.text : '');
        const initial =
          parsed.kind === 'table'
            ? serializeCsvRows(parsed.rows)
            : parsed.kind === 'text'
              ? parsed.text
              : '';
        const stored = await window.pidom.db.editorDraftGet(documentId);
        const recoveredDraft =
          stored?.content && stored.content !== initial && stored.content.length <= RECOVERY_MAX
            ? stored.content
            : null;
        setDraft(recoveredDraft ?? initial);
        setSavedDraft(initial);
        setRecovered(recoveredDraft !== null);
      } catch {
        if (!cancelled) setError('This document could not be opened for editing.');
      }
    })();
    return () => {
      cancelled = true;
      if (openedHandle) void window.pidom.reader.closeDocument(openedHandle);
    };
  }, [convex, documentId, format]);

  useEffect(() => {
    if (!editable || !content || draft === savedDraft) return;
    const timer = window.setTimeout(() => {
      if (draft.length > RECOVERY_MAX) return;
      void window.pidom.db.editorDraftPut(documentId, draft).then(() => setRecovered(true));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [content, documentId, draft, editable, savedDraft]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    setCloudVersion(history?.[0]?.version ?? 0);
  }, [history]);

  const title = meta?.title ?? 'Document';
  const canEdit =
    editable &&
    (format === 'pdf' || content?.kind === 'text' || content?.kind === 'table');
  const canCloudEdit =
    editableFormat === 'txt' || editableFormat === 'md' || editableFormat === 'csv';
  const display = useMemo(() => {
    if (!content) return '';
    if (content.kind === 'table') return content.rows.map((row) => row.join('\t')).join('\n');
    return content.kind === 'text' ? content.text : '';
  }, [content]);

  const saveAs = async () => {
    if (!handle || !canEdit || !sourceBytes || !editableFormat) return;
    const bytes = await editedBytes();
    const baseName =
      title.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 150) ||
      'document';
    const result = await window.pidom.reader.saveAs({
      handle,
      bytes: asArrayBuffer(bytes),
      suggestedName: `${baseName}.${format}`,
      format: editableFormat,
    });
    if (result.saved) {
      setSourceBytes(bytes);
      if (isOfficeEditable(editableFormat)) setOfficeSourceText(draft);
      if (editableFormat === 'pdf') {
        setPdfAnnotation('');
        setPdfRotation(0);
      }
      setSavedDraft(draft);
      setRecovered(false);
      void window.pidom.db.editorDraftDelete(documentId);
    }
  };

  const save = async () => {
    if (!handle || !contentHash || !canEdit || editableFormat === null) return;
    const bytes = await editedBytes();
    const result = await window.pidom.reader.save({
      handle,
      bytes: asArrayBuffer(bytes),
      expectedContentHash: contentHash,
      format: editableFormat,
    });
    if (result.status === 'conflict') {
      setCloudMessage('The local file changed outside Pidom. Use Save As to keep this draft.');
      return;
    }
    setContentHash(result.contentHash);
    setSourceBytes(bytes);
    if (isOfficeEditable(editableFormat)) setOfficeSourceText(draft);
    if (editableFormat === 'pdf') {
      setPdfAnnotation('');
      setPdfRotation(0);
    }
    setSavedDraft(draft);
    setRecovered(false);
    void window.pidom.db.editorDraftDelete(documentId);
  };

  const editedBytes = async (): Promise<Uint8Array> => {
    if (!sourceBytes || !editableFormat) throw new Error('document is not ready to save');
    if (editableFormat === 'pdf') {
      return applyPdfEdits(sourceBytes, {
        pages: pdfRotation ? [{ type: 'rotate', page: 1, degrees: pdfRotation }] : [],
        annotations: pdfAnnotation.trim()
          ? [{ type: 'text', page: 1, x: 36, y: 36, text: pdfAnnotation.trim() }]
          : [],
      });
    }
    if (isOfficeEditable(editableFormat)) {
      return applyOfficeTextReplacements(sourceBytes, editableFormat, [
        { find: officeSourceText, replace: draft },
      ]);
    }
    return new TextEncoder().encode(draft);
  };

  const saveVersion = async () => {
    if (!canEdit || !canCloudEdit || editableFormat === null) return;
    if (editableFormat !== 'txt' && editableFormat !== 'md' && editableFormat !== 'csv') return;
    setCloudMessage(null);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(draft));
    const contentHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const clientCommitId = crypto.randomUUID().replace(/-/g, '');
    try {
      const result = await convex.mutation(api.editor.commit, {
        documentId,
        expectedBaseVersion: cloudVersion ?? 0,
        format: editableFormat,
        content: draft,
        contentHash,
        clientCommitId,
      });
      setCloudVersion(result.version.version);
      setCloudMessage(`Cloud version ${result.version.version} ${result.status === 'duplicate' ? 'already exists' : 'saved'}`);
    } catch (commitError) {
      const code =
        commitError instanceof Error && commitError.message.includes('EDITOR_CONFLICT')
          ? 'A newer cloud version exists. Refresh history before saving again.'
          : 'Cloud save failed; your local draft is still safe.';
      setCloudMessage(code);
    }
  };

  const restoreVersion = async (version: number) => {
    if (!canEdit) return;
    setCloudMessage(null);
    try {
      const result = await convex.mutation(api.editor.restore, {
        documentId,
        sourceVersion: version,
        expectedBaseVersion: cloudVersion ?? 0,
        clientCommitId: crypto.randomUUID().replace(/-/g, ''),
      });
      setDraft(result.version.content);
      setSavedDraft(result.version.content);
      setCloudVersion(result.version.version);
      setCloudMessage(`Restored version ${version} as cloud version ${result.version.version}`);
    } catch {
      setCloudMessage('Restore failed because the cloud version changed. Refresh and try again.');
    }
  };

  const saveImageAs = async () => {
    const image = imageRef.current;
    if (!handle || !image || imageRotation === 0) return;
    const canvas = document.createElement('canvas');
    const quarterTurn = imageRotation % 180 !== 0;
    canvas.width = quarterTurn ? image.naturalHeight : image.naturalWidth;
    canvas.height = quarterTurn ? image.naturalWidth : image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((imageRotation * Math.PI) / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const result = await window.pidom.reader.saveAs({
      handle,
      bytes: (await blob.arrayBuffer()) as ArrayBuffer,
      suggestedName: `${title.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9 ._-]/g, '_') || 'image'}.png`,
      format: 'image',
    });
    if (result.saved) setImageRotation(0);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-fg-muted">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header
        className="flex h-12 shrink-0 items-center gap-2 px-3"
        style={{ borderBottom: '1px solid rgb(var(--border))' }}
      >
        <button
          className={buttonGhostClass}
          onClick={() => {
            if (!dirty || window.confirm('Discard unsaved changes and leave the editor?')) {
              void navigate({ to: '/library' });
            }
          }}
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
        <span className="text-xs uppercase text-fg-muted">{format}</span>
        {dirty && (
          <span className="text-xs text-warn">
            {recovered ? 'Recovery draft' : 'Unsaved'}
          </span>
        )}
        {canEdit && (
          <>
            <button
              className={buttonGhostClass}
              disabled={!dirty}
              onClick={() => {
                setDraft(savedDraft);
                setPdfAnnotation('');
                setPdfRotation(0);
                setRecovered(false);
                void window.pidom.db.editorDraftDelete(documentId);
              }}
            >
              <Undo2 className="size-4" />
              Revert
            </button>
            <button className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40" disabled={!dirty} onClick={() => void saveAs()}>
              <Save className="size-4" />
              Save As
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-40"
              disabled={!dirty || !contentHash}
              onClick={() => void save()}
            >
              <Save className="size-4" />
              Save
            </button>
            {canCloudEdit && <button
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-40"
              disabled={!dirty || draft.length > 750_000}
              onClick={() => void saveVersion()}
              title={draft.length > 750_000 ? 'Cloud snapshots are limited to 750,000 characters' : undefined}
            >
              <Cloud className="size-4" />
              Save version
            </button>}
          </>
        )}
        {cloudMessage && (
          <span className="max-w-72 truncate text-xs text-fg-muted" aria-live="polite">
            {cloudMessage}
          </span>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        {canEdit && format === 'pdf' ? (
          <div className="mx-auto flex max-w-2xl flex-col gap-4 rounded-md border border-border bg-elevated p-6">
            <div>
              <h1 className="text-sm font-semibold text-foreground">Edit PDF</h1>
              <p className="mt-1 text-sm leading-6 text-fg-muted">
                Add a persisted text annotation or rotate the first page. Existing PDF glyphs and XFA remain unchanged.
              </p>
            </div>
            <label className="text-sm text-foreground">
              Text annotation
              <textarea
                className="mt-2 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
                value={pdfAnnotation}
                onChange={(event) => setPdfAnnotation(event.target.value)}
                placeholder="Add a note to page 1"
              />
            </label>
            <label className="text-sm text-foreground">
              First page rotation
              <select
                className="mt-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={pdfRotation}
                onChange={(event) => setPdfRotation(Number(event.target.value) as 0 | 90 | 180 | 270)}
              >
                <option value={0}>No rotation</option>
                <option value={90}>90 degrees</option>
                <option value={180}>180 degrees</option>
                <option value={270}>270 degrees</option>
              </select>
            </label>
          </div>
        ) : canEdit ? (
          <textarea
            className="mx-auto block min-h-[calc(100vh-10rem)] w-full max-w-5xl resize-none rounded-md border border-border bg-elevated p-6 font-mono text-sm leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={format !== 'csv'}
            aria-label={`Edit ${title}`}
          />
        ) : OFFICE.has(format) ? (
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-md border border-border bg-elevated p-8 text-center">
            <LockKeyhole className="size-5 text-fg-muted" />
            <h1 className="text-sm font-semibold text-foreground">Office editing is not enabled</h1>
            <p className="text-sm leading-6 text-fg-muted">
              This editor can preserve selected text changes while keeping the rest of the Office package intact.
            </p>
          </div>
        ) : format === 'image' ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                className={buttonGhostClass}
                onClick={() => setImageRotation((value) => (value + 90) % 360)}
              >
                <RotateCw className="size-4" />
                Rotate
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                disabled={imageRotation === 0}
                onClick={() => void saveImageAs()}
              >
                <Save className="size-4" />
                Export PNG
              </button>
            </div>
            <img
              ref={imageRef}
              src={handle ? `pidom-doc://${handle}/document` : undefined}
              alt={title}
              className="max-h-[calc(100vh-10rem)] max-w-full object-contain"
              style={{ transform: `rotate(${imageRotation}deg)` }}
            />
            <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
              <ImageIcon className="size-4" />
              Rotate creates a new PNG; the original image is preserved.
            </span>
          </div>
        ) : (
          <pre className="mx-auto max-w-4xl whitespace-pre-wrap text-sm leading-7 text-fg-muted">{display || 'This format is currently read-only.'}</pre>
        )}
        {canEdit && history && history.length > 0 && (
          <section className="mx-auto mt-6 max-w-5xl rounded-md border border-border bg-elevated p-4" aria-labelledby="editor-history-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="editor-history-heading" className="text-sm font-semibold text-foreground">
                Cloud versions
              </h2>
              <span className="text-xs text-fg-muted">Current: v{cloudVersion ?? 0}</span>
            </div>
            <div className="space-y-2">
              {history.map((version) => (
                <div key={version.id} className="flex items-center gap-3 text-xs">
                  <span className="w-12 font-medium text-foreground">v{version.version}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-muted">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(version.createdAt)}
                  </span>
                  <button
                    className={buttonGhostClass}
                    disabled={version.version === cloudVersion || dirty}
                    onClick={() => void restoreVersion(version.version)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
