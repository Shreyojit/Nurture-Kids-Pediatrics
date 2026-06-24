import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import { config, resolveDataPath, toRelativeDataPath } from '../config.js';
import { fail, ok } from '../lib/response.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  createAsqTemplate,
  getAsqTemplate,
  listAsqTemplates,
  deleteAsqTemplate,
  listAsqTemplateFields,
  createAsqTemplateField,
  updateAsqTemplateField,
  deleteAsqTemplateField,
  deleteAllAsqTemplateFields,
  bulkInsertAsqTemplateFields,
  createAsqSubmission,
  getAsqSubmission,
  listAsqSubmissions,
  updateAsqSubmissionScores,
  setAsqSubmissionGeneratedPdf,
  upsertAsqSubmissionValues,
  getAsqSubmissionValues,
  computeAsqScores,
} from '../db/asqQueries.js';

export const asqStaffRouter = Router();
export const asqPublicRouter = Router();

// ─── File storage ──────────────────────────────────────────────────────────

const asqUploadDir = path.join(config.dataPath, 'asq', 'pdfs');
fs.mkdirSync(asqUploadDir, { recursive: true });

const asqGeneratedDir = path.join(config.dataPath, 'asq', 'generated');
fs.mkdirSync(asqGeneratedDir, { recursive: true });

const storageSource = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, asqUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.pdf') || '.pdf';
    cb(null, `${Date.now()}_${randomUUID()}${ext}`);
  },
});

const uploadPdf = multer({
  storage: storageSource,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.includes('pdf')) {
      cb(new Error('Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

const uploadImport = multer({ storage: multer.memoryStorage() });

// ─── Zod schemas ───────────────────────────────────────────────────────────

const fieldSchema = z.object({
  field_name: z.string().min(1),
  field_key: z.string().min(1),
  field_type: z.enum(['text', 'textarea', 'checkbox', 'radio', 'signature']),
  page_number: z.number().int().min(1),
  x_percent: z.number().min(0).max(100),
  y_percent: z.number().min(0).max(100),
  width_percent: z.number().min(0).max(100),
  height_percent: z.number().min(0).max(100),
  group_name: z.string().nullable().optional(),
  option_value: z.string().nullable().optional(),
  required: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// ─── STAFF: Template management ────────────────────────────────────────────

asqStaffRouter.use(authMiddleware('staff'));

// List templates
asqStaffRouter.get('/', (req, res) => {
  ok(res, listAsqTemplates(req.user!.practiceId));
});

// Upload PDF and create template
asqStaffRouter.post('/upload', uploadPdf.single('file'), (req, res) => {
  if (!req.file) {
    fail(res, 'VALIDATION_ERROR', 'PDF file is required', 422);
    return;
  }

  const bodySchema = z.object({
    name: z.string().min(1),
    template_type: z.string().default('ASQ_48'),
    version: z.coerce.number().int().min(1).default(1),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid metadata', 422, parsed.error.flatten());
    return;
  }

  const relPath = toRelativeDataPath(req.file.path);
  const tmpl = createAsqTemplate({
    practiceId: req.user!.practiceId,
    name: parsed.data.name,
    templateType: parsed.data.template_type,
    version: parsed.data.version,
    originalFileName: req.file.originalname,
    storedFileName: path.basename(req.file.path),
    filePath: relPath,
    createdBy: req.user!.id,
  });

  ok(res, tmpl);
});

// Get template + fields
asqStaffRouter.get('/:id', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }
  const fields = listAsqTemplateFields(tmpl.id);
  ok(res, { ...tmpl, fields });
});

// Serve PDF file
asqStaffRouter.get('/:id/pdf', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }
  const abs = resolveDataPath(tmpl.file_path);
  if (!fs.existsSync(abs)) { fail(res, 'NOT_FOUND', 'PDF file not found', 404); return; }
  res.sendFile(abs);
});

// Delete template
asqStaffRouter.delete('/:id', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }
  try {
    const abs = resolveDataPath(tmpl.file_path);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* non-blocking cleanup */ }
  deleteAsqTemplate(req.params.id, req.user!.practiceId);
  ok(res, { deleted: true, id: req.params.id });
});

// Add field
asqStaffRouter.post('/:id/fields', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const parsed = fieldSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid field data', 422, parsed.error.flatten());
    return;
  }

  const f = parsed.data;
  const field = createAsqTemplateField({
    templateId: tmpl.id,
    fieldName: f.field_name,
    fieldKey: f.field_key,
    fieldType: f.field_type,
    pageNumber: f.page_number,
    xPercent: f.x_percent,
    yPercent: f.y_percent,
    widthPercent: f.width_percent,
    heightPercent: f.height_percent,
    groupName: f.group_name,
    optionValue: f.option_value,
    required: f.required ?? false,
    sortOrder: f.sort_order ?? 0,
  });
  ok(res, field);
});

// Update field
asqStaffRouter.put('/:id/fields/:fieldId', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const parsed = fieldSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid field data', 422, parsed.error.flatten());
    return;
  }

  const p = parsed.data;
  const updated = updateAsqTemplateField(req.params.fieldId, tmpl.id, {
    fieldName: p.field_name,
    fieldKey: p.field_key,
    fieldType: p.field_type,
    pageNumber: p.page_number,
    xPercent: p.x_percent,
    yPercent: p.y_percent,
    widthPercent: p.width_percent,
    heightPercent: p.height_percent,
    groupName: p.group_name,
    optionValue: p.option_value,
    required: p.required,
    sortOrder: p.sort_order,
  });
  ok(res, updated);
});

// Delete field
asqStaffRouter.delete('/:id/fields/:fieldId', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }
  deleteAsqTemplateField(req.params.fieldId, tmpl.id);
  ok(res, { deleted: true, id: req.params.fieldId });
});

// ─── STAFF: Export template as JSON ───────────────────────────────────────

asqStaffRouter.get('/:id/export', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }
  const fields = listAsqTemplateFields(tmpl.id);

  const exportPayload = {
    template_name: tmpl.name,
    template_type: tmpl.template_type,
    template_version: tmpl.version,
    original_file_name: tmpl.original_file_name,
    exported_at: new Date().toISOString(),
    fields: fields.map((f) => ({
      field_name: f.field_name,
      field_key: f.field_key,
      field_type: f.field_type,
      page_number: f.page_number,
      x_percent: f.x_percent,
      y_percent: f.y_percent,
      width_percent: f.width_percent,
      height_percent: f.height_percent,
      group_name: f.group_name,
      option_value: f.option_value,
      required: !!f.required,
      sort_order: f.sort_order,
    })),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${tmpl.name.replace(/[^a-z0-9]/gi, '_')}_template.json"`,
  );
  res.json(exportPayload);
});

// ─── STAFF: Import template (PDF + JSON) ─────────────────────────────────

asqStaffRouter.post(
  '/import',
  uploadImport.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'json', maxCount: 1 },
  ]),
  (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const pdfFile = files?.['pdf']?.[0];
    const jsonFile = files?.['json']?.[0];

    if (!pdfFile || !jsonFile) {
      fail(res, 'VALIDATION_ERROR', 'Both pdf and json files are required', 422);
      return;
    }

    let mapping: {
      template_name: string;
      template_type?: string;
      template_version?: number;
      original_file_name?: string;
      fields: Array<{
        field_name: string;
        field_key: string;
        field_type: string;
        page_number: number;
        x_percent: number;
        y_percent: number;
        width_percent: number;
        height_percent: number;
        group_name?: string | null;
        option_value?: string | null;
        required?: boolean;
        sort_order?: number;
      }>;
    };

    try {
      mapping = JSON.parse(jsonFile.buffer.toString('utf-8')) as typeof mapping;
    } catch {
      fail(res, 'VALIDATION_ERROR', 'Invalid JSON mapping file', 422);
      return;
    }

    if (!mapping.template_name || !Array.isArray(mapping.fields)) {
      fail(res, 'VALIDATION_ERROR', 'JSON must contain template_name and fields array', 422);
      return;
    }

    // Write PDF to disk
    const ext = path.extname(pdfFile.originalname || '.pdf') || '.pdf';
    const storedName = `${Date.now()}_${randomUUID()}${ext}`;
    const destPath = path.join(asqUploadDir, storedName);
    fs.writeFileSync(destPath, pdfFile.buffer);

    const tmpl = createAsqTemplate({
      practiceId: req.user!.practiceId,
      name: mapping.template_name,
      templateType: mapping.template_type ?? 'ASQ_48',
      version: mapping.template_version ?? 1,
      originalFileName: pdfFile.originalname,
      storedFileName: storedName,
      filePath: toRelativeDataPath(destPath),
      createdBy: req.user!.id,
    });

    bulkInsertAsqTemplateFields(
      tmpl.id,
      mapping.fields.map((f, i) => ({
        fieldName: f.field_name,
        fieldKey: f.field_key,
        fieldType: f.field_type,
        pageNumber: f.page_number,
        xPercent: f.x_percent,
        yPercent: f.y_percent,
        widthPercent: f.width_percent,
        heightPercent: f.height_percent,
        groupName: f.group_name ?? null,
        optionValue: f.option_value ?? null,
        required: f.required ?? false,
        sortOrder: f.sort_order ?? i,
      })),
    );

    const fields = listAsqTemplateFields(tmpl.id);
    ok(res, {
      ...tmpl,
      fields,
      imported: true,
      fields_imported: fields.length,
    });
  },
);

// ─── STAFF: Submissions list ───────────────────────────────────────────────

asqStaffRouter.get('/:id/submissions', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }
  ok(res, listAsqSubmissions(req.user!.practiceId));
});

// ─── STAFF: Create submission ──────────────────────────────────────────────

asqStaffRouter.post('/:id/submissions', (req, res) => {
  const tmpl = getAsqTemplate(req.params.id, req.user!.practiceId);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const submission = createAsqSubmission({
    templateId: tmpl.id,
    practiceId: req.user!.practiceId,
    patientId: (req.body as Record<string, unknown>).patient_id as string | null ?? null,
  });
  ok(res, submission);
});

// ─── PUBLIC: Submission fill routes ───────────────────────────────────────

// Get submission
asqPublicRouter.get('/:id', (req, res) => {
  const sub = getAsqSubmission(req.params.id);
  if (!sub) { fail(res, 'NOT_FOUND', 'Submission not found', 404); return; }
  const values = getAsqSubmissionValues(sub.id);
  const fields = listAsqTemplateFields(sub.template_id);
  ok(res, { ...sub, values, fields });
});

// Save values + compute scores
asqPublicRouter.put('/:id/values', (req, res) => {
  const sub = getAsqSubmission(req.params.id);
  if (!sub) { fail(res, 'NOT_FOUND', 'Submission not found', 404); return; }

  const bodySchema = z.object({
    values: z.array(
      z.object({
        field_id: z.string(),
        field_key: z.string(),
        value: z.string(),
      }),
    ),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid values payload', 422, parsed.error.flatten());
    return;
  }

  upsertAsqSubmissionValues(
    sub.id,
    parsed.data.values.map((v) => ({
      fieldId: v.field_id,
      fieldKey: v.field_key,
      value: v.value,
    })),
  );

  const allValues = getAsqSubmissionValues(sub.id);
  const scores = computeAsqScores(allValues);
  updateAsqSubmissionScores(sub.id, scores);

  ok(res, { ...getAsqSubmission(sub.id), scores });
});

// Generate filled PDF
asqPublicRouter.post('/:id/generate-pdf', async (req, res) => {
  const sub = getAsqSubmission(req.params.id);
  if (!sub) { fail(res, 'NOT_FOUND', 'Submission not found', 404); return; }

  const tmpl = getAsqTemplate(sub.template_id, sub.practice_id);
  if (!tmpl) { fail(res, 'NOT_FOUND', 'Template not found', 404); return; }

  const pdfPath = resolveDataPath(tmpl.file_path);
  if (!fs.existsSync(pdfPath)) {
    fail(res, 'NOT_FOUND', 'Source PDF not found', 404);
    return;
  }

  const fields = listAsqTemplateFields(tmpl.id);
  const values = getAsqSubmissionValues(sub.id);
  const responseMap: Record<string, string> = {};
  for (const v of values) responseMap[v.field_key] = v.value;

  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const field of fields) {
      const page = pages[field.page_number - 1];
      if (!page) continue;

      const { width: pw, height: ph } = page.getSize();
      const px = (field.x_percent / 100) * pw;
      // PDF Y origin is bottom-left; screen Y is top-left — flip it
      const py = ph - (field.y_percent / 100) * ph - (field.height_percent / 100) * ph;
      const fw = (field.width_percent / 100) * pw;
      const fh = (field.height_percent / 100) * ph;

      if (field.field_type === 'text' || field.field_type === 'textarea') {
        const val = responseMap[field.field_key];
        if (val) {
          page.drawText(val, {
            x: px + 2,
            y: py + Math.max(2, fh / 2 - 5),
            size: fh > 20 ? 10 : 7,
            font,
            color: rgb(0, 0, 0),
            maxWidth: fw - 4,
            lineHeight: 12,
          });
        }
      } else if (field.field_type === 'radio' && field.group_name && field.option_value) {
        const selected = responseMap[field.group_name];
        if (selected === field.option_value) {
          page.drawEllipse({
            x: px + fw / 2,
            y: py + fh / 2,
            xScale: Math.max(2, fw / 2 - 1),
            yScale: Math.max(2, fh / 2 - 1),
            color: rgb(0, 0, 0),
          });
        }
      } else if (field.field_type === 'checkbox') {
        const val = responseMap[field.field_key];
        if (val === 'checked' || val === 'true' || val === '1') {
          // Draw checkmark
          page.drawLine({ start: { x: px + 2, y: py + fh / 2 }, end: { x: px + fw / 2 - 1, y: py + 2 }, thickness: 1.4, color: rgb(0, 0, 0) });
          page.drawLine({ start: { x: px + fw / 2 - 1, y: py + 2 }, end: { x: px + fw - 2, y: py + fh - 2 }, thickness: 1.4, color: rgb(0, 0, 0) });
        }
      } else if (field.field_type === 'signature') {
        const val = responseMap[field.field_key];
        if (val) {
          page.drawText(val, {
            x: px + 2,
            y: py + Math.max(2, fh / 2 - 5),
            size: 11,
            font,
            color: rgb(0, 0, 0.6),
            maxWidth: fw - 4,
          });
        }
      }
    }

    const filledBytes = await pdfDoc.save();
    const outName = `asq_filled_${sub.id}.pdf`;
    const outPath = path.join(asqGeneratedDir, outName);
    fs.writeFileSync(outPath, filledBytes);
    const relPath = toRelativeDataPath(outPath);
    setAsqSubmissionGeneratedPdf(sub.id, relPath);

    ok(res, {
      download_url: `/api/asq/submissions/${sub.id}/download`,
      generated_pdf_path: relPath,
    });
  } catch (err) {
    fail(res, 'PDF_GENERATION_ERROR', (err as Error).message, 500);
  }
});

// Download generated PDF
asqPublicRouter.get('/:id/download', (req, res) => {
  const sub = getAsqSubmission(req.params.id);
  if (!sub) { fail(res, 'NOT_FOUND', 'Submission not found', 404); return; }
  if (!sub.generated_pdf_path) {
    fail(res, 'NOT_FOUND', 'No generated PDF yet. Call generate-pdf first.', 404);
    return;
  }
  const abs = resolveDataPath(sub.generated_pdf_path);
  if (!fs.existsSync(abs)) {
    fail(res, 'NOT_FOUND', 'Generated PDF file missing from disk', 404);
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="asq_filled_${sub.id}.pdf"`);
  res.sendFile(abs);
});
