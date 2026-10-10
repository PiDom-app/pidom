import {
  PDFDocument,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
  type PDFPage,
} from 'pdf-lib';

const MAX_OPERATIONS = 500;
const MAX_TEXT = 4_000;

export type PdfPageOperation =
  | { type: 'delete'; page: number }
  | { type: 'rotate'; page: number; degrees: 0 | 90 | 180 | 270 }
  | { type: 'move'; page: number; to: number };

export type PdfAnnotation =
  | { type: 'text'; page: number; x: number; y: number; text: string; size?: number }
  | { type: 'highlight'; page: number; x: number; y: number; width: number; height: number }
  | { type: 'rectangle'; page: number; x: number; y: number; width: number; height: number }
  | { type: 'ink'; page: number; points: readonly { x: number; y: number }[] };

export type PdfFormValue = { name: string; value: string | boolean };

export interface PdfEditModel {
  pages?: readonly PdfPageOperation[];
  annotations?: readonly PdfAnnotation[];
  forms?: readonly PdfFormValue[];
}

function pageAt(document: PDFDocument, pageNumber: number): PDFPage {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.getPageCount()) {
    throw new Error(`PDF page ${pageNumber} is out of range`);
  }
  return document.getPage(pageNumber - 1);
}

function boundedText(value: string): string {
  if (value.length > MAX_TEXT) throw new Error('PDF annotation text is too long');
  return value;
}

function boundedCoordinate(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 100_000) throw new Error('invalid PDF coordinate');
  return value;
}

export async function applyPdfEdits(bytes: Uint8Array, model: PdfEditModel): Promise<Uint8Array> {
  const operationCount =
    (model.pages?.length ?? 0) + (model.annotations?.length ?? 0) + (model.forms?.length ?? 0);
  if (operationCount > MAX_OPERATIONS) throw new Error('too many PDF edit operations');

  const document = await PDFDocument.load(bytes, { updateMetadata: false });

  for (const operation of model.pages ?? []) {
    if (operation.type === 'delete') {
      pageAt(document, operation.page);
      if (document.getPageCount() === 1) throw new Error('a PDF must retain one page');
      document.removePage(operation.page - 1);
    } else if (operation.type === 'rotate') {
      const page = pageAt(document, operation.page);
      page.setRotation(degrees(operation.degrees));
    } else {
      pageAt(document, operation.page);
      if (!Number.isInteger(operation.to) || operation.to < 1 || operation.to > document.getPageCount()) {
        throw new Error('PDF destination page is out of range');
      }
      const [page] = await document.copyPages(document, [operation.page - 1]);
      document.removePage(operation.page - 1);
      document.insertPage(Math.min(operation.to - 1, document.getPageCount()), page);
    }
  }

  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const annotation of model.annotations ?? []) {
    const page = pageAt(document, annotation.page);
    if (annotation.type === 'text') {
      page.drawText(boundedText(annotation.text), {
        x: boundedCoordinate(annotation.x),
        y: boundedCoordinate(annotation.y),
        size: Math.min(Math.max(annotation.size ?? 12, 6), 72),
        font,
        color: rgb(0.18, 0.12, 0.35),
      });
    } else if (annotation.type === 'highlight') {
      page.drawRectangle({
        x: boundedCoordinate(annotation.x),
        y: boundedCoordinate(annotation.y),
        width: boundedCoordinate(annotation.width),
        height: boundedCoordinate(annotation.height),
        color: rgb(1, 0.85, 0.1),
        opacity: 0.35,
        borderWidth: 0,
      });
    } else if (annotation.type === 'rectangle') {
      page.drawRectangle({
        x: boundedCoordinate(annotation.x),
        y: boundedCoordinate(annotation.y),
        width: boundedCoordinate(annotation.width),
        height: boundedCoordinate(annotation.height),
        borderColor: rgb(0.35, 0.2, 0.7),
        borderWidth: 2,
        opacity: 0,
      });
    } else {
      if (annotation.points.length < 2 || annotation.points.length > 1_000) {
        throw new Error('ink annotations require between two and 1,000 points');
      }
      for (let index = 1; index < annotation.points.length; index += 1) {
        const from = annotation.points[index - 1];
        const to = annotation.points[index];
        page.drawLine({
          start: { x: boundedCoordinate(from.x), y: boundedCoordinate(from.y) },
          end: { x: boundedCoordinate(to.x), y: boundedCoordinate(to.y) },
          thickness: 2,
          color: rgb(0.18, 0.12, 0.35),
        });
      }
    }
  }

  const form = document.getForm();
  for (const field of model.forms ?? []) {
    const target = form.getFieldMaybe(field.name);
    if (!target) throw new Error(`PDF form field not found: ${field.name}`);
    if (typeof field.value === 'boolean') {
      const checkbox = form.getCheckBox(field.name);
      if (field.value) checkbox.check();
      else checkbox.uncheck();
    }
    else {
      if (target instanceof PDFTextField) form.getTextField(field.name).setText(field.value);
      else form.getDropdown(field.name).select(field.value);
    }
  }
  if ((model.forms?.length ?? 0) > 0) form.updateFieldAppearances(font);
  return document.save({ useObjectStreams: true });
}
