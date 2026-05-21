import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ok, fail } from '../lib/response.js';
import { getPatientByPortalToken, getActiveAssignmentsForPortal } from '../db/portalQueries.js';
import { updateAssignment } from '../db/assignmentQueries.js';
import { createSubmission, addSubmissionEvent, findPracticeById } from '../db/queries.js';
import { getTemplateWithFields } from '../db/templateQueries.js';
import { db } from '../db/database.js';

export const portalRouter = Router();

// In-memory rate limiter: max 5 failed verify attempts per token per hour
const verifyFailures = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  const entry = verifyFailures.get(token);
  if (!entry || entry.resetAt < now) {
    return true; // no failures or window expired
  }
  return entry.count < 5;
}

function recordFailure(token: string): void {
  const now = Date.now();
  const entry = verifyFailures.get(token);
  if (!entry || entry.resetAt < now) {
    verifyFailures.set(token, { count: 1, resetAt: now + 60 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

function clearFailures(token: string): void {
  verifyFailures.delete(token);
}

const verifySchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
});

// GET /api/portal/:token — confirm portal exists and return active form count only (no patient name)
portalRouter.get('/:token', (req, res) => {
  const patient = getPatientByPortalToken(req.params.token);
  if (!patient) {
    fail(res, 'NOT_FOUND', 'Portal link not found', 404);
    return;
  }

  const assignments = getActiveAssignmentsForPortal(
    patient.id as string,
    patient.practice_id as string,
  );

  ok(res, {
    assignment_count: assignments.length,
  });
});

// POST /api/portal/:token/verify — verify identity, create sessions for all active assignments
portalRouter.post('/:token/verify', (req, res) => {
  const token = req.params.token;

  if (!checkRateLimit(token)) {
    fail(res, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Please try again in an hour.', 429);
    return;
  }

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'first_name and last_name are required', 422);
    return;
  }

  const patient = getPatientByPortalToken(token);
  if (!patient) {
    fail(res, 'NOT_FOUND', 'Portal link not found', 404);
    return;
  }

  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    normalize(parsed.data.first_name) !== normalize(patient.child_first_name as string) ||
    normalize(parsed.data.last_name) !== normalize(patient.child_last_name as string)
  ) {
    recordFailure(token);
    fail(res, 'IDENTITY_MISMATCH', 'Name does not match our records', 403);
    return;
  }

  // Successful verify — clear any accumulated failures
  clearFailures(token);

  const practice = findPracticeById(patient.practice_id as string);
  if (!practice) {
    fail(res, 'NOT_FOUND', 'Practice not found', 404);
    return;
  }

  const assignments = getActiveAssignmentsForPortal(
    patient.id as string,
    patient.practice_id as string,
  );

  const results = assignments.map((assignment) => {
    // Reuse an existing in_progress or completed submission if present
    if (assignment.submission_id) {
      const existing = db
        .prepare('select id, status from submissions where id = ?')
        .get(assignment.submission_id) as { id: string; status: string } | undefined;
      if (existing && (existing.status === 'in_progress' || existing.status === 'completed')) {
        return {
          assignment_id: assignment.id,
          template_name: assignment.template_name,
          session_id: existing.id,
          practice_slug: practice.slug,
          template_id: assignment.template_id,
          status: existing.status,
        };
      }
    }

    let template: Record<string, unknown>;
    try {
      template = getTemplateWithFields(
        assignment.template_id,
        patient.practice_id as string,
      ) as Record<string, unknown>;
    } catch {
      return null;
    }

    const confirmationCode = `PA-${randomBytes(3).toString('hex').toUpperCase()}`;
    const submission = createSubmission({
      practiceId: patient.practice_id as string,
      patientId: patient.id as string,
      visitType: (patient.visit_type as string) || 'new_patient',
      formId: String(template.template_key),
      templateVersion: `${String(template.template_key)}@v${String(template.version)}`,
      templateId: String(template.id),
      templateVersionNum: Number(template.version),
      initialData: {
        patient: {
          child: {
            first_name: patient.child_first_name,
            last_name: patient.child_last_name,
            dob: patient.child_dob,
          },
        },
        visit_type: patient.visit_type,
        template_key: String(template.template_key),
      },
      confirmationCode,
      ipAddress: req.ip,
    });

    addSubmissionEvent({
      submissionId: submission.id,
      practiceId: patient.practice_id as string,
      actorType: 'system',
      eventType: 'portal_verified',
      payload: { portal_token: token, assignment_id: assignment.id },
    });

    updateAssignment(assignment.id, { status: 'in_progress', submissionId: submission.id });

    return {
      assignment_id: assignment.id,
      template_name: assignment.template_name,
      session_id: submission.id,
      practice_slug: String(practice.slug),
      template_id: String(template.id),
      status: 'in_progress',
    };
  });

  ok(res, {
    patient_first_name: patient.child_first_name,
    assignments: results.filter(Boolean),
  });
});
