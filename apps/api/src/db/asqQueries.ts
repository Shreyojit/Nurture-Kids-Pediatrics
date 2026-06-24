import { randomUUID } from 'node:crypto';
import { db, nowIso } from './database.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export type AsqTemplate = {
  id: string;
  practice_id: string;
  name: string;
  template_type: string;
  version: number;
  original_file_name: string;
  stored_file_name: string;
  file_path: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AsqTemplateField = {
  id: string;
  template_id: string;
  field_name: string;
  field_key: string;
  field_type: string;
  page_number: number;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  group_name: string | null;
  option_value: string | null;
  required: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AsqSubmission = {
  id: string;
  template_id: string;
  patient_id: string | null;
  practice_id: string;
  status: string;
  communication_total: number | null;
  gross_motor_total: number | null;
  fine_motor_total: number | null;
  problem_solving_total: number | null;
  personal_social_total: number | null;
  generated_pdf_path: string | null;
  created_at: string;
  updated_at: string;
};

export type AsqSubmissionValue = {
  id: string;
  submission_id: string;
  field_id: string;
  field_key: string;
  value: string;
  created_at: string;
  updated_at: string;
};

// ─── Template CRUD ─────────────────────────────────────────────────────────

export function listAsqTemplates(practiceId: string): AsqTemplate[] {
  return db
    .prepare('select * from asq_templates where practice_id = ? order by created_at desc')
    .all(practiceId) as AsqTemplate[];
}

export function getAsqTemplate(id: string, practiceId: string): AsqTemplate | null {
  return (
    (db
      .prepare('select * from asq_templates where id = ? and practice_id = ?')
      .get(id, practiceId) as AsqTemplate | undefined) ?? null
  );
}

export function createAsqTemplate(input: {
  practiceId: string;
  name: string;
  templateType: string;
  version: number;
  originalFileName: string;
  storedFileName: string;
  filePath: string;
  createdBy: string;
}): AsqTemplate {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `insert into asq_templates
     (id, practice_id, name, template_type, version, original_file_name,
      stored_file_name, file_path, created_by, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.practiceId,
    input.name,
    input.templateType,
    input.version,
    input.originalFileName,
    input.storedFileName,
    input.filePath,
    input.createdBy,
    now,
    now,
  );
  return db.prepare('select * from asq_templates where id = ?').get(id) as AsqTemplate;
}

export function deleteAsqTemplate(id: string, practiceId: string): void {
  db.prepare('delete from asq_template_fields where template_id = ?').run(id);
  db.prepare('delete from asq_templates where id = ? and practice_id = ?').run(id, practiceId);
}

// ─── Field CRUD ────────────────────────────────────────────────────────────

export function listAsqTemplateFields(templateId: string): AsqTemplateField[] {
  return db
    .prepare(
      'select * from asq_template_fields where template_id = ? order by page_number asc, sort_order asc',
    )
    .all(templateId) as AsqTemplateField[];
}

export function createAsqTemplateField(input: {
  templateId: string;
  fieldName: string;
  fieldKey: string;
  fieldType: string;
  pageNumber: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  groupName?: string | null;
  optionValue?: string | null;
  required?: boolean;
  sortOrder?: number;
}): AsqTemplateField {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `insert into asq_template_fields
     (id, template_id, field_name, field_key, field_type, page_number,
      x_percent, y_percent, width_percent, height_percent,
      group_name, option_value, required, sort_order, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.templateId,
    input.fieldName,
    input.fieldKey,
    input.fieldType,
    input.pageNumber,
    input.xPercent,
    input.yPercent,
    input.widthPercent,
    input.heightPercent,
    input.groupName ?? null,
    input.optionValue ?? null,
    input.required ? 1 : 0,
    input.sortOrder ?? 0,
    now,
    now,
  );
  return db.prepare('select * from asq_template_fields where id = ?').get(id) as AsqTemplateField;
}

export function updateAsqTemplateField(
  id: string,
  templateId: string,
  patch: Partial<{
    fieldName: string;
    fieldKey: string;
    fieldType: string;
    pageNumber: number;
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
    groupName: string | null;
    optionValue: string | null;
    required: boolean;
    sortOrder: number;
  }>,
): AsqTemplateField {
  const now = nowIso();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [now];

  if (patch.fieldName !== undefined) { sets.push('field_name = ?'); vals.push(patch.fieldName); }
  if (patch.fieldKey !== undefined) { sets.push('field_key = ?'); vals.push(patch.fieldKey); }
  if (patch.fieldType !== undefined) { sets.push('field_type = ?'); vals.push(patch.fieldType); }
  if (patch.pageNumber !== undefined) { sets.push('page_number = ?'); vals.push(patch.pageNumber); }
  if (patch.xPercent !== undefined) { sets.push('x_percent = ?'); vals.push(patch.xPercent); }
  if (patch.yPercent !== undefined) { sets.push('y_percent = ?'); vals.push(patch.yPercent); }
  if (patch.widthPercent !== undefined) { sets.push('width_percent = ?'); vals.push(patch.widthPercent); }
  if (patch.heightPercent !== undefined) { sets.push('height_percent = ?'); vals.push(patch.heightPercent); }
  if (patch.groupName !== undefined) { sets.push('group_name = ?'); vals.push(patch.groupName); }
  if (patch.optionValue !== undefined) { sets.push('option_value = ?'); vals.push(patch.optionValue); }
  if (patch.required !== undefined) { sets.push('required = ?'); vals.push(patch.required ? 1 : 0); }
  if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(patch.sortOrder); }

  vals.push(id, templateId);
  db.prepare(
    `update asq_template_fields set ${sets.join(', ')} where id = ? and template_id = ?`,
  ).run(...vals);
  return db.prepare('select * from asq_template_fields where id = ?').get(id) as AsqTemplateField;
}

export function deleteAsqTemplateField(id: string, templateId: string): void {
  db.prepare('delete from asq_template_fields where id = ? and template_id = ?').run(id, templateId);
}

export function deleteAllAsqTemplateFields(templateId: string): void {
  db.prepare('delete from asq_template_fields where template_id = ?').run(templateId);
}

export function bulkInsertAsqTemplateFields(
  templateId: string,
  fields: Array<{
    fieldName: string;
    fieldKey: string;
    fieldType: string;
    pageNumber: number;
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
    groupName?: string | null;
    optionValue?: string | null;
    required?: boolean;
    sortOrder?: number;
  }>,
): void {
  const now = nowIso();
  const stmt = db.prepare(
    `insert into asq_template_fields
     (id, template_id, field_name, field_key, field_type, page_number,
      x_percent, y_percent, width_percent, height_percent,
      group_name, option_value, required, sort_order, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    for (const f of fields) {
      stmt.run(
        randomUUID(),
        templateId,
        f.fieldName,
        f.fieldKey,
        f.fieldType,
        f.pageNumber,
        f.xPercent,
        f.yPercent,
        f.widthPercent,
        f.heightPercent,
        f.groupName ?? null,
        f.optionValue ?? null,
        f.required ? 1 : 0,
        f.sortOrder ?? 0,
        now,
        now,
      );
    }
  });
  run();
}

// ─── Submission CRUD ───────────────────────────────────────────────────────

export function createAsqSubmission(input: {
  templateId: string;
  patientId?: string | null;
  practiceId: string;
}): AsqSubmission {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `insert into asq_submissions
     (id, template_id, patient_id, practice_id, status,
      communication_total, gross_motor_total, fine_motor_total,
      problem_solving_total, personal_social_total,
      generated_pdf_path, created_at, updated_at)
     values (?, ?, ?, ?, 'in_progress', null, null, null, null, null, null, ?, ?)`,
  ).run(id, input.templateId, input.patientId ?? null, input.practiceId, now, now);
  return db.prepare('select * from asq_submissions where id = ?').get(id) as AsqSubmission;
}

export function getAsqSubmission(id: string): AsqSubmission | null {
  return (
    (db.prepare('select * from asq_submissions where id = ?').get(id) as AsqSubmission | undefined) ?? null
  );
}

export function listAsqSubmissions(practiceId: string): AsqSubmission[] {
  return db
    .prepare('select * from asq_submissions where practice_id = ? order by created_at desc')
    .all(practiceId) as AsqSubmission[];
}

export function updateAsqSubmissionScores(
  id: string,
  scores: {
    communication_total: number;
    gross_motor_total: number;
    fine_motor_total: number;
    problem_solving_total: number;
    personal_social_total: number;
  },
): void {
  db.prepare(
    `update asq_submissions set
     communication_total = ?,
     gross_motor_total = ?,
     fine_motor_total = ?,
     problem_solving_total = ?,
     personal_social_total = ?,
     status = 'scored',
     updated_at = ?
     where id = ?`,
  ).run(
    scores.communication_total,
    scores.gross_motor_total,
    scores.fine_motor_total,
    scores.problem_solving_total,
    scores.personal_social_total,
    nowIso(),
    id,
  );
}

export function setAsqSubmissionGeneratedPdf(id: string, pdfPath: string): void {
  db.prepare(
    'update asq_submissions set generated_pdf_path = ?, status = \'completed\', updated_at = ? where id = ?',
  ).run(pdfPath, nowIso(), id);
}

// ─── Submission Values ─────────────────────────────────────────────────────

export function upsertAsqSubmissionValues(
  submissionId: string,
  values: Array<{ fieldId: string; fieldKey: string; value: string }>,
): void {
  const now = nowIso();
  const stmt = db.prepare(
    `insert into asq_submission_values (id, submission_id, field_id, field_key, value, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(submission_id, field_key)
     do update set value = excluded.value, updated_at = excluded.updated_at`,
  );
  const run = db.transaction(() => {
    for (const v of values) {
      stmt.run(randomUUID(), submissionId, v.fieldId, v.fieldKey, v.value, now, now);
    }
  });
  run();
}

export function getAsqSubmissionValues(submissionId: string): AsqSubmissionValue[] {
  return db
    .prepare('select * from asq_submission_values where submission_id = ?')
    .all(submissionId) as AsqSubmissionValue[];
}

// ─── Scoring ───────────────────────────────────────────────────────────────

const ASQ_SCORE_MAP: Record<string, number> = { yes: 10, sometimes: 5, not_yet: 0 };

const ASQ_DOMAINS = [
  { key: 'communication_total', prefix: 'communication_' },
  { key: 'gross_motor_total', prefix: 'gross_motor_' },
  { key: 'fine_motor_total', prefix: 'fine_motor_' },
  { key: 'problem_solving_total', prefix: 'problem_solving_' },
  { key: 'personal_social_total', prefix: 'personal_social_' },
] as const;

export function computeAsqScores(
  submissionValues: AsqSubmissionValue[],
): {
  communication_total: number;
  gross_motor_total: number;
  fine_motor_total: number;
  problem_solving_total: number;
  personal_social_total: number;
} {
  const result = {
    communication_total: 0,
    gross_motor_total: 0,
    fine_motor_total: 0,
    problem_solving_total: 0,
    personal_social_total: 0,
  };

  for (const val of submissionValues) {
    const score = ASQ_SCORE_MAP[val.value.toLowerCase()];
    if (score === undefined) continue;

    for (const domain of ASQ_DOMAINS) {
      if (val.field_key.startsWith(domain.prefix)) {
        (result as Record<string, number>)[domain.key] += score;
        break;
      }
    }
  }

  return result;
}
