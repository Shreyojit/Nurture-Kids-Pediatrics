import { randomBytes } from 'node:crypto';
import { db, nowIso } from './database.js';

export function ensurePatientPortalToken(patientId: string): string {
  const row = db.prepare('select portal_token from patients where id = ?').get(patientId) as
    | { portal_token: string | null }
    | undefined;
  if (!row) throw new Error('Patient not found');
  if (row.portal_token) return row.portal_token;

  const token = randomBytes(16).toString('hex');
  db.prepare('update patients set portal_token = ? where id = ?').run(token, patientId);
  return token;
}

export function getPatientByPortalToken(token: string): Record<string, unknown> | undefined {
  return db.prepare('select * from patients where portal_token = ?').get(token) as
    | Record<string, unknown>
    | undefined;
}

export function regeneratePatientPortalToken(patientId: string, practiceId: string): string {
  const token = randomBytes(16).toString('hex');
  const result = db
    .prepare('update patients set portal_token = ? where id = ? and practice_id = ?')
    .run(token, patientId, practiceId);
  if ((result.changes as number) === 0) throw new Error('Patient not found');
  return token;
}

export function getActiveAssignmentsForPortal(
  patientId: string,
  practiceId: string,
): Array<{
  id: string;
  template_id: string;
  template_name: string;
  status: string;
  submission_id: string | null;
  expires_at: string;
}> {
  return db
    .prepare(
      `select fa.id, fa.template_id, fa.status, fa.submission_id, fa.expires_at,
              t.name as template_name
       from form_assignments fa
       join pdf_templates t on t.id = fa.template_id
       where fa.patient_id = ? and fa.practice_id = ?
         and fa.status in ('pending', 'in_progress')
         and datetime(fa.expires_at) >= datetime('now')
       order by fa.created_at asc`,
    )
    .all(patientId, practiceId) as Array<{
    id: string;
    template_id: string;
    template_name: string;
    status: string;
    submission_id: string | null;
    expires_at: string;
  }>;
}
