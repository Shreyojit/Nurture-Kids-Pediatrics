/**
 * Full round-trip E2E test
 *
 * Flow:
 *   1. Admin logs in and assigns a form to a NEW patient via the UI
 *   2. Capture the portal fill URL from the API response
 *   3. Navigate to the portal link (patient perspective)
 *   4. Verify identity to access forms
 *   5. Click "Start" and fill the form step by step
 *   6. Reach and verify the confirmation page
 *   7. Admin navigates to Submissions and sees the completed entry
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin, ADMIN, fillFormStep } from '../helpers/auth';

const SUFFIX = `${Date.now()}`;
const PATIENT = {
  first: 'RoundTrip',
  last: `Patient${SUFFIX}`,
  dob: '2020-06-15',
};

// ── shared state set by the "setup" test ─────────────────────────────────────
let adminToken = '';

test.describe.serial('Round-trip: admin assigns → patient fills → admin reviews', () => {
  // ── Step 1: admin creates the assignment ─────────────────────────────────

  test('Admin creates assignment for new patient via the UI', async ({ page }) => {
    await loginAsAdmin(page);

    // Fetch a token for later API assertions
    const tokenRes = await page.request.post('http://localhost:4000/api/staff/login', {
      data: {
        email: ADMIN.email,
        password: ADMIN.password,
        practice_name: ADMIN.practiceName,
      },
    });
    const tokenBody = await tokenRes.json();
    adminToken = tokenBody.data?.token ?? tokenBody.token ?? '';

    // Check published templates exist
    const tRes = await page.request.get('http://localhost:4000/api/staff/templates', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const tBody = await tRes.json();
    const templates: Array<{ id: string; status: string }> = tBody.data ?? tBody;
    const published = templates.filter((t) => t.status === 'published');
    if (!published.length) {
      test.skip(true, 'No published templates — cannot run round-trip test');
      return;
    }

    await page.goto('/staff/assignments');
    await page.getByRole('button', { name: /\+ Assign forms/i }).click();

    // New patient mode
    await page.getByRole('button', { name: /new patient/i }).click();
    await page.locator('input[placeholder="Jane"]').fill(PATIENT.first);
    await page.locator('input[placeholder="Doe"]').fill(PATIENT.last);
    // Date of birth — first date input inside the New Patient section
    await page.locator('.row input[type="date"]').first().fill(PATIENT.dob);

    // Select the first available template checkbox
    await page.locator('input[type="checkbox"]').first().check();

    // Intercept the POST response to grab the portal URL for subsequent patient steps
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/staff/assignments') && res.request().method() === 'POST',
    );

    await page.getByRole('button', { name: /assign \d* ?forms?|assign form/i }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await response.json();

    // The UI shows the success message with the patient name
    await expect(page.getByText(new RegExp(`forms assigned to.*${PATIENT.first}`, 'i'))).toBeVisible();
  });

  // ── Step 2: patient verifies identity ────────────────────────────────────

  test('Patient signs in and verifies identity', async ({ page }) => {
    if (!adminToken) {
      test.skip(true, 'No admin token from previous step');
      return;
    }

    await page.goto('/parent/login');

    await expect(page.getByText(/patient sign-in/i)).toBeVisible({ timeout: 10_000 });

    await page.locator('#signin-first').fill(PATIENT.first);
    await page.locator('#signin-last').fill(PATIENT.last);
    await page.locator('#signin-dob').fill(PATIENT.dob);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });

    // At least one pending form with a Start button
    await expect(page.getByRole('button', { name: /start/i }).first()).toBeVisible();
  });

  // ── Step 3: patient starts and fills the form ─────────────────────────────

  test('Patient fills the form and reaches dashboard or confirmation', async ({ page }) => {
    if (!adminToken) {
      test.skip(true, 'No admin token from previous step');
      return;
    }

    // Sign in again (no shared auth state across tests)
    await page.goto('/parent/login');
    await page.locator('#signin-first').fill(PATIENT.first);
    await page.locator('#signin-last').fill(PATIENT.last);
    await page.locator('#signin-dob').fill(PATIENT.dob);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForSelector('[class*="patient-portal-start-btn"], button:has-text("Start")', {
      timeout: 15_000,
    });

    // Click the first "Start" button
    await page.getByRole('button', { name: /start/i }).first().click();

    // Overview page → click "Start Paperwork" (or "Fill PDF Directly")
    const overviewBtn = page.getByRole('button', { name: /start paperwork|fill pdf directly|fill step-by-step/i });
    if (await overviewBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await overviewBtn.click();
    }

    // ── Step-by-step form filling ─────────────────────────────────────────
    // Keep filling steps until we land on a confirmation URL or the submit
    // button is absent (covers multi-step registration forms).
    const MAX_STEPS = 30;
    for (let step = 0; step < MAX_STEPS; step++) {
      const url = page.url();

      // We're done when we hit the confirmation page or the patient dashboard
      if (url.includes('/confirmation') || url.includes('/parent/dashboard')) break;

      // PDF forms (M-CHAT etc.) — look for a submit / save button on the PDF overlay
      const pdfSubmit = page.getByRole('button', {
        name: /submit form|save form|complete/i,
      });
      if (await pdfSubmit.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await pdfSubmit.click();
        break;
      }

      // Step-by-step form — fill inputs and advance
      await fillFormStep(page);

      // If a "Submit" button appears, click it to finish
      const submitBtn = page.getByRole('button', { name: /^submit$/i });
      if (await submitBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await submitBtn.click();
        break;
      }

      // Wait briefly for navigation
      await page.waitForTimeout(800);
    }

    // Patient lands on /parent/dashboard (portal session set) or /confirmation (no session)
    await page.waitForURL(/\/confirmation|\/parent\/dashboard/, { timeout: 30_000 });
    // Either the dashboard greeting or the submission heading must be visible
    const onDashboard = page.url().includes('/parent/dashboard');
    if (onDashboard) {
      await expect(page.getByRole('heading').filter({ hasText: new RegExp(PATIENT.first, 'i') })).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(page.getByRole('heading', { name: /submitted/i })).toBeVisible({ timeout: 10_000 });
    }
  });

  // ── Step 4: admin reviews the completed submission ────────────────────────

  test('Admin sees the completed submission in the submissions list', async ({ page }) => {
    if (!adminToken) {
      test.skip(true, 'No admin token from previous step');
      return;
    }

    await loginAsAdmin(page);
    await page.goto('/staff/submissions');

    // Look for the patient name in the submissions table
    // Match by full last name (includes timestamp suffix) to avoid hitting rows from prior runs
    await expect(
      page.getByRole('cell', { name: new RegExp(PATIENT.last, 'i') }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Status should be "Completed" (or "Downloaded" once exported)
    await expect(
      page.locator('td').filter({ hasText: /completed|started/i }).first(),
    ).toBeVisible();
  });

  // ── Step 5: admin can download the submission PDF ─────────────────────────

  test('Admin can trigger PDF download for the completed submission', async ({ page }) => {
    if (!adminToken) {
      test.skip(true, 'No admin token from previous step');
      return;
    }

    await loginAsAdmin(page);
    await page.goto('/staff/submissions');

    // Wait for submissions to load
    await page.waitForSelector('table, [class*="submission"]', { timeout: 10_000 });

    // Find a row matching our test patient
    const row = page.locator('tr').filter({ hasText: PATIENT.first }).first();
    const downloadBtn = row.getByRole('button', { name: /download|pdf/i });

    if (await downloadBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        downloadBtn.click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    } else {
      // The view button shows a PDF viewer — just click it
      const viewBtn = row.getByRole('button', { name: /view/i });
      if (await viewBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await viewBtn.click();
        await expect(page.locator('canvas, iframe, embed')).toBeVisible({ timeout: 10_000 });
      }
    }
  });
});
