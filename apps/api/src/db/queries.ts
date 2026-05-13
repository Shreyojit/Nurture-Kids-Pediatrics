import { randomUUID } from 'node:crypto';
import type { PatientExcelImportRow } from '../lib/patientExcelImport.js';
import { db, nowIso, parseJson, stringifyJson } from './database.js';

export type SubmissionRow = {
  id: string;
  practice_id: string;
  patient_id: string | null;
  form_id: string;
  template_version: string;
  template_id: string | null;
  template_version_num: number | null;
  visit_type: string;
  status: 'in_progress' | 'completed' | 'exported';
  form_data_json: string;
  responses_json: string;
  completed_pdf_path: string | null;
  forms_completed_json: string;
  confirmation_code: string;
  submitted_at: string | null;
  exported_at: string | null;
  exported_by: string | null;
  ip_address: string | null;
  created_at: string;
  updated_at: string;
};

export function createSubmission(input: {
  practiceId: string;
  patientId?: string;
  visitType: string;
  formId: string;
  templateVersion: string;
  templateId?: string;
  templateVersionNum?: number;
  initialData: Record<string, unknown>;
  initialResponses?: Record<string, unknown>;
  confirmationCode: string;
  ipAddress?: string;
}): SubmissionRow {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `insert into submissions (
      id, practice_id, patient_id, form_id, template_version, template_id, template_version_num, visit_type, status,
      form_data_json, responses_json, completed_pdf_path, forms_completed_json, confirmation_code, submitted_at,
      exported_at, exported_by, ip_address, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, null, ?, ?, null, null, null, ?, ?, ?)`,
  ).run(
    id,
    input.practiceId,
    input.patientId ?? null,
    input.formId,
    input.templateVersion,
    input.templateId ?? null,
    input.templateVersionNum ?? null,
    input.visitType,
    stringifyJson(input.initialData),
    stringifyJson(input.initialResponses ?? {}),
    stringifyJson([]),
    input.confirmationCode,
    input.ipAddress ?? null,
    now,
    now,
  );

  return getSubmissionByIdOrThrow(id);
}

export function getSubmissionById(id: string): SubmissionRow | undefined {
  return db.prepare('select * from submissions where id = ?').get(id) as SubmissionRow | undefined;
}

export function getSubmissionByIdOrThrow(id: string): SubmissionRow {
  const row = getSubmissionById(id);
  if (!row) throw new Error('Submission not found');
  return row;
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) return b;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return b;
}

export function autosaveSubmission(input: {
  submissionId: string;
  formId: string;
  data: Record<string, unknown>;
}): SubmissionRow {
  const current = getSubmissionByIdOrThrow(input.submissionId);
  const currentData = parseJson<Record<string, unknown>>(current.form_data_json, {});
  const merged = deepMerge(currentData, input.data) as Record<string, unknown>;

  db.prepare('update submissions set form_data_json = ?, updated_at = ? where id = ?').run(
    stringifyJson(merged),
    nowIso(),
    input.submissionId,
  );

  return getSubmissionByIdOrThrow(input.submissionId);
}

export function autosaveSubmissionResponses(input: {
  submissionId: string;
  responses: Record<string, { value: unknown; updated_at?: string }>;
}): SubmissionRow {
  const current = getSubmissionByIdOrThrow(input.submissionId);
  const currentResponses = parseJson<Record<string, { value: unknown; updated_at?: string }>>(current.responses_json, {});
  const now = nowIso();
  const merged: Record<string, { value: unknown; updated_at: string }> = {
    ...(currentResponses as Record<string, { value: unknown; updated_at: string }>),
  };

  for (const [fieldId, payload] of Object.entries(input.responses)) {
    merged[fieldId] = {
      value: payload?.value ?? null,
      updated_at: now,
    };
  }

  db.prepare('update submissions set responses_json = ?, updated_at = ? where id = ?').run(
    stringifyJson(merged),
    now,
    input.submissionId,
  );

  return getSubmissionByIdOrThrow(input.submissionId);
}

export function addSubmissionEvent(input: {
  submissionId: string;
  practiceId: string;
  actorType: 'parent' | 'staff' | 'system';
  actorId?: string;
  eventType: string;
  payload?: Record<string, unknown>;
}): void {
  db.prepare(
    `insert into submission_events (
      submission_id, practice_id, actor_type, actor_id, event_type, event_payload_json, created_at
    ) values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.submissionId,
    input.practiceId,
    input.actorType,
    input.actorId ?? null,
    input.eventType,
    stringifyJson(input.payload ?? {}),
    nowIso(),
  );
}

function upsertSingle(table: string, patientId: string, values: Record<string, unknown>): void {
  const id = randomUUID();
  const now = nowIso();
  const columns = Object.keys(values);
  if (columns.length === 0) return;

  const allColumns = ['id', 'patient_id', ...columns, 'created_at', 'updated_at'];
  const placeholders = allColumns.map(() => '?').join(', ');
  const updateSet = [...columns.map((col) => `${col}=excluded.${col}`), 'updated_at=excluded.updated_at'].join(', ');

  db.prepare(
    `insert into ${table} (${allColumns.join(', ')}) values (${placeholders})
     on conflict(patient_id) do update set ${updateSet}`,
  ).run(id, patientId, ...columns.map((c) => values[c]), now, now);
}

function replaceRows(
  table: string,
  patientId: string,
  rows: Array<Record<string, unknown>>,
  extraFixed?: Record<string, unknown>,
): void {
  db.prepare(`delete from ${table} where patient_id = ?`).run(patientId);
  const now = nowIso();

  for (const row of rows) {
    const merged = { ...(extraFixed ?? {}), ...row };
    const columns = Object.keys(merged);
    const values = columns.map((k) => merged[k]);
    db.prepare(
      `insert into ${table} (id, patient_id, ${columns.join(', ')}, created_at, updated_at)
       values (?, ?, ${columns.map(() => '?').join(', ')}, ?, ?)`,
    ).run(randomUUID(), patientId, ...values, now, now);
  }
}

export function materializePatientFromSubmission(submissionId: string): { patientId: string } {
  const submission = getSubmissionByIdOrThrow(submissionId);
  const form = parseJson<Record<string, any>>(submission.form_data_json, {});
  const patient = form.patient ?? {};
  const child = patient.child ?? {};
  const guardians = form.guardians ?? {};
  const insurance = form.insurance ?? {};
  const pharmacy = form.pharmacy ?? {};
  const medical = form.medical_history ?? {};
  const concerns = form.concerns ?? {};
  const immunizations = form.immunizations ?? {};
  const social = form.social_history ?? {};
  const preferences = form.provider_preferences ?? {};
  const consent = form.consent_signature ?? {};

  const now = nowIso();
  const existingPatient = submission.patient_id
    ? (db.prepare('select id from patients where id = ?').get(submission.patient_id) as { id: string } | undefined)
    : undefined;

  const patientId = existingPatient?.id ?? randomUUID();

  db.prepare(
    `insert into patients (
      id, practice_id, account_id, child_first_name, child_last_name, child_dob, visit_type,
      preferred_language, sex, race_ethnicity, created_at, updated_at
    ) values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      child_first_name=excluded.child_first_name,
      child_last_name=excluded.child_last_name,
      child_dob=excluded.child_dob,
      visit_type=excluded.visit_type,
      preferred_language=excluded.preferred_language,
      sex=excluded.sex,
      race_ethnicity=excluded.race_ethnicity,
      updated_at=excluded.updated_at`,
  ).run(
    patientId,
    submission.practice_id,
    child.first_name ?? '',
    child.last_name ?? '',
    child.dob ?? '',
    submission.visit_type,
    child.preferred_language ?? null,
    child.sex ?? null,
    child.race_ethnicity ?? null,
    now,
    now,
  );

  const guardianRows: Array<Record<string, unknown>> = [];
  if (guardians.primary) {
    guardianRows.push({
      guardian_index: 1,
      full_name: guardians.primary.full_name ?? null,
      relationship: guardians.primary.relationship ?? null,
      phone: guardians.primary.phone ?? null,
      email: guardians.primary.email ?? null,
      address: guardians.primary.address ?? null,
      employer: guardians.primary.employer ?? null,
      ssn_last4: guardians.primary.ssn_last4 ?? null,
    });
  }
  if (guardians.secondary && guardians.secondary.enabled !== false) {
    guardianRows.push({
      guardian_index: 2,
      full_name: guardians.secondary.full_name ?? null,
      relationship: guardians.secondary.relationship ?? null,
      phone: guardians.secondary.phone ?? null,
      email: guardians.secondary.email ?? null,
      address: guardians.secondary.address ?? null,
      employer: guardians.secondary.employer ?? null,
      ssn_last4: guardians.secondary.ssn_last4 ?? null,
    });
  }

  db.prepare('delete from guardians where patient_id = ?').run(patientId);
  for (const g of guardianRows) {
    db.prepare(
      `insert into guardians (
        id, patient_id, guardian_index, full_name, relationship, phone, email, address, employer,
        ssn_last4, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      patientId,
      g.guardian_index,
      g.full_name,
      g.relationship,
      g.phone,
      g.email,
      g.address,
      g.employer,
      g.ssn_last4,
      now,
      now,
    );
  }

  const insuranceRows = [
    { policy_order: 1, ...(insurance.primary ?? {}) },
    { policy_order: 2, ...(insurance.secondary ?? {}) },
  ].filter((row) => Object.keys(row).length > 1);

  db.prepare('delete from insurance_policies where patient_id = ?').run(patientId);
  for (const policy of insuranceRows) {
    db.prepare(
      `insert into insurance_policies (
        id, patient_id, policy_order, company, subscriber_name, subscriber_dob, group_number, member_id,
        created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      patientId,
      policy.policy_order,
      (policy as any).company ?? null,
      (policy as any).subscriber_name ?? null,
      (policy as any).subscriber_dob ?? null,
      (policy as any).group_number ?? null,
      (policy as any).member_id ?? null,
      now,
      now,
    );
  }

  upsertSingle('pharmacies', patientId, {
    name: pharmacy.name ?? null,
    address: pharmacy.address ?? null,
    zip: pharmacy.zip ?? null,
  });

  upsertSingle('medical_history', patientId, {
    gestational_age: medical.gestational_age ?? null,
    birth_weight: medical.birth_weight ?? null,
    birth_complications: medical.birth_complications ?? null,
    hospitalizations: medical.hospitalizations ?? null,
    surgeries: medical.surgeries ?? null,
  });

  upsertSingle('concerns', patientId, {
    visit_reason: concerns.visit_reason ?? null,
    development_concerns: concerns.development_concerns ?? null,
  });

  const allergyRows: Array<Record<string, unknown>> = [];
  for (const item of (form.allergies?.drug ?? []) as any[]) {
    allergyRows.push({ allergy_type: 'drug', allergy_name: item.name ?? null, reaction: item.reaction ?? null });
  }
  for (const item of (form.allergies?.food ?? []) as any[]) {
    allergyRows.push({ allergy_type: 'food', allergy_name: item.name ?? null, reaction: item.reaction ?? null });
  }
  for (const item of (form.allergies?.environmental ?? []) as any[]) {
    allergyRows.push({
      allergy_type: 'environmental',
      allergy_name: item.name ?? null,
      reaction: item.reaction ?? null,
    });
  }
  replaceRows('allergies', patientId, allergyRows);

  const medicationRows = ((form.medications?.items ?? []) as any[]).map((item) => ({
    medication_name: item.name ?? null,
    dose: item.dose ?? null,
    frequency: item.frequency ?? null,
  }));
  replaceRows('medications', patientId, medicationRows);

  upsertSingle('immunizations', patientId, {
    status: immunizations.status ?? null,
  });

  const familyRows = Object.entries((form.family_history?.conditions ?? {}) as Record<string, unknown>).map(
    ([conditionName, present]) => ({
      condition_name: conditionName,
      present: present ? 1 : 0,
      notes: null,
    }),
  );
  replaceRows('family_history', patientId, familyRows);

  upsertSingle('social_history', patientId, {
    household_adults: social.household_adults ?? null,
    household_children: social.household_children ?? null,
    smokers_in_home: social.smokers_in_home ? 1 : 0,
    pets: social.pets ?? null,
    daycare_school: social.daycare_school ?? null,
    nutrition: social.nutrition ?? null,
  });

  upsertSingle('provider_preferences', patientId, {
    physician_preference: preferences.physician_preference ?? null,
    referral_source: preferences.referral_source ?? null,
    referring_provider: preferences.referring_provider ?? null,
  });

  upsertSingle('consents_signatures', patientId, {
    agreed: consent.agreed ? 1 : 0,
    typed_name: consent.typed_name ?? null,
    signature_data: consent.signature_data ?? null,
    signed_at: consent.signed_at ?? null,
  });

  db.prepare('update submissions set patient_id = ?, updated_at = ? where id = ?').run(patientId, nowIso(), submissionId);
  return { patientId };
}

export function completeSubmission(submissionId: string): SubmissionRow {
  const submission = getSubmissionByIdOrThrow(submissionId);
  // Legacy materialization remains for compatibility with the normalized staff workspace.
  materializePatientFromSubmission(submissionId);
  const now = nowIso();
  db.prepare(
    `update submissions
     set status = 'completed',
         forms_completed_json = ?,
         submitted_at = ?,
         completed_pdf_path = coalesce(?, completed_pdf_path),
         updated_at = ?
     where id = ?`,
  ).run(stringifyJson([submission.form_id]), now, null, now, submissionId);
  return getSubmissionByIdOrThrow(submissionId);
}

export function completeSubmissionWithPdf(submissionId: string, completedPdfPath: string | null): SubmissionRow {
  const submission = getSubmissionByIdOrThrow(submissionId);
  materializePatientFromSubmission(submissionId);
  const now = nowIso();
  db.prepare(
    `update submissions
     set status = 'completed',
         forms_completed_json = ?,
         submitted_at = ?,
         completed_pdf_path = ?,
         updated_at = ?
     where id = ?`,
  ).run(stringifyJson([submission.form_id]), now, completedPdfPath, now, submissionId);
  return getSubmissionByIdOrThrow(submissionId);
}

export function linkPatientAccount(input: { submissionId: string; accountId: string }): void {
  const submission = getSubmissionByIdOrThrow(input.submissionId);
  if (!submission.patient_id) {
    materializePatientFromSubmission(input.submissionId);
  }
  const latest = getSubmissionByIdOrThrow(input.submissionId);
  if (!latest.patient_id) return;
  db.prepare('update patients set account_id = ?, updated_at = ? where id = ?').run(
    input.accountId,
    nowIso(),
    latest.patient_id,
  );
}

export function listPatients(practiceId: string, search?: string): Array<Record<string, unknown>> {
  const q = `%${search ?? ''}%`;
  return db
    .prepare(
      `select p.id, p.child_first_name, p.child_last_name, p.child_dob, p.visit_type, p.updated_at,
              p.patient_acct_no,
              na.next_appointment_date, na.next_appointment_time,
              s.status as latest_submission_status,
              pa.email as account_email
       from patients p
       left join (
         select patient_id, appointment_date as next_appointment_date, appointment_time as next_appointment_time
         from (
           select patient_id, appointment_date, appointment_time,
                  row_number() over (partition by patient_id order by created_at desc, id desc) as rn
           from appointments
         ) x where rn = 1
       ) na on na.patient_id = p.id
       left join submissions s on s.patient_id = p.id
       left join patient_accounts pa on pa.id = p.account_id
       where p.practice_id = ? and (
         p.child_first_name like ? or p.child_last_name like ?
         or coalesce(p.patient_acct_no, '') like ?
       )
       group by p.id
       order by p.updated_at desc`,
    )
    .all(practiceId, q, q, q) as Array<Record<string, unknown>>;
}

export type BulkPatientImportResult = {
  inserted: number;
  skipped: number;
  total_rows: number;
  errors: string[];
  imported_patients: Array<{
    id: string;
    child_first_name: string;
    child_last_name: string;
    patient_acct_no: string | null;
  }>;
};

/**
 * Insert parsed Excel rows; skips duplicates (same practice + acct no, or name + DOB),
 * duplicate keys within the same upload batch, and unique constraint violations.
 */
export function bulkImportPatientsFromExcelRows(
  practiceId: string,
  parsedRows: PatientExcelImportRow[],
  total_rows: number,
  parseErrors: string[],
): BulkPatientImportResult {
  const errors = [...parseErrors];
  const imported_patients: BulkPatientImportResult['imported_patients'] = [];
  let inserted = 0;
  let skipped = 0;

  const dupByAcct = db.prepare(
    `select id from patients where practice_id = ? and patient_acct_no is not null and trim(patient_acct_no) = ? limit 1`,
  );
  const dupByNameDob = db.prepare(
    `select id from patients where practice_id = ?
       and lower(trim(child_first_name)) = lower(trim(?))
       and lower(trim(child_last_name)) = lower(trim(?))
       and child_dob = ?
     limit 1`,
  );

  const insertPatient = db.prepare(
    `insert into patients (
      id, practice_id, account_id, child_first_name, child_last_name, child_dob, visit_type,
      preferred_language, sex, race_ethnicity, created_at, updated_at,
      external_patient_key, patient_acct_no, import_source, imported_at
    ) values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertAppointment = db.prepare(
    `insert into appointments (
      id, practice_id, patient_id, external_appointment_key,
      appointment_date, appointment_time, visit_type_raw, visit_reason,
      provider_name, facility_name, import_source, imported_at,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertGuardian = db.prepare(
    `insert into guardians (
      id, patient_id, guardian_index, full_name, relationship, phone, email, address, employer,
      ssn_last4, created_at, updated_at
    ) values (?, ?, 1, null, null, ?, ?, ?, null, null, ?, ?)`,
  );

  const insertInsurance = db.prepare(
    `insert into insurance_policies (
      id, patient_id, policy_order, company, subscriber_name, subscriber_dob, group_number, member_id,
      created_at, updated_at
    ) values (?, ?, 1, ?, null, null, null, ?, ?, ?)`,
  );

  const seenInFile = new Set<string>();

  for (const row of parsedRows) {
    const key = row.externalPatientKey;
    if (seenInFile.has(key)) {
      skipped += 1;
      errors.push(`Row ${row.sheetRow}: skipped (duplicate row in file)`);
      continue;
    }
    seenInFile.add(key);

    let existing: { id: string } | undefined;
    if (row.patientAcctNo?.trim()) {
      existing = dupByAcct.get(practiceId, row.patientAcctNo.trim()) as { id: string } | undefined;
    } else {
      existing = dupByNameDob.get(practiceId, row.childFirstName, row.childLastName, row.childDob) as
        | { id: string }
        | undefined;
    }

    if (existing) {
      skipped += 1;
      errors.push(`Row ${row.sheetRow}: skipped (patient already exists)`);
      continue;
    }

    const id = randomUUID();
    const now = nowIso();
    const acct = row.patientAcctNo?.trim() || null;

    try {
      insertPatient.run(
        id,
        practiceId,
        row.childFirstName,
        row.childLastName,
        row.childDob,
        row.visitType,
        row.preferredLanguage,
        row.sex,
        row.raceEthnicity,
        now,
        now,
        row.externalPatientKey,
        acct,
        'excel_bulk',
        now,
      );
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        skipped += 1;
        errors.push(`Row ${row.sheetRow}: skipped (duplicate key)`);
        continue;
      }
      errors.push(`Row ${row.sheetRow}: ${msg}`);
      continue;
    }

    const apptKey = `excel:${practiceId}:${row.externalPatientKey}:r${row.sheetRow}`;
    const hasApptData = Boolean(
      row.nextAppointmentDate ||
        row.nextAppointmentTime ||
        row.appointmentVisitType ||
        row.appointmentVisitReason ||
        row.appointmentProviderName ||
        row.appointmentFacilityName,
    );
    if (hasApptData) {
      try {
        insertAppointment.run(
          randomUUID(),
          practiceId,
          id,
          apptKey,
          row.nextAppointmentDate,
          row.nextAppointmentTime,
          row.appointmentVisitType,
          row.appointmentVisitReason,
          row.appointmentProviderName,
          row.appointmentFacilityName,
          'excel_bulk',
          now,
          now,
          now,
        );
      } catch (apptErr) {
        const apMsg = (apptErr as Error).message ?? String(apptErr);
        errors.push(`Row ${row.sheetRow}: patient saved but appointment not saved (${apMsg})`);
      }
    }

    if (row.guardianPhones || row.guardianEmail || row.guardianAddress) {
      insertGuardian.run(
        randomUUID(),
        id,
        row.guardianPhones,
        row.guardianEmail,
        row.guardianAddress,
        now,
        now,
      );
    }

    const hasPrimary = Boolean(row.primaryInsuranceCompany?.trim() || row.primaryInsuranceMemberId?.trim());
    const hasApptIns = Boolean(
      row.appointmentInsuranceCompany?.trim() || row.appointmentInsuranceMemberId?.trim(),
    );
    let company: string | null = null;
    let memberId: string | null = null;
    if (hasPrimary) {
      company = row.primaryInsuranceCompany?.trim() || null;
      memberId = row.primaryInsuranceMemberId?.trim() || null;
    } else if (hasApptIns) {
      company = row.appointmentInsuranceCompany?.trim() || null;
      memberId = row.appointmentInsuranceMemberId?.trim() || null;
    }
    if (company || memberId) {
      insertInsurance.run(randomUUID(), id, company, memberId, now, now);
    }

    inserted += 1;
    imported_patients.push({
      id,
      child_first_name: row.childFirstName,
      child_last_name: row.childLastName,
      patient_acct_no: acct,
    });
  }

  return { inserted, skipped, total_rows, errors, imported_patients };
}

function getRows(table: string, patientId: string): Array<Record<string, unknown>> {
  return db.prepare(`select * from ${table} where patient_id = ? order by created_at asc`).all(patientId) as Array<
    Record<string, unknown>
  >;
}

function getOne(table: string, patientId: string): Record<string, unknown> | null {
  return (db.prepare(`select * from ${table} where patient_id = ?`).get(patientId) as Record<string, unknown> | undefined) ?? null;
}

export function getPatientDetail(patientId: string, practiceId: string): Record<string, unknown> | null {
  const patient = db.prepare('select * from patients where id = ? and practice_id = ?').get(patientId, practiceId) as
    | Record<string, unknown>
    | undefined;
  if (!patient) return null;

  return {
    patient,
    guardians: getRows('guardians', patientId),
    insurance_policies: getRows('insurance_policies', patientId),
    appointments: db
      .prepare(`select * from appointments where patient_id = ? order by created_at desc, id desc`)
      .all(patientId),
    pharmacies: getOne('pharmacies', patientId),
    medical_history: getOne('medical_history', patientId),
    concerns: getOne('concerns', patientId),
    allergies: getRows('allergies', patientId),
    medications: getRows('medications', patientId),
    immunizations: getOne('immunizations', patientId),
    family_history: getRows('family_history', patientId),
    social_history: getOne('social_history', patientId),
    provider_preferences: getOne('provider_preferences', patientId),
    consents_signatures: getOne('consents_signatures', patientId),
    submissions: db
      .prepare(
        'select id, form_id, template_id, status, submitted_at, confirmation_code, completed_pdf_path from submissions where patient_id = ? order by created_at desc',
      )
      .all(patientId),
  };
}

export function updatePatientCore(
  patientId: string,
  practiceId: string,
  payload: Partial<Record<'child_first_name' | 'child_last_name' | 'child_dob' | 'visit_type' | 'preferred_language' | 'sex' | 'race_ethnicity', string>>,
): void {
  const allowed = ['child_first_name', 'child_last_name', 'child_dob', 'visit_type', 'preferred_language', 'sex', 'race_ethnicity'];
  const entries = Object.entries(payload).filter(([k, v]) => allowed.includes(k) && typeof v === 'string');
  if (entries.length === 0) return;
  const set = [...entries.map(([k]) => `${k} = ?`), 'updated_at = ?'].join(', ');
  db.prepare(`update patients set ${set} where id = ? and practice_id = ?`).run(
    ...entries.map(([, v]) => v),
    nowIso(),
    patientId,
    practiceId,
  );
}

export function replaceChildTable(patientId: string, table: string, rows: Array<Record<string, unknown>>): void {
  const tableMap: Record<string, string[]> = {
    guardians: ['guardian_index', 'full_name', 'relationship', 'phone', 'email', 'address', 'employer', 'ssn_last4'],
    insurance_policies: ['policy_order', 'company', 'subscriber_name', 'subscriber_dob', 'group_number', 'member_id'],
    allergies: ['allergy_type', 'allergy_name', 'reaction'],
    medications: ['medication_name', 'dose', 'frequency'],
    family_history: ['condition_name', 'present', 'notes'],
  };

  const columns = tableMap[table];
  if (!columns) throw new Error(`Unsupported table replace: ${table}`);

  db.prepare(`delete from ${table} where patient_id = ?`).run(patientId);
  const now = nowIso();
  for (const row of rows) {
    const filtered = columns.map((col) => row[col] ?? null);
    db.prepare(
      `insert into ${table} (id, patient_id, ${columns.join(', ')}, created_at, updated_at)
       values (?, ?, ${columns.map(() => '?').join(', ')}, ?, ?)`,
    ).run(randomUUID(), patientId, ...filtered, now, now);
  }
}

export function upsertOneToOne(patientId: string, table: string, payload: Record<string, unknown>): void {
  const map: Record<string, string[]> = {
    pharmacies: ['name', 'address', 'zip'],
    medical_history: ['gestational_age', 'birth_weight', 'birth_complications', 'hospitalizations', 'surgeries'],
    concerns: ['visit_reason', 'development_concerns'],
    immunizations: ['status'],
    social_history: ['household_adults', 'household_children', 'smokers_in_home', 'pets', 'daycare_school', 'nutrition'],
    provider_preferences: ['physician_preference', 'referral_source', 'referring_provider'],
    consents_signatures: ['agreed', 'typed_name', 'signature_data', 'signed_at'],
  };
  const columns = map[table];
  if (!columns) throw new Error(`Unsupported one-to-one table: ${table}`);
  const values = columns.map((col) => payload[col] ?? null);

  db.prepare(
    `insert into ${table} (id, patient_id, ${columns.join(', ')}, created_at, updated_at)
     values (?, ?, ${columns.map(() => '?').join(', ')}, ?, ?)
     on conflict(patient_id) do update set
     ${columns.map((c) => `${c}=excluded.${c}`).join(', ')},
     updated_at=excluded.updated_at`,
  ).run(randomUUID(), patientId, ...values, nowIso(), nowIso());
}

export function listSubmissions(practiceId: string): Array<Record<string, unknown>> {
  return db
    .prepare(
      `select s.id, s.status, s.submitted_at, s.updated_at, s.confirmation_code,
              p.child_first_name, p.child_last_name, p.child_dob, p.id as patient_id,
              t.name as template_name
       from submissions s
       left join patients p on p.id = s.patient_id
       left join pdf_templates t on t.id = s.template_id
       where s.practice_id = ?
       order by s.created_at desc`,
    )
    .all(practiceId) as Array<Record<string, unknown>>;
}

export function exportSubmissionJson(submissionId: string, staffUserId: string): Record<string, unknown> {
  const submission = getSubmissionByIdOrThrow(submissionId);
  const payload = parseJson<Record<string, unknown>>(submission.form_data_json, {});
  const responses = parseJson<Record<string, unknown>>(submission.responses_json, {});

  db.prepare("update submissions set status='exported', exported_at=?, exported_by=?, updated_at=? where id=?").run(
    nowIso(),
    staffUserId,
    nowIso(),
    submissionId,
  );

  const patientDetail = submission.patient_id
    ? getPatientDetail(submission.patient_id, submission.practice_id)
    : null;

  return {
    submission_id: submission.id,
    practice_id: submission.practice_id,
    patient_id: submission.patient_id,
    form_id: submission.form_id,
    template_version: submission.template_version,
    template_id: submission.template_id,
    template_version_num: submission.template_version_num,
    status: 'exported',
    completed_pdf_path: submission.completed_pdf_path,
    submitted_at: submission.submitted_at,
    confirmation_code: submission.confirmation_code,
    payload,
    responses,
    normalized_patient_data: patientDetail,
  };
}

export function findPracticeBySlug(slug: string): Record<string, unknown> | undefined {
  return db.prepare('select * from practices where slug = ?').get(slug) as Record<string, unknown> | undefined;
}

export function findPracticeById(id: string): Record<string, unknown> | undefined {
  return db.prepare('select * from practices where id = ?').get(id) as Record<string, unknown> | undefined;
}

export function createPatientAccount(input: {
  email: string;
  passwordHash: string;
  practiceId: string;
}): { id: string; email: string; practiceId: string } {
  const id = randomUUID();
  db.prepare(
    `insert into patient_accounts (id, email, password_hash, practice_id, created_at, last_login_at)
     values (?, ?, ?, ?, ?, null)`,
  ).run(id, input.email, input.passwordHash, input.practiceId, nowIso());

  return { id, email: input.email, practiceId: input.practiceId };
}

const placeholderFirstNames = ['Avery', 'Milo', 'Luna', 'Noah', 'Maya', 'Leo', 'Ivy', 'Owen'];
const placeholderLastNames = ['Parker', 'Hayes', 'Bennett', 'Reed', 'Foster', 'Brooks', 'Wells', 'Carter'];

function hashSeed(value: string): number {
  let hash = 0;
  for (const ch of value) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

export function ensureLinkedPatientForAccount(input: {
  accountId: string;
  practiceId: string;
  seed?: string;
}): void {
  const existing = db.prepare('select id from patients where account_id = ? limit 1').get(input.accountId) as { id: string } | undefined;
  if (existing) return;

  const seed = input.seed?.trim() || input.accountId;
  const hash = hashSeed(seed);
  const firstName = placeholderFirstNames[hash % placeholderFirstNames.length];
  const lastName = placeholderLastNames[Math.floor(hash / placeholderFirstNames.length) % placeholderLastNames.length];
  const now = nowIso();

  db.prepare(
    `insert into patients (
      id, practice_id, account_id, child_first_name, child_last_name, child_dob, visit_type,
      preferred_language, sex, race_ethnicity, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, null, null, null, ?, ?)`,
  ).run(
    randomUUID(),
    input.practiceId,
    input.accountId,
    firstName,
    lastName,
    '2026-01-01',
    'new_patient',
    now,
    now,
  );
}

export function getPatientAccountByEmail(email: string):
  | { id: string; email: string; password_hash: string; practice_id: string }
  | undefined {
  return db
    .prepare('select id, email, password_hash, practice_id from patient_accounts where lower(email) = lower(?)')
    .get(email) as { id: string; email: string; password_hash: string; practice_id: string } | undefined;
}

export function touchPatientLogin(accountId: string): void {
  db.prepare('update patient_accounts set last_login_at = ? where id = ?').run(nowIso(), accountId);
}

export function listSubmissionsForAccount(accountId: string, practiceId: string): Array<Record<string, unknown>> {
  return db
    .prepare(
      `select s.id, s.status, s.submitted_at, s.updated_at, s.confirmation_code,
              s.form_id, s.template_id, s.visit_type,
              p.child_first_name, p.child_last_name, p.child_dob, p.id as patient_id
       from submissions s
       join patients p on p.id = s.patient_id
       where p.account_id = ? and s.practice_id = ?
       order by s.created_at desc`,
    )
    .all(accountId, practiceId) as Array<Record<string, unknown>>;
}

export function getStaffByEmail(email: string):
  | { id: string; email: string; password_hash: string; practice_id: string; role: 'staff' | 'admin'; is_active: number }
  | undefined {
  return db
    .prepare('select id, email, password_hash, practice_id, role, is_active from staff_users where lower(email) = lower(?)')
    .get(email) as
    | { id: string; email: string; password_hash: string; practice_id: string; role: 'staff' | 'admin'; is_active: number }
    | undefined;
}

// Expire in_progress submissions older than `olderThanHours` hours.
// Returns the number of rows marked expired.
export function expireStaleSubmissions(olderThanHours = 48): number {
  const result = db
    .prepare(
      `update submissions
       set status = 'expired', updated_at = ?
       where status = 'in_progress'
         and created_at < datetime('now', '-' || ? || ' hours')`,
    )
    .run(nowIso(), olderThanHours);
  return result.changes as number;
}
