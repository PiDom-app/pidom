import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const MAX_REPLACEMENTS = 2_000;
const XML_ENTRY = /\.(xml|rels)$/i;
const OFFICE_ENTRY = /^(word|xl|ppt|content\.xml|styles\.xml|META-INF)\//;

export type OfficeTextReplacement = {
  find: string;
  replace: string;
};

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function replaceXmlText(xml: string, replacement: OfficeTextReplacement): string {
  const find = xmlEscape(replacement.find);
  const next = xmlEscape(replacement.replace);
  return xml.replaceAll(find, next);
}

/**
 * Rewrites only text values in the existing OOXML/ODF package. Every other
 * archive entry is copied byte-for-byte, so media, styles, relationships,
 * formulas, macros, and unknown extensions are not discarded.
 */
export function applyOfficeTextReplacements(
  bytes: Uint8Array,
  format: 'docx' | 'xlsx' | 'pptx' | 'odt',
  replacements: readonly OfficeTextReplacement[],
): Uint8Array {
  if (replacements.length > MAX_REPLACEMENTS) throw new Error('too many Office text replacements');
  const entries = unzipSync(bytes);
  const output: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(entries)) {
    let next = value;
    if (XML_ENTRY.test(name) && (OFFICE_ENTRY.test(name) || format === 'odt')) {
      let xml = strFromU8(value);
      for (const replacement of replacements) {
        if (replacement.find.length === 0 || replacement.find.length > 4_000) {
          throw new Error('Office replacement text is invalid');
        }
        xml = replaceXmlText(xml, replacement);
      }
      next = strToU8(xml);
    }
    output[name] = next;
  }
  return zipSync(output, { level: 0 });
}
