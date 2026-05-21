import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config, resolveDataPath, toRelativeDataPath } from '../config.js';
import { ok, fail } from '../lib/response.js';
import { loadTemplate } from '../lib/templateLoader.js';
import { fillAcroformPdfWithResponses } from '../lib/acroformEngine.js';
import { hasOverlayFields, parseTemplateFieldSchema } from '../lib/fieldSchema.js';
import { fillPdfWithOverlaySchema } from '../lib/pdfOverlayFill.js';
import { isMchatTemplateKey } from '../lib/mchatRDefinition.js';
import { generateResponsesSummaryPdf } from '../lib/responsesSummaryPdf.js';
import { parseJson } from '../db/database.js';
import {
  getTemplateBySubmissionContext,
  getTemplateWithFields,
  listPublishedTemplatesForPractice,
  resolveIntakeTemplate,
} from '../db/templateQueries.js';
import {
  addSubmissionEvent,
  autosaveSubmission,
  autosaveSubmissionResponses,
  completeSubmission,
  completeSubmissionWithPdf,
  createSubmission,
  findPatientIdByPracticeNameDob,
  findPracticeById,
  findPracticeBySlug,
  getSubmissionById,
} from '../db/queries.js';
import { completeAssignmentBySubmissionId } from '../db/assignmentQueries.js';
import { filterPatientRegistrationFields, isExcludedPatientDobField } from '../lib/patientPhiFields.js';

export const publicRouter = Router();

type DynamicTemplateField = {
  field_id: string;
  label: string;
  label_es?: string;
  input_type: string;
  required: boolean;
  options: string[];
  validation_rules: Record<string, unknown>;
  font_size: number;
  group_id: string | null;
  group_value: string | null;
  parent_field_id: string | null;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DynamicTemplateStep = {
  step_id: string;
  title: string;
  fields: DynamicTemplateField[];
};

function toStepId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function normalizeFieldType(fieldType: string): string {
  if (fieldType === 'signature') return 'text';
  return fieldType;
}

function mapTemplateForPatient(template: Record<string, unknown>) {
  const sourceFields = Array.isArray(template.fields) ? (template.fields as Array<Record<string, unknown>>) : [];
  const sourceGroups = Array.isArray(template.groups) ? template.groups : [];
  const stepMap = new Map<string, DynamicTemplateStep>();

  for (const field of sourceFields) {
    const fieldId = String(field.field_id ?? '');
    if (isExcludedPatientDobField(fieldId)) continue;

    const sectionTitle = String(field.section_key ?? 'General');
    const sectionKey = toStepId(sectionTitle || 'general');

    if (!stepMap.has(sectionKey)) {
      stepMap.set(sectionKey, {
        step_id: sectionKey,
        title: sectionTitle || 'General',
        fields: [],
      });
    }

    const step = stepMap.get(sectionKey)!;
    const options = Array.isArray(field.options_json) ? field.options_json.map((item) => String(item)) : [];
    const validation =
      typeof field.validation_json === 'object' && field.validation_json !== null
        ? (field.validation_json as Record<string, unknown>)
        : {};
    const labelEsRaw = validation.label_es;
    const label_es =
      typeof labelEsRaw === 'string' && labelEsRaw.trim() ? String(labelEsRaw).trim() : undefined;

    step.fields.push({
      field_id: String(field.field_id ?? ''),
      label: String(field.field_name ?? ''),
      ...(label_es ? { label_es } : {}),
      input_type: normalizeFieldType(String(field.field_type ?? 'text')),
      required: Boolean(field.required),
      options,
      validation_rules: validation,
      font_size: Number(field.font_size ?? 12),
      group_id: field.group_id ? String(field.group_id) : null,
      group_value: field.group_value ? String(field.group_value) : null,
      parent_field_id: field.parent_field_id ? String(field.parent_field_id) : null,
      page_number: Number(field.page_number ?? 1),
      x: Number(field.x ?? 0),
      y: Number(field.y ?? 0),
      width: Number(field.width ?? 120),
      height: Number(field.height ?? 18),
    });
  }

  const templateKey = String(template.template_key ?? '');
  const isMchat = isMchatTemplateKey(templateKey);
  const field_schema = isMchat
    ? parseTemplateFieldSchema(
        typeof template.field_schema_json === 'string' ? template.field_schema_json : undefined,
      )
    : { fields: [] };
  const pdf_overlay_ready = isMchat && hasOverlayFields(field_schema);

  return {
    form_id: templateKey || 'patient_registration',
    template_id: String(template.id ?? ''),
    version: String(template.version ?? ''),
    title: String(template.name ?? 'Patient Registration'),
    ...(isMchat ? { field_schema, pdf_overlay_ready } : {}),
    steps: (() => {
      const steps = Array.from(stepMap.values());
      if (
        steps.length === 1 &&
        (steps[0].title === 'Imported' || steps[0].title === 'General') &&
        String(template.name ?? '').trim()
      ) {
        steps[0].title = String(template.name);
      }
      return steps;
    })(),
    groups: sourceGroups,
    acroform_ready: Boolean(template.acroform_pdf_path),
  };
}

publicRouter.get('/practices/:slug', (req, res) => {
  const practice = findPracticeBySlug(req.params.slug);
  if (!practice) {
    fail(res, 'NOT_FOUND', 'Practice not found', 404);
    return;
  }

  ok(res, {
    id: practice.id,
    name: practice.name,
    slug: practice.slug,
    logo_url: practice.logo_url,
    settings: JSON.parse((practice.settings_json as string) || '{}'),
  });
});

publicRouter.get('/forms/:formId/template', (req, res) => {
  try {
    const template = loadTemplate(req.params.formId);
    ok(res, template);
  } catch {
    fail(res, 'NOT_FOUND', 'Template not found', 404);
  }
});

publicRouter.get('/forms/active/:slug', (req, res) => {
  const practice = findPracticeBySlug(req.params.slug);
  if (!practice) {
    fail(res, 'NOT_FOUND', 'Practice not found', 404);
    return;
  }

  const requestedTemplateKey = typeof req.query.template_key === 'string' ? req.query.template_key.trim() : '';
  if (requestedTemplateKey) {
    const template = resolveIntakeTemplate(String(practice.id), requestedTemplateKey);
    if (!template) {
      fail(
        res,
        'NOT_FOUND',
        `No template found for "${requestedTemplateKey}"${isMchatTemplateKey(requestedTemplateKey) ? ' (upload a source PDF for mchat; publish optional)' : ''}`,
        404,
      );
      return;
    }
    ok(res, mapTemplateForPatient(template));
    return;
  }

  const published = listPublishedTemplatesForPractice(String(practice.id));
  ok(res, {
    practice_slug: practice.slug,
    templates: published.map((template) => ({
      id: template.id,
      template_key: template.template_key,
      version: template.version,
      name: template.name,
      status: template.status,
      acroform_ready: Boolean(template.acroform_pdf_path),
    })),
  });
});

const createSubmissionSchema = z.object({
  practice_id: z.string().uuid(),
  child_first_name: z.string().min(1),
  child_last_name: z.string().min(1),
  child_dob: z.string().optional(),
  visit_type: z.enum(['new_patient', 'well_child', 'sick', 'follow_up']),
  template_key: z.string().min(1).optional(),
});

publicRouter.post('/submissions', (req, res) => {
  const parsed = createSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid request body', 422, parsed.error.flatten());
    return;
  }

  const practice = findPracticeById(parsed.data.practice_id);
  if (!practice) {
    fail(res, 'NOT_FOUND', 'Practice not found', 404);
    return;
  }

  const selectedTemplateKey = parsed.data.template_key ?? 'patient_registration';
  const resolvedTemplate = resolveIntakeTemplate(parsed.data.practice_id, selectedTemplateKey);
  if (!resolvedTemplate) {
    fail(
      res,
      'NO_ACTIVE_TEMPLATE',
      `No usable template found for "${selectedTemplateKey}".${isMchatTemplateKey(selectedTemplateKey) ? ' For M-CHAT-R, upload the PDF source (publish optional); for other forms, staff must publish a version first.' : ' Staff must upload, generate, and publish this template first.'}`,
      422,
    );
    return;
  }

  const template = resolvedTemplate as Record<string, unknown>;
  const confirmationCode = `SP-${randomBytes(3).toString('hex').toUpperCase()}`;

  const childDob = parsed.data.child_dob?.trim() ?? '';

  const initialPayload = {
    patient: {
      child: {
        first_name: parsed.data.child_first_name,
        last_name: parsed.data.child_last_name,
        ...(childDob ? { dob: childDob } : {}),
      },
    },
    visit_type: parsed.data.visit_type,
    template_key: selectedTemplateKey,
  };

  const existingPatientId = childDob
    ? findPatientIdByPracticeNameDob(
        parsed.data.practice_id,
        parsed.data.child_first_name,
        parsed.data.child_last_name,
        childDob,
      )
    : undefined;

  const submission = createSubmission({
    practiceId: parsed.data.practice_id,
    patientId: existingPatientId,
    visitType: parsed.data.visit_type,
    formId: String(template.template_key),
    templateVersion: `${String(template.template_key)}@v${String(template.version)}`,
    templateId: String(template.id),
    templateVersionNum: Number(template.version),
    initialData: initialPayload,
    confirmationCode,
    ipAddress: req.ip,
  });

  addSubmissionEvent({
    submissionId: submission.id,
    practiceId: parsed.data.practice_id,
    actorType: 'system',
    eventType: 'submission_created',
    payload: { visit_type: parsed.data.visit_type },
  });

  ok(res, {
    session_id: submission.id,
    forms_to_complete: [submission.form_id],
    confirmation_code: submission.confirmation_code,
    template_version: submission.template_version,
    template_id: submission.template_id,
  });
});

const legacyAutosaveSchema = z.object({
  form_id: z.string().min(1),
  step: z.number().int().min(1),
  data: z.record(z.unknown()),
});

const responseAutosaveSchema = z.object({
  step: z.number().int().min(1).optional(),
  responses: z.record(z.unknown()),
});

publicRouter.patch('/submissions/:id/autosave', (req, res) => {
  const parsed = z.union([legacyAutosaveSchema, responseAutosaveSchema]).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid autosave payload', 422, parsed.error.flatten());
    return;
  }

  const submission = getSubmissionById(req.params.id);
  if (!submission) {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
    return;
  }

  let updated = submission;
  if ('responses' in parsed.data) {
    const normalizedResponses: Record<string, { value: unknown; updated_at?: string }> = {};
    for (const [fieldId, rawValue] of Object.entries(parsed.data.responses)) {
      if (rawValue && typeof rawValue === 'object' && 'value' in (rawValue as Record<string, unknown>)) {
        normalizedResponses[fieldId] = rawValue as { value: unknown; updated_at?: string };
      } else {
        normalizedResponses[fieldId] = { value: rawValue };
      }
    }
    updated = autosaveSubmissionResponses({
      submissionId: submission.id,
      responses: normalizedResponses,
    });
  } else {
    updated = autosaveSubmission({
      submissionId: submission.id,
      formId: parsed.data.form_id,
      data: parsed.data.data,
    });
  }

  addSubmissionEvent({
    submissionId: updated.id,
    practiceId: updated.practice_id,
    actorType: 'parent',
    eventType: 'autosave',
    payload: { step: parsed.data.step ?? null },
  });

  ok(res, {
    submission_id: updated.id,
    status: updated.status,
    updated_at: updated.updated_at,
  });
});

publicRouter.get('/submissions/:id/template', (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
    return;
  }

  if (submission.template_id) {
    try {
      const template = getTemplateWithFields(submission.template_id, submission.practice_id);
      const mapped = mapTemplateForPatient(template as Record<string, unknown>);
      const responses = parseJson<Record<string, unknown>>(submission.responses_json, {});
      ok(res, {
        submission_id: submission.id,
        visit_type: submission.visit_type,
        ...mapped,
        responses,
      });
      return;
    } catch {
      // fall through to legacy file template for backward compatibility
    }
  }

  try {
    const legacyTemplate = loadTemplate('new_patient_paperwork');
    ok(res, {
      submission_id: submission.id,
      visit_type: submission.visit_type,
      ...legacyTemplate,
      steps: legacyTemplate.steps.map((step) => ({
        ...step,
        fields: filterPatientRegistrationFields(step.fields),
      })),
      responses: {},
    });
  } catch {
    fail(res, 'NOT_FOUND', 'Template not found', 404);
  }
});

publicRouter.get('/submissions/:id/source-pdf', (req, res) => {
  const templateContext = getTemplateBySubmissionContext(req.params.id);
  if (!templateContext?.template.source_pdf_path) {
    fail(res, 'NOT_FOUND', 'Source PDF not available for this submission', 404);
    return;
  }
  const pdfPath = resolveDataPath(templateContext.template.source_pdf_path);
  if (!fs.existsSync(pdfPath)) {
    fail(res, 'NOT_FOUND', 'Source PDF file not found on disk', 404);
    return;
  }
  res.sendFile(pdfPath);
});

publicRouter.get('/submissions/:id/acroform-pdf', (req, res) => {
  const templateContext = getTemplateBySubmissionContext(req.params.id);
  if (!templateContext?.template.acroform_pdf_path) {
    fail(res, 'NOT_FOUND', 'AcroForm PDF not available for this submission', 404);
    return;
  }
  const pdfPath = resolveDataPath(templateContext.template.acroform_pdf_path);
  if (!fs.existsSync(pdfPath)) {
    fail(res, 'NOT_FOUND', 'AcroForm PDF file not found on disk', 404);
    return;
  }
  res.sendFile(pdfPath);
});

publicRouter.get('/submissions/:id/responses-pdf', async (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
    return;
  }
  try {
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
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_responses.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    fail(res, 'RESPONSES_PDF_ERROR', (error as Error).message || 'Failed to build responses PDF', 500);
  }
});

publicRouter.post('/submissions/:id/complete', (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
    return;
  }

  (async () => {
    let completedPdfPath: string | null = null;
    const templateContext = getTemplateBySubmissionContext(submission.id);

    const templateKey = String(templateContext?.template.template_key ?? submission.form_id ?? '');
    const responseMap = parseJson<Record<string, unknown>>(submission.responses_json, {});

    const overlaySchema = parseTemplateFieldSchema(templateContext?.template.field_schema_json);
    if (
      templateContext &&
      isMchatTemplateKey(templateKey) &&
      hasOverlayFields(overlaySchema) &&
      templateContext.template.source_pdf_path
    ) {
      const sourcePath = resolveDataPath(templateContext.template.source_pdf_path);
      if (fs.existsSync(sourcePath)) {
        const pdfBytes = await fillPdfWithOverlaySchema({
          sourcePdfPath: sourcePath,
          schema: overlaySchema,
          responses: responseMap,
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
        const safeTemplateKey = String(templateContext.template.template_key || 'form')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .replace(/_+/g, '_');
        const submissionsDir = path.join(config.dataPath, 'submissions', submission.id);
        fs.mkdirSync(submissionsDir, { recursive: true });
        const absoluteCompleted = path.join(submissionsDir, `${safeName}_${safeTemplateKey}_completed.pdf`);
        fs.writeFileSync(absoluteCompleted, Buffer.from(pdfBytes));
        completedPdfPath = toRelativeDataPath(absoluteCompleted);
      }
    } else if (templateContext?.template.acroform_pdf_path) {
      const templateWithGroups = getTemplateWithFields(templateContext.template.id, templateContext.template.practice_id) as Record<string, unknown>;
      const pdfBytes = await fillAcroformPdfWithResponses({
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
        groups: (Array.isArray(templateWithGroups.groups) ? templateWithGroups.groups : []) as Array<{
          id: string;
          group_type: string;
          group_name: string;
          acro_group_name: string;
        }>,
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
      const safeTemplateKey = String(templateContext.template.template_key || 'form')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');

      const submissionsDir = path.join(config.dataPath, 'submissions', submission.id);
      fs.mkdirSync(submissionsDir, { recursive: true });
      const absoluteCompleted = path.join(submissionsDir, `${safeName}_${safeTemplateKey}_completed.pdf`);
      fs.writeFileSync(absoluteCompleted, Buffer.from(pdfBytes));
      completedPdfPath = toRelativeDataPath(absoluteCompleted);
    }

    const completed = completedPdfPath
      ? completeSubmissionWithPdf(submission.id, completedPdfPath)
      : completeSubmission(submission.id);

    completeAssignmentBySubmissionId(submission.id);

    addSubmissionEvent({
      submissionId: completed.id,
      practiceId: completed.practice_id,
      actorType: 'parent',
      eventType: 'submission_completed',
      payload: {
        completed_pdf_path: completed.completed_pdf_path,
      },
    });

    ok(res, {
      submission_id: completed.id,
      status: completed.status,
      confirmation_code: completed.confirmation_code,
      submitted_at: completed.submitted_at,
      completed_pdf_path: completed.completed_pdf_path,
    });
  })().catch((error) => {
    fail(res, 'SUBMISSION_COMPLETE_ERROR', (error as Error).message || 'Failed to complete submission', 500);
  });
});
