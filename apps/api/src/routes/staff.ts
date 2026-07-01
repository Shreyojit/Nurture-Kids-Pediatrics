import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { z } from 'zod';
import { comparePassword, hashPassword, signToken } from '../lib/auth.js';
import { fail, ok } from '../lib/response.js';
import { buildSubmissionDownloadFileName } from '../lib/pdfGenerator.js';
import { generateResponsesSummaryPdf } from '../lib/responsesSummaryPdf.js';
import { fillAcroformPdfWithResponses } from '../lib/acroformEngine.js';
import { hasOverlayFields, parseTemplateFieldSchema } from '../lib/fieldSchema.js';
import { fillPdfWithOverlaySchema } from '../lib/pdfOverlayFill.js';
import { isMchatTemplateKey } from '../lib/mchatRDefinition.js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getTemplateBySubmissionContext } from '../db/templateQueries.js';
import {
  addSubmissionEvent,
  autosaveSubmissionResponses,
  exportSubmissionJson,
  getPatientDetail,
  getSubmissionById,
  getStaffByEmail,
  bulkImportPatientsFromExcelRows,
  deletePatientCascade,
  listPatients,
  listSubmissions,
  expireStaleSubmissions,
  replaceChildTable,
  updatePatientCore,
  upsertOneToOne,
  findPracticeByName,
  findPracticeById,
  createOrganization,
  createLocation,
  findLocationByName,
  listLocationsForOrg,
  createStaffUser,
} from '../db/queries.js';
import { provisionDefaultTemplatesForPractice } from '../db/seedTemplates.js';
import { db, parseJson } from '../db/database.js';
import { config } from '../config.js';
import { ensurePatientPortalToken, regeneratePatientPortalToken } from '../db/portalQueries.js';
import { authMiddleware } from '../middleware/auth.js';
import { parsePatientExcelBuffer } from '../lib/patientExcelImport.js';
import path from 'node:path';
import {
  documentStorageKeyPrefix,
  insertPatientDocument,
  listDocumentsForStaff,
  getPatientDocumentById,
  resolveDocumentPath,
  deletePatientDocument,
} from '../db/patientDocumentQueries.js';
import { putObject, getObjectBuffer, deleteObject, objectExists, streamObjectToResponse } from '../lib/s3Storage.js';

export const staffRouter = Router();

const documentMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okMime = /^(application\/pdf|image\/(jpeg|png|gif|webp|heic|heif))$/.test(file.mimetype);
    const okExt = /\.(pdf|jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file.originalname ?? '');
    if (okMime || okExt) { cb(null, true); return; }
    cb(new Error('Only PDF or image files are allowed'));
  },
});

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
  group_id?: string | null;
  group_value?: string | null;
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
    let raw = input.responses[field.field_id];
    if (field.field_type === 'radio_option' && field.group_id) {
      const groupRaw = input.responses[`__group_${field.group_id}`];
      const selectedGroupValue = unwrapResponseValue(groupRaw);
      raw = selectedGroupValue === field.group_value ? selectedGroupValue : undefined;
    }
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

  const locationId = (user.location_id as string | null) ?? null;

  const token = signToken({
    id: user.id as string,
    role: user.role as 'staff' | 'admin',
    practiceId: user.practice_id as string,
    locationId,
    email: user.email as string,
  });

  // Resolve location display name if available
  let locationName: string | null = null;
  if (locationId) {
    const locRow = db.prepare('select location_name, state, city from practices where id = ?').get(locationId) as
      | { location_name: string | null; state: string | null; city: string | null }
      | undefined;
    locationName = locRow?.location_name ?? null;
  }

  ok(res, {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      org_id: user.practice_id,
      org_name: practice.name,
      location_id: locationId,
      location_name: locationName,
      // Legacy fields
      practice_id: user.practice_id,
      practice_name: practice.name,
    },
  });
});

const staffRegisterSchema = z.object({
  /** The root organization / group name. Required. */
  org_name: z.string().min(2, 'Organization name must be at least 2 characters'),
  /**
   * Optional location / branch name within the org.
   * e.g. "Texas", "Sunshine Pediatrics", "Downtown Office"
   * If omitted the staff member is org-wide (no specific branch).
   */
  location_name: z.string().optional(),
  state: z.string().max(50).optional(),
  city: z.string().max(100).optional(),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Deprecated alias — still accepted for older clients
  practice_name: z.string().optional(),
});

staffRouter.post('/register', (req, res) => {
  const parsed = staffRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid registration payload', 422, parsed.error.flatten());
    return;
  }

  // Accept either the new `org_name` or the legacy `practice_name` field
  const orgName = (parsed.data.org_name || parsed.data.practice_name || '').trim();
  if (!orgName) {
    fail(res, 'VALIDATION_ERROR', 'Organization name is required', 422);
    return;
  }

  const { location_name, state, city, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = getStaffByEmail(normalizedEmail);
  if (existingUser) {
    fail(res, 'EMAIL_TAKEN', 'An account with this email already exists', 409);
    return;
  }

  // ── 1. Resolve (or create) the root organization ─────────────────────────
  let org = findPracticeByName(orgName);
  const isNewOrg = !org;
  if (!org) {
    org = createOrganization(orgName);
  }
  const orgId = org.id as string;

  // ── 2. Resolve (or create) the location/branch, if specified ─────────────
  let locationId: string | null = null;
  if (location_name?.trim()) {
    const trimmedLoc = location_name.trim();
    let loc = findLocationByName(orgId, trimmedLoc);
    if (!loc) {
      loc = createLocation({ organizationId: orgId, locationName: trimmedLoc, state, city });
    }
    locationId = loc.id as string;
  }

  // ── 3. Create staff user ──────────────────────────────────────────────────
  const passwordHash = hashPassword(password);
  const newUser = createStaffUser({
    email: normalizedEmail,
    passwordHash,
    practiceId: orgId,
    locationId,
    role: 'admin',
  });

  // ── 4. Provision standard forms for brand-new orgs ────────────────────────
  if (isNewOrg) {
    const provision = provisionDefaultTemplatesForPractice(orgId, newUser.id);
    if (provision.errors.length > 0) {
      console.warn('[register] template provisioning warnings for', orgName, provision.errors);
    } else if (provision.copied > 0) {
      console.log(`[register] provisioned ${provision.copied} template(s) for new org "${orgName}"`);
    }
  }

  // ── 5. Sign JWT ───────────────────────────────────────────────────────────
  const token = signToken({
    id: newUser.id,
    role: 'admin',
    practiceId: orgId,
    locationId,
    email: newUser.email,
  });

  ok(res, {
    token,
    user: {
      id: newUser.id,
      email: newUser.email,
      role: 'admin',
      org_id: orgId,
      org_name: org.name,
      location_id: locationId,
      location_name: locationId ? location_name : null,
      // Legacy field kept for backward compat
      practice_id: orgId,
      practice_name: org.name,
    },
  });
});

staffRouter.use(authMiddleware('staff'));

/** Current logged-in staff profile (org, branch, role). */
staffRouter.get('/me', (req, res) => {
  const org = findPracticeById(req.user!.practiceId);
  let locationName: string | null = null;
  let locationState: string | null = null;
  let facilityGroupName: string | null = null;

  if (req.user!.locationId) {
    const loc = db
      .prepare(
        `select location_name, state, facility_group_name from practices where id = ?`,
      )
      .get(req.user!.locationId) as
      | { location_name: string | null; state: string | null; facility_group_name: string | null }
      | undefined;
    locationName = loc?.location_name ?? null;
    locationState = loc?.state ?? null;
    facilityGroupName = loc?.facility_group_name ?? null;
  }

  ok(res, {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    org_id: req.user!.practiceId,
    org_name: org?.name ?? null,
    location_id: req.user!.locationId ?? null,
    location_name: locationName,
    location_state: locationState,
    facility_group_name: facilityGroupName,
  });
});

/** List all locations/branches for the logged-in org. */
staffRouter.get('/locations', (req, res) => {
  const rows = listLocationsForOrg(req.user!.practiceId);
  ok(res, rows);
});

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

/** DELETE /api/staff/patients/:id — permanently remove a patient and all their records. */
staffRouter.delete('/patients/:id', (req, res) => {
  const deleted = deletePatientCascade(req.params.id, req.user!.practiceId);
  if (!deleted) {
    fail(res, 'NOT_FOUND', 'Patient not found', 404);
    return;
  }
  ok(res, { deleted: true });
});

/** GET /api/staff/patients/:id/registration-pdf — download most recent registration as PDF. */
staffRouter.get('/patients/:id/registration-pdf', (req, res) => {
  const row = db
    .prepare(
      `select responses_json from patient_registrations
       where patient_id = ? and practice_id = ?
       order by created_at desc limit 1`,
    )
    .get(req.params.id, req.user!.practiceId) as { responses_json: string } | undefined;

  if (!row) {
    fail(res, 'NOT_FOUND', 'No registration found for this patient', 404);
    return;
  }

  const responses = JSON.parse(row.responses_json) as Record<string, unknown>;
  const fn = String(responses.patient_first_name ?? 'patient').replace(/[^a-z0-9]/gi, '_');
  const ln = String(responses.patient_last_name ?? 'unknown').replace(/[^a-z0-9]/gi, '_');

  buildRegistrationPdf(responses)
    .then((pdfBytes) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="registration_${fn}_${ln}.pdf"`);
      res.send(Buffer.from(pdfBytes));
    })
    .catch((err) => {
      fail(res, 'PDF_ERROR', (err as Error).message, 500);
    });
});

async function buildRegistrationPdf(r: Record<string, unknown>): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 612, H = 792, M = 50;
  const CW = W - 2 * M;
  const BLUE = rgb(0.06, 0.24, 0.47);
  const DKGRAY = rgb(0.12, 0.12, 0.12);
  const LTGRAY = rgb(0.45, 0.45, 0.45);
  const BGBLUE = rgb(0.92, 0.95, 0.99);

  let page = pdfDoc.addPage([W, H]);
  let y = H - 80;

  function pageHeader() {
    page.drawRectangle({ x: 0, y: H - 68, width: W, height: 68, color: BLUE });
    page.drawText('New Patient Registration', {
      x: M, y: H - 40, size: 18, font: boldFont, color: rgb(1, 1, 1),
    });
    page.drawText('Confidential Patient Record', {
      x: M, y: H - 58, size: 10, font, color: rgb(0.8, 0.9, 1),
    });
  }
  pageHeader();

  function checkY(need: number) {
    if (y - need < 40) {
      page.drawText('— continued —', { x: W / 2 - 28, y: 28, size: 8, font, color: LTGRAY });
      page = pdfDoc.addPage([W, H]);
      pageHeader();
      y = H - 88;
    }
  }

  function sectionHead(title: string) {
    checkY(36);
    y -= 10;
    page.drawRectangle({ x: M, y: y - 5, width: CW, height: 20, color: BGBLUE });
    page.drawText(title.toUpperCase(), { x: M + 8, y: y + 2, size: 9, font: boldFont, color: BLUE });
    y -= 22;
  }

  function v(key: string): string {
    const val = r[key];
    if (Array.isArray(val)) return (val as unknown[]).join(', ');
    return String(val ?? '').trim();
  }

  function field(label: string, value: string) {
    if (!value) return;
    const maxChars = 90;
    checkY(26);
    page.drawText(label + ':', { x: M, y, size: 8, font: boldFont, color: LTGRAY });
    const words = value.split(' ');
    let line = '', firstLine = true;
    for (const word of words) {
      if ((line + (line ? ' ' : '') + word).length > maxChars) {
        checkY(14);
        page.drawText(line, { x: M + 145, y: firstLine ? y : y, size: 10, font, color: DKGRAY });
        if (firstLine) { firstLine = false; } else { y -= 13; }
        line = word;
        if (!firstLine) y -= 13;
      } else {
        line += (line ? ' ' : '') + word;
      }
    }
    if (line) {
      page.drawText(line, { x: M + 145, y, size: 10, font, color: DKGRAY });
    }
    y -= 16;
  }

  // ── Patient Information ──────────────────────────────────────────────────
  sectionHead('Patient Information');
  field('Last Name', v('patient_last_name'));
  field('First Name', v('patient_first_name'));
  field('Middle Initial', v('patient_middle_initial'));
  field('Sex', v('patient_sex'));
  field('Date of Birth', v('patient_dob'));
  field('Social Security #', v('patient_ssn'));
  field('Home Phone', v('patient_home_phone'));
  field('Address', v('patient_address'));
  field('City', v('patient_city'));
  field('State', v('patient_state'));
  field('Zip Code', v('patient_zip'));
  sectionHead('Emergency Contact');
  field('Name', v('emergency_name'));
  field('Relationship', v('emergency_relationship'));
  field('Phone', v('emergency_phone'));

  // ── Guardian 1 ───────────────────────────────────────────────────────────
  sectionHead('Guardian 1');
  field('Type', v('guardian1_type'));
  field('Full Name', v('guardian1_name'));
  field('Date of Birth', v('guardian1_dob'));
  field('Email', v('guardian1_email'));
  field('Home Phone', v('guardian1_home_phone'));
  field('Work Phone', v('guardian1_work_phone'));
  field('Cell Phone', v('guardian1_cell'));
  field('Marital Status', v('guardian1_marital_status'));
  field('Address', v('guardian1_address'));
  field('City', v('guardian1_city'));
  field('State', v('guardian1_state'));
  field('Zip', v('guardian1_zip'));

  // ── Guardian 2 ───────────────────────────────────────────────────────────
  sectionHead('Guardian 2');
  field('Type', v('guardian2_type'));
  field('Full Name', v('guardian2_name'));
  field('Date of Birth', v('guardian2_dob'));
  field('Email', v('guardian2_email'));
  field('Home Phone', v('guardian2_home_phone'));
  field('Work Phone', v('guardian2_work_phone'));
  field('Cell Phone', v('guardian2_cell'));
  field('Marital Status', v('guardian2_marital_status'));
  field('Address', v('guardian2_address'));
  field('City', v('guardian2_city'));
  field('State', v('guardian2_state'));
  field('Zip', v('guardian2_zip'));

  // ── Insurance ────────────────────────────────────────────────────────────
  sectionHead('Primary Insurance');
  field('Insurance Company', v('primary_insurance_company'));
  field('Policyholder Name', v('primary_policyholder'));
  field('Policyholder DOB', v('primary_policyholder_dob'));
  field('Member ID', v('primary_member_id'));
  field('Group Number', v('primary_group_number'));
  sectionHead('Secondary Insurance');
  field('Insurance Company', v('secondary_insurance_company'));
  field('Policyholder Name', v('secondary_policyholder'));
  field('Policyholder DOB', v('secondary_policyholder_dob'));
  field('Member ID', v('secondary_member_id'));
  field('Group Number', v('secondary_group_number'));

  // ── Medical History ──────────────────────────────────────────────────────
  sectionHead('Medical History');
  field('Information Provided By', v('medical_info_by'));
  field('Reason for Visit', v('reason_for_visit'));
  field('Current Medications', v('current_medications'));
  field('Medication Allergies', v('allergy_medications'));
  field('Food Allergies', v('allergy_foods'));
  field('Other Allergies', v('allergy_other'));

  // ── HIPAA ────────────────────────────────────────────────────────────────
  sectionHead('HIPAA Authorization / Release of Information');
  field('Patient Name', v('hipaa_patient_name'));
  field('Date of Birth', v('hipaa_patient_dob'));
  field('Telephone', v('hipaa_phone'));
  field('Release From', v('hipaa_release_from'));
  field('Released To', v('hipaa_released_to'));
  field('Information to Release', v('hipaa_release_info'));
  field('Reason for Disclosure', v('hipaa_reason'));
  field('Signature', v('hipaa_signature'));
  field('Signature Date', v('hipaa_signature_date'));
  field('Relationship', v('hipaa_relationship'));

  // ── Financial Policy ─────────────────────────────────────────────────────
  sectionHead('Insurance Authorization');
  field('Patient Name', v('insurance_auth_patient_name'));
  field('Patient DOB', v('insurance_auth_patient_dob'));
  field('Parent / Guardian Name', v('insurance_auth_parent_name'));
  field('Relationship', v('insurance_auth_relationship'));
  field('Signature', v('insurance_auth_signature'));
  field('Date', v('insurance_auth_date'));
  sectionHead('Text / Email Authorization');
  field('Email', v('text_email'));
  field('Cell Phone', v('text_cell'));
  field('Patient Name', v('text_patient_name'));
  field('Print Name', v('text_print_name'));
  field('Relationship', v('text_relationship'));
  field('Signature', v('text_signature'));
  field('Date', v('text_date'));
  sectionHead('Financial Policy');
  field('Acknowledged', r['financial_policy_ack'] ? 'Yes' : '');
  field('Parent / Guardian Name', v('financial_parent_name'));
  field('Signature', v('financial_signature'));
  field('Date', v('financial_date'));
  sectionHead('Credit Card Authorization');
  field('Patient Name', v('card_patient_name'));
  field('Authorized', r['card_on_file_ack'] ? 'Yes' : '');
  field('Parent / Guardian Name', v('card_parent_name'));
  field('Signature', v('card_signature'));
  field('Date', v('card_date'));

  // ── Consent ──────────────────────────────────────────────────────────────
  sectionHead('Informed Consent');
  field('Name', v('consent_name'));
  field('Consent Acknowledged', r['informed_consent_ack'] ? 'Yes' : '');
  field('Client Signature', v('client_signature'));
  field('Client Signature Date', v('client_signature_date'));
  field('Guardian Signature', v('guardian_consent_signature'));
  field('Guardian Date', v('guardian_consent_date'));
  sectionHead('Non-Parent Authorization');
  field('Name', v('nonparent_name'));
  field('Relationship', v('nonparent_relationship'));
  field('Patient Name', v('nonparent_patient_name'));
  field('Patient DOB', v('nonparent_patient_dob'));
  field('Authorized Person', v('authorized_person'));
  field('Authorized Person Phone', v('authorized_person_phone'));
  field('Additional Authorized Person', v('additional_authorized_person'));
  field('Additional Phone', v('additional_authorized_phone'));
  field('Signature', v('nonparent_signature'));
  field('Date', v('nonparent_date'));

  // Page numbers
  const allPages = pdfDoc.getPages();
  allPages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${allPages.length}`, {
      x: W / 2 - 22, y: 22, size: 8, font, color: LTGRAY,
    });
  });

  return pdfDoc.save();
}

function practiceSlug(practiceId: string): string {
  const practice = findPracticeById(practiceId) as { slug?: string } | undefined;
  return practice?.slug ?? 'unknown';
}

/** GET /api/staff/documents?patient_id=:id — list documents for a patient. */
staffRouter.get('/documents', (req, res) => {
  const { patient_id } = req.query as Record<string, string>;
  const docs = listDocumentsForStaff(req.user!.practiceId, patient_id || undefined);
  ok(res, docs);
});

/** POST /api/staff/documents — upload a file for a patient. */
staffRouter.post('/documents', documentMemoryUpload.single('file'), async (req, res) => {
  const { patient_id, document_type } = req.body as Record<string, string>;
  if (!patient_id || !document_type || !req.file) {
    fail(res, 'VALIDATION_ERROR', 'patient_id, document_type, and file are required', 422);
    return;
  }
  const patient = getPatientDetail(patient_id, req.user!.practiceId);
  if (!patient) { fail(res, 'NOT_FOUND', 'Patient not found', 404); return; }

  const ext = path.extname(req.file.originalname) || '';
  const storedKey = `${documentStorageKeyPrefix(req.user!.practiceId, patient_id)}/${Date.now()}${ext}`;
  await putObject(storedKey, req.file.buffer, req.file.mimetype);

  const doc = insertPatientDocument({
    practiceId: req.user!.practiceId,
    patientId: patient_id,
    documentType: document_type,
    originalFilename: req.file.originalname,
    storedKey,
    uploadedBy: req.user!.id,
  });
  ok(res, doc);
});

/** DELETE /api/staff/documents/:id — delete a patient document. */
staffRouter.delete('/documents/:id', async (req, res) => {
  const doc = getPatientDocumentById(req.params.id, req.user!.practiceId);
  if (!doc) { fail(res, 'NOT_FOUND', 'Document not found', 404); return; }
  await deleteObject(resolveDocumentPath(doc));
  deletePatientDocument(req.params.id, req.user!.practiceId);
  ok(res, { deleted: true });
});

/** GET /api/staff/documents/:id/download — staff download of a patient document. */
staffRouter.get('/documents/:id/download', async (req, res) => {
  const doc = getPatientDocumentById(req.params.id, req.user!.practiceId);
  if (!doc) { fail(res, 'NOT_FOUND', 'Document not found', 404); return; }
  await streamObjectToResponse(resolveDocumentPath(doc), res, { download: true, filename: doc.original_filename });
});

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

/**
 * Provision the standard form library for this practice.
 * Safe to call multiple times — already-present templates are skipped.
 * Useful for practices that were created before auto-provisioning was introduced.
 */
staffRouter.post('/templates/provision', (req, res) => {
  const result = provisionDefaultTemplatesForPractice(req.user!.practiceId, req.user!.id);
  ok(res, {
    message: result.copied > 0
      ? `Provisioned ${result.copied} template(s) for your practice.`
      : result.skipped > 0
        ? `All ${result.skipped} standard template(s) are already present.`
        : 'Nothing to provision.',
    ...result,
  });
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
        sourcePdfBytes: await getObjectBuffer(templateContext.template.source_pdf_path),
        schema: overlaySchema,
        responses: responseMap,
      });
    } else if (templateContext?.template.acroform_pdf_path) {
      pdfBytes = await fillAcroformPdfWithResponses({
        acroformPdfBytes: await getObjectBuffer(templateContext.template.acroform_pdf_path),
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
    } else if (templateContext?.template.is_marker_template) {
      // Visual-markers forms: the filled PDF was written to completed_pdf_path at submission time.
      const completedKey = exported.completed_pdf_path ? String(exported.completed_pdf_path) : null;
      if (completedKey && (await objectExists(completedKey))) {
        pdfBytes = new Uint8Array(await getObjectBuffer(completedKey));
      } else {
        pdfBytes = await generateResponsesSummaryPdf({
          title: String(templateContext.template.name ?? exported.form_id ?? 'Form Responses'),
          responses: (exported.responses ?? {}) as Record<string, unknown>,
        });
      }
    } else {
      // Generic fallback: produce a readable response-summary PDF.
      pdfBytes = await generateResponsesSummaryPdf({
        title: String(templateContext?.template.name ?? exported.form_id ?? 'Form Responses'),
        responses: (exported.responses ?? {}) as Record<string, unknown>,
      });
    }

    const formName = String(templateContext?.template.name ?? exported.form_id ?? 'form');
    const fileName = buildSubmissionDownloadFileName(exported, formName);

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
