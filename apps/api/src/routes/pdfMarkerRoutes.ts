import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { config, resolveDataPath, toRelativeDataPath } from '../config.js';
import { fail, ok } from '../lib/response.js';
import { db, nowIso } from '../db/database.js';

export const pdfMarkerRouter = Router();

// ── Storage ─────────────────────────────────────────────────────────────────

const markerSourceDir = path.join(config.dataPath, 'templates', 'source');
fs.mkdirSync(markerSourceDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, markerSourceDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.pdf') || '.pdf';
    cb(null, `${Date.now()}_${randomUUID()}${ext}`);
  },
});

const uploadPdf = multer({
  storage: diskStorage,
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (!allowed) { cb(new Error('Only PDF files are allowed')); return; }
    cb(null, true);
  },
  limits: { fileSize: 60 * 1024 * 1024 },
});

const memStorage = multer.memoryStorage();
const uploadImport = multer({
  storage: memStorage,
  limits: { fileSize: 60 * 1024 * 1024 },
});

// ── Types ────────────────────────────────────────────────────────────────────

type TemplateRow = {
  id: string;
  practice_id: string;
  template_key: string;
  name: string;
  source_pdf_path: string;
  page_count: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type FieldRow = {
  id: string;
  template_id: string;
  field_id: string;
  field_name: string;
  field_label: string | null;
  field_type: string;
  page_number: number;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  required: number;
  radio_group: string | null;
  radio_value: string | null;
  placeholder: string | null;
  default_value: string | null;
  font_size: number | null;
  display_order: number;
};

const VALID_TYPES = new Set(['text', 'textarea', 'checkbox', 'radio', 'signature', 'date']);

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
}

// ── List marker templates ────────────────────────────────────────────────────

pdfMarkerRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    select t.id, t.practice_id, t.template_key, t.name, t.source_pdf_path,
           t.page_count, t.status, t.created_at, t.updated_at,
           count(f.id) as field_count
    from pdf_templates t
    left join pdf_template_fields f on f.template_id = t.id
    where t.practice_id = ? and t.is_marker_template = 1
    group by t.id
    order by t.created_at desc
  `).all(req.user!.practiceId);
  ok(res, rows);
});

// ── Upload PDF → create marker template ─────────────────────────────────────

pdfMarkerRouter.post('/upload', uploadPdf.single('pdf'), (req, res) => {
  if (!req.file) { fail(res, 'VALIDATION_ERROR', 'PDF file required', 422); return; }

  const name = String(req.body.name ?? '').trim();
  if (!name) { fail(res, 'VALIDATION_ERROR', 'Template name required', 422); return; }

  const templateKey = slugify(req.body.template_key ?? name) || `tpl_${Date.now()}`;
  const pageCount = req.body.page_count ? parseInt(String(req.body.page_count), 10) : null;
  const relPath = toRelativeDataPath(req.file.path);
  const id = randomUUID();
  const now = nowIso();

  db.prepare(`
    insert into pdf_templates
      (id, practice_id, template_key, version, name, source_pdf_path, acroform_pdf_path,
       status, is_marker_template, page_count, created_by, created_at, updated_at, field_schema_json)
    values (?, ?, ?, 1, ?, ?, null, 'draft', 1, ?, ?, ?, ?, '{"fields":[]}')
  `).run(id, req.user!.practiceId, templateKey, name, relPath, pageCount, req.user!.id, now, now);

  ok(res, db.prepare(`select * from pdf_templates where id = ?`).get(id));
});

// ── Get single template with fields ──────────────────────────────────────────

pdfMarkerRouter.get('/:id', (req, res) => {
  const template = db.prepare(`
    select * from pdf_templates
    where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId) as TemplateRow | undefined;

  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const fields = db.prepare(`
    select id, template_id, field_id, field_name, field_label, field_type,
           page_number, x_percent, y_percent, width_percent, height_percent,
           required, radio_group, radio_value, placeholder, default_value,
           font_size, display_order, created_at, updated_at
    from pdf_template_fields
    where template_id = ?
    order by page_number asc, display_order asc
  `).all(req.params.id) as FieldRow[];

  ok(res, { ...(template as object), fields });
});

// ── Serve source PDF ──────────────────────────────────────────────────────────

pdfMarkerRouter.get('/:id/source', (req, res) => {
  const row = db.prepare(`
    select source_pdf_path from pdf_templates
    where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId) as { source_pdf_path: string } | undefined;

  if (!row) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const filePath = resolveDataPath(row.source_pdf_path);
  if (!fs.existsSync(filePath)) { fail(res, 'NOT_FOUND', 'PDF file not found on disk', 404); return; }

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

// ── Add marker field ──────────────────────────────────────────────────────────

pdfMarkerRouter.post('/:id/fields', (req, res) => {
  const template = db.prepare(`
    select id from pdf_templates where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId);
  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const {
    field_name, field_label, field_type,
    page_number = 1,
    x_percent = 10, y_percent = 10, width_percent = 20, height_percent = 4,
    required = 0,
    radio_group, radio_value,
    placeholder, default_value,
    font_size = 10,
    display_order = 0,
  } = req.body as Record<string, unknown>;

  if (!field_name || typeof field_name !== 'string') {
    fail(res, 'VALIDATION_ERROR', 'field_name required', 422); return;
  }
  if (!field_type || !VALID_TYPES.has(String(field_type))) {
    fail(res, 'VALIDATION_ERROR', 'Valid field_type required: text|textarea|checkbox|radio|signature|date', 422); return;
  }
  if (field_type === 'radio' && (!radio_group || !radio_value)) {
    fail(res, 'VALIDATION_ERROR', 'Radio fields require radio_group and radio_value', 422); return;
  }

  // Build a unique field_id within this template
  const baseSlug = field_type === 'radio'
    ? `${slugify(String(radio_group))}_${slugify(String(radio_value))}`
    : slugify(field_name);

  // Suffix with short UUID chunk to guarantee uniqueness
  const fieldId = `${baseSlug}_${randomUUID().slice(0, 8)}`;
  const now = nowIso();
  const fid = randomUUID();

  db.prepare(`
    insert into pdf_template_fields (
      id, template_id, field_id, field_name, field_label, field_type, acro_field_name,
      page_number, x_percent, y_percent, width_percent, height_percent,
      x, y, width, height, required, radio_group, radio_value,
      placeholder, default_value, font_size, display_order,
      options_json, validation_json, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 100, 20, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?)
  `).run(
    fid, req.params.id, fieldId,
    String(field_name), field_label ? String(field_label) : null,
    String(field_type), fieldId,
    Number(page_number),
    Number(x_percent), Number(y_percent), Number(width_percent), Number(height_percent),
    required ? 1 : 0,
    radio_group ? String(radio_group) : null,
    radio_value ? String(radio_value) : null,
    placeholder ? String(placeholder) : null,
    default_value ? String(default_value) : null,
    Number(font_size), Number(display_order),
    now, now,
  );

  ok(res, db.prepare(`select * from pdf_template_fields where id = ?`).get(fid));
});

// ── Update marker field position / properties ─────────────────────────────────

pdfMarkerRouter.put('/:id/fields/:fieldId', (req, res) => {
  const template = db.prepare(`
    select id from pdf_templates where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId);
  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const field = db.prepare(`select id from pdf_template_fields where id = ? and template_id = ?`)
    .get(req.params.fieldId, req.params.id);
  if (!field) { fail(res, 'NOT_FOUND', 'Field not found', 404); return; }

  const allowed = [
    'field_name', 'field_label', 'field_type', 'page_number',
    'x_percent', 'y_percent', 'width_percent', 'height_percent',
    'required', 'radio_group', 'radio_value',
    'placeholder', 'default_value', 'font_size', 'display_order',
  ];

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      setClauses.push(`${key} = ?`);
      values.push(key === 'required' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
  }

  if (setClauses.length === 0) { fail(res, 'VALIDATION_ERROR', 'No valid fields to update', 422); return; }

  setClauses.push('updated_at = ?');
  values.push(nowIso(), req.params.fieldId);

  db.prepare(`update pdf_template_fields set ${setClauses.join(', ')} where id = ?`).run(...values);

  ok(res, db.prepare(`select * from pdf_template_fields where id = ?`).get(req.params.fieldId));
});

// ── Delete marker field ────────────────────────────────────────────────────────

pdfMarkerRouter.delete('/:id/fields/:fieldId', (req, res) => {
  const template = db.prepare(`
    select id from pdf_templates where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId);
  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  db.prepare(`delete from pdf_template_fields where id = ? and template_id = ?`)
    .run(req.params.fieldId, req.params.id);

  ok(res, { deleted: true, id: req.params.fieldId });
});

// ── Update template metadata ──────────────────────────────────────────────────

pdfMarkerRouter.patch('/:id', (req, res) => {
  const template = db.prepare(`
    select id from pdf_templates where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId);
  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const now = nowIso();
  const { name, page_count, status } = req.body as Record<string, unknown>;

  if (name) db.prepare(`update pdf_templates set name = ?, updated_at = ? where id = ?`).run(String(name), now, req.params.id);
  if (page_count != null) db.prepare(`update pdf_templates set page_count = ?, updated_at = ? where id = ?`).run(Number(page_count), now, req.params.id);
  if (status && ['draft', 'published', 'archived'].includes(String(status))) {
    db.prepare(`update pdf_templates set status = ?, updated_at = ? where id = ?`).run(String(status), now, req.params.id);
  }

  ok(res, db.prepare(`select * from pdf_templates where id = ?`).get(req.params.id));
});

// ── Export template JSON ──────────────────────────────────────────────────────

pdfMarkerRouter.get('/:id/export', (req, res) => {
  const template = db.prepare(`
    select * from pdf_templates where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId) as TemplateRow | undefined;
  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const fields = db.prepare(`
    select field_id, field_name, field_label, field_type, page_number,
           x_percent, y_percent, width_percent, height_percent,
           required, radio_group, radio_value, placeholder, default_value,
           font_size, display_order
    from pdf_template_fields
    where template_id = ?
    order by page_number asc, display_order asc
  `).all(template.id);

  const payload = {
    version: 1,
    exported_at: nowIso(),
    template: {
      name: template.name,
      template_key: template.template_key,
      page_count: template.page_count,
    },
    fields,
  };

  res.setHeader('Content-Disposition', `attachment; filename="${template.template_key}_fields.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(payload);
});

// ── Import template (PDF + JSON) ─────────────────────────────────────────────

pdfMarkerRouter.post(
  '/import',
  uploadImport.fields([{ name: 'pdf', maxCount: 1 }, { name: 'json', maxCount: 1 }]),
  (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const pdfFile = files?.pdf?.[0];
    const jsonFile = files?.json?.[0];

    if (!pdfFile || !jsonFile) {
      fail(res, 'VALIDATION_ERROR', 'Both PDF and JSON files are required', 422); return;
    }

    type ImportJson = {
      version?: number;
      template: { name: string; template_key?: string; page_count?: number | null };
      fields: Record<string, unknown>[];
    };

    let importData: ImportJson;
    try {
      importData = JSON.parse(jsonFile.buffer.toString('utf-8')) as ImportJson;
    } catch {
      fail(res, 'VALIDATION_ERROR', 'Invalid JSON file', 422); return;
    }

    if (!importData.template?.name || !Array.isArray(importData.fields)) {
      fail(res, 'VALIDATION_ERROR', 'JSON must have { template: { name }, fields: [] }', 422); return;
    }

    // Save PDF buffer to disk
    const ext = path.extname(pdfFile.originalname || '.pdf') || '.pdf';
    const pdfFilename = `${Date.now()}_${randomUUID()}${ext}`;
    const pdfAbsPath = path.join(markerSourceDir, pdfFilename);
    fs.writeFileSync(pdfAbsPath, pdfFile.buffer);
    const relPdfPath = toRelativeDataPath(pdfAbsPath);

    const templateId = randomUUID();
    const now = nowIso();
    const templateKey = slugify(importData.template.template_key ?? importData.template.name) || `tpl_${Date.now()}`;

    db.transaction(() => {
      db.prepare(`
        insert into pdf_templates
          (id, practice_id, template_key, version, name, source_pdf_path, acroform_pdf_path,
           status, is_marker_template, page_count, created_by, created_at, updated_at, field_schema_json)
        values (?, ?, ?, 1, ?, ?, null, 'draft', 1, ?, ?, ?, ?, '{"fields":[]}')
      `).run(
        templateId, req.user!.practiceId, templateKey,
        importData.template.name, relPdfPath,
        importData.template.page_count ?? null,
        req.user!.id, now, now,
      );

      let order = 0;
      for (const f of importData.fields) {
        const ftType = String(f.field_type ?? 'text');
        const baseSlug = ftType === 'radio'
          ? `${slugify(String(f.radio_group ?? 'grp'))}_${slugify(String(f.radio_value ?? 'opt'))}`
          : slugify(String(f.field_name ?? 'field'));
        const fieldId = `${baseSlug}_${randomUUID().slice(0, 8)}`;

        db.prepare(`
          insert into pdf_template_fields (
            id, template_id, field_id, field_name, field_label, field_type, acro_field_name,
            page_number, x_percent, y_percent, width_percent, height_percent,
            x, y, width, height, required, radio_group, radio_value,
            placeholder, default_value, font_size, display_order,
            options_json, validation_json, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 100, 20, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?)
        `).run(
          randomUUID(), templateId, fieldId,
          String(f.field_name ?? 'Field'), f.field_label ? String(f.field_label) : null,
          ftType, fieldId,
          Number(f.page_number ?? 1),
          Number(f.x_percent ?? 0), Number(f.y_percent ?? 0),
          Number(f.width_percent ?? 20), Number(f.height_percent ?? 4),
          f.required ? 1 : 0,
          f.radio_group ? String(f.radio_group) : null,
          f.radio_value ? String(f.radio_value) : null,
          f.placeholder ? String(f.placeholder) : null,
          f.default_value ? String(f.default_value) : null,
          Number(f.font_size ?? 10),
          Number(f.display_order ?? order),
          now, now,
        );
        order++;
      }
    })();

    const tpl = db.prepare(`select * from pdf_templates where id = ?`).get(templateId);
    const fieldRows = db.prepare(`
      select * from pdf_template_fields where template_id = ? order by page_number, display_order
    `).all(templateId);

    ok(res, { ...(tpl as object), fields: fieldRows, imported_field_count: fieldRows.length });
  },
);

// ── Generate filled PDF ────────────────────────────────────────────────────────

pdfMarkerRouter.post('/:id/generate-filled', async (req, res) => {
  const template = db.prepare(`
    select * from pdf_templates where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId) as TemplateRow | undefined;
  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const fields = db.prepare(`
    select * from pdf_template_fields where template_id = ? order by page_number, display_order
  `).all(req.params.id) as FieldRow[];

  const responses: Record<string, string> = (req.body.responses as Record<string, string>) ?? {};

  const pdfPath = resolveDataPath(template.source_pdf_path);
  if (!fs.existsSync(pdfPath)) { fail(res, 'NOT_FOUND', 'Source PDF file not found on disk', 404); return; }

  try {
    const srcBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

    // Flatten any existing AcroForm so our overlay draws on top cleanly
    try { pdfDoc.getForm().flatten(); } catch { /* no AcroForm — fine */ }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const field of fields) {
      const page = pages[field.page_number - 1];
      if (!page) continue;

      const { width: pw, height: ph } = page.getSize();
      const fx = (field.x_percent / 100) * pw;
      const fh = (field.height_percent / 100) * ph;
      const fy = ph - (field.y_percent / 100) * ph - fh;
      const fw = (field.width_percent / 100) * pw;
      const fs_ = Math.max(6, field.font_size ?? 10);

      // Determine value
      let value: string | undefined;
      if (field.field_type === 'radio' && field.radio_group) {
        if (responses[field.radio_group] !== field.radio_value) continue;
        value = field.radio_value ?? undefined;
      } else {
        value = responses[field.field_id] ?? undefined;
      }
      if (!value) continue;

      try {
        if (field.field_type === 'radio') {
          const r = Math.max(1, Math.min(fw, fh) / 2 - 1);
          page.drawEllipse({ x: fx + fw / 2, y: fy + fh / 2, xScale: r, yScale: r, color: rgb(0, 0, 0) });
        } else if (field.field_type === 'checkbox') {
          if (value === 'checked') {
            page.drawText('X', { x: fx + 1, y: fy + 1, size: Math.min(fs_ + 2, Math.min(fw, fh) - 2), font, color: rgb(0, 0, 0) });
          }
        } else {
          const lines = String(value).split('\n');
          const lineH = fs_ * 1.25;
          let ly = fy + fh - fs_ - 2;
          for (const line of lines) {
            if (ly < fy) break;
            page.drawText(line.slice(0, 300), { x: fx + 2, y: ly, size: fs_, font, maxWidth: Math.max(1, fw - 4), color: rgb(0, 0, 0) });
            ly -= lineH;
          }
        }
      } catch {
        // Skip fields that fail to render (e.g. font encoding edge cases)
      }
    }

    const filled = await pdfDoc.save();
    const isDownload = req.query.download === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="filled_${template.template_key}.pdf"`);
    res.send(Buffer.from(filled));
  } catch (err) {
    fail(res, 'PDF_GENERATION_ERROR', (err as Error).message, 500);
  }
});

// ── Delete template ────────────────────────────────────────────────────────────

pdfMarkerRouter.delete('/:id', (req, res) => {
  const template = db.prepare(`
    select * from pdf_templates where id = ? and practice_id = ? and is_marker_template = 1
  `).get(req.params.id, req.user!.practiceId) as TemplateRow | undefined;
  if (!template) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  db.prepare(`delete from pdf_template_fields where template_id = ?`).run(template.id);
  db.prepare(`delete from pdf_templates where id = ?`).run(template.id);

  // Best-effort delete source PDF
  try {
    const fp = resolveDataPath(template.source_pdf_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch { /* non-fatal */ }

  ok(res, { deleted: true, id: template.id });
});
