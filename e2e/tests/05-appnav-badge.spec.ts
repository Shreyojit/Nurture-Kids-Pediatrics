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
 *
 * Session is seeded directly into localStorage to avoid any API calls,
 * keeping the tests fast and independent of app mode / API URL config.
 */
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'pediform_patient_session';

const PATIENT_SESSION = {
  identity: { firstName: 'NavBadge', lastName: 'Tester', dob: '2020-03-10' },
  access: {
    patient_first_name: 'NavBadge',
    practice_name: 'Test Practice',
    practice_names: ['Test Practice'],
    next_appointment_date: null,
    next_appointment_time: null,
    forms: [],
    documents: [],
  },
};

// Seed the patient session in localStorage then navigate to the dashboard.
async function goToDashboardWithSession(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(PATIENT_SESSION)],
  );
  await page.goto('/parent/dashboard');
}

test.describe('AppNav: patient portal nav (no ADMIN badge)', () => {
  test('patient dashboard shows portal nav brand, not admin nav', async ({ page }) => {
    await goToDashboardWithSession(page);

    // Portal nav brand must be visible — confirms the patient nav branch rendered
    await expect(page.locator('.portal-nav-brand')).toBeVisible();
  });

  test('ADMIN mode badge is not shown to authenticated patient on dashboard', async ({ page }) => {
    await goToDashboardWithSession(page);

    // The ADMIN badge must never appear while a patient is on their dashboard
    await expect(page.locator('.mode-badge-admin')).not.toBeVisible();
  });

  test('"My dashboard" nav link is visible in patient portal nav', async ({ page }) => {
    await goToDashboardWithSession(page);

    await expect(page.getByRole('link', { name: /my dashboard/i })).toBeVisible();
  });

  test('"Sign out" link is visible in patient portal nav', async ({ page }) => {
    await goToDashboardWithSession(page);

    await expect(page.getByRole('link', { name: /sign out/i })).toBeVisible();
  });

  test('ADMIN mode badge is not shown on the patient sign-in page', async ({ page }) => {
    // No session — patient has not yet logged in
    await page.goto('/parent/login');

    // Portal nav must render (no admin badge), even before the patient authenticates
    await expect(page.locator('.portal-nav-brand')).toBeVisible();
    await expect(page.locator('.mode-badge-admin')).not.toBeVisible();
  });
});
