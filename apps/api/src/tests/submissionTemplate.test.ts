/**
 * Tests for GET /api/submissions/:id/template
 *
 * This endpoint drives frontend routing in ParentOverviewPage. Getting the
 * response shape wrong causes the acroform PDF flow to silently fall back to
 * the step-by-step form — a regression that has recurred multiple times.
 *
 * KEY INVARIANTS (do not break):
 *  1. acroform_ready === true  iff  the template has an acroform_pdf_path
 *  2. form_id is the template_key, NOT 'patient_registration', for non-registration templates
 *  3. new_patient visit_type does NOT suppress acroform routing — only form_id does
 *  4. M-CHAT templates: pdf_overlay_ready is returned; non-MCHAT templates: it is not
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db/database.js';
import { createSubmission } from '../db/queries.js';
import {
  bootstrapDb,
  buildTestApp,
  resetAssignmentTables,
  TEST_PRACTICE_ID,
  TEST_PATIENT_ID,
  TEST_TEMPLATE_ID,
  TEST_STAFF_ID,
} from './helpers.js';

const app = buildTestApp();

beforeAll(() => bootstrapDb());
beforeEach(() => {
  resetAssignmentTables();
  // Reset acroform_pdf_path and template_key on the shared test template
  db.prepare(`update pdf_templates set acroform_pdf_path = null, template_key = 'test_form' where id = ?`)
    .run(TEST_TEMPLATE_ID);
  // Remove any extra templates inserted by individual tests
  db.prepare(`delete from pdf_templates where id != ?`).run(TEST_TEMPLATE_ID);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function insertTemplate(overrides: {
  id?: string;
  templateKey?: string;
  acroformPath?: string | null;
  fieldSchemaJson?: string;
} = {}): string {
  const id = overrides.id ?? randomUUID();
  const now = nowIso();
  db.prepare(
    `insert into pdf_templates
       (id, practice_id, template_key, version, name, source_pdf_path, acroform_pdf_path,
        field_schema_json, status, created_by, created_at, updated_at)
     values (?, ?, ?, 1, ?, 'templates/source/test.pdf', ?, ?, 'published', ?, ?, ?)`,
  ).run(
    id,
    TEST_PRACTICE_ID,
    overrides.templateKey ?? 'test_form',
    overrides.templateKey ?? 'Test Form',
    overrides.acroformPath ?? null,
    overrides.fieldSchemaJson ?? '{"fields":[]}',
    TEST_STAFF_ID,
    now,
    now,
  );
  return id;
}

function insertSubmission(templateId: string, visitType = 'new_patient'): string {
  const sub = createSubmission({
    practiceId: TEST_PRACTICE_ID,
    patientId: TEST_PATIENT_ID,
    visitType,
    formId: 'test_form',
    templateVersion: 'test_form@v1',
    templateId,
    templateVersionNum: 1,
    initialData: {},
    confirmationCode: `TEST-${randomUUID().slice(0, 6).toUpperCase()}`,
  });
  return sub.id;
}

// ── acroform_ready flag ───────────────────────────────────────────────────────

describe('GET /api/submissions/:id/template — acroform_ready', () => {
  it('is true when the template has an acroform_pdf_path', async () => {
    db.prepare(`update pdf_templates set acroform_pdf_path = ? where id = ?`)
      .run('templates/acroforms/test.pdf', TEST_TEMPLATE_ID);
    const subId = insertSubmission(TEST_TEMPLATE_ID);

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.acroform_ready).toBe(true);
  });

  it('is false when the template has no acroform_pdf_path', async () => {
    // acroform_pdf_path is null (reset in beforeEach)
    const subId = insertSubmission(TEST_TEMPLATE_ID);

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.acroform_ready).toBe(false);
  });
});

// ── form_id (template_key) ────────────────────────────────────────────────────

describe('GET /api/submissions/:id/template — form_id', () => {
  it('returns the template_key as form_id, not "patient_registration"', async () => {
    db.prepare(`update pdf_templates set template_key = 'asq30' where id = ?`)
      .run(TEST_TEMPLATE_ID);
    const subId = insertSubmission(TEST_TEMPLATE_ID);

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.form_id).toBe('asq30');
    expect(res.body.data.form_id).not.toBe('patient_registration');
  });

  it('returns "patient_registration" for a patient_registration template', async () => {
    const regId = insertTemplate({ templateKey: 'patient_registration' });
    const subId = insertSubmission(regId);

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.form_id).toBe('patient_registration');
  });
});

// ── visit_type must NOT suppress acroform routing ────────────────────────────

describe('GET /api/submissions/:id/template — visit_type does not affect acroform_ready', () => {
  it('returns acroform_ready: true for a new_patient visit_type with an acroform template', async () => {
    // Regression: a previous version of ParentOverviewPage routed new_patient
    // visits to step-by-step regardless of acroform_ready.
    // The API must return acroform_ready: true so the frontend can route correctly.
    db.prepare(`update pdf_templates set acroform_pdf_path = ? where id = ?`)
      .run('templates/acroforms/asq.pdf', TEST_TEMPLATE_ID);
    const subId = insertSubmission(TEST_TEMPLATE_ID, 'new_patient');

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.acroform_ready).toBe(true);
    // form_id is NOT patient_registration — so frontend should route to PDF
    expect(res.body.data.form_id).not.toBe('patient_registration');
  });

  it('returns acroform_ready: true for a well_visit visit_type with an acroform template', async () => {
    db.prepare(`update pdf_templates set acroform_pdf_path = ? where id = ?`)
      .run('templates/acroforms/asq.pdf', TEST_TEMPLATE_ID);
    const subId = insertSubmission(TEST_TEMPLATE_ID, 'well_visit');

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.acroform_ready).toBe(true);
  });
});

// ── M-CHAT overlay fields ─────────────────────────────────────────────────────

describe('GET /api/submissions/:id/template — M-CHAT pdf_overlay_ready', () => {
  it('returns pdf_overlay_ready: true for an mchat template with overlay fields', async () => {
    const fieldSchema = JSON.stringify({
      fields: [{ id: 'q1', key: 'q1', label: 'Q1', type: 'text', page: 1, x: 10, y: 10, width: 80, height: 14 }],
    });
    const mchatId = insertTemplate({ templateKey: 'mchat_r', fieldSchemaJson: fieldSchema });
    const subId = insertSubmission(mchatId);

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.pdf_overlay_ready).toBe(true);
    expect(res.body.data.field_schema.fields.length).toBeGreaterThan(0);
  });

  it('returns pdf_overlay_ready: false for an mchat template with no overlay fields', async () => {
    const mchatId = insertTemplate({ templateKey: 'mchat_r', fieldSchemaJson: '{"fields":[]}' });
    const subId = insertSubmission(mchatId);

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data.pdf_overlay_ready).toBe(false);
  });

  it('does not include pdf_overlay_ready for non-MCHAT templates', async () => {
    db.prepare(`update pdf_templates set template_key = 'asq30' where id = ?`)
      .run(TEST_TEMPLATE_ID);
    const subId = insertSubmission(TEST_TEMPLATE_ID);

    const res = await request(app).get(`/api/submissions/${subId}/template`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('pdf_overlay_ready');
    expect(res.body.data).not.toHaveProperty('field_schema');
  });
});

// ── error cases ───────────────────────────────────────────────────────────────

describe('GET /api/submissions/:id/template — error cases', () => {
  it('returns 404 for an unknown submission id', async () => {
    const res = await request(app).get(`/api/submissions/${randomUUID()}/template`);
    expect(res.status).toBe(404);
  });
});
