import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { TemplateFieldSchema } from '../lib/fieldSchema.js';
import { fillPdfWithOverlaySchema } from '../lib/pdfOverlayFill.js';

async function makeBlankPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-')), 'blank.pdf');
  fs.writeFileSync(tmp, Buffer.from(bytes));
  return tmp;
}

describe('fillPdfWithOverlaySchema', () => {
  it('draws text, checkbox, and radio selections', async () => {
    const pdfPath = await makeBlankPdf();
    const schema: TemplateFieldSchema = {
      fields: [
        {
          id: 't1',
          key: 'childName',
          label: 'Name',
          type: 'text',
          page: 0,
          x: 100,
          y: 700,
          width: 120,
          height: 20,
          fontSize: 10,
        },
        {
          id: 'c1',
          key: 'agree',
          label: 'Agree',
          type: 'checkbox',
          page: 0,
          x: 100,
          y: 650,
          width: 14,
          height: 14,
        },
        {
          id: 'r1',
          key: 'q1',
          label: 'Q1',
          type: 'radio',
          page: 0,
          options: [
            { id: 'y', label: 'Yes', value: 'Yes', x: 200, y: 600, width: 16, height: 16 },
            { id: 'n', label: 'No', value: 'No', x: 240, y: 600, width: 16, height: 16 },
          ],
        },
      ],
    };

    const out = await fillPdfWithOverlaySchema({
      sourcePdfPath: pdfPath,
      schema,
      responses: { childName: 'Alex', agree: true, q1: 'Yes' },
    });

    expect(out.byteLength).toBeGreaterThan(1000);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
