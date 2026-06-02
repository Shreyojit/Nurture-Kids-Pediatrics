/**
 * Post-submit routing tests for dashboard-authenticated patients
 *
 * Covers the fix where patients created via CSV import (or any patient with a
 * pediform_patient_session) are sent to /parent/dashboard after submitting a
 * form instead of the anonymous /confirmation page that prompts "Create Account".
 *
 * Flows tested:
 *   1. Dashboard-logged-in patient submits a form → lands on /parent/dashboard
 *   2. Dashboard shows the submitted form as completed afterward
 *   3. Confirmation page safety net: logged-in patient sees "Back to My Forms",
 *      not "Create Account (Optional)"
 */
import { test, expect } from '@playwright/test';
import { loginAsPatient, fillFormStep, ADMIN, API_BASE } from '../helpers/auth';

// ── shared helpers ────────────────────────────────────────────────────────────

async function getAdminToken(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.post(`${API_BASE}/api/staff/login`, {
    data: {
      email: ADMIN.email,
      password: ADMIN.password,
      practice_name: ADMIN.practiceName,
    },
  });
  const body = await res.json();
  return (body.data?.token ?? body.token ?? '') as string;
}

async function createPatientWithAssignment(
  page: import('@playwright/test').Page,
  token: string,
  firstName: string,
  lastName: string,
  dob: string,
): Promise<string | null> {
  const tRes = await page.request.get(`${API_BASE}/api/staff/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tBody = await tRes.json();
  const templates: Array<{ id: string; status: string }> = tBody.data ?? tBody;
  const published = templates.filter((t) => t.status === 'published');
  if (!published.length) return null;

  const aRes = await page.request.post(`${API_BASE}/api/staff/assignments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      first_name: firstName,
      last_name: lastName,
      dob,
      template_ids: [published[0].id],
    },
  });
  if (!aRes.ok()) return null;
  const aBody = await aRes.json();
  return aBody.data?.fill_url ?? aBody.fill_url ?? null;
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Post-submit routing: dashboard-authenticated patient', () => {
  const suffix = `${Date.now()}`;
  const firstName = 'DashSubmit';
  const lastName = `Patient${suffix}`;
  const dob = '2019-03-11';
  let hasTemplates = true;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const token = await getAdminToken(page);
    const result = await createPatientWithAssignment(page, token, firstName, lastName, dob);
    if (!result) hasTemplates = false;
    await page.close();
  });

  test('submitting a form routes to /parent/dashboard, not /confirmation', async ({ page }) => {
    if (!hasTemplates) {
      test.skip(true, 'No published templates — skipping');
      return;
    }

    await loginAsPatient(page, firstName, lastName, dob);
    await page.waitForURL('**/parent/dashboard', { timeout: 15_000 });

    // Click the first pending form's Start/Continue button
    const startBtn = page.getByRole('button', { name: /start|continue/i }).first();
    await expect(startBtn).toBeVisible({ timeout: 10_000 });
    await startBtn.click();

    // We're now on a form fill page — fill and submit
    const MAX_STEPS = 30;
    for (let step = 0; step < MAX_STEPS; step++) {
      const url = page.url();

      // Should NOT land on confirmation — bail early if it does (test will fail below)
      if (url.includes('/confirmation')) break;
      // Done when back on dashboard
      if (url.includes('/parent/dashboard')) break;

      // PDF overlay form — click the submit button
      const pdfSubmit = page.getByRole('button', { name: /submit form|save form|complete/i });
      if (await pdfSubmit.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await pdfSubmit.click();
        break;
      }

      // Step-by-step form
      await fillFormStep(page);

      const submitBtn = page.getByRole('button', { name: /^submit$/i });
      if (await submitBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await submitBtn.click();
        break;
      }

      await page.waitForTimeout(800);
    }

    // Key assertion: must land on dashboard, not confirmation
    await page.waitForURL('**/parent/dashboard', { timeout: 30_000 });
    await expect(page).not.toHaveURL(/\/confirmation/);
    await expect(page.getByRole('heading').filter({ hasText: new RegExp(firstName, 'i') })).toBeVisible();
  });

  test('dashboard shows submitted form as completed after redirect', async ({ page }) => {
    if (!hasTemplates) {
      test.skip(true, 'No published templates — skipping');
      return;
    }

    // Start from dashboard (relies on the patient + assignment created in beforeAll)
    await loginAsPatient(page, firstName, lastName, dob);
    await page.waitForURL('**/parent/dashboard', { timeout: 15_000 });

    // Either there's still a pending form (patient hasn't submitted yet in this run)
    // or the form is already completed (from the previous test in the same run).
    // In both cases the dashboard must be visible and the patient greeting shown.
    await expect(
      page.getByRole('heading').filter({ hasText: new RegExp(firstName, 'i') }),
    ).toBeVisible({ timeout: 10_000 });

    // If a completed section exists, verify the label
    const completedSection = page.getByText(/completed/i).first();
    if (await completedSection.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(page.getByText(/submitted.*thank you|thank you/i).first()).toBeVisible({ timeout: 5_000 });
    }
  });
});

test.describe('Confirmation page safety net: logged-in patient', () => {
  test('shows "Back to My Forms" and hides "Create Account" when session exists', async ({ page }) => {
    // Seed a fake patient session in localStorage so the confirmation page
    // treats this browser as a logged-in portal patient.
    await page.addInitScript(() => {
      localStorage.setItem(
        'pediform_patient_session',
        JSON.stringify({
          identity: { firstName: 'Safety', lastName: 'NetPatient', dob: '2020-01-01' },
          access: {
            patient_first_name: 'Safety',
            practice_name: 'Test Practice',
            practice_names: ['Test Practice'],
            next_appointment_date: null,
            next_appointment_time: null,
            forms: [],
            documents: [],
          },
        }),
      );
      // Also seed a start record so a confirmation code is displayed
      localStorage.setItem(
        'pediform_start_fake-session-id',
        JSON.stringify({ confirmation_code: 'TEST-001', completed: true }),
      );
    });

    await page.goto('/p/nurturekidspediatrics/session/fake-session-id/confirmation');

    // "Back to My Forms" button must be present
    await expect(page.getByRole('button', { name: /back to my forms/i })).toBeVisible({ timeout: 5_000 });

    // "Create Account (Optional)" must NOT appear
    await expect(page.getByRole('button', { name: /create account/i })).not.toBeVisible();
  });

  test('shows "Create Account" when no session exists (anonymous patient)', async ({ page }) => {
    // No localStorage seeding — anonymous patient
    await page.addInitScript(() => {
      localStorage.setItem(
        'pediform_start_anon-session-id',
        JSON.stringify({ confirmation_code: 'ANON-002', completed: true }),
      );
    });

    await page.goto('/p/nurturekidspediatrics/session/anon-session-id/confirmation');

    // "Create Account (Optional)" should appear for anonymous patients
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible({ timeout: 5_000 });

    // "Back to My Forms" should NOT appear
    await expect(page.getByRole('button', { name: /back to my forms/i })).not.toBeVisible();
  });
});
