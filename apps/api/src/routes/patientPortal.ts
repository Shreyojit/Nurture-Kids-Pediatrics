/**
 * Public patient portal — no pre-generated token required.
 * Patients sign in with First Name + Last Name + DOB (no practice name).
 * Practice-scoped slug routes remain for backward compatibility.
 */
import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { ok, fail } from '../lib/response.js';
import { findPracticeBySlug, findPatientsByIdentity } from '../db/queries.js';
import { getPatientNextAppointment } from '../db/portalQueries.js';
import {
  getDocumentForIdentityDownload,
  listDocumentsForIdentity,
  resolveDocumentPath,
} from '../db/patientDocumentQueries.js';
import { db } from '../db/database.js';
import {
  buildPortalDocumentsForPatient,
  buildPortalFormsForPatient,
  pickEarliestAppointment,
} from '../lib/patientPortalAccess.js';

export const patientPortalRouter = Router();

const accessAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000;

function rlKey(req: { ip?: string }, suffix: string) {
  return `${req.ip ?? 'unknown'}:${suffix}`;
}

function checkRL(key: string): boolean {
  const now = Date.now();
  const e = accessAttempts.get(key);
  return !e || e.resetAt < now || e.count < MAX_ATTEMPTS;
}

function recordRL(key: string): void {
  const now = Date.now();
  const e = accessAttempts.get(key);
  if (!e || e.resetAt < now) {
    accessAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    e.count++;
  }
}

function clearRL(key: string): void {
  accessAttempts.delete(key);
}

const accessSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  dob: z.string().min(1),
});

function lookupPatientInPractice(
  practiceId: string,
  firstName: string,
  lastName: string,
  dobNorm: string,
): Record<string, unknown> | undefined {
  return db
    .prepare(
      `select * from patients
       where practice_id = ?
         and lower(trim(child_first_name)) = lower(trim(?))
         and lower(trim(child_last_name)) = lower(trim(?))
         and child_dob = ?
       limit 1`,
    )
    .get(practiceId, firstName.trim(), lastName.trim(), dobNorm) as Record<string, unknown> | undefined;
}

function buildAccessPayloadForPatients(
  patients: Array<Record<string, unknown> & { practice_slug: string; practice_name: string }>,
  req: Parameters<typeof buildPortalFormsForPatient>[2],
) {
  const forms = patients.flatMap((patient) => {
    const practice = {
      id: patient.practice_id,
      slug: patient.practice_slug,
      name: patient.practice_name,
    };
    return buildPortalFormsForPatient(patient, practice, req);
  });

  const documents =
    patients.length > 0
      ? listDocumentsForIdentity(
          String(patients[0].child_first_name),
          String(patients[0].child_last_name),
          String(patients[0].child_dob),
        ).map((d) => ({
          id: d.id,
          document_type: d.document_type,
          original_filename: d.original_filename,
          uploaded_at: d.uploaded_at,
          practice_name: d.practice_name,
          location_name: d.location_name ?? null,
        }))
      : [];

  const appointments = patients.map((p) => getPatientNextAppointment(p.id as string)).filter(Boolean) as Array<{
    next_appointment_date: string | null;
    next_appointment_time: string | null;
  }>;
  const appointment = pickEarliestAppointment(appointments);

  const practiceNames = [...new Set(patients.map((p) => p.practice_name))];

  return {
    patient_first_name: String(patients[0]?.child_first_name ?? ''),
    practice_name: practiceNames.length === 1 ? practiceNames[0] : null,
    practice_names: practiceNames,
    next_appointment_date: appointment.next_appointment_date,
    next_appointment_time: appointment.next_appointment_time,
    forms,
    documents,
  };
}

/** POST /api/patient-portal/access — global sign-in (no practice slug). */
patientPortalRouter.post('/access', (req, res) => {
  const key = rlKey(req, 'global-access');
  if (!checkRL(key)) {
    fail(res, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Please try again later.', 429);
    return;
  }

  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'first_name, last_name, and dob are required', 422);
    return;
  }

  const patients = findPatientsByIdentity({
    firstName: parsed.data.first_name,
    lastName: parsed.data.last_name,
    dob: parsed.data.dob,
  });

  if (patients.length === 0) {
    recordRL(key);
    fail(res, 'IDENTITY_MISMATCH', 'No record found matching that name and date of birth', 403);
    return;
  }

  clearRL(key);
  ok(res, buildAccessPayloadForPatients(patients, req));
});

/** GET /api/patient-portal/documents/:id/download — identity-verified download (any practice). */
patientPortalRouter.get('/documents/:id/download', (req, res) => {
  const { first_name, last_name, dob } = req.query as Record<string, string>;
  if (!first_name || !last_name || !dob) {
    fail(res, 'VALIDATION_ERROR', 'first_name, last_name, and dob are required', 422);
    return;
  }

  const doc = getDocumentForIdentityDownload(req.params.id, first_name, last_name, dob);
  if (!doc) {
    fail(res, 'NOT_FOUND', 'Document not found', 404);
    return;
  }

  const absPath = resolveDocumentPath(doc);
  if (!fs.existsSync(absPath)) {
    fail(res, 'NOT_FOUND', 'File not found on server', 404);
    return;
  }

  res.download(absPath, doc.original_filename);
});

/** GET /api/patient-portal/:slug — return practice info (legacy / direct links). */
patientPortalRouter.get('/:slug', (req, res) => {
  const practice = findPracticeBySlug(req.params.slug);
  if (!practice) {
    fail(res, 'NOT_FOUND', 'Practice not found', 404);
    return;
  }
  ok(res, { practice_name: practice.name, practice_slug: practice.slug });
});

/** POST /api/patient-portal/:slug/access — practice-scoped sign-in (backward compatible). */
patientPortalRouter.post('/:slug/access', (req, res) => {
  const slug = req.params.slug;
  const key = rlKey(req, slug);

  if (!checkRL(key)) {
    fail(res, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Please try again later.', 429);
    return;
  }

  const practice = findPracticeBySlug(slug);
  if (!practice) {
    fail(res, 'NOT_FOUND', 'Practice not found', 404);
    return;
  }

  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'first_name, last_name, and dob are required', 422);
    return;
  }

  const dobNorm = String(parsed.data.dob).trim().slice(0, 10);
  const patient = lookupPatientInPractice(
    practice.id as string,
    parsed.data.first_name,
    parsed.data.last_name,
    dobNorm,
  );

  if (!patient) {
    recordRL(key);
    fail(res, 'IDENTITY_MISMATCH', 'No record found matching that name and date of birth', 403);
    return;
  }

  clearRL(key);

  const appointment = getPatientNextAppointment(patient.id as string);
  const forms = buildPortalFormsForPatient(patient, practice, req);
  const documents = buildPortalDocumentsForPatient(patient.id as string, practice.id as string);

  ok(res, {
    patient_first_name: patient.child_first_name,
    practice_name: practice.name,
    practice_names: [practice.name],
    next_appointment_date: appointment?.next_appointment_date ?? null,
    next_appointment_time: appointment?.next_appointment_time ?? null,
    forms,
    documents,
  });
});

/** GET /api/patient-portal/:slug/documents/:id/download — legacy practice-scoped download. */
patientPortalRouter.get('/:slug/documents/:id/download', (req, res) => {
  const { first_name, last_name, dob } = req.query as Record<string, string>;
  if (!first_name || !last_name || !dob) {
    fail(res, 'VALIDATION_ERROR', 'first_name, last_name, and dob are required', 422);
    return;
  }

  const doc = getDocumentForIdentityDownload(req.params.id, first_name, last_name, dob);
  if (!doc) {
    fail(res, 'NOT_FOUND', 'Document not found', 404);
    return;
  }

  const practice = findPracticeBySlug(req.params.slug);
  if (!practice || doc.practice_id !== practice.id) {
    fail(res, 'NOT_FOUND', 'Document not found', 404);
    return;
  }

  const absPath = resolveDocumentPath(doc);
  if (!fs.existsSync(absPath)) {
    fail(res, 'NOT_FOUND', 'File not found on server', 404);
    return;
  }

  res.download(absPath, doc.original_filename);
});
