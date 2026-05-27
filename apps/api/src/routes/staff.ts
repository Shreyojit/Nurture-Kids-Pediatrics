import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { z } from 'zod';
import { comparePassword, hashPassword, signToken } from '../lib/auth.js';
import { fail, ok } from '../lib/response.js';
import { buildPatientRegistrationFileName, generateSubmissionPdf } from '../lib/pdfGenerator.js';
import { generateResponsesSummaryPdf } from '../lib/responsesSummaryPdf.js';
import { fillAcroformPdfWithResponses } from '../lib/acroformEngine.js';
import { hasOverlayFields, parseTemplateFieldSchema } from '../lib/fieldSchema.js';
import { fillPdfWithOverlaySchema } from '../lib/pdfOverlayFill.js';
import { isMchatTemplateKey } from '../lib/mchatRDefinition.js';
import { getTemplateBySubmissionContext, getTemplateWithFields } from '../db/templateQueries.js';
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
  findPracticeByName,
  findPracticeById,
  createPractice,
  createStaffUser,
} from '../db/queries.js';
import { parseJson } from '../db/database.js';
import { config, resolveDataPath } from '../config.js';
import { ensurePatientPortalToken, regeneratePatientPortalToken } from '../db/portalQueries.js';
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
  practice_name: z.string().min(1),
});

staffRouter.post('/login', (req, res) => {
  const parsed = staffLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid login payload', 422, parsed.error.flatten());
    return;
  }

  // Validate practice name first
  const practice = findPracticeByName(parsed.data.practice_name);
  if (!practice) {
    fail(res, 'INVALID_CREDENTIALS', 'Practice not found', 401);
    return;
  }

  const user = getStaffByEmail(parsed.data.email.toLowerCase());
  if (!user || !user.is_active || !comparePassword(parsed.data.password, user.password_hash as string)) {
    fail(res, 'INVALID_CREDENTIALS', 'Invalid credentials', 401);
    return;
  }

  if (user.practice_id !== practice.id) {
    fail(res, 'INVALID_CREDENTIALS', 'This account is not registered for that practice', 401);
    return;
  }

  const token = signToken({
    id: user.id as string,
    role: user.role as 'staff' | 'admin',
    practiceId: user.practice_id as string,
    email: user.email as string,
  });

  ok(res, {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      practice_id: user.practice_id,
      practice_name: practice.name,
    },
  });
});

const staffRegisterSchema = z.object({
  practice_name: z.string().min(2, 'Practice name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

staffRouter.post('/register', (req, res) => {
  const parsed = staffRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid registration payload', 422, parsed.error.flatten());
    return;
  }

  const { practice_name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = getStaffByEmail(normalizedEmail);
  if (existingUser) {
    fail(res, 'EMAIL_TAKEN', 'An account with this email already exists', 409);
    return;
  }

  let practice = findPracticeByName(practice_name);
  if (!practice) {
    practice = createPractice(practice_name);
  }

  const passwordHash = hashPassword(password);
  const newUser = createStaffUser({
    email: normalizedEmail,
    passwordHash,
    practiceId: practice.id as string,
    role: 'admin',
  });

  const token = signToken({
    id: newUser.id,
    role: 'admin',
    practiceId: newUser.practiceId,
    email: newUser.email,
  });

  ok(res, {
    token,
    user: {
      id: newUser.id,
      email: newUser.email,
      role: 'admin',
      practice_id: practice.id,
      practice_name: practice.name,
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
  async (req, res) => {
    if (!req.file?.buffer) {
      fail(res, 'VALIDATION_ERROR', 'Excel file field "file" is required', 422);
      return;
    }
    const parsed = parsePatientExcelBuffer(req.file.buffer);
    const result = await bulkImportPatientsFromExcelRows(
      req.user!.practiceId,
      parsed.rows,
      parsed.total_rows,
      parsed.errors,
      req.user!.id,
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

function practiceSlug(practiceId: string): string {
  const practice = findPracticeById(practiceId) as { slug?: string } | undefined;
  return practice?.slug ?? 'unknown';
}

staffRouter.get('/patients/:id/portal-link', async (req, res) => {
  const auth = req.user as { id: string; practiceId: string };
  const patient = getPatientDetail(req.params.id, auth.practiceId);
  if (!patient) {
    fail(res, 'NOT_FOUND', 'Patient not found', 404);
    return;
  }
  const portalToken = ensurePatientPortalToken(req.params.id);
  const portalUrl = `${config.frontendUrl}/${practiceSlug(auth.practiceId)}/fill/portal/${portalToken}`;
  const qr_code_data_url = await QRCode.toDataURL(portalUrl, { width: 300, margin: 2 });
  ok(res, { portal_url: portalUrl, qr_code_data_url });
});

staffRouter.post('/patients/:id/regenerate-portal-token', async (req, res) => {
  const auth = req.user as { id: string; practiceId: string };
  const patient = getPatientDetail(req.params.id, auth.practiceId);
  if (!patient) {
    fail(res, 'NOT_FOUND', 'Patient not found', 404);
    return;
  }
  const portalToken = regeneratePatientPortalToken(req.params.id, auth.practiceId);
  const portalUrl = `${config.frontendUrl}/${practiceSlug(auth.practiceId)}/fill/portal/${portalToken}`;
  const qr_code_data_url = await QRCode.toDataURL(portalUrl, { width: 300, margin: 2 });
  ok(res, { portal_url: portalUrl, qr_code_data_url });
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
    const templateKey = String(templateContext?.template.template_key ?? '');
    const responseMap = (exported.responses ?? {}) as Record<string, unknown>;

    const overlaySchema = parseTemplateFieldSchema(templateContext?.template.field_schema_json);
    if (
      templateContext &&
      isMchatTemplateKey(templateKey) &&
      hasOverlayFields(overlaySchema) &&
      templateContext.template.source_pdf_path
    ) {
      pdfBytes = await fillPdfWithOverlaySchema({
        sourcePdfPath: resolveDataPath(templateContext.template.source_pdf_path),
        schema: overlaySchema,
        responses: responseMap,
      });
    } else if (templateContext?.template.acroform_pdf_path) {
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

/** Plain PDF listing `responses_json` keys and values (new document; does not alter the source template). */
staffRouter.get('/submissions/:id/responses-pdf', async (req, res) => {
  try {
    getStaffScopedSubmissionOrFail(req.params.id, req.user!.practiceId);
    const submission = getSubmissionById(req.params.id);
    if (!submission) {
      fail(res, 'NOT_FOUND', 'Submission not found', 404);
      return;
    }
    const responses = parseJson<Record<string, unknown>>(submission.responses_json, {});
    const ctx = getTemplateBySubmissionContext(submission.id);
    const templateName = ctx?.template.name ?? String(submission.form_id ?? '');
    const pdfBytes = await generateResponsesSummaryPdf({
      title: 'Questionnaire responses',
      subtitleLines: [
        `Submission: ${submission.id}`,
        `Form: ${String(submission.form_id ?? '')} · Template: ${templateName}`,
        submission.submitted_at ? `Submitted: ${submission.submitted_at}` : 'Not yet submitted',
        `Confirmation code: ${submission.confirmation_code}`,
      ],
      responses,
    });
    const form = parseJson<Record<string, unknown>>(submission.form_data_json, {});
    const child = (form.patient as Record<string, unknown> | undefined)?.child as Record<string, unknown> | undefined;
    const firstName = String(child?.first_name ?? 'patient');
    const lastName = String(child?.last_name ?? 'unknown');
    const safeName = `${firstName}_${lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=\"${safeName}_responses.pdf\"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    fail(res, 'PDF_EXPORT_ERROR', (error as Error).message || 'Failed to export responses PDF', 500);
  }
});
