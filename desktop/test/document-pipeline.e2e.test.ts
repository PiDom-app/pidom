import { zipSync } from 'fflate';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDocumentBytes } from '../src/renderer/features/reader/formats/document-adapters.ts';

const text = (value: string) => new TextEncoder().encode(value);

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
      text('<h1>Pidom</h1><script>alert(1)</script><img src="https://evil.test/x" onerror="alert(2)">'),
      'html',
    );
    assert.deepEqual(result, { kind: 'html', html: '<h1>Pidom</h1><img>' });
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
});
