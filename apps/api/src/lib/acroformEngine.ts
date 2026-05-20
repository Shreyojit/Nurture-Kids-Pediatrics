import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

function findGhostscript(): string | null {
  // Check common install locations
  const candidates = [
    'gs',
    '/usr/bin/gs',
    '/usr/local/bin/gs',
    '/opt/homebrew/bin/gs',
  ];
  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ['--version'], { stdio: 'pipe' });
      if (result.status === 0) return candidate;
    } catch {
      // not found at this path
    }
  }
  return null;
}

export type AcroField = {
  field_id: string;
  field_name: string;
  field_type: string;
  acro_field_name: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options_json?: string | unknown[];
  font_size?: number | null;
  group_id?: string | null;
  group_value?: string | null;
};

export type AcroGroup = {
  id: string;
  group_type: string;
  group_name: string;
  acro_group_name: string;
};

type Responses = Record<string, { value: unknown; updated_at?: string } | unknown>;

async function getPdfLib() {
  try {
    return await import('pdf-lib');
  } catch {
    throw new Error("Missing dependency 'pdf-lib'. Run: npm install");
  }
}

async function loadPdfDocument(bytes: Uint8Array | Buffer) {
  const { PDFDocument } = await getPdfLib();
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

function normalizePdfWithGhostscript(sourcePdfPath: string): string {
  const gs = findGhostscript();
  if (!gs) {
    console.warn('Ghostscript not found; skipping source PDF normalization.');
    return sourcePdfPath;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formfiller-pdf-'));
  const outputPdfPath = path.join(tempDir, 'normalized.pdf');

  try {
    execFileSync(
      gs,
      ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', '-o', outputPdfPath, sourcePdfPath],
      { stdio: 'pipe' },
    );
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : 'Ghostscript PDF normalization failed.';
    throw new Error(`Unable to normalize source PDF for AcroForm generation. ${message}`);
  }

  return outputPdfPath;
}

function normalizePdfBytesWithGhostscript(bytes: Uint8Array | Buffer): Uint8Array {
  const gs = findGhostscript();
  if (!gs) {
    console.warn('Ghostscript not found; skipping filled PDF normalization.');
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formfiller-pdf-bytes-'));
  const inputPdfPath = path.join(tempDir, 'input.pdf');
  const outputPdfPath = path.join(tempDir, 'normalized.pdf');

  try {
    fs.writeFileSync(inputPdfPath, Buffer.from(bytes));
    execFileSync(
      gs,
      ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', '-o', outputPdfPath, inputPdfPath],
      { stdio: 'pipe' },
    );
    return fs.readFileSync(outputPdfPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ghostscript PDF normalization failed.';
    throw new Error(`Unable to normalize filled PDF output. ${message}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function asOptions(value: string | unknown[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

export async function buildAcroformPdfFromFieldDefinitions(input: {
  sourcePdfPath: string;
  outputPdfPath: string;
  fields: AcroField[];
  groups?: AcroGroup[];
}): Promise<void> {
  if (!fs.existsSync(input.sourcePdfPath)) {
    throw new Error('Source PDF not found.');
  }

  const normalizedSourcePdfPath = normalizePdfWithGhostscript(input.sourcePdfPath);
  const normalizedIsTemp = normalizedSourcePdfPath !== input.sourcePdfPath;

  let pdfDoc;
  try {
    const src = fs.readFileSync(normalizedSourcePdfPath);
    pdfDoc = await loadPdfDocument(src);
  } finally {
    if (normalizedIsTemp) {
      fs.rmSync(path.dirname(normalizedSourcePdfPath), { recursive: true, force: true });
    }
  }
  const pages = pdfDoc.getPages();
  const form = pdfDoc.getForm();

  // Build group lookup: id → acro_group_name
  const groupAcroName = new Map<string, string>();
  for (const g of (input.groups ?? [])) {
    groupAcroName.set(g.id, g.acro_group_name);
  }

  // Pre-process radio_option fields: group by group_id
  const radioOptionsByGroup = new Map<string, AcroField[]>();
  for (const field of input.fields) {
    if (field.field_type === 'radio_option' && field.group_id) {
      const bucket = radioOptionsByGroup.get(field.group_id) ?? [];
      bucket.push(field);
      radioOptionsByGroup.set(field.group_id, bucket);
    }
  }

  // Create radio groups for radio_option fields
  for (const [gid, options] of radioOptionsByGroup) {
    const acroName = groupAcroName.get(gid);
    if (!acroName) continue;
    const radio = form.createRadioGroup(acroName);
    for (const opt of options) {
      const page = pages[Math.max(0, Number(opt.page_number || 1) - 1)];
      if (!page) continue;
      const x = Number(opt.x ?? 0);
      const y = Number(opt.y ?? 0);
      const sz = Math.max(10, Math.min(Number(opt.width ?? 14), Number(opt.height ?? 14)));
      radio.addOptionToPage(opt.group_value ?? opt.field_id, page, { x, y, width: sz, height: sz, borderWidth: 0 });
    }
  }

  // Process remaining fields
  for (const field of input.fields) {
    if (field.field_type === 'radio_option') continue; // already handled above

    const page = pages[Math.max(0, Number(field.page_number || 1) - 1)];
    if (!page) continue;

    const x = Number(field.x ?? 0);
    const y = Number(field.y ?? 0);
    const width = Math.max(10, Number(field.width ?? 120));
    const height = Math.max(10, Number(field.height ?? 18));
    const fontSize = Number(field.font_size ?? 12);

    if (field.field_type === 'checkbox') {
      const cb = form.createCheckBox(field.acro_field_name);
      const sz = Math.min(width, height);
      cb.addToPage(page, { x, y, width: sz, height: sz, borderWidth: 0 });
      continue;
    }

    if (field.field_type === 'radio') {
      const radio = form.createRadioGroup(field.acro_field_name);
      const options = asOptions(field.options_json);
      if (options.length === 0) {
        radio.addOptionToPage('Yes', page, { x, y, width: 12, height: 12, borderWidth: 0 });
      } else {
        options.forEach((option, idx) => {
          radio.addOptionToPage(option, page, {
            x,
            y: y - idx * (Math.max(height, 12) + 4),
            width: 12,
            height: 12,
            borderWidth: 0,
          });
        });
      }
      continue;
    }

    if (field.field_type === 'select') {
      const dd = form.createDropdown(field.acro_field_name);
      dd.addToPage(page, { x, y, width, height, borderWidth: 0 });
      const options = asOptions(field.options_json);
      if (options.length > 0) dd.addOptions(options);
      continue;
    }

    // text, textarea, date, signature, box_char
    const text = form.createTextField(field.acro_field_name);
    text.addToPage(page, { x, y, width, height, borderWidth: 0 });
    if (fontSize > 0) {
      try { text.setFontSize(fontSize); } catch { /* ignore if font not embedded */ }
    }
    if (field.field_type === 'textarea') {
      text.enableMultiline();
    }
    if (field.field_type === 'box_char') {
      text.setMaxLength(1);
    }
  }

  fs.mkdirSync(path.dirname(input.outputPdfPath), { recursive: true });
  const out = await pdfDoc.save({ useObjectStreams: false });
  fs.writeFileSync(input.outputPdfPath, out);
}

function valueFromResponse(entry: unknown): string | boolean | null {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === 'object' && entry !== null && 'value' in (entry as Record<string, unknown>)) {
    const v = (entry as Record<string, unknown>).value;
    if (typeof v === 'boolean') return v;
    if (v === null || v === undefined) return null;
    return String(v);
  }
  if (typeof entry === 'boolean') return entry;
  return String(entry);
}

function hasMeaningfulResponseValue(value: string | boolean | null): boolean {
  return value !== null && value !== '';
}

export async function fillAcroformPdfWithResponses(input: {
  acroformPdfPath: string;
  fields: AcroField[];
  responses: Responses;
  groups?: AcroGroup[];
}): Promise<Uint8Array> {
  if (!fs.existsSync(input.acroformPdfPath)) {
    throw new Error('AcroForm PDF not found.');
  }

  const src = fs.readFileSync(input.acroformPdfPath);
  const pdfDoc = await loadPdfDocument(src);
  const form = pdfDoc.getForm();

  // Build group lookup: id → acro_group_name
  const groupAcroName = new Map<string, string>();
  for (const g of (input.groups ?? [])) {
    groupAcroName.set(g.id, g.acro_group_name);
  }

  // For radio_option fields, the response is stored per group_id (which option is selected)
  const filledRadioGroups = new Set<string>();

  for (const field of input.fields) {
    const responseVal = valueFromResponse(input.responses[field.field_id]);

    try {
      if (field.field_type === 'radio_option' && field.group_id) {
        // Each radio option field stores its own checked state (true/false)
        // The acro radio group stores the currently selected option value
        if (!filledRadioGroups.has(field.group_id)) {
          const acroName = groupAcroName.get(field.group_id);
          if (acroName) {
            // Find the selected option value from responses across all options in this group
            const selectedVal = valueFromResponse(input.responses[`__group_${field.group_id}`]);
            if (hasMeaningfulResponseValue(selectedVal)) {
              const radio = form.getRadioGroup(acroName);
              radio.select(String(selectedVal).trim());
            }
            filledRadioGroups.add(field.group_id);
          }
        }
        continue;
      }

      if (field.field_type === 'checkbox') {
        const cb = form.getCheckBox(field.acro_field_name);
        if (responseVal === true || responseVal === 'true' || responseVal === '1') cb.check();
        else cb.uncheck();
        continue;
      }

      if (!hasMeaningfulResponseValue(responseVal)) continue;

      if (field.field_type === 'radio') {
        const radio = form.getRadioGroup(field.acro_field_name);
        radio.select(String(responseVal).trim());
        continue;
      }

      if (field.field_type === 'select') {
        const valStr = String(responseVal).trim();
        try {
          const dd = form.getDropdown(field.acro_field_name);
          dd.select(valStr);
        } catch {
          try {
            const ol = form.getOptionList(field.acro_field_name);
            ol.select(valStr);
          } catch {
            // ignore missing / wrong control type
          }
        }
        continue;
      }

      // text, textarea, date, signature, box_char
      const text = form.getTextField(field.acro_field_name);
      text.setText(String(responseVal));
    } catch {
      // Ignore missing/invalid field binding at runtime; validation should catch these before publish.
    }
  }

  form.updateFieldAppearances();
  form.flatten();
  const out = await pdfDoc.save({ useObjectStreams: false });
  return normalizePdfBytesWithGhostscript(out);
}
