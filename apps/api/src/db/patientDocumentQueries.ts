import { randomUUID } from 'node:crypto';
import { db, nowIso } from './database.js';
import { config, resolveDataPath, toRelativeDataPath } from '../config.js';
import path from 'node:path';
import fs from 'node:fs';

export type PatientDocumentRow = {
  id: string;
  practice_id: string;
  patient_id: string;
  document_type: string;
  original_filename: string;
  stored_path: string;
  uploaded_by: string;
  uploaded_at: string;
};

export function ensureDocumentStorageDir(practiceId: string, patientId: string): string {
  const dir = path.join(config.dataPath, 'patient-documents', practiceId, patientId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function insertPatientDocument(input: {
  practiceId: string;
  patientId: string;
  documentType: string;
  originalFilename: string;
  absolutePath: string;
  uploadedBy: string;
}): PatientDocumentRow {
  const id = randomUUID();
  const now = nowIso();
  const storedPath = toRelativeDataPath(input.absolutePath);
  db.prepare(
    `insert into patient_documents
      (id, practice_id, patient_id, document_type, original_filename, stored_path, uploaded_by, uploaded_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.practiceId, input.patientId, input.documentType, input.originalFilename, storedPath, input.uploadedBy, now);
  return getPatientDocumentById(id, input.practiceId)!;
}

export function getPatientDocumentById(id: string, practiceId: string): PatientDocumentRow | undefined {
  return db
    .prepare('select * from patient_documents where id = ? and practice_id = ?')
    .get(id, practiceId) as PatientDocumentRow | undefined;
}

export function listDocumentsForPatient(
  patientId: string,
  practiceId: string,
): Array<PatientDocumentRow & { practice_name: string; location_name: string | null; uploaded_by_email: string }> {
  return db
    .prepare(
      `select d.*, pr.name as practice_name, s.email as uploaded_by_email,
              loc.location_name as location_name
       from patient_documents d
       join practices pr on pr.id = d.practice_id
       join staff_users s on s.id = d.uploaded_by
       left join practices loc on loc.id = s.location_id
       where d.patient_id = ? and d.practice_id = ?
       order by d.uploaded_at desc`,
    )
    .all(patientId, practiceId) as Array<PatientDocumentRow & { practice_name: string; location_name: string | null; uploaded_by_email: string }>;
}

export function listDocumentsForStaff(
  practiceId: string,
  patientId?: string,
): Array<PatientDocumentRow & { child_first_name: string; child_last_name: string; uploaded_by_email: string }> {
  const base = `
    select d.*, p.child_first_name, p.child_last_name, s.email as uploaded_by_email
    from patient_documents d
    join patients p on p.id = d.patient_id
    join staff_users s on s.id = d.uploaded_by
    where d.practice_id = ?`;
  if (patientId) {
    return db.prepare(`${base} and d.patient_id = ? order by d.uploaded_at desc`).all(practiceId, patientId) as Array<
      PatientDocumentRow & { child_first_name: string; child_last_name: string; uploaded_by_email: string }
    >;
  }
  return db.prepare(`${base} order by d.uploaded_at desc`).all(practiceId) as Array<
    PatientDocumentRow & { child_first_name: string; child_last_name: string; uploaded_by_email: string }
  >;
}

/** Secure download: document must belong to practice and the patient must match name+dob. */
export function getDocumentForPatientDownload(
  documentId: string,
  practiceId: string,
  patientId: string,
): (PatientDocumentRow & { practice_name: string }) | undefined {
  return db
    .prepare(
      `select d.*, pr.name as practice_name
       from patient_documents d
       join practices pr on pr.id = d.practice_id
       where d.id = ? and d.practice_id = ? and d.patient_id = ?`,
    )
    .get(documentId, practiceId, patientId) as (PatientDocumentRow & { practice_name: string }) | undefined;
}

export function resolveDocumentPath(doc: PatientDocumentRow): string {
  return resolveDataPath(doc.stored_path);
}

export function deletePatientDocument(id: string, practiceId: string): void {
  db.prepare('delete from patient_documents where id = ? and practice_id = ?').run(id, practiceId);
}

/** Patient download: document must belong to a patient record matching name + DOB. */
export function getDocumentForIdentityDownload(
  documentId: string,
  firstName: string,
  lastName: string,
  dob: string,
): (PatientDocumentRow & { practice_name: string }) | undefined {
  const dobNorm = String(dob).trim().slice(0, 10);
  return db
    .prepare(
      `select d.*, pr.name as practice_name
       from patient_documents d
       join patients p on p.id = d.patient_id and p.practice_id = d.practice_id
       join practices pr on pr.id = d.practice_id
       where d.id = ?
         and lower(trim(p.child_first_name)) = lower(trim(?))
         and lower(trim(p.child_last_name)) = lower(trim(?))
         and p.child_dob = ?
       limit 1`,
    )
    .get(documentId, firstName.trim(), lastName.trim(), dobNorm) as
    | (PatientDocumentRow & { practice_name: string })
    | undefined;
}

/** All documents for a child identity across every linked practice. */
export function listDocumentsForIdentity(
  firstName: string,
  lastName: string,
  dob: string,
): Array<PatientDocumentRow & { practice_name: string; location_name: string | null; uploaded_by_email: string }> {
  const dobNorm = String(dob).trim().slice(0, 10);
  return db
    .prepare(
      `select d.*, pr.name as practice_name, s.email as uploaded_by_email,
              loc.location_name as location_name
       from patient_documents d
       join patients p on p.id = d.patient_id and p.practice_id = d.practice_id
       join practices pr on pr.id = d.practice_id
       join staff_users s on s.id = d.uploaded_by
       left join practices loc on loc.id = s.location_id
       where lower(trim(p.child_first_name)) = lower(trim(?))
         and lower(trim(p.child_last_name)) = lower(trim(?))
         and p.child_dob = ?
       order by d.uploaded_at desc`,
    )
    .all(firstName.trim(), lastName.trim(), dobNorm) as Array<
    PatientDocumentRow & { practice_name: string; location_name: string | null; uploaded_by_email: string }
  >;
}
