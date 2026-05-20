import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../db/migrate.js';
import { db, nowIso } from '../db/database.js';
import { staffTemplatesRouter } from '../routes/staffTemplates.js';
import { authMiddleware } from '../middleware/auth.js';
import { fail } from '../lib/response.js';
import { signToken } from '../lib/auth.js';
import { bootstrapDb, TEST_PATIENT_ID, TEST_PRACTICE_ID, TEST_STAFF_ID, TEST_TEMPLATE_ID } from './helpers.js';

function buildTemplatesApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/staff/templates', authMiddleware('staff'), staffTemplatesRouter);
  app.use((_req, res) => fail(res, 'NOT_FOUND', 'Route not found', 404));
  return app;
}

function staffAuthHeader() {
  return {
    Authorization: `Bearer ${signToken({
      id: TEST_STAFF_ID,
      practiceId: TEST_PRACTICE_ID,
      role: 'admin',
      email: 'admin@test.com',
    })}`,
  };
}

function insertDraftTemplate(id: string) {
  const now = nowIso();
  db.prepare(
    `insert into pdf_templates
       (id, practice_id, template_key, version, name, source_pdf_path, acroform_pdf_path,
        status, created_by, created_at, updated_at)
     values (?, ?, 'draft_form', 2, 'Draft Form', 'templates/source/draft.pdf', null, 'draft', ?, ?, ?)`,
  ).run(id, TEST_PRACTICE_ID, TEST_STAFF_ID, now, now);
}

describe('DELETE /api/staff/templates/:id', () => {
  beforeAll(() => bootstrapDb());

  beforeEach(() => {
    db.prepare('delete from pdf_template_fields').run();
    db.prepare('delete from field_groups').run();
    db.prepare('delete from template_publish_events').run();
    db.prepare('delete from form_assignments').run();
    db.prepare('delete from pdf_templates where id != ?').run(TEST_TEMPLATE_ID);
  });

  it('deletes a draft template version and returns confirmation', async () => {
    const templateId = randomUUID();
    insertDraftTemplate(templateId);

    const app = buildTemplatesApp();
    const res = await request(app)
      .delete(`/api/staff/templates/${templateId}`)
      .set(staffAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
    expect(res.body.data.id).toBe(templateId);

    const row = db.prepare('select id from pdf_templates where id = ?').get(templateId);
    expect(row).toBeUndefined();
  });

  it('deletes a published template and removes linked assignments', async () => {
    const templateId = randomUUID();
    const assignmentId = randomUUID();
    const now = nowIso();
    db.prepare(
      `insert into pdf_templates
         (id, practice_id, template_key, version, name, source_pdf_path, acroform_pdf_path,
          status, created_by, created_at, updated_at)
       values (?, ?, 'live_form', 1, 'Live', 'templates/source/live.pdf', 'templates/x.pdf', 'published', ?, ?, ?)`,
    ).run(templateId, TEST_PRACTICE_ID, TEST_STAFF_ID, now, now);

    db.prepare(
      `insert into form_assignments
         (id, practice_id, patient_id, template_id, assigned_by, token, status, submission_id, expires_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, 'tok-live', 'pending', null, ?, ?, ?)`,
    ).run(assignmentId, TEST_PRACTICE_ID, TEST_PATIENT_ID, templateId, TEST_STAFF_ID, now, now, now);

    const app = buildTemplatesApp();
    const res = await request(app)
      .delete(`/api/staff/templates/${templateId}`)
      .set(staffAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.removed_assignment_count).toBe(1);

    expect(db.prepare('select id from pdf_templates where id = ?').get(templateId)).toBeUndefined();
    expect(db.prepare('select id from form_assignments where id = ?').get(assignmentId)).toBeUndefined();
  });
});
