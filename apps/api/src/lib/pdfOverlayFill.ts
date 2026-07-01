import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { FieldSchemaField, FieldSchemaOption, TemplateFieldSchema } from './fieldSchema.js';

type Responses = Record<string, unknown>;

function responseValue(responses: Responses, key: string): unknown {
  const raw = responses[key];
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function drawTextValue(page: ReturnType<PDFDocument['getPages']>[number], field: FieldSchemaField, value: unknown, font: Awaited<ReturnType<PDFDocument['embedFont']>>) {
  const x = field.x ?? 0;
  const y = field.y ?? 0;
  const width = field.width ?? 120;
  const height = field.height ?? 18;
  const text = String(value ?? '');
  page.drawText(text, {
    x: x + 2,
    y: y + Math.max(2, height / 2 - 4),
    size: field.fontSize ?? 10,
    font,
    color: rgb(0, 0, 0),
    maxWidth: Math.max(20, width - 4),
  });
}

function drawCheckboxMark(page: ReturnType<PDFDocument['getPages']>[number], field: FieldSchemaField) {
  const x = field.x ?? 0;
  const y = field.y ?? 0;
  const width = field.width ?? 14;
  const height = field.height ?? 14;
  const x1 = x + 3;
  const y1 = y + height / 2;
  const x2 = x + width / 2 - 1;
  const y2 = y + 3;
  const x3 = x + width - 3;
  const y3 = y + height - 3;

  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: 1.4,
    color: rgb(0, 0, 0),
  });

  page.drawLine({
    start: { x: x2, y: y2 },
    end: { x: x3, y: y3 },
    thickness: 1.4,
    color: rgb(0, 0, 0),
  });
}

function drawRadioCircle(page: ReturnType<PDFDocument['getPages']>[number], option: FieldSchemaOption) {
  page.drawEllipse({
    x: option.x + option.width / 2,
    y: option.y + option.height / 2,
    xScale: option.width / 2,
    yScale: option.height / 2,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.2,
  });
}

export async function fillPdfWithOverlaySchema(input: {
  sourcePdfBytes: Uint8Array;
  schema: TemplateFieldSchema;
  responses: Responses;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(input.sourcePdfBytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const field of input.schema.fields) {
    const page = pages[field.page];
    if (!page) {
      throw new Error(`Page ${field.page} not found for field ${field.key}`);
    }

    if (field.type === 'text') {
      drawTextValue(page, field, responseValue(input.responses, field.key), font);
    }

    if (field.type === 'checkbox') {
      if (responseValue(input.responses, field.key) === true) {
        drawCheckboxMark(page, field);
      }
    }

    if (field.type === 'radio') {
      const selectedValue = responseValue(input.responses, field.key);
      const selectedOption = (field.options ?? []).find((option) => option.value === selectedValue);
      if (selectedOption) {
        drawRadioCircle(page, selectedOption);
      }
    }
  }

  return pdfDoc.save();
}
