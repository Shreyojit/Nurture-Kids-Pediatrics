import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { createSubmission, addSubmissionEvent } from '../db/queries.js';
import { getPortalAssignmentsForPatient, getPatientNextAppointment } from '../db/portalQueries.js';
import { updateAssignment } from '../db/assignmentQueries.js';
import { getTemplateWithFields } from '../db/templateQueries.js';
import { listDocumentsForPatient } from '../db/patientDocumentQueries.js';
import { db } from '../db/database.js';

export type PortalFormItem = {
  assignment_id: string;
  template_name: string;
  template_key: string;
  session_id: string | null;
  practice_slug: string;
  practice_name: string;
  template_id: string;
  status: string;
};

export type PortalDocumentItem = {
  id: string;
  document_type: string;
  original_filename: string;
  uploaded_at: string;
  practice_name: string;
};

export function buildPortalFormsForPatient(
  patient: Record<string, unknown>,
  practice: Record<string, unknown>,
  req: Request,
): PortalFormItem[] {
  const rawAssignments = getPortalAssignmentsForPatient(patient.id as string, practice.id as string);
  const practiceSlug = String(practice.slug);
  const practiceName = String(practice.name);

  const activeForms = rawAssignments
    .filter((a) => a.status !== 'completed')
    .map((assignment) => {
      if (assignment.submission_id) {
        const existing = db
          .prepare('select id, status from submissions where id = ?')
          .get(assignment.submission_id) as { id: string; status: string } | undefined;
        if (existing && (existing.status === 'in_progress' || existing.status === 'completed')) {
          return {
            assignment_id: assignment.id,
            template_name: assignment.template_name,
            template_key: assignment.template_key,
            session_id: existing.id,
            practice_slug: practiceSlug,
            practice_name: practiceName,
            template_id: assignment.template_id,
            status: existing.status,
          };
        }
      }

      let template: Record<string, unknown>;
      try {
        template = getTemplateWithFields(assignment.template_id, practice.id as string) as Record<string, unknown>;
      } catch {
        return null;
      }

      const confirmationCode = `PP-${randomBytes(3).toString('hex').toUpperCase()}`;
      const submission = createSubmission({
        practiceId: practice.id as string,
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
        practiceId: practice.id as string,
        actorType: 'system',
        eventType: 'portal_accessed',
        payload: { patient_id: patient.id, assignment_id: assignment.id },
      });

      updateAssignment(assignment.id, { status: 'in_progress', submissionId: submission.id });

      return {
        assignment_id: assignment.id,
        template_name: assignment.template_name,
        template_key: assignment.template_key,
        session_id: submission.id,
        practice_slug: practiceSlug,
        practice_name: practiceName,
        template_id: String(template.id),
        status: 'in_progress' as const,
      };
    })
    .filter(Boolean) as PortalFormItem[];

  const completedForms = rawAssignments
    .filter((a) => a.status === 'completed' && a.submission_id)
    .map((a) => ({
      assignment_id: a.id,
      template_name: a.template_name,
      template_key: a.template_key,
      session_id: a.submission_id,
      practice_slug: practiceSlug,
      practice_name: practiceName,
      template_id: a.template_id,
      status: 'completed' as const,
    }));

  return [...activeForms, ...completedForms];
}

export function buildPortalDocumentsForPatient(
  patientId: string,
  practiceId: string,
): PortalDocumentItem[] {
  return listDocumentsForPatient(patientId, practiceId).map((d) => ({
    id: d.id,
    document_type: d.document_type,
    original_filename: d.original_filename,
    uploaded_at: d.uploaded_at,
    practice_name: d.practice_name,
  }));
}

export function pickEarliestAppointment(
  appointments: Array<{ next_appointment_date: string | null; next_appointment_time: string | null }>,
): { next_appointment_date: string | null; next_appointment_time: string | null } {
  let best: { next_appointment_date: string | null; next_appointment_time: string | null } = {
    next_appointment_date: null,
    next_appointment_time: null,
  };
  for (const appt of appointments) {
    if (!appt.next_appointment_date) continue;
    if (!best.next_appointment_date || appt.next_appointment_date < best.next_appointment_date) {
      best = appt;
    }
  }
  return best;
}
