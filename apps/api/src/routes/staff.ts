import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { comparePassword, signToken } from '../lib/auth.js';
import { fail, ok } from '../lib/response.js';
import { buildPatientRegistrationFileName, generateSubmissionPdf } from '../lib/pdfGenerator.js';
import { fillAcroformPdfWithResponses } from '../lib/acroformEngine.js';
import { getTemplateBySubmissionContext } from '../db/templateQueries.js';
import {
  addSubmissionEvent,
  autosaveSubmissionResponses,
  exportSubmissionJson,
  getPatientDetail,
  getSubmissionById,
  getStaffByEmail,
  bulkImportPatientsFromExcelRows,
  listPatients,
  listSubmissions,
  expireStaleSubmissions,
  replaceChildTable,
  updatePatientCore,
  upsertOneToOne,
} from '../db/queries.js';
import { resolveDataPath } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { parsePatientExcelBuffer } from '../lib/patientExcelImport.js';

export const staffRouter = Router();

const excelMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname ?? '';
    const okExt = /\.(xlsx|xls)$/i.test(name);
    const okMime =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream';
    if (okExt || okMime) {
      cb(null, true);
      return;
    }
    cb(new Error('Only Excel .xlsx or .xls uploads are allowed'));
  },
});

type TemplateFieldContext = {
  field_id: string;
  field_name: string;
  field_type: string;
  acro_field_name: string;
  options_json?: unknown;
  required?: boolean;
  section_key?: string | null;
  display_order?: number;
};

function unwrapResponseValue(entry: unknown): unknown {
  if (entry && typeof entry === 'object' && 'value' in (entry as Record<string, unknown>)) {
    return (entry as Record<string, unknown>).value;
  }
  return entry;
}

function buildTemplateBoundAnswers(input: {
  template: { id: string; template_key: string; version: number };
  fields: TemplateFieldContext[];
  responses: Record<string, unknown>;
}) {
  const sortedFields = [...input.fields].sort((a, b) => {
    const sectionA = String(a.section_key ?? 'General');
    const sectionB = String(b.section_key ?? 'General');
    if (sectionA !== sectionB) return sectionA.localeCompare(sectionB);
    return Number(a.display_order ?? 0) - Number(b.display_order ?? 0);
  });

  const sectionsMap = new Map<string, Array<Record<string, unknown>>>();
  const answersByFieldId: Record<string, { value: unknown; answered: boolean }> = {};

  for (const field of sortedFields) {
    const raw = input.responses[field.field_id];
    const value = unwrapResponseValue(raw);
    const answered =
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && value.trim() === '') &&
      !(Array.isArray(value) && value.length === 0);

    answersByFieldId[field.field_id] = {
      value: value ?? null,
      answered,
    };

    const sectionKey = String(field.section_key ?? 'General');
    const sectionFields = sectionsMap.get(sectionKey) ?? [];
    sectionFields.push({
      field_id: field.field_id,
      field_name: field.field_name,
      field_type: field.field_type,
      acro_field_name: field.acro_field_name,
      options: Array.isArray(field.options_json) ? field.options_json.map((item) => String(item)) : [],
      required: Boolean(field.required),
      value: value ?? null,
      answered,
    });
    sectionsMap.set(sectionKey, sectionFields);
  }

  const sections = Array.from(sectionsMap.entries()).map(([section_key, fields]) => ({
    section_key,
    fields,
  }));

  return {
    template_id: input.template.id,
    template_key: input.template.template_key,
    template_version: input.template.version,
    answers_by_field_id: answersByFieldId,
    sections,
  };
}

function getStaffScopedSubmissionOrFail(
  submissionId: string,
  practiceId: string,
): { id: string; practice_id: string; responses_json: string; status: string; updated_at: string } {
  const submission = getSubmissionById(submissionId) as
    | { id: string; practice_id: string; responses_json: string; status: string; updated_at: string }
    | undefined;
  if (!submission || submission.practice_id !== practiceId) {
    throw new Error('SUBMISSION_NOT_FOUND');
  }
  return submission;
}

const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

staffRouter.post('/login', (req, res) => {
  const parsed = staffLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid login payload', 422, parsed.error.flatten());
    return;
  }

  const user = getStaffByEmail(parsed.data.email.toLowerCase());
  if (!user || !user.is_active || !comparePassword(parsed.data.password, user.password_hash)) {
    fail(res, 'INVALID_CREDENTIALS', 'Invalid credentials', 401);
    return;
  }

  const token = signToken({
    id: user.id,
    role: user.role,
    practiceId: user.practice_id,
    email: user.email,
  });

  ok(res, {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      practice_id: user.practice_id,
    },
  });
});

staffRouter.use(authMiddleware('staff'));

staffRouter.get('/patients', (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const patients = listPatients(req.user!.practiceId, search);
  ok(res, patients);
});

staffRouter.post(
  '/patients/bulk-upload',
  (req, res, next) => {
    excelMemoryUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        fail(res, 'VALIDATION_ERROR', err instanceof Error ? err.message : 'Upload failed', 422);
        return;
      }
      next();
    });
  },
  (req, res) => {
    if (!req.file?.buffer) {
      fail(res, 'VALIDATION_ERROR', 'Excel file field "file" is required', 422);
      return;
    }
    const parsed = parsePatientExcelBuffer(req.file.buffer);
    const result = bulkImportPatientsFromExcelRows(
      req.user!.practiceId,
      parsed.rows,
      parsed.total_rows,
      parsed.errors,
    );
    ok(res, result);
  },
);

staffRouter.get('/patients/:id', (req, res) => {
  const detail = getPatientDetail(req.params.id, req.user!.practiceId);
  if (!detail) {
    fail(res, 'NOT_FOUND', 'Patient not found', 404);
    return;
  }
  ok(res, detail);
});

const coreUpdateSchema = z.object({
  child_first_name: z.string().optional(),
  child_last_name: z.string().optional(),
  child_dob: z.string().optional(),
  visit_type: z.string().optional(),
  preferred_language: z.string().optional(),
  sex: z.string().optional(),
  race_ethnicity: z.string().optional(),
});

staffRouter.patch('/patients/:id/core', (req, res) => {
  const parsed = coreUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid payload', 422, parsed.error.flatten());
    return;
  }

  updatePatientCore(req.params.id, req.user!.practiceId, parsed.data);
  ok(res, { updated: true });
});

const tableUpdateSchema = z.object({
  rows: z.array(z.record(z.unknown())).optional(),
  data: z.record(z.unknown()).optional(),
});

staffRouter.put('/patients/:id/table/:table', (req, res) => {
  const parsed = tableUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid payload', 422, parsed.error.flatten());
    return;
  }

  const table = req.params.table;

  try {
    if (parsed.data.rows) {
      replaceChildTable(req.params.id, table, parsed.data.rows);
    } else if (parsed.data.data) {
      upsertOneToOne(req.params.id, table, parsed.data.data);
    } else {
      fail(res, 'VALIDATION_ERROR', 'rows or data is required', 422);
      return;
    }

    ok(res, { updated: true, table });
  } catch (error) {
    fail(res, 'UPDATE_ERROR', (error as Error).message, 400);
  }
});

staffRouter.get('/submissions', (req, res) => {
  const submissions = listSubmissions(req.user!.practiceId);
  ok(res, submissions);
});

staffRouter.post('/submissions/expire-stale', (_req, res) => {
  const count = expireStaleSubmissions(48);
  ok(res, { expired: count });
});

staffRouter.get('/submissions/:id/json', (req, res) => {
  try {
    getStaffScopedSubmissionOrFail(req.params.id, req.user!.practiceId);
    const exported = exportSubmissionJson(req.params.id, req.user!.id);
    const templateContext = getTemplateBySubmissionContext(req.params.id);
    const templateBoundAnswers = templateContext
      ? buildTemplateBoundAnswers({
          template: {
            id: templateContext.template.id,
            template_key: templateContext.template.template_key,
            version: templateContext.template.version,
          },
          fields: templateContext.fields as TemplateFieldContext[],
          responses: (exported.responses ?? {}) as Record<string, unknown>,
        })
      : null;

    addSubmissionEvent({
      submissionId: req.params.id,
      practiceId: req.user!.practiceId,
      actorType: 'staff',
      actorId: req.user!.id,
      eventType: 'json_exported',
    });
    ok(res, {
      ...exported,
      template_bound_answers: templateBoundAnswers,
    });
  } catch {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
  }
});

staffRouter.get('/submissions/:id/responses', (req, res) => {
  try {
    const submission = getStaffScopedSubmissionOrFail(req.params.id, req.user!.practiceId);
    const templateContext = getTemplateBySubmissionContext(req.params.id);
    if (!templateContext) {
      fail(res, 'NOT_FOUND', 'Template context not found for submission', 404);
      return;
    }

    const responses = JSON.parse(submission.responses_json || '{}') as Record<string, unknown>;
    const templateBoundAnswers = buildTemplateBoundAnswers({
      template: {
        id: templateContext.template.id,
        template_key: templateContext.template.template_key,
        version: templateContext.template.version,
      },
      fields: templateContext.fields as TemplateFieldContext[],
      responses,
    });

    ok(res, {
      submission_id: submission.id,
      status: submission.status,
      updated_at: submission.updated_at,
      template_bound_answers: templateBoundAnswers,
    });
  } catch {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
  }
});

const responsePatchSchema = z.object({
  responses: z.record(z.unknown()),
});

staffRouter.patch('/submissions/:id/responses', (req, res) => {
  const parsed = responsePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid response payload', 422, parsed.error.flatten());
    return;
  }

  let scopedSubmission: { id: string; practice_id: string };
  try {
    scopedSubmission = getStaffScopedSubmissionOrFail(req.params.id, req.user!.practiceId);
  } catch {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
    return;
  }

  try {
    const normalizedResponses: Record<string, { value: unknown; updated_at?: string }> = {};
    for (const [fieldId, rawValue] of Object.entries(parsed.data.responses)) {
      if (rawValue && typeof rawValue === 'object' && 'value' in (rawValue as Record<string, unknown>)) {
        normalizedResponses[fieldId] = rawValue as { value: unknown; updated_at?: string };
      } else {
        normalizedResponses[fieldId] = { value: rawValue };
      }
    }

    const updated = autosaveSubmissionResponses({
      submissionId: scopedSubmission.id,
      responses: normalizedResponses,
    });

    addSubmissionEvent({
      submissionId: scopedSubmission.id,
      practiceId: scopedSubmission.practice_id,
      actorType: 'staff',
      actorId: req.user!.id,
      eventType: 'staff_responses_updated',
      payload: {
        field_count: Object.keys(normalizedResponses).length,
      },
    });

    ok(res, {
      submission_id: updated.id,
      status: updated.status,
      updated_at: updated.updated_at,
    });
  } catch (error) {
    fail(res, 'UPDATE_ERROR', (error as Error).message, 400);
  }
});

staffRouter.get('/submissions/:id/pdf', async (req, res) => {
  try {
    getStaffScopedSubmissionOrFail(req.params.id, req.user!.practiceId);
    const exported = exportSubmissionJson(req.params.id, req.user!.id);
    let pdfBytes: Uint8Array;

    const templateContext = getTemplateBySubmissionContext(req.params.id);
    if (templateContext?.template.acroform_pdf_path) {
      const responseMap = (exported.responses ?? {}) as Record<string, unknown>;

      pdfBytes = await fillAcroformPdfWithResponses({
        acroformPdfPath: resolveDataPath(templateContext.template.acroform_pdf_path),
        fields: templateContext.fields as Array<{
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
          group_id?: string | null;
          group_value?: string | null;
        }>,
        responses: responseMap,
        groups: templateContext.groups as Array<{
          id: string;
          group_type: string;
          group_name: string;
          acro_group_name: string;
        }>,
      });
    } else {
      pdfBytes = await generateSubmissionPdf(exported);
    }

    const fileName = buildPatientRegistrationFileName(exported);

    addSubmissionEvent({
      submissionId: req.params.id,
      practiceId: req.user!.practiceId,
      actorType: 'staff',
      actorId: req.user!.id,
      eventType: 'pdf_exported',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=\"${fileName}\"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    fail(res, 'PDF_EXPORT_ERROR', (error as Error).message || 'Failed to export PDF', 500);
  }
});
