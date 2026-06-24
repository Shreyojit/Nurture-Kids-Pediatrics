import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail } from '../lib/response.js';
import {
  listAssignmentsForPractice,
  listAssignmentsForPatient,
  expireStaleAssignments,
  deleteAssignment,
} from '../db/assignmentQueries.js';
import { createBundleWithAssignments } from '../db/bundleQueries.js';
import { getLatestAppointmentVisitTypeRaw } from '../db/queries.js';
import { autoAssignForWellVisit, debugAutoAssign } from '../lib/autoFormAssignment.js';
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

staffAssignmentsRouter.post('/', (req, res) => {
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

  createBundleWithAssignments({
    practiceId: auth.practiceId,
    patientId,
    assignedBy: auth.id,
    templateIds,
    expiresInDays,
  });

  ok(res, {
    patient_name: patientName,
    template_names: (templates as Array<{ id: string; name: string }>).map((t) => t.name),
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

const autoAssignSchema = z.object({
  expires_in_days: z.number().int().min(1).max(90).optional(),
});

/** Debug: trace the full auto-assign algorithm for a patient without writing to DB. */
staffAssignmentsRouter.get('/patient/:patientId/auto-assign-debug', (req, res) => {
  const auth = req.user as { id: string; practiceId: string };

  const patient = db
    .prepare('select id, child_dob, visit_type from patients where id = ? and practice_id = ?')
    .get(req.params.patientId, auth.practiceId) as
    | { id: string; child_dob: string; visit_type: string }
    | undefined;

  if (!patient) { fail(res, 'NOT_FOUND', 'Patient not found', 404); return; }

  const apptVisit = getLatestAppointmentVisitTypeRaw(patient.id);
  const visitType = apptVisit ?? patient.visit_type;

  ok(res, debugAutoAssign(auth.practiceId, patient.child_dob, visitType));
});

/** Age-based auto-assignment for well / preventive visits (DOB + visit type). */
staffAssignmentsRouter.post('/patient/:patientId/auto-assign', (req, res) => {
  const auth = req.user as { id: string; practiceId: string };
  const parsed = autoAssignSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid payload', 422, parsed.error.flatten());
    return;
  }

  const patient = db
    .prepare('select id, child_dob, visit_type from patients where id = ? and practice_id = ?')
    .get(req.params.patientId, auth.practiceId) as
    | { id: string; child_dob: string; visit_type: string }
    | undefined;

  if (!patient) {
    fail(res, 'NOT_FOUND', 'Patient not found', 404);
    return;
  }

  const apptVisit = getLatestAppointmentVisitTypeRaw(patient.id);
  const visitType = apptVisit ?? patient.visit_type;

  const result = autoAssignForWellVisit({
    practiceId: auth.practiceId,
    patientId: patient.id,
    childDob: patient.child_dob,
    visitType,
    assignedBy: auth.id,
    expiresInDays: parsed.data.expires_in_days,
  });

  ok(res, {
    ...result,
    visit_type_used: visitType,
    message:
      result.assignments_created > 0
        ? `Assigned ${result.assignments_created} form(s) for age group ${result.age_group ?? 'n/a'}.`
        : result.form_labels.length === 0
          ? 'No forms mapped for this age group, or visit type is not a well/preventive visit.'
          : 'No new assignments created (may already be assigned).',
  });
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
