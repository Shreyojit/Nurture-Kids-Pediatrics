import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { humanPdfFieldBaseName, importEmbeddedAcroFieldsFromPdfBytes } from '../lib/acroformFieldImporter.js';

describe('humanPdfFieldBaseName', () => {
  it('strips trailing numeric widget path segments used by Acrobat', () => {
    expect(humanPdfFieldBaseName('Check Box17.0.0.0.0')).toBe('Check Box17');
    expect(humanPdfFieldBaseName('row.field.12.0')).toBe('row — field — 12');
  });
});

describe('importEmbeddedAcroFieldsFromPdfBytes', () => {
  it('extracts text fields and checkboxes from a programmatic AcroForm PDF', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();

    const nameField = form.createTextField('childs_name');
    nameField.addToPage(page, { x: 72, y: 700, width: 220, height: 20, borderWidth: 1 });

    const cb = form.createCheckBox('sample_check');
    cb.addToPage(page, { x: 72, y: 640, width: 14, height: 14, borderWidth: 1 });

    const bytes = await doc.save({ useObjectStreams: false });
    const plan = await importEmbeddedAcroFieldsFromPdfBytes(bytes);

    expect(plan.groups.length).toBe(0);
    expect(plan.fields.length).toBe(2);

    const text = plan.fields.find((f) => f.field_type === 'text');
    const check = plan.fields.find((f) => f.field_type === 'checkbox');
    expect(text?.acro_field_name).toBe('childs_name');
    expect(check?.acro_field_name).toBe('sample_check');
    expect(text?.page_number).toBe(1);
    expect(check?.page_number).toBe(1);
  });

  it('creates radio groups and radio_option fields', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const rg = form.createRadioGroup('mchat_q1');
    rg.addOptionToPage('Yes', page, { x: 100, y: 500, width: 12, height: 12, borderWidth: 0 });
    rg.addOptionToPage('No', page, { x: 140, y: 500, width: 12, height: 12, borderWidth: 0 });
    const bytes = await doc.save({ useObjectStreams: false });
    const plan = await importEmbeddedAcroFieldsFromPdfBytes(bytes);
    expect(plan.groups.length).toBe(1);
    expect(plan.groups[0]!.acro_group_name).toBe('mchat_q1');
    const opts = plan.fields.filter((f) => f.field_type === 'radio_option');
    expect(opts.length).toBe(2);
    expect(new Set(opts.map((o) => o.group_value))).toEqual(new Set(['Yes', 'No']));
    expect(opts.every((o) => o.group_index === 0)).toBe(true);
  });

  it('returns empty fields when PDF has no form', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const bytes = await doc.save({ useObjectStreams: false });
    const plan = await importEmbeddedAcroFieldsFromPdfBytes(bytes);
    expect(plan.fields.length).toBe(0);
  });
});
