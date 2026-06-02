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
): Promise<{ fillUrl: string } | null> {
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
  if (!aRes.ok()) return null;
  const aBody = await aRes.json();
  const fillUrl: string = aBody.data?.fill_url ?? aBody.fill_url ?? '';
  return fillUrl ? { fillUrl } : null;
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Patient: portal login form', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/parent/login');
    await expect(page.getByText('Patient sign-in')).toBeVisible();
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

  test('link to new patient registration is visible', async ({ page }) => {
    await page.goto('/parent/login');
    await expect(page.getByRole('link', { name: /new patient registration/i })).toBeVisible();
  });
});

test.describe('Patient: dashboard', () => {
  const suffix = `${Date.now()}`;
  const firstName = 'Dash';
  const lastName = `Patient${suffix}`;
  const dob = '2019-07-22';
  let fillUrl = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const token = await getAdminToken(page);
    const result = await createPatientAndAssignment(page, token, firstName, lastName, dob);
    if (result) fillUrl = result.fillUrl;
    await page.close();
  });

  test('patient can sign in with name + dob and see dashboard', async ({ page }) => {
    await page.goto('/parent/login');
    await page.locator('#signin-first').fill(firstName);
    await page.locator('#signin-last').fill(lastName);
    await page.locator('#signin-dob').fill(dob);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });
    // Greeting includes the child's first name
    await expect(page.getByText(new RegExp(firstName, 'i'))).toBeVisible();
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
  let fillUrl = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const token = await getAdminToken(page);
    const result = await createPatientAndAssignment(page, token, firstName, lastName, dob);
    if (result) fillUrl = result.fillUrl;
    await page.close();
  });

  test('portal URL shows identity verification form', async ({ page }) => {
    if (!fillUrl) {
      test.skip(true, 'No portal link — no published templates');
      return;
    }

    // The fill URL may be an absolute URL like http://localhost:5173/fill/portal/...
    // Strip the origin and navigate relative to baseURL
    const path = fillUrl.replace(/^https?:\/\/[^/]+/, '');
    await page.goto(path);

    await expect(page.getByText(/confirm your identity/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#portal-first-name')).toBeVisible();
    await expect(page.locator('#portal-last-name')).toBeVisible();
    await expect(page.locator('#portal-dob')).toBeVisible();
  });

  test('wrong identity shows verification error', async ({ page }) => {
    if (!fillUrl) {
      test.skip(true, 'No portal link — no published templates');
      return;
    }

    const path = fillUrl.replace(/^https?:\/\/[^/]+/, '');
    await page.goto(path);

    await page.locator('#portal-first-name').fill('Wrong');
    await page.locator('#portal-last-name').fill('Person');
    await page.locator('#portal-dob').fill('2000-01-01');
    await page.getByRole('button', { name: /access my forms/i }).click();

    await expect(page.locator('[class*="error"], .error')).toBeVisible({ timeout: 10_000 });
  });

  test('correct identity reveals pending form list', async ({ page }) => {
    if (!fillUrl) {
      test.skip(true, 'No portal link — no published templates');
      return;
    }

    const path = fillUrl.replace(/^https?:\/\/[^/]+/, '');
    await page.goto(path);

    await page.locator('#portal-first-name').fill(firstName);
    await page.locator('#portal-last-name').fill(lastName);
    await page.locator('#portal-dob').fill(dob);
    await page.getByRole('button', { name: /access my forms/i }).click();

    // Should see a greeting with the child's first name
    await expect(page.getByText(new RegExp(`hi.*${firstName}`, 'i'))).toBeVisible({ timeout: 15_000 });
    // Should see at least one form card with a "Start" button
    await expect(page.getByRole('button', { name: /start/i }).first()).toBeVisible();
  });
});
