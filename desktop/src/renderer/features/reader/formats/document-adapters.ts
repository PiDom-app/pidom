import { unzipSync, strFromU8 } from 'fflate';

const MAX_TEXT = 2_000_000;
const MAX_ZIP_ENTRIES = 2_000;

function clamp(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}\n\n[Document truncated]` : value;
}

function stripMarkup(value: string): string {
  return sanitizeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtml(value: string): string {
  const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form']);
  const blockedVoid = new Set(['embed']);
  const safeAttributes = new Set([
    'alt',
    'class',
    'colspan',
    'height',
    'id',
    'role',
    'rowspan',
    'title',
    'width',
  ]);
  const urlAttributes = new Set([
    'action',
    'background',
    'cite',
    'formaction',
    'href',
    'poster',
    'src',
    'srcset',
    'xlink:href',
  ]);

  const tagEnd = (start: number): number => {
    let quote = '';
    for (let index = start; index < value.length; index += 1) {
      const character = value[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        return index;
      }
    }
    return -1;
  };

  const tagInfo = (start: number, end: number) => {
    let index = start + 1;
    let closing = false;
    if (value[index] === '/') {
      closing = true;
      index += 1;
    }
    while (index < end && /\s/.test(value[index])) index += 1;
    const nameStart = index;
    while (index < end && /[A-Za-z0-9:_-]/.test(value[index])) index += 1;
    if (index === nameStart) return null;
    return { closing, name: value.slice(nameStart, index).toLowerCase(), attributesStart: index };
  };

  const output: string[] = [];
  let index = 0;
  while (index < value.length) {
    if (value[index] !== '<') {
      output.push(value[index]);
      index += 1;
      continue;
    }
    if (value.startsWith('<!--', index)) {
      const commentEnd = value.indexOf('-->', index + 4);
      index = commentEnd === -1 ? value.length : commentEnd + 3;
      continue;
    }
    const end = tagEnd(index + 1);
    if (end === -1) {
      output.push('&lt;');
      index += 1;
      continue;
    }
    const info = tagInfo(index, end);
    if (!info) {
      output.push('&lt;');
      index += 1;
      continue;
    }
    if (blocked.has(info.name)) {
      if (!info.closing) {
        if (blockedVoid.has(info.name)) {
          index = end + 1;
          continue;
        }
        let depth = 1;
        index = end + 1;
        while (index < value.length && depth > 0) {
          if (value[index] !== '<') {
            index += 1;
            continue;
          }
          const nestedEnd = tagEnd(index + 1);
          if (nestedEnd === -1) break;
          const nested = tagInfo(index, nestedEnd);
          if (nested?.name === info.name) depth += nested.closing ? -1 : 1;
          index = nestedEnd + 1;
        }
      } else {
        index = end + 1;
      }
      continue;
    }
    if (info.closing) {
      output.push(`</${info.name}>`);
      index = end + 1;
      continue;
    }

    let attributes = '';
    let cursor = info.attributesStart;
    let selfClosing = false;
    while (cursor < end) {
      while (cursor < end && /\s/.test(value[cursor])) cursor += 1;
      if (cursor >= end) break;
      if (value[cursor] === '/') {
        selfClosing = true;
        cursor += 1;
        continue;
      }
      const attributeStart = cursor;
      while (cursor < end && !/[\s=/>]/.test(value[cursor])) cursor += 1;
      const name = value.slice(attributeStart, cursor).toLowerCase();
      while (cursor < end && /\s/.test(value[cursor])) cursor += 1;
      let attributeValue = '';
      if (value[cursor] === '=') {
        cursor += 1;
        while (cursor < end && /\s/.test(value[cursor])) cursor += 1;
        const quote = value[cursor] === '"' || value[cursor] === "'" ? value[cursor++] : '';
        const valueStart = cursor;
        while (cursor < end && (quote ? value[cursor] !== quote : !/[\s/>]/.test(value[cursor]))) {
          cursor += 1;
        }
        attributeValue = value.slice(valueStart, cursor);
        if (quote && value[cursor] === quote) cursor += 1;
      }
      const isEvent = name.startsWith('on');
      const isUrl = urlAttributes.has(name);
      const isFragment = name === 'href' && attributeValue.trim().startsWith('#');
      const isSafe = safeAttributes.has(name) || (name.startsWith('data-') || name.startsWith('aria-'));
      if (!isEvent && ((isUrl && isFragment) || (!isUrl && isSafe))) {
        attributes += ` ${name}${attributeValue ? `="${attributeValue.replaceAll('"', '&quot;')}"` : ''}`;
      }
    }
    output.push(`<${info.name}${attributes}${selfClosing ? '/' : ''}>`);
    index = end + 1;
  }
  return output.join('');
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
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"' && quoted && value[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && value[index + 1] === '\n') index += 1;
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

export function serializeCsvRows(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
}

export type ParsedDocument =
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'binary-text'; text: string };

export function parseDocumentBytes(bytes: Uint8Array, format: string): ParsedDocument {
  if (format === 'image') return { kind: 'text', text: '' };
  if (format === 'pdf') return { kind: 'text', text: '' };
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
