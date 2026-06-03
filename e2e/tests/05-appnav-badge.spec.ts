/**
 * AppNav mode-badge tests
 *
 * Regression test for: patient seeing ADMIN badge when VITE_APP_MODE=admin.
 *
 * When a patient has an active session and is on a patient-portal route
 * (/parent/...) the portal nav must always be shown — regardless of
 * VITE_APP_MODE.  This file is executed by two Playwright projects:
 *
 *   chromium       → baseURL http://localhost:5173  (VITE_APP_MODE unset)
 *   chromium-admin → baseURL http://localhost:5174  (VITE_APP_MODE=admin)
 *
 * Both projects must pass.  Before the fix, chromium-admin failed because
 * AppNav had `if (patientSession && isPatientPortal && !isAdminOnly)` which
 * skipped the patient nav and fell through to the generic nav that renders
 * the ADMIN badge.
 */
import { test, expect } from '@playwright/test';
import { API_BASE, ADMIN, loginAsPatient } from '../helpers/auth';

// ── helpers ───────────────────────────────────────────────────────────────────

async function getAdminToken(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.post(`${API_BASE}/api/staff/login`, {
    data: {
      email: ADMIN.email,
      password: ADMIN.password,
      practice_name: ADMIN.practiceName,
    },
  });
  const body = await res.json() as Record<string, unknown>;
  const data = body.data as Record<string, unknown> | undefined;
  return (data?.token ?? body.token ?? '') as string;
}

async function ensurePatientExists(
  page: import('@playwright/test').Page,
  token: string,
  firstName: string,
  lastName: string,
  dob: string,
): Promise<void> {
  // Fetch published templates — skip if none
  const tRes = await page.request.get(`${API_BASE}/api/staff/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tBody = await tRes.json() as Record<string, unknown>;
  const templates = (tBody.data ?? tBody) as Array<{ id: string; status: string }>;
  const published = templates.filter((t) => t.status === 'published');
  if (!published.length) return;

  await page.request.post(`${API_BASE}/api/staff/assignments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      first_name: firstName,
      last_name: lastName,
      dob,
      template_ids: [published[0].id],
    },
  });
}

// ── shared patient fixture ────────────────────────────────────────────────────

const suffix = `badge${Date.now()}`;
const PATIENT = {
  firstName: 'NavBadge',
  lastName: `Test${suffix}`,
  dob: '2020-03-10',
};

test.describe('AppNav: patient portal nav (no ADMIN badge)', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const token = await getAdminToken(page);
    await ensurePatientExists(page, token, PATIENT.firstName, PATIENT.lastName, PATIENT.dob);
    await page.close();
  });

  test('patient dashboard shows portal nav brand, not admin nav', async ({ page }) => {
    await loginAsPatient(page, PATIENT.firstName, PATIENT.lastName, PATIENT.dob);
    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });

    // Portal nav brand must be visible — confirms the patient nav branch rendered
    await expect(page.locator('.portal-nav-brand')).toBeVisible();
  });

  test('ADMIN mode badge is not shown to authenticated patient', async ({ page }) => {
    await loginAsPatient(page, PATIENT.firstName, PATIENT.lastName, PATIENT.dob);
    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });

    // The ADMIN badge must never appear while a patient is on their dashboard
    await expect(page.locator('.mode-badge-admin')).not.toBeVisible();
  });

  test('"My dashboard" nav link is visible in patient portal nav', async ({ page }) => {
    await loginAsPatient(page, PATIENT.firstName, PATIENT.lastName, PATIENT.dob);
    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });

    await expect(page.getByRole('link', { name: /my dashboard/i })).toBeVisible();
  });

  test('"Sign out" link is visible in patient portal nav', async ({ page }) => {
    await loginAsPatient(page, PATIENT.firstName, PATIENT.lastName, PATIENT.dob);
    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });

    await expect(page.getByRole('link', { name: /sign out/i })).toBeVisible();
  });
});
