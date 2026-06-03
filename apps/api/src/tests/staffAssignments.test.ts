import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  bootstrapDb,
  buildTestApp,
  resetAssignmentTables,
  insertAssignment,
  staffToken,
  TEST_PRACTICE_ID,
  TEST_PATIENT_ID,
  TEST_TEMPLATE_ID,
  TEST_STAFF_ID,
} from './helpers.js';
import { db } from '../db/database.js';

const app = buildTestApp();

beforeAll(() => bootstrapDb());
beforeEach(() => resetAssignmentTables());

// ── POST /api/staff/assignments ───────────────────────────────────────────────

describe('POST /api/staff/assignments', () => {
  it('creates a bundle and returns portal fill_url + qr_code_data_url', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ patient_id: TEST_PATIENT_ID, template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.bundle_id).toBeTruthy();
    expect(data.bundle_token).toBeTruthy();
    expect(data.fill_url).toContain('/fill/portal/');
    expect(data.portal_url).toContain('/fill/portal/');
    expect(data.qr_code_data_url).toMatch(/^data:image\/png;base64,/);
    expect(data.patient_name).toBe('Emma Smith');
    expect(data.template_names).toContain('Test Registration Form');
  });

  it('respects expires_in_days', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ patient_id: TEST_PATIENT_ID, template_ids: [TEST_TEMPLATE_ID], expires_in_days: 14 });

    expect(res.status).toBe(200);
    const diffDays =
      (new Date(res.body.data.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(13);
    expect(diffDays).toBeLessThan(15);
  });

  it('returns 401 without an auth token', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .send({ patient_id: TEST_PATIENT_ID, template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(401);
  });

  it('returns 403 when a parent token is used', async () => {
    const parentJwt = staffToken({ role: 'parent' });
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ patient_id: TEST_PATIENT_ID, template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(403);
  });

  it('returns 422 when patient_id is missing', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ template_id: TEST_TEMPLATE_ID });

    expect(res.status).toBe(422);
  });

  it('returns 422 when template_id is missing', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ patient_id: TEST_PATIENT_ID });

    expect(res.status).toBe(422);
  });

  it('returns 404 when patient belongs to a different practice', async () => {
    const otherPatientId = randomUUID();
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ patient_id: otherPatientId, template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 when template is not published', async () => {
    const draftTemplateId = randomUUID();
    // Insert a draft template
    const { nowIso, db } = await import('../db/database.js');
    db.prepare(
      `insert into pdf_templates
         (id, practice_id, template_key, version, name, source_pdf_path, status,
          created_by, created_at, updated_at)
       values (?, ?, 'draft_form', 1, 'Draft Form', 'x.pdf', 'draft', ?, ?, ?)`,
    ).run(draftTemplateId, TEST_PRACTICE_ID, TEST_STAFF_ID, nowIso(), nowIso());

    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ patient_id: TEST_PATIENT_ID, template_ids: [draftTemplateId] });

    expect(res.status).toBe(404);
  });
});

// ── GET /api/staff/assignments ────────────────────────────────────────────────

describe('GET /api/staff/assignments', () => {
  it('returns all assignments for the practice', async () => {
    insertAssignment();
    insertAssignment();

    const res = await request(app)
      .get('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/staff/assignments');
    expect(res.status).toBe(401);
  });

  it('includes patient name and template name in the response', async () => {
    insertAssignment();

    const res = await request(app)
      .get('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`);

    const row = res.body.data[0];
    expect(row.child_first_name).toBe('Emma');
    expect(row.child_last_name).toBe('Smith');
    expect(row.template_name).toBe('Test Registration Form');
  });
});

// ── GET /api/staff/assignments/patient/:patientId ─────────────────────────────

describe('GET /api/staff/assignments/patient/:patientId', () => {
  it('returns assignments only for the specified patient', async () => {
    insertAssignment();

    const res = await request(app)
      .get(`/api/staff/assignments/patient/${TEST_PATIENT_ID}`)
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].template_name).toBe('Test Registration Form');
  });

  it('returns empty array when patient has no assignments', async () => {
    const res = await request(app)
      .get(`/api/staff/assignments/patient/${randomUUID()}`)
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── GET /api/staff/assignments/:id/link ───────────────────────────────────────

describe('GET /api/staff/assignments/:id/link', () => {
  it('returns fill_url and qr_code_data_url for an existing assignment', async () => {
    const { id } = insertAssignment();

    const res = await request(app)
      .get(`/api/staff/assignments/${id}/link`)
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.fill_url).toContain('/fill/');
    expect(res.body.data.qr_code_data_url).toMatch(/^data:image\/png;base64,/);
  });

  it('returns 404 for an assignment from a different practice', async () => {
    const { id } = insertAssignment();
    const otherPracticeToken = staffToken({ practiceId: randomUUID() });

    const res = await request(app)
      .get(`/api/staff/assignments/${id}/link`)
      .set('Authorization', `Bearer ${otherPracticeToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-existent assignment id', async () => {
    const res = await request(app)
      .get(`/api/staff/assignments/${randomUUID()}/link`)
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(404);
  });
});

// ── POST /api/staff/assignments/:id/send-sms ──────────────────────────────────

describe('POST /api/staff/assignments/:id/send-sms', () => {
  it('returns 503 when Twilio env vars are not configured', async () => {
    const { id } = insertAssignment();

    const res = await request(app)
      .post(`/api/staff/assignments/${id}/send-sms`)
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ phone: '+15551234567' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SMS_NOT_CONFIGURED');
  });

  it('returns 422 when phone is missing', async () => {
    const { id } = insertAssignment();

    const res = await request(app)
      .post(`/api/staff/assignments/${id}/send-sms`)
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('returns 400 when assignment is expired', async () => {
    const { id } = insertAssignment({
      status: 'expired',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await request(app)
      .post(`/api/staff/assignments/${id}/send-sms`)
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ phone: '+15551234567' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSIGNMENT_EXPIRED');
  });

  it('returns 400 when assignment is already completed', async () => {
    const { id } = insertAssignment({ status: 'completed' });

    const res = await request(app)
      .post(`/api/staff/assignments/${id}/send-sms`)
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ phone: '+15551234567' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSIGNMENT_COMPLETED');
  });
});

// ── POST /api/staff/assignments – inline new patient ──────────────────────────

describe('POST /api/staff/assignments – inline new patient', () => {
  it('creates an assignment for a brand-new patient by name + dob', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ first_name: 'Liam', last_name: 'Torres', dob: '2021-04-10', template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(200);
    expect(res.body.data.patient_name).toBe('Liam Torres');
    expect(res.body.data.bundle_id).toBeTruthy();
  });

  it('reuses an existing patient when name + dob already match', async () => {
    await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ first_name: 'Mia', last_name: 'Chen', dob: '2022-08-20', template_ids: [TEST_TEMPLATE_ID] });

    resetAssignmentTables();

    await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ first_name: 'Mia', last_name: 'Chen', dob: '2022-08-20', template_ids: [TEST_TEMPLATE_ID] });

    const { n } = db
      .prepare(
        `select count(*) as n from patients
         where child_first_name = 'Mia' and child_last_name = 'Chen'
           and practice_id = '${TEST_PRACTICE_ID}'`,
      )
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it('returns 422 when first_name is missing', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ last_name: 'Brown', dob: '2020-01-01', template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(422);
  });

  it('returns 422 when dob is missing', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ first_name: 'Jake', last_name: 'Brown', template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(422);
  });
});

// ── POST /api/staff/assignments – default expiry ──────────────────────────────

describe('POST /api/staff/assignments – default expiry', () => {
  it('defaults to 7 days when expires_in_days is omitted', async () => {
    const res = await request(app)
      .post('/api/staff/assignments')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ patient_id: TEST_PATIENT_ID, template_ids: [TEST_TEMPLATE_ID] });

    expect(res.status).toBe(200);
    const diffDays =
      (new Date(res.body.data.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });
});

// ── DELETE /api/staff/assignments/:id ─────────────────────────────────────────

describe('DELETE /api/staff/assignments/:id', () => {
  it('deletes an existing assignment and returns deleted: true', async () => {
    const { id } = insertAssignment();

    const res = await request(app)
      .delete(`/api/staff/assignments/${id}`)
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
  });

  it('actually removes the row from the database', async () => {
    const { id } = insertAssignment();

    await request(app)
      .delete(`/api/staff/assignments/${id}`)
      .set('Authorization', `Bearer ${staffToken()}`);

    const row = db.prepare('select id from form_assignments where id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('returns 404 for a non-existent assignment', async () => {
    const res = await request(app)
      .delete(`/api/staff/assignments/${randomUUID()}`)
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 when the assignment belongs to a different practice', async () => {
    const { id } = insertAssignment();
    const otherToken = staffToken({ practiceId: randomUUID() });

    const res = await request(app)
      .delete(`/api/staff/assignments/${id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without an auth token', async () => {
    const { id } = insertAssignment();

    const res = await request(app).delete(`/api/staff/assignments/${id}`);

    expect(res.status).toBe(401);
  });
});
