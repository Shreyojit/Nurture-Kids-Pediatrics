import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import {
  addSubmissionEvent,
  createPatientAccount,
  ensureLinkedPatientForAccount,
  findPracticeById,
  getPatientAccountByEmail,
  getSubmissionById,
  linkPatientAccount,
  listSubmissionsForAccount,
  touchPatientLogin,
} from '../db/queries.js';
import { listPublishedTemplatesForPractice } from '../db/templateQueries.js';
import { comparePassword, hashPassword, signToken } from '../lib/auth.js';
import { fail, ok } from '../lib/response.js';
import { authMiddleware } from '../middleware/auth.js';

export const parentAuthRouter = Router();

const gmailSchema = z.string().email().refine((value) => value.toLowerCase().endsWith('@gmail.com'), {
  message: 'Only Gmail addresses are allowed for parent accounts',
});

const createAccountSchema = z.object({
  submission_id: z.string().uuid(),
  email: gmailSchema,
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must include an uppercase letter')
    .regex(/[a-z]/, 'Must include a lowercase letter')
    .regex(/[0-9]/, 'Must include a number'),
});

parentAuthRouter.post('/accounts', (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid account payload', 422, parsed.error.flatten());
    return;
  }

  const submission = getSubmissionById(parsed.data.submission_id);
  if (!submission) {
    fail(res, 'NOT_FOUND', 'Submission not found', 404);
    return;
  }

  const existing = getPatientAccountByEmail(parsed.data.email);
  if (existing) {
    fail(res, 'ACCOUNT_EXISTS', 'Account already exists. Please sign in.', 409);
    return;
  }

  const account = createPatientAccount({
    email: parsed.data.email.toLowerCase(),
    passwordHash: hashPassword(parsed.data.password),
    practiceId: submission.practice_id,
  });

  linkPatientAccount({
    submissionId: submission.id,
    accountId: account.id,
  });

  addSubmissionEvent({
    submissionId: submission.id,
    practiceId: submission.practice_id,
    actorType: 'parent',
    actorId: account.id,
    eventType: 'parent_account_created',
  });

  const token = signToken({
    id: account.id,
    role: 'parent',
    practiceId: account.practiceId,
    email: account.email,
  });

  ok(res, {
    token,
    account: {
      id: account.id,
      email: account.email,
      practice_id: account.practiceId,
    },
  });
});

const loginSchema = z.object({
  email: gmailSchema,
  password: z.string().min(1),
});

parentAuthRouter.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid login payload', 422, parsed.error.flatten());
    return;
  }

  const account = getPatientAccountByEmail(parsed.data.email.toLowerCase());
  if (!account || !comparePassword(parsed.data.password, account.password_hash)) {
    fail(res, 'INVALID_CREDENTIALS', 'Invalid credentials', 401);
    return;
  }

  touchPatientLogin(account.id);

  const token = signToken({
    id: account.id,
    role: 'parent',
    practiceId: account.practice_id,
    email: account.email,
  });

  ok(res, {
    token,
    account: {
      id: account.id,
      email: account.email,
      practice_id: account.practice_id,
    },
  });
});

parentAuthRouter.get('/me', authMiddleware('parent'), (req, res) => {
  const account = db
    .prepare('select id, email, practice_id, created_at, last_login_at from patient_accounts where id = ?')
    .get(req.user!.id) as Record<string, unknown> | undefined;

  if (!account) {
    fail(res, 'NOT_FOUND', 'Account not found', 404);
    return;
  }

  ensureLinkedPatientForAccount({
    accountId: req.user!.id,
    practiceId: req.user!.practiceId,
    seed: String(account.email ?? req.user!.id),
  });

  const patients = db
    .prepare('select * from patients where account_id = ? order by updated_at desc')
    .all(req.user!.id) as Array<Record<string, unknown>>;

  ok(res, {
    account,
    patients,
  });
});

function inferVisitType(templateKey: string): 'new_patient' | 'well_child' | 'sick' | 'follow_up' {
  const key = templateKey.toLowerCase();
  if (key === 'mchat' || key.includes('mchat') || key.includes('m-chat')) return 'well_child';
  if (key.includes('well')) return 'well_child';
  if (key.includes('sick')) return 'sick';
  if (key.includes('follow')) return 'follow_up';
  return 'new_patient';
}

function inferDescription(templateName: string, templateKey: string): string {
  const key = templateKey.toLowerCase();
  if (key.includes('well')) return 'Pre-visit intake for routine wellness appointments.';
  if (key.includes('sick')) return 'Focused intake for urgent or sick-visit appointments.';
  if (key.includes('follow')) return 'Follow-up intake for existing patients.';
  if (templateName.toLowerCase().includes('registration')) return 'Full intake for a new child record and guardian information.';
  return `Complete ${templateName} online.`;
}

parentAuthRouter.get('/submissions', authMiddleware('parent'), (req, res) => {
  const submissions = listSubmissionsForAccount(req.user!.id, req.user!.practiceId);
  ok(res, { submissions });
});

parentAuthRouter.get('/forms', authMiddleware('parent'), (req, res) => {
  const practice = findPracticeById(req.user!.practiceId);
  if (!practice) {
    fail(res, 'NOT_FOUND', 'Practice not found', 404);
    return;
  }

  const practiceSlug = String(practice.slug ?? '');
  const templates = listPublishedTemplatesForPractice(req.user!.practiceId);

  const forms = templates.map((template) => {
    const visitType = inferVisitType(template.template_key);
    const startPath = `/p/${practiceSlug}?template_key=${encodeURIComponent(template.template_key)}&visit_type=${visitType}`;
    return {
      id: template.id,
      template_key: template.template_key,
      title: template.name,
      description: inferDescription(template.name, template.template_key),
      version: template.version,
      visit_type: visitType,
      start_path: startPath,
      acroform_ready: Boolean(template.acroform_pdf_path),
    };
  });

  ok(res, {
    practice_slug: practiceSlug,
    forms,
  });
});
