import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';

const paragraphs = [
  ['Welcome to Pidom', true],
  ['Pidom is a privacy-conscious document library and reader for keeping your documents available, searchable, and understandable across devices. This document is included in the desktop app as a practical guide to the product and its editing model.', false],
  ['What Pidom contains', true],
  ['Pidom combines a local-first desktop library, a reader for supported document formats, collections and favorites, reading progress, annotations and bookmarks where supported, offline storage, and Convex synchronization. The desktop app keeps the physical document copy on your computer while the account stores the library metadata and synchronized document copy.', false],
  ['Local-first desktop behavior', true],
  ['Documents imported into the desktop app are validated, copied into Pidom-managed storage, and made available locally before network synchronization finishes. The app can therefore open locally held documents without a connection. Temporary downloads and recovery data are bounded and stored separately from the source document.', false],
  ['Supported document formats', true],
  ['Pidom supports PDF, DOCX, ODT, XLSX, PPTX, TXT, Markdown, CSV, HTML, EPUB, images, and selected legacy formats for reading. Capabilities are format-specific: a reader surface is not automatically an editing promise, and unsupported operations remain clearly marked instead of producing a lossy rewrite.', false],
  ['Editing and safe write-back', true],
  ['Plain text, Markdown, and CSV provide direct editing. Images support rotation and PNG export. PDF editing persists supported page rotation, deletion and reordering, text and visual annotations, and AcroForm values. DOCX, XLSX, PPTX, and ODT support bounded text replacement while preserving untouched archive entries such as media, relationships, styles, formulas, and macro payloads. Existing PDF glyph editing, XFA, and legacy DOC, XLS, and PPT binary write-back remain outside the supported editing contract.', false],
  ['Saving, versions, and recovery', true],
  ['Save writes through an atomic native-file replacement and checks the original content hash first. If another program changed the file, Pidom reports a conflict rather than overwriting it silently. Save As creates a new copy. Text-based editor versions can be stored in Convex with immutable history, idempotent commits, conflict checks, and restore-as-new-version behavior. Local recovery drafts protect unsaved work between launches.', false],
  ['Security and privacy', true],
  ['The renderer does not receive unrestricted Node.js access or filesystem paths. Native file operations run in the Electron main process behind typed, validated IPC. The app uses context isolation, sandboxing, a restrictive content security policy, opaque document handles, owner-checked Convex queries and mutations, and bounded parsers for untrusted files.', false],
  ['Using this guide', true],
  ['You can edit, rename, organize, export, save, remove, or synchronize this document like other documents in your library. Use it as a reference while exploring the desktop app. You may also create your own documents through Import, open files from the operating system, and use Settings to configure appearance, reader behavior, storage, imports, account sync, privacy, shortcuts, and updates.', false],
  ['Pidom desktop', true],
  ['This starter document is generated locally by the desktop app, registered through the normal import and synchronization pipeline, and created only once per account. It is an ordinary DOCX document after creation: it can be edited with the supported Office text-write-back capability, saved safely, exported, or removed from the library.', false],
] as const;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function starterDocumentLocalId(subject: string): string {
  return createHash('sha256').update(`pidom-starter:${subject}`).digest('hex').slice(0, 32);
}

export function starterDocumentBytes(): Uint8Array {
  const body = paragraphs
    .map(
      ([text, heading]) =>
        `<w:p><w:pPr>${heading ? '<w:pStyle w:val="Heading1"/>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join('');
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
      ),
    },
    { level: 0 },
  );
}
