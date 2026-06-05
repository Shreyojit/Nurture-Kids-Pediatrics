/**
 * Patient flow tests
 *
 * Covers:
 * - Patient portal login (name + DOB)
 * - Dashboard: pending form cards visible
 * - Patient portal link (identity verification → form list)
 * - Invalid login shows error
 */
import { test, expect } from '@playwright/test';
import { ADMIN } from '../helpers/auth';

// ── helpers ───────────────────────────────────────────────────────────────────

async function getAdminToken(page: import('@playwright/test').Page) {
  const res = await page.request.post('http://localhost:4000/api/staff/login', {
    data: {
      email: ADMIN.email,
      password: ADMIN.password,
      practice_name: ADMIN.practiceName,
    },
  });
  const body = await res.json();
  return (body.data?.token ?? body.token ?? '') as string;
}

async function createPatientAndAssignment(
  page: import('@playwright/test').Page,
  token: string,
  firstName: string,
  lastName: string,
  dob: string,
): Promise<true | null> {
  // Fetch published templates
  const tRes = await page.request.get('http://localhost:4000/api/staff/templates', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tBody = await tRes.json();
  const templates: Array<{ id: string; status: string }> = tBody.data ?? tBody;
  const published = templates.filter((t) => t.status === 'published');
  if (!published.length) return null;

  const aRes = await page.request.post('http://localhost:4000/api/staff/assignments', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      first_name: firstName,
      last_name: lastName,
      dob,
      template_ids: [published[0].id],
    },
  });
  return aRes.ok() ? true : null;
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Patient: portal login form', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/parent/login');
    await expect(page.getByRole('heading', { name: 'Patient sign-in' })).toBeVisible();
    await expect(page.locator('#signin-first')).toBeVisible();
    await expect(page.locator('#signin-last')).toBeVisible();
    await expect(page.locator('#signin-dob')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('invalid credentials show an error', async ({ page }) => {
    await page.goto('/parent/login');
    await page.locator('#signin-first').fill('Ghost');
    await page.locator('#signin-last').fill('Nobody');
    await page.locator('#signin-dob').fill('2000-01-01');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should stay on login and show an error
    await expect(page).toHaveURL(/\/parent\/login/);
    await expect(page.locator('.patient-portal-error')).toBeVisible({ timeout: 10_000 });
  });

});

test.describe('Patient: dashboard', () => {
  const suffix = `${Date.now()}`;
  const firstName = 'Dash';
  const lastName = `Patient${suffix}`;
  const dob = '2019-07-22';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const token = await getAdminToken(page);
    await createPatientAndAssignment(page, token, firstName, lastName, dob);
    await page.close();
  });

  test('patient can sign in with name + dob and see dashboard', async ({ page }) => {
    await page.goto('/parent/login');
    await page.locator('#signin-first').fill(firstName);
    await page.locator('#signin-last').fill(lastName);
    await page.locator('#signin-dob').fill(dob);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });
    // Greeting heading includes the child's first name
    await expect(page.getByRole('heading').filter({ hasText: new RegExp(firstName, 'i') })).toBeVisible();
  });

  test('dashboard shows pending form card', async ({ page }) => {
    await page.goto('/parent/login');
    await page.locator('#signin-first').fill(firstName);
    await page.locator('#signin-last').fill(lastName);
    await page.locator('#signin-dob').fill(dob);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/parent\/dashboard/, { timeout: 15_000 });

    // At least one form card should be visible
    const formCards = page.locator('[class*="form-card"], [class*="form-item"], .patient-portal-form-item');
    await expect(formCards.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Patient: portal link (identity verification)', () => {
  const suffix = `${Date.now()}`;
  const firstName = 'Portal';
  const lastName = `Link${suffix}`;
  const dob = '2021-04-05';
  let assigned = false;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const token = await getAdminToken(page);
    const result = await createPatientAndAssignment(page, token, firstName, lastName, dob);
    assigned = result === true;
    await page.close();
  });

  test('login page shows identity fields', async ({ page }) => {
    if (!assigned) {
      test.skip(true, 'No published templates — skipping');
      return;
    }

    await page.goto('/parent/login');

    await expect(page.getByText(/patient sign-in/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#signin-first')).toBeVisible();
    await expect(page.locator('#signin-last')).toBeVisible();
    await expect(page.locator('#signin-dob')).toBeVisible();
  });

  test('wrong identity shows verification error', async ({ page }) => {
    if (!assigned) {
      test.skip(true, 'No published templates — skipping');
      return;
    }

    await page.goto('/parent/login');

    await page.locator('#signin-first').fill('Wrong');
    await page.locator('#signin-last').fill('Person');
    await page.locator('#signin-dob').fill('2000-01-01');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.locator('.patient-portal-error')).toBeVisible({ timeout: 10_000 });
  });

  test('correct identity reveals pending form list', async ({ page }) => {
    if (!assigned) {
      test.skip(true, 'No published templates — skipping');
      return;
    }

    await page.goto('/parent/login');

    await page.locator('#signin-first').fill(firstName);
    await page.locator('#signin-last').fill(lastName);
    await page.locator('#signin-dob').fill(dob);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });
    // Button says "Start" for pending or "Continue" for in_progress — match both
    await expect(page.getByRole('button', { name: /start|continue/i }).first()).toBeVisible({ timeout: 10_000 });
  });
});
