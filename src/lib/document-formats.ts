/**
 * The format vocabulary shared by import, metadata, and future renderers.
 *
 * This is deliberately capability-based. A file extension is useful for
 * presentation, but it is not a promise that every platform can render or
 * edit the format with PDF semantics.
 */
export type DocumentFormat =
  | 'pdf'
  | 'doc'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'epub'
  | 'md'
  | 'txt'
  | 'html'
  | 'csv'
  | 'xls'
  | 'xlsx'
  | 'ppt'
  | 'pptx'
  | 'image'
  | 'unknown';

export type DocumentCapabilities = {
  format: DocumentFormat;
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  /** The desktop reader adapter selected for this format. */
  renderer: 'pdf' | 'reflow' | 'structured' | 'slides' | 'image';
  /** MIME sent by the desktop document protocol and used by the browser surface. */
  contentType: string;
  /** Active-content policy applied before rendering untrusted bytes. */
  security: 'pdf' | 'plain-text' | 'sanitized-html' | 'archive' | 'image';
  reflowable: boolean;
  preservesPageLayout: boolean;
  searchable: boolean;
  editable: boolean;
};

const FORMATS: readonly DocumentCapabilities[] = [
  {
    format: 'pdf',
    label: 'PDF',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    renderer: 'pdf',
    contentType: 'application/pdf',
    security: 'pdf',
    reflowable: false,
    preservesPageLayout: true,
    searchable: true,
    editable: false,
  },
  {
    format: 'doc',
    label: 'Word document',
    extensions: ['doc'],
    mimeTypes: ['application/msword'],
    renderer: 'reflow',
    contentType: 'application/msword',
    security: 'archive',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'docx',
    label: 'Word document',
    extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    renderer: 'reflow',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    security: 'archive',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'odt',
    label: 'OpenDocument text',
    extensions: ['odt'],
    mimeTypes: ['application/vnd.oasis.opendocument.text'],
    renderer: 'reflow',
    contentType: 'application/vnd.oasis.opendocument.text',
    security: 'archive',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'rtf',
    label: 'Rich text',
    extensions: ['rtf'],
    mimeTypes: ['application/rtf', 'text/rtf'],
    renderer: 'reflow',
    contentType: 'application/rtf',
    security: 'plain-text',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'epub',
    label: 'EPUB',
    extensions: ['epub'],
    mimeTypes: ['application/epub+zip'],
    renderer: 'reflow',
    contentType: 'application/epub+zip',
    security: 'archive',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'md',
    label: 'Markdown',
    extensions: ['md', 'markdown'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    renderer: 'reflow',
    contentType: 'text/markdown',
    security: 'sanitized-html',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'txt',
    label: 'Text document',
    extensions: ['txt', 'text', 'log'],
    mimeTypes: ['text/plain'],
    renderer: 'reflow',
    contentType: 'text/plain',
    security: 'plain-text',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'html',
    label: 'HTML document',
    extensions: ['html', 'htm'],
    mimeTypes: ['text/html', 'application/xhtml+xml'],
    renderer: 'reflow',
    contentType: 'text/html',
    security: 'sanitized-html',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'csv',
    label: 'CSV spreadsheet',
    extensions: ['csv'],
    mimeTypes: ['text/csv'],
    renderer: 'structured',
    contentType: 'text/csv',
    security: 'plain-text',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'xls',
    label: 'Excel spreadsheet',
    extensions: ['xls'],
    mimeTypes: ['application/vnd.ms-excel'],
    renderer: 'structured',
    contentType: 'application/vnd.ms-excel',
    security: 'archive',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'xlsx',
    label: 'Excel spreadsheet',
    extensions: ['xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    renderer: 'structured',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    security: 'archive',
    reflowable: true,
    preservesPageLayout: false,
    searchable: true,
    editable: false,
  },
  {
    format: 'ppt',
    label: 'PowerPoint presentation',
    extensions: ['ppt'],
    mimeTypes: ['application/vnd.ms-powerpoint'],
    renderer: 'slides',
    contentType: 'application/vnd.ms-powerpoint',
    security: 'archive',
    reflowable: false,
    preservesPageLayout: true,
    searchable: true,
    editable: false,
  },
  {
    format: 'pptx',
    label: 'PowerPoint presentation',
    extensions: ['pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    renderer: 'slides',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    security: 'archive',
    reflowable: false,
    preservesPageLayout: true,
    searchable: true,
    editable: false,
  },
  {
    format: 'image',
    label: 'Image',
    extensions: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'],
    mimeTypes: ['image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'],
    renderer: 'image',
    contentType: 'image/*',
    security: 'image',
    reflowable: false,
    preservesPageLayout: true,
    searchable: false,
    editable: false,
  },
];

const byExtension = new Map(
  FORMATS.flatMap((entry) => entry.extensions.map((extension) => [extension, entry] as const)),
);
const byMime = new Map(
  FORMATS.flatMap((entry) => entry.mimeTypes.map((mime) => [mime, entry] as const)),
);

export function documentFormats(): readonly DocumentCapabilities[] {
  return FORMATS;
}

export function formatFromFilename(filename: string): DocumentCapabilities {
  const extension = filename.trim().toLowerCase().split('.').pop() ?? '';
  return byExtension.get(extension) ?? unknownFormat();
}

export function formatFromMimeType(mimeType: string | null | undefined): DocumentCapabilities {
  return byMime.get((mimeType ?? '').toLowerCase()) ?? unknownFormat();
}

export function detectDocumentFormat(
  filename: string,
  mimeType: string | null | undefined,
): DocumentCapabilities {
  const byType = formatFromMimeType(mimeType);
  return byType.format !== 'unknown' ? byType : formatFromFilename(filename);
}

export function unknownFormat(): DocumentCapabilities {
  return {
    format: 'unknown',
    label: 'Document',
    extensions: [],
    mimeTypes: [],
    renderer: 'reflow',
    contentType: 'application/octet-stream',
    security: 'plain-text',
    reflowable: true,
    preservesPageLayout: false,
    searchable: false,
    editable: false,
  };
}

export function isSupportedDocument(filename: string, mimeType?: string | null): boolean {
  return detectDocumentFormat(filename, mimeType).format !== 'unknown';
}

/** Cheap signature checks used before any parser receives untrusted bytes. */
export function hasRecognizedSignature(format: DocumentFormat, bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  if (format === 'pdf') return new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
  if (['docx', 'odt', 'epub', 'xlsx', 'pptx'].includes(format)) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  if (format === 'image') {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const gif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const bmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
    const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const ftyp = bytes.length > 11 && new TextDecoder().decode(bytes.subarray(4, 8)) === 'ftyp';
    return png || jpeg || gif || bmp || riff || ftyp;
  }
  return true;
}
