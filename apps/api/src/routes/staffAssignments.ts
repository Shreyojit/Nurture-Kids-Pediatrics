import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { ok, fail } from '../lib/response.js';
import {
  getAssignmentById,
  listAssignmentsForPractice,
  listAssignmentsForPatient,
  expireStaleAssignments,
  deleteAssignment,
} from '../db/assignmentQueries.js';
import { createBundleWithAssignments } from '../db/bundleQueries.js';
import { ensurePatientPortalToken } from '../db/portalQueries.js';
import { db, nowIso } from '../db/database.js';

export const staffAssignmentsRouter = Router();

const expiresInDaysField = z.number().int().min(1).max(90).catch(7).optional();

const byPatientIdSchema = z.object({
  patient_id: z.string().uuid(),
  template_ids: z.array(z.string().uuid()).min(1),
  expires_in_days: expiresInDaysField,
});

const byNameDobSchema = z.object({
  first_name: z.string().min(1).trim(),
  last_name: z.string().min(1).trim(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD'),
  template_ids: z.array(z.string().uuid()).min(1),
  expires_in_days: expiresInDaysField,
});

staffAssignmentsRouter.post('/', async (req, res) => {
  const auth = req.user as { id: string; practiceId: string };

  let patientId: string;
  let patientName: string;
  let templateIds: string[];
  let expiresInDays: number | undefined;

  const byId = byPatientIdSchema.safeParse(req.body);
  if (byId.success) {
    const existing = db
      .prepare('select id, child_first_name, child_last_name from patients where id = ? and practice_id = ?')
      .get(byId.data.patient_id, auth.practiceId) as
      | { id: string; child_first_name: string; child_last_name: string }
      | undefined;
    if (!existing) { fail(res, 'NOT_FOUND', 'Patient not found', 404); return; }
    patientId = existing.id;
    patientName = `${existing.child_first_name} ${existing.child_last_name}`;
    templateIds = byId.data.template_ids;
    expiresInDays = byId.data.expires_in_days;
  } else {
    const byName = byNameDobSchema.safeParse(req.body);
    if (!byName.success) {
      fail(res, 'VALIDATION_ERROR', 'Provide patient_id or first_name + last_name + dob, plus template_ids array', 422, byName.error.flatten());
      return;
    }
    const { first_name, last_name, dob } = byName.data;
    templateIds = byName.data.template_ids;
    expiresInDays = byName.data.expires_in_days;

    const found = db
      .prepare(
        `select id from patients
         where practice_id = ?
           and lower(trim(child_first_name)) = lower(trim(?))
           and lower(trim(child_last_name)) = lower(trim(?))
           and child_dob = ?`,
      )
      .get(auth.practiceId, first_name, last_name, dob) as { id: string } | undefined;

    if (found) {
      patientId = found.id;
    } else {
      const now = nowIso();
      patientId = randomUUID();
      db.prepare(
        `insert into patients
           (id, practice_id, account_id, child_first_name, child_last_name, child_dob,
            visit_type, preferred_language, sex, race_ethnicity, created_at, updated_at)
         values (?, ?, null, ?, ?, ?, '', null, null, null, ?, ?)`,
      ).run(patientId, auth.practiceId, first_name, last_name, dob, now, now);
    }
    patientName = `${first_name} ${last_name}`;
  }

  // Verify all templates belong to this practice and are published
  const templates = templateIds.map((tid) => {
    const t = db
      .prepare(`select id, name from pdf_templates where id = ? and practice_id = ? and status = 'published'`)
      .get(tid, auth.practiceId) as { id: string; name: string } | undefined;
    return t;
  });
  if (templates.some((t) => !t)) {
    fail(res, 'NOT_FOUND', 'One or more templates not found or not published', 404);
    return;
  }

  const { bundle } = createBundleWithAssignments({
    practiceId: auth.practiceId,
    patientId,
    assignedBy: auth.id,
    templateIds,
    expiresInDays,
  });

  const portalToken = ensurePatientPortalToken(patientId);
  const portalUrl = `${config.frontendUrl}/${config.practiceSlug}/fill/portal/${portalToken}`;
  const portalQrCodeDataUrl = await QRCode.toDataURL(portalUrl, { width: 300, margin: 2 });

  const bundleUrl = `${config.frontendUrl}/${config.practiceSlug}/fill/bundle/${bundle.token}`;

  ok(res, {
    bundle_id: bundle.id,
    bundle_token: bundle.token,
    patient_name: patientName,
    template_names: (templates as Array<{ id: string; name: string }>).map((t) => t.name),
    fill_url: portalUrl,
    qr_code_data_url: portalQrCodeDataUrl,
    bundle_fill_url: bundleUrl,
    portal_url: portalUrl,
    portal_token: portalToken,
    expires_at: bundle.expires_at,
  });
});

staffAssignmentsRouter.get('/', (req, res) => {
  expireStaleAssignments();
  const auth = req.user as { practiceId: string };
  const assignments = listAssignmentsForPractice(auth.practiceId);
  ok(res, assignments);
});

staffAssignmentsRouter.get('/patient/:patientId', (req, res) => {
  expireStaleAssignments();
  const auth = req.user as { practiceId: string };
  const assignments = listAssignmentsForPatient(req.params.patientId, auth.practiceId);
  ok(res, assignments);
});

staffAssignmentsRouter.get('/:id/link', async (req, res) => {
  const auth = req.user as { practiceId: string };
  const assignment = getAssignmentById(req.params.id);

  if (!assignment || assignment.practice_id !== auth.practiceId) {
    fail(res, 'NOT_FOUND', 'Assignment not found', 404);
    return;
  }

  const portalToken = ensurePatientPortalToken(assignment.patient_id);
  const portalUrl = `${config.frontendUrl}/${config.practiceSlug}/fill/portal/${portalToken}`;
  const qrCodeDataUrl = await QRCode.toDataURL(portalUrl, { width: 300, margin: 2 });

  const row = assignment as typeof assignment & { bundle_id?: string };
  const bundle_id = row.bundle_id ?? null;
  ok(res, { fill_url: portalUrl, qr_code_data_url: qrCodeDataUrl, bundle_id, portal_url: portalUrl });
});

const smsSchema = z.object({
  phone: z.string().min(10),
});

staffAssignmentsRouter.delete('/:id', (req, res) => {
  const auth = req.user as { practiceId: string };
  const deleted = deleteAssignment(req.params.id, auth.practiceId);
  if (!deleted) {
    fail(res, 'NOT_FOUND', 'Assignment not found', 404);
    return;
  }
  ok(res, { deleted: true });
});

staffAssignmentsRouter.post('/bundle/:bundleId/send-sms', async (req, res) => {
  const parsed = smsSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Phone number required', 422);
    return;
  }

  const auth = req.user as { practiceId: string };
  const bundle = db
    .prepare('select * from assignment_bundles where id = ? and practice_id = ?')
    .get(req.params.bundleId, auth.practiceId) as
    | { id: string; practice_id: string; patient_id: string; token: string; expires_at: string }
    | undefined;

  if (!bundle) {
    fail(res, 'NOT_FOUND', 'Bundle not found', 404);
    return;
  }

  if (new Date(bundle.expires_at) < new Date()) {
    fail(res, 'BUNDLE_EXPIRED', 'This bundle has expired', 400);
    return;
  }

  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.fromNumber) {
    fail(res, 'SMS_NOT_CONFIGURED', 'SMS sending is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.', 503);
    return;
  }

  const patient = db
    .prepare('select child_first_name from patients where id = ?')
    .get(bundle.patient_id) as { child_first_name: string } | undefined;

  const portalToken = ensurePatientPortalToken(bundle.patient_id);
  const fillUrl = `${config.frontendUrl}/${config.practiceSlug}/fill/portal/${portalToken}`;

  const firstName = patient?.child_first_name ?? 'your child';
  const formCount = (db
    .prepare('select count(*) as n from form_assignments where bundle_id = ?')
    .get(bundle.id) as { n: number }).n;
  const message = `Your medical form${formCount > 1 ? 's' : ''} for ${firstName} ${formCount > 1 ? 'are' : 'is'} ready to complete. Please visit: ${fillUrl}`;

  const credentials = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
  const body = new URLSearchParams({
    To: parsed.data.phone,
    From: config.twilio.fromNumber,
    Body: message,
  });

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );

  if (!twilioRes.ok) {
    const errBody = await twilioRes.json().catch(() => ({})) as Record<string, unknown>;
    fail(res, 'SMS_SEND_FAILED', String(errBody.message ?? 'Failed to send SMS'), 500);
    return;
  }

  ok(res, { sent: true, to: parsed.data.phone });
});

const emailSchema = z.object({
  email: z.string().email(),
});

staffAssignmentsRouter.post('/bundle/:bundleId/send-email', async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Valid email address required', 422);
    return;
  }

  const auth = req.user as { practiceId: string };
  const bundle = db
    .prepare('select * from assignment_bundles where id = ? and practice_id = ?')
    .get(req.params.bundleId, auth.practiceId) as
    | { id: string; practice_id: string; patient_id: string; token: string; expires_at: string }
    | undefined;

  if (!bundle) {
    fail(res, 'NOT_FOUND', 'Bundle not found', 404);
    return;
  }

  if (new Date(bundle.expires_at) < new Date()) {
    fail(res, 'BUNDLE_EXPIRED', 'This bundle has expired', 400);
    return;
  }

  if (!config.email.smtpHost || !config.email.smtpUser || !config.email.smtpPass) {
    fail(res, 'EMAIL_NOT_CONFIGURED', 'Email sending is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.', 503);
    return;
  }

  const patient = db
    .prepare('select child_first_name, child_last_name from patients where id = ?')
    .get(bundle.patient_id) as { child_first_name: string; child_last_name: string } | undefined;

  const portalToken2 = ensurePatientPortalToken(bundle.patient_id);
  const fillUrl = `${config.frontendUrl}/${config.practiceSlug}/fill/portal/${portalToken2}`;

  const patientName = patient
    ? `${patient.child_first_name} ${patient.child_last_name}`
    : 'your child';
  const formCount = (db
    .prepare('select count(*) as n from form_assignments where bundle_id = ?')
    .get(bundle.id) as { n: number }).n;

  const transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpPort === 465,
    auth: { user: config.email.smtpUser, pass: config.email.smtpPass },
  });

  await transporter.sendMail({
    from: config.email.fromAddress,
    to: parsed.data.email,
    subject: `Medical form${formCount > 1 ? 's' : ''} ready for ${patientName}`,
    text: `Your medical form${formCount > 1 ? 's' : ''} for ${patientName} ${formCount > 1 ? 'are' : 'is'} ready to complete.\n\nPlease visit the link below to fill them out:\n${fillUrl}\n\nThis link expires on ${new Date(bundle.expires_at).toLocaleDateString()}.`,
    html: `<p>Your medical form${formCount > 1 ? 's' : ''} for <strong>${patientName}</strong> ${formCount > 1 ? 'are' : 'is'} ready to complete.</p><p><a href="${fillUrl}">Click here to fill out the form${formCount > 1 ? 's' : ''}</a></p><p style="color:#888;font-size:12px;">This link expires on ${new Date(bundle.expires_at).toLocaleDateString()}.</p>`,
  });

  ok(res, { sent: true, to: parsed.data.email });
});

staffAssignmentsRouter.post('/:id/send-sms', async (req, res) => {
  const parsed = smsSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Phone number required', 422);
    return;
  }

  // Load and validate the assignment before checking Twilio config so callers
  // get a meaningful error (expired/completed) rather than a generic 503.
  const auth = req.user as { practiceId: string };
  const assignment = getAssignmentById(req.params.id);

  if (!assignment || assignment.practice_id !== auth.practiceId) {
    fail(res, 'NOT_FOUND', 'Assignment not found', 404);
    return;
  }

  if (assignment.status === 'expired') {
    fail(res, 'ASSIGNMENT_EXPIRED', 'This assignment has expired', 400);
    return;
  }
  if (assignment.status === 'completed') {
    fail(res, 'ASSIGNMENT_COMPLETED', 'This form has already been completed', 400);
    return;
  }

  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.fromNumber) {
    fail(res, 'SMS_NOT_CONFIGURED', 'SMS sending is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.', 503);
    return;
  }

  const fillUrl = `${config.frontendUrl}/${config.practiceSlug}/fill/${assignment.token}`;

  const patient = db
    .prepare('select child_first_name from patients where id = ?')
    .get(assignment.patient_id) as { child_first_name: string } | undefined;

  const firstName = patient?.child_first_name ?? 'your child';
  const message = `Your medical form for ${firstName} is ready to complete. Please visit: ${fillUrl}`;

  const credentials = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
  const body = new URLSearchParams({
    To: parsed.data.phone,
    From: config.twilio.fromNumber,
    Body: message,
  });

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );

  if (!twilioRes.ok) {
    const errBody = await twilioRes.json().catch(() => ({})) as Record<string, unknown>;
    fail(res, 'SMS_SEND_FAILED', String(errBody.message ?? 'Failed to send SMS'), 500);
    return;
  }

  ok(res, { sent: true, to: parsed.data.phone });
});
