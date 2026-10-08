import { describe, expect, it } from 'vitest';

import {
  detectDocumentFormat,
  formatFromFilename,
  formatFromMimeType,
  hasRecognizedSignature,
  isSupportedDocument,
} from './document-formats';

describe('document format detection', () => {
  it('prefers a trusted MIME type when the filename is generic', () => {
    expect(detectDocumentFormat('download', 'text/markdown').format).toBe('md');
  });

  it('recognises common filename variants case-insensitively', () => {
    expect(formatFromFilename('BOOK.EPUB').format).toBe('epub');
    expect(formatFromFilename('photo.JpEg').format).toBe('image');
  });

  it('recognises office MIME types', () => {
    expect(
      formatFromMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .format,
    ).toBe('docx');
  });

  it('does not claim support for unknown extensions', () => {
    expect(isSupportedDocument('archive.zip', 'application/zip')).toBe(false);
  });

  it('declares an explicit desktop renderer and security policy for every supported family', () => {
    for (const filename of [
      'a.pdf',
      'a.txt',
      'a.md',
      'a.html',
      'a.epub',
      'a.doc',
      'a.docx',
      'a.odt',
      'a.rtf',
      'a.csv',
      'a.xls',
      'a.xlsx',
      'a.ppt',
      'a.pptx',
      'a.png',
    ]) {
      const format = formatFromFilename(filename);
      expect(format.renderer).not.toBeUndefined();
      expect(format.security).not.toBeUndefined();
      expect(format.contentType).not.toBe('application/octet-stream');
    }
  });

  it('rejects renamed archive and PDF bytes before parsing', () => {
    expect(hasRecognizedSignature('pdf', new TextEncoder().encode('not a pdf'))).toBe(false);
    expect(hasRecognizedSignature('docx', new Uint8Array([0x3c, 0x21]))).toBe(false);
    expect(hasRecognizedSignature('docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });
});
