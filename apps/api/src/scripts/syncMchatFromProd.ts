/**
 * Syncs M-CHAT template(s) from production into the local dev database.
 *
 * Usage:
 *   PROD_EMAIL=you@example.com PROD_PASSWORD=secret npm run sync:mchat -w apps/api
 *
 * What it does:
 *   1. Logs into the production API as staff
 *   2. Lists all templates and finds M-CHAT ones
 *   3. Downloads the source PDF for each M-CHAT template
 *   4. Copies the field_schema_json (overlay field positions)
 *   5. Upserts the template into the local DB and marks it published
 */

import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { config } from '../config.js';
import { putObject } from '../lib/s3Storage.js';

const PROD_API = 'https://api.pediformpro.com';
const LOCAL_PRACTICE_ID = 'a1b2c3d4-0000-4000-8000-100000000001';

const email = process.env.PROD_EMAIL;
const password = process.env.PROD_PASSWORD;
const practiceName = process.env.PROD_PRACTICE ?? 'Nurture Kids Pediatrics';

if (!email || !password) {
  console.error('Set PROD_EMAIL and PROD_PASSWORD env vars before running.');
  console.error('Optionally set PROD_PRACTICE (default: "Nurture Kids Pediatrics").');
  process.exit(1);
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: { data?: T; error?: unknown };
  try {
    body = JSON.parse(text) as { data?: T };
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${JSON.stringify(body)}`);
  return body.data as T;
}

async function main() {
  // 1. Login to production
  console.log('Logging into production...');
  const auth = await apiJson<{ token: string }>(`${PROD_API}/api/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, practice_name: practiceName }),
  });
  const token = auth.token;
  const headers = { Authorization: `Bearer ${token}` };
  console.log('  ✓ Authenticated');

  // 2. List all templates and find M-CHAT ones
  const templates = await apiJson<Array<{
    id: string;
    name: string;
    template_key: string;
    source_pdf_path: string | null;
    field_schema_json: string | null;
    status: string;
    version: number;
  }>>(`${PROD_API}/api/staff/templates`, { headers });

  const mchatTemplates = templates.filter(
    (t) => t.template_key === 'mchat' || /^mchat/i.test(t.template_key),
  );

  if (mchatTemplates.length === 0) {
    console.error('No M-CHAT templates found in production.');
    process.exit(1);
  }

  console.log(`Found ${mchatTemplates.length} M-CHAT template(s): ${mchatTemplates.map((t) => `${t.template_key} v${t.version} (${t.status})`).join(', ')}`);

  // Prefer the published one; fall back to latest
  const prod = mchatTemplates.find((t) => t.status === 'published') ?? mchatTemplates[0];

  // 3. Fetch full template details (includes field_schema_json)
  const full = await apiJson<{
    id: string;
    name: string;
    template_key: string;
    source_pdf_path: string | null;
    field_schema_json: string | null;
    status: string;
    version: number;
  }>(`${PROD_API}/api/staff/templates/${prod.id}`, { headers });

  console.log(`Using template: ${full.name} (${full.template_key} v${full.version})`);

  // 4. Download the source PDF and upload it to S3
  const relativePdfPath = 'templates/source/mchat_source.pdf';

  console.log('Downloading source PDF...');
  const pdfRes = await fetch(`${PROD_API}/api/staff/templates/${full.id}/source`, { headers });
  if (!pdfRes.ok) {
    throw new Error(`Failed to download source PDF: ${pdfRes.status} ${pdfRes.statusText}`);
  }
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  await putObject(relativePdfPath, pdfBuffer, 'application/pdf');
  console.log(`  ✓ Uploaded to s3://${config.aws.bucket}/${relativePdfPath} (${Math.round(pdfBuffer.length / 1024)} KB)`);

  // 5. Upsert into local DB via sqlite3 CLI (avoids Node version conflicts with better-sqlite3)
  const now = new Date().toISOString();
  const schemaJson = (full.field_schema_json ?? '{}').replace(/'/g, "''");

  function sqlite(sql: string) {
    execSync(`sqlite3 "${config.dbPath}"`, { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  function sqliteRead(sql: string): string {
    return execSync(`sqlite3 "${config.dbPath}"`, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  }

  const existingRow = sqliteRead(
    `SELECT id FROM pdf_templates WHERE practice_id='${LOCAL_PRACTICE_ID}' AND lower(trim(template_key))='mchat' ORDER BY version DESC LIMIT 1;`,
  );

  if (existingRow) {
    console.log(`Updating existing local template (id=${existingRow})...`);
    sqlite(
      `UPDATE pdf_templates SET source_pdf_path='${relativePdfPath}', field_schema_json='${schemaJson}', status='published', updated_at='${now}' WHERE id='${existingRow}';`,
    );
    console.log(`  ✓ Updated local M-CHAT template (id=${existingRow})`);
  } else {
    const newId = randomUUID();
    const templateName = (full.name || 'M-CHAT-R/F').replace(/'/g, "''");
    console.log('Creating new local template...');
    sqlite(
      `INSERT INTO pdf_templates (id, practice_id, template_key, version, name, source_pdf_path, acroform_pdf_path, field_schema_json, status, created_by, created_at, updated_at) VALUES ('${newId}','${LOCAL_PRACTICE_ID}','mchat',1,'${templateName}','${relativePdfPath}',null,'${schemaJson}','published',null,'${now}','${now}');`,
    );
    console.log(`  ✓ Created local M-CHAT template (id=${newId})`);
  }

  console.log('\nDone! Restart the local API server and test the M-CHAT form.');
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
