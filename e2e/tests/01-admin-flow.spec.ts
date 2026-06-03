/**
 * Admin flow tests
 *
 * Covers:
 * - Staff login / logout
 * - Navigating the admin sidebar
 * - Creating a form assignment for a new patient
 * - Verifying the assignment appears in the "All sent forms" table
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin, ADMIN } from '../helpers/auth';

test.describe('Admin: login', () => {
  test('successful login lands on patients page', async ({ page }) => {
    await loginAsAdmin(page);

    // Should be on a staff page after login
    await expect(page).toHaveURL(/\/staff\//);
    // Staff nav links confirm we are authenticated
    await expect(page.getByRole('link', { name: "Sent Forms" })).toBeVisible();
  });

  test('wrong password shows an error message', async ({ page }) => {
    await page.goto('/staff/login');
    await page.locator('#admin-practice').fill(ADMIN.practiceName);
    await page.locator('#admin-email').fill(ADMIN.email);
    await page.locator('#admin-password').fill('WrongPassword!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should stay on the login page and show an error
    await expect(page).toHaveURL(/\/staff\/login/);
    await expect(page.locator('.patient-portal-error, .error')).toBeVisible();
  });

  test('empty credentials shows browser validation', async ({ page }) => {
    await page.goto('/staff/login');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Form is required — browser prevents submission, URL stays the same
    await expect(page).toHaveURL(/\/staff\/login/);
  });
});

test.describe('Admin: navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('can navigate to Assignments page', async ({ page }) => {
    await page.getByRole('link', { name: 'Sent Forms' }).click();
    await expect(page).toHaveURL(/\/staff\/assignments/);
    await expect(page.getByRole('heading', { name: /form assignments/i })).toBeVisible();
  });

  test('can navigate to Submissions page', async ({ page }) => {
    await page.getByRole('link', { name: 'Completed Forms' }).click();
    await expect(page).toHaveURL(/\/staff\/submissions/);
  });

  test('can navigate to Templates page', async ({ page }) => {
    await page.getByRole('link', { name: 'Form Builder', exact: true }).click();
    await expect(page).toHaveURL(/\/staff\/templates/);
  });
});

test.describe('Admin: create assignment', () => {
  const uniqueSuffix = `${Date.now()}`;
  const patientFirst = 'E2E';
  const patientLast = `Patient${uniqueSuffix}`;
  const patientDob = '2020-03-10';

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/staff/assignments');
  });

  test('opens "Assign forms" panel when button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: /\+ Assign forms/i }).click();
    await expect(page.getByRole('heading', { name: /assign forms to patient/i })).toBeVisible();
  });

  test('creates assignment for a new patient and shows success message', async ({ page }) => {
    // Skip if no published templates exist
    const templates = await page.request.get('http://localhost:4000/api/staff/templates', {
      headers: {
        Authorization: `Bearer ${await getAdminToken(page)}`,
      },
    });
    const templateList: Array<{ status: string }> = (await templates.json()).data ?? await templates.json();
    const published = Array.isArray(templateList)
      ? templateList.filter((t) => t.status === 'published')
      : [];
    if (published.length === 0) {
      test.skip(true, 'No published templates in DB — skipping assignment creation test');
      return;
    }

    // Open the form panel
    await page.getByRole('button', { name: /\+ Assign forms/i }).click();

    // Switch to "New Patient" mode
    await page.getByRole('button', { name: /new patient/i }).click();

    // Fill patient details
    await page.locator('input[placeholder="Jane"]').fill(patientFirst);
    await page.locator('input[placeholder="Doe"]').fill(patientLast);
    await page.locator('input[type="date"]').first().fill(patientDob);

    // Select all available templates
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/staff/assignments') && res.request().method() === 'POST',
    );

    await page.getByRole('button', { name: /assign \d* ?forms?|assign form/i }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);

    // UI shows the success banner with patient name and login instructions
    await expect(page.getByText(/forms assigned to/i)).toBeVisible();
    await expect(page.getByText(new RegExp(patientFirst, 'i'))).toBeVisible();
    await expect(page.getByText(/admin\.pediformpro\.com\/parent\/login/i)).toBeVisible();
  });

  test('shows the new assignment in the All sent forms table', async ({ page }) => {
    // Use the API directly to create a "new patient" assignment and reload
    const token = await getAdminToken(page);
    const res = await page.request.post('http://localhost:4000/api/staff/assignments', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        first_name: patientFirst,
        last_name: patientLast,
        dob: patientDob,
        template_ids: await getFirstPublishedTemplateIds(page, token),
      },
    });

    if (res.status() === 422 || res.status() === 404) {
      test.skip(true, 'No published templates — skipping table assertion test');
      return;
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    // Match by unique last name (includes timestamp) to avoid collisions with prior runs
    await expect(page.getByRole('cell', { name: new RegExp(patientLast, 'i') }).first()).toBeVisible({ timeout: 10_000 });
    // 'pending' renders as 'Not opened' via formatAssignmentStatus
    await expect(page.getByRole('cell', { name: /not opened/i }).first()).toBeVisible();
  });
});

// ── helpers used only in this spec ────────────────────────────────────────────

async function getAdminToken(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.post('http://localhost:4000/api/staff/login', {
    data: {
      email: ADMIN.email,
      password: ADMIN.password,
      practice_name: ADMIN.practiceName,
    },
  });
  const body = await res.json();
  return body.data?.token ?? body.token ?? '';
}

async function getFirstPublishedTemplateIds(
  page: import('@playwright/test').Page,
  token: string,
): Promise<string[]> {
  const res = await page.request.get('http://localhost:4000/api/staff/templates', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const list: Array<{ id: string; status: string }> = body.data ?? body;
  const published = list.filter((t) => t.status === 'published');
  return published.length ? [published[0].id] : [];
}
