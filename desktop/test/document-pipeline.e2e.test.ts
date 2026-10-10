import { unzipSync, zipSync } from 'fflate';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDocumentBytes,
  serializeCsvRows,
} from '../src/renderer/features/reader/formats/document-adapters.ts';
import { applyOfficeTextReplacements } from '../src/renderer/features/reader/formats/office-writer.ts';
import { applyPdfEdits } from '../src/renderer/features/reader/pdf/editor.ts';
import { starterDocumentBytes, starterDocumentLocalId } from '../src/main/storage/starter-document.ts';
import { formatFromFilename } from '../../src/lib/document-formats.ts';

const text = (value: string) => new TextEncoder().encode(value);

test('built-in starter document', () => {
  const bytes = starterDocumentBytes();
  const entries = unzipSync(bytes);
  assert.ok(entries['word/document.xml']);
  assert.equal(starterDocumentLocalId('test-subject').length, 32);
  const parsed = parseDocumentBytes(bytes, 'docx');
  assert.equal(parsed.kind, 'text');
  assert.match(JSON.stringify(parsed), /Welcome to Pidom/);
  assert.match(JSON.stringify(parsed), /Local-first desktop behavior/);
});

test('desktop adapter fixture matrix', async (t) => {
  await t.test('reads plain, markdown, rich text, and legacy binary fixtures', () => {
    for (const [format, source] of [
      ['txt', 'Pidom plain text'],
      ['md', '# Pidom heading\n\nReadable content'],
      ['rtf', '{\\\\rtf1\\\\b Pidom rich text}'],
      ['doc', 'Legacy Word text Pidom'],
      ['xls', 'Legacy Excel text Pidom'],
      ['ppt', 'Legacy PowerPoint text Pidom'],
    ]) {
      const result = parseDocumentBytes(text(source), format);
      assert.match(result.kind, /text/);
      assert.match(JSON.stringify(result), /Pidom/);
    }
  });

  await t.test('sanitizes HTML active content and external resources', () => {
    const result = parseDocumentBytes(
      text(
        '<h1>Pidom</h1><script>alert(1)</script><img src="https://evil.test/x" onerror="alert(2)">',
      ),
      'html',
    );
    assert.deepEqual(result, { kind: 'html', html: '<h1>Pidom</h1><img>' });
  });

  await t.test('removes varied event-handler attributes', () => {
    const result = parseDocumentBytes(
      text(
        '<div onload="a()" ONCLICK = \'b()\' onfocus=c() onmouseover\n=\n"d()" ' +
          'onerror></div><img/onbeforeinput="e()">',
      ),
      'html',
    );
    assert.deepEqual(result, { kind: 'html', html: '<div></div><img/>' });
  });

  await t.test('removes active URL attributes but keeps fragment links', () => {
    const result = parseDocumentBytes(
      text(
        '<a href="#section">local</a><a href="https://evil.test">external</a>' +
          '<form action="/submit"><button formaction="https://evil.test">submit</button></form>' +
          '<img srcset="https://evil.test/a 1x" poster="https://evil.test/v">',
      ),
      'html',
    );
    assert.deepEqual(result, {
      kind: 'html',
      html: '<a href="#section">local</a><a>external</a><img>',
    });
  });

  await t.test('blocks active elements with whitespace-tolerant closing tags', () => {
    const result = parseDocumentBytes(
      text(
        '<main>Safe</main>' +
          '<script>alert(1)</script >' +
          '<style>.safe{color:red}</style >' +
          '<iframe src="https://evil.test/frame">frame</iframe >' +
          '<object data="https://evil.test/object">object</object >' +
          '<embed src="https://evil.test/embed">' +
          '<form action="https://evil.test/form">form</form >',
      ),
      'html',
    );

    assert.deepEqual(result, { kind: 'html', html: '<main>Safe</main>' });
  });

  await t.test('reads CSV into a bounded structured grid', () => {
    const result = parseDocumentBytes(text('Name,Value\nPidom,1\nReader,2'), 'csv');
    assert.deepEqual(result, {
      kind: 'table',
      rows: [
        ['Name', 'Value'],
        ['Pidom', '1'],
        ['Reader', '2'],
      ],
    });
  });

  await t.test('round-trips quoted CSV cells without losing commas or quotes', () => {
    const source = serializeCsvRows([
      ['Name', 'Note'],
      ['Pidom', 'A, "careful" reader'],
    ]);
    const result = parseDocumentBytes(text(source), 'csv');
    assert.deepEqual(result, {
      kind: 'table',
      rows: [
        ['Name', 'Note'],
        ['Pidom', 'A, "careful" reader'],
      ],
    });
  });

  await t.test('marks formats with verified desktop write-back as editable', () => {
    assert.equal(formatFromFilename('notes.txt').editable, true);
    assert.equal(formatFromFilename('notes.md').editable, true);
    assert.equal(formatFromFilename('rows.csv').editable, true);
    assert.equal(formatFromFilename('photo.jpg').editable, true);
    assert.equal(formatFromFilename('report.pdf').editable, true);
    assert.equal(formatFromFilename('report.docx').editable, true);
  });

  for (const [format, filename, source] of [
    ['docx', 'word/document.xml', '<w:document><w:p><w:t>Pidom DOCX</w:t></w:p></w:document>'],
    ['odt', 'content.xml', '<office:document><text:p>Pidom ODT</text:p></office:document>'],
    ['xlsx', 'xl/worksheets/sheet1.xml', '<worksheet><row><c>Pidom XLSX</c></row></worksheet>'],
    ['pptx', 'ppt/slides/slide1.xml', '<p:sld><a:p><a:t>Pidom PPTX</a:t></a:p></p:sld>'],
    ['epub', 'OEBPS/chapter.xhtml', '<html><body><p>Pidom EPUB</p></body></html>'],
  ]) {
    await t.test(`extracts text from ${format} archives`, () => {
      const result = parseDocumentBytes(
        zipSync({ [filename]: text(source) }),
        format,
      );
      assert.match(JSON.stringify(result), /Pidom/);
    });
  }

  await t.test('preserves Office package entries while replacing supported text', () => {
    const source = zipSync({
      '[Content_Types].xml': text('<Types/>'),
      'word/document.xml': text('<w:t>Old value</w:t>'),
      'word/media/image.bin': new Uint8Array([1, 2, 3]),
      'word/vbaProject.bin': new Uint8Array([4, 5, 6]),
    });
    const result = applyOfficeTextReplacements(source, 'docx', [
      { find: 'Old value', replace: 'New value' },
    ]);
    const entries = unzipSync(result);
    assert.equal(new TextDecoder().decode(entries['word/document.xml']), '<w:t>New value</w:t>');
    assert.deepEqual(entries['word/media/image.bin'], new Uint8Array([1, 2, 3]));
    assert.deepEqual(entries['word/vbaProject.bin'], new Uint8Array([4, 5, 6]));
  });

  await t.test('persists PDF page and visual annotation edits', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const sourceDocument = await PDFDocument.create();
    sourceDocument.addPage([300, 400]);
    sourceDocument.addPage([300, 400]);
    const source = await sourceDocument.save();
    const edited = await applyPdfEdits(source, {
      pages: [
        { type: 'rotate', page: 1, degrees: 90 },
        { type: 'move', page: 2, to: 1 },
      ],
      annotations: [
        { type: 'text', page: 1, x: 20, y: 20, text: 'Pidom' },
        { type: 'highlight', page: 1, x: 10, y: 10, width: 40, height: 12 },
      ],
    });
    const reopened = await PDFDocument.load(edited);
    assert.equal(reopened.getPageCount(), 2);
    assert.equal(reopened.getPage(1).getRotation().angle, 90);
    assert.ok(edited.byteLength > source.byteLength);
  });
});
