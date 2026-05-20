import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MCHAT_QUESTIONS } from '../lib/mchatRDefinition.js';
import { buildMchatPatientTemplate, normalizeMchatMarkerGroup } from '../lib/mchatTemplate.js';
import { fillMchatPdfWithCheckmarks, normalizeMchatAnswer } from '../lib/mchatPdfFill.js';

describe('mchatRDefinition', () => {
  it('defines 20 bilingual questions', () => {
    expect(MCHAT_QUESTIONS).toHaveLength(20);
    expect(MCHAT_QUESTIONS[0]!.field_id).toBe('mchat_q01');
    expect(MCHAT_QUESTIONS[19]!.field_id).toBe('mchat_q20');
  });
});

describe('buildMchatPatientTemplate', () => {
  it('returns JSON-driven steps with boolean_yes_no fields', () => {
    const t = buildMchatPatientTemplate({
      id: 'tpl-1',
      template_key: 'mchat',
      version: 1,
      name: 'M-CHAT-R Bilingual',
      source_pdf_path: 'templates/x.pdf',
    });
    expect(t.mchat_json_form).toBe(true);
    expect(t.steps.length).toBe(4);
    const allFields = t.steps.flatMap((s) => s.fields);
    expect(allFields).toHaveLength(20);
    expect(allFields[0]!.input_type).toBe('boolean_yes_no');
    expect(allFields[0]!.label_es).toBeTruthy();
  });
});

describe('normalizeMchatMarkerGroup', () => {
  it('buckets bilingual staff marker labels into yes/no', () => {
    expect(normalizeMchatMarkerGroup('yes')).toBe('yes');
    expect(normalizeMchatMarkerGroup('yes_en')).toBe('yes');
    expect(normalizeMchatMarkerGroup('yes_es')).toBe('yes');
    expect(normalizeMchatMarkerGroup('no_es')).toBe('no');
    expect(normalizeMchatMarkerGroup('Sí')).toBe('yes');
    expect(normalizeMchatMarkerGroup('invalid')).toBeNull();
  });
});

describe('normalizeMchatAnswer', () => {
  it('maps yes/no variants to boolean', () => {
    expect(normalizeMchatAnswer(true)).toBe(true);
    expect(normalizeMchatAnswer('Yes')).toBe(true);
    expect(normalizeMchatAnswer('Sí')).toBe(true);
    expect(normalizeMchatAnswer(false)).toBe(false);
    expect(normalizeMchatAnswer('No')).toBe(false);
    expect(normalizeMchatAnswer(null)).toBeNull();
  });
});

describe('fillMchatPdfWithCheckmarks', () => {
  it('draws using preset layout when no pdf_marker rows exist', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);
    pdfDoc.addPage([612, 792]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mchat-test-'));
    const pdfPath = path.join(tmpDir, 'two.pdf');
    fs.writeFileSync(pdfPath, await pdfDoc.save());

    const out = await fillMchatPdfWithCheckmarks({
      sourcePdfPath: pdfPath,
      dbFields: [],
      responses: { mchat_q01: { value: true }, mchat_q02: { value: false } },
    });
    expect(out.byteLength).toBeGreaterThan(fs.readFileSync(pdfPath).byteLength);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('draws two ticks per answer on bilingual templates (four columns)', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);
    pdfDoc.addPage([612, 792]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mchat-test-'));
    const pdfPath = path.join(tmpDir, 'biling.pdf');
    fs.writeFileSync(pdfPath, await pdfDoc.save());

    const single = await fillMchatPdfWithCheckmarks({
      sourcePdfPath: pdfPath,
      dbFields: [],
      responses: { mchat_q01: { value: true } },
      templateName: 'English-only',
    });
    const bilingual = await fillMchatPdfWithCheckmarks({
      sourcePdfPath: pdfPath,
      dbFields: [],
      responses: { mchat_q01: { value: true } },
      templateName: 'M-CHAT-R Bilingual',
    });
    expect(bilingual.byteLength).toBeGreaterThan(single.byteLength);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('draws on PDF when markers and responses exist', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mchat-test-'));
    const pdfPath = path.join(tmpDir, 'blank.pdf');
    fs.writeFileSync(pdfPath, await pdfDoc.save());

    const q1 = MCHAT_QUESTIONS[0]!.field_id;
    const dbFields = [
      {
        field_id: `${q1}__yes`,
        field_type: 'pdf_marker',
        parent_field_id: q1,
        group_value: 'yes',
        page_number: 1,
        x: 100,
        y: 700,
        width: 12,
        height: 12,
      },
      {
        field_id: `${q1}__no`,
        field_type: 'pdf_marker',
        parent_field_id: q1,
        group_value: 'no',
        page_number: 1,
        x: 150,
        y: 700,
        width: 12,
        height: 12,
      },
    ];

    const out = await fillMchatPdfWithCheckmarks({
      sourcePdfPath: pdfPath,
      dbFields,
      responses: { [q1]: { value: true } },
    });
    expect(out.byteLength).toBeGreaterThan(100);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accumulates separate EN/ES marker boxes for one answer', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mchat-test-'));
    const pdfPath = path.join(tmpDir, 'blank.pdf');
    fs.writeFileSync(pdfPath, await pdfDoc.save());

    const q1 = MCHAT_QUESTIONS[0]!.field_id;
    const dbFields = [
      {
        field_id: `${q1}__yes_en`,
        field_type: 'pdf_marker',
        parent_field_id: q1,
        group_value: 'yes_en',
        page_number: 1,
        x: 100,
        y: 700,
        width: 12,
        height: 12,
      },
      {
        field_id: `${q1}__yes_es`,
        field_type: 'pdf_marker',
        parent_field_id: q1,
        group_value: 'yes_es',
        page_number: 1,
        x: 300,
        y: 700,
        width: 12,
        height: 12,
      },
      {
        field_id: `${q1}__no_en`,
        field_type: 'pdf_marker',
        parent_field_id: q1,
        group_value: 'no_en',
        page_number: 1,
        x: 150,
        y: 700,
        width: 12,
        height: 12,
      },
      {
        field_id: `${q1}__no_es`,
        field_type: 'pdf_marker',
        parent_field_id: q1,
        group_value: 'no_es',
        page_number: 1,
        x: 350,
        y: 700,
        width: 12,
        height: 12,
      },
    ];

    const out = await fillMchatPdfWithCheckmarks({
      sourcePdfPath: pdfPath,
      dbFields,
      responses: { [q1]: { value: true } },
      templateName: 'M-CHAT',
      mchatPdfLayout: 'single_column',
    });
    expect(out.byteLength).toBeGreaterThan(100);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
