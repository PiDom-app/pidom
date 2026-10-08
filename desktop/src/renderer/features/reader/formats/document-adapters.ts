import { unzipSync, strFromU8 } from 'fflate';

const MAX_TEXT = 2_000_000;
const MAX_ZIP_ENTRIES = 2_000;

function clamp(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}\n\n[Document truncated]` : value;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|form)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:src|href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (attribute) =>
      /\s+href\s*=\s*["']#/i.test(attribute) ? attribute : '',
    );
}

function xmlText(value: string): string {
  return stripMarkup(
    value
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<row[^>]*>/g, '\n')
      .replace(/<a:p[^>]*>/g, '\n')
      .replace(/<text:p[^>]*>/g, '\n'),
  );
}

function zipEntries(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('archive exceeds the reader limit');
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  if (names.length > MAX_ZIP_ENTRIES) throw new Error('document has too many archive entries');
  return entries;
}

function archiveText(bytes: Uint8Array, kind: string): string {
  const entries = zipEntries(bytes);
  const preferred =
    kind === 'docx'
      ? ['word/document.xml']
      : kind === 'odt'
        ? ['content.xml']
        : kind === 'xlsx'
          ? Object.keys(entries).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
          : kind === 'pptx'
            ? Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
            : Object.keys(entries).filter((name) => /\.(xhtml?|html|xml)$/i.test(name));
  const files = preferred.filter((name) => entries[name]).slice(0, 200);
  return clamp(files.map((name) => xmlText(strFromU8(entries[name]))).join('\n\n'));
}

function binaryText(bytes: Uint8Array): string {
  const ascii = new TextDecoder('latin1').decode(bytes);
  const runs = ascii.match(/[ -~]{4,}/g) ?? [];
  return clamp(runs.join(' '));
}

function csvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (cell || row.length) {
        row.push(cell.trim());
        rows.push(row);
      }
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.slice(0, 10_000).map((cells) => cells.slice(0, 200));
}

export type ParsedDocument =
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'binary-text'; text: string };

export function parseDocumentBytes(bytes: Uint8Array, format: string): ParsedDocument {
  if (format === 'image') return { kind: 'text', text: '' };
  if (format === 'html') {
    const raw = new TextDecoder().decode(bytes).slice(0, MAX_TEXT);
    return { kind: 'html', html: sanitizeHtml(raw) };
  }
  if (format === 'csv') return { kind: 'table', rows: csvRows(new TextDecoder().decode(bytes)) };
  if (['docx', 'odt', 'xlsx', 'pptx', 'epub'].includes(format)) {
    return { kind: 'text', text: archiveText(bytes, format) };
  }
  if (['doc', 'xls', 'ppt'].includes(format))
    return { kind: 'binary-text', text: binaryText(bytes) };
  let text = new TextDecoder().decode(bytes);
  if (format === 'rtf') text = text.replace(/\\[a-z]+-?\d* ?|[{}]/gi, '');
  if (format === 'md') {
    text = text.replace(/^#{1,6}\s+/gm, '').replace(/[*_`]/g, '');
  }
  return { kind: 'text', text: clamp(text) };
}

export async function parseDocument(url: string, format: string): Promise<ParsedDocument> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('document could not be read');
  return parseDocumentBytes(new Uint8Array(await response.arrayBuffer()), format);
}
