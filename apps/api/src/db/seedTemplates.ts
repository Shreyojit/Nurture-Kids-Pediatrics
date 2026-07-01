import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db, nowIso } from './database.js';
import { putObject } from '../lib/s3Storage.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// After tsc, this file is at dist/db/seedTemplates.js
// The entire src/seeds/ folder is copied to dist/seeds/ by the build script
const SEEDS_DIR = path.join(__dirname, '..', 'seeds');
const PDFS_DIR = path.join(SEEDS_DIR, 'pdfs');
const DATA_FILE = path.join(SEEDS_DIR, 'templateSeedData.json');

/** The slug of the reference practice whose templates are used as the system library. */
const REFERENCE_PRACTICE_SLUG = 'nurturekidspediatrics';

/** Shape of a template row as stored in the seed JSON (no PDF path columns). */
type TemplateRecord = {
  id: string;
  template_key: string;
  version: number;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Full DB row shape (includes PDF path columns). */
type TemplateDbRow = TemplateRecord & {
  practice_id: string;
  source_pdf_path: string;
  acroform_pdf_path: string | null;
};

type FieldRecord = {
  id: string;
  template_id: string;
  field_id: string;
  field_name: string;
  field_type: string;
  acro_field_name: string;
  required: number;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options_json: string;
  validation_json: string;
  section_key: string | null;
  display_order: number;
  font_size: number;
  group_id: string | null;
  group_value: string | null;
  parent_field_id: string | null;
};

type GroupRecord = {
  id: string;
  template_id: string;
  group_type: string;
  group_name: string;
  acro_group_name: string;
  created_at: string;
};

// Map from template ID to bundled PDF filenames
const PDF_FILES: Record<string, { source: string; acroform: string }> = {
  '1da4ed73-bd00-4e1f-9d42-ed10ffa2253b': {
    source: 'patient_registration_source.pdf',
    acroform: 'patient_registration_acroform.pdf',
  },
  '30684745-8590-471d-b842-e3eb6d5c16cd': {
    source: 'asq9mos_source.pdf',
    acroform: 'asq9mos_acroform.pdf',
  },
  '9b6d260c-9659-4740-85df-38c81bd7ceda': {
    source: 'asq30_source.pdf',
    acroform: 'asq30_acroform.pdf',
  },
  '0428202b-938a-4a88-b422-a58343de4726': {
    source: 'asq12mos_source.pdf',
    acroform: 'asq12mos_acroform.pdf',
  },
  '46a56232-79fd-4bc2-afc0-632de573b214': {
    source: 'asq18mos_source.pdf',
    acroform: 'asq18mos_acroform.pdf',
  },
  'd5dc70ff-7d29-4f74-9aea-c387eec9e6c4': {
    source: 'asq24mos_source.pdf',
    acroform: 'asq24mos_acroform.pdf',
  },
  '06a6b2e5-7746-431b-a49b-50e2e35f3156': {
    source: 'asq36mos_source.pdf',
    acroform: 'asq36mos_acroform.pdf',
  },
  '3761fe08-1151-4f61-8411-75c78332ca2e': {
    source: 'asq48mos_source.pdf',
    acroform: 'asq48mos_acroform.pdf',
  },
  '1722df6d-573e-4671-8db6-f39fbbf11fa9': {
    source: 'lead_risk_source.pdf',
    acroform: 'lead_risk_acroform.pdf',
  },
};

export async function seedTemplates(): Promise<void> {
  if (!fs.existsSync(DATA_FILE)) {
    console.warn('[seed] template seed skipped — DATA_FILE not found:', DATA_FILE);
    return;
  }
  if (!fs.existsSync(PDFS_DIR)) {
    console.warn('[seed] template seed skipped — PDFS_DIR not found:', PDFS_DIR);
    return;
  }

  const practice = db
    .prepare('select id from practices where slug = ?')
    .get('nurturekidspediatrics') as { id: string } | undefined;
  if (!practice) {
    console.warn('[seed] template seed skipped — practice "nurturekidspediatrics" not found');
    return;
  }

  const staff = db
    .prepare('select id from staff_users where email = ?')
    .get('admin@nurturekidspediatrics.com') as { id: string } | undefined;
  if (!staff) {
    console.warn('[seed] template seed skipped — staff user "admin@nurturekidspediatrics.com" not found');
    return;
  }

  const { templates, fields, groups } = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as {
    templates: TemplateRecord[];
    fields: FieldRecord[];
    groups: GroupRecord[];
  };

  // Upload the bundled PDFs to S3 first (async) — the DB writes below run inside a
  // synchronous better-sqlite3 transaction, so no async work can happen there.
  const templatePaths = new Map<string, { sourceRelPath: string; acroformRelPath: string }>();
  for (const t of templates) {
    const pdfs = PDF_FILES[t.id];
    if (!pdfs) continue;

    const sourceRelPath = `templates/source/${pdfs.source}`;
    const acroformRelPath = `templates/${t.id}/acroform_v${t.version}.pdf`;
    const bundledSource = path.join(PDFS_DIR, pdfs.source);
    const bundledAcroform = path.join(PDFS_DIR, pdfs.acroform);

    if (fs.existsSync(bundledSource)) {
      await putObject(sourceRelPath, fs.readFileSync(bundledSource), 'application/pdf');
    }
    if (fs.existsSync(bundledAcroform)) {
      await putObject(acroformRelPath, fs.readFileSync(bundledAcroform), 'application/pdf');
    }
    templatePaths.set(t.id, { sourceRelPath, acroformRelPath });
  }

  // Templates: insert if new, then always update the PDF paths so swapped PDFs take effect
  const insertTemplate = db.prepare(`
    insert or ignore into pdf_templates
      (id, practice_id, template_key, version, name, source_pdf_path, acroform_pdf_path,
       status, created_by, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateTemplatePaths = db.prepare(`
    update pdf_templates set source_pdf_path = ?, acroform_pdf_path = ? where id = ?
  `);

  const insertField = db.prepare(`
    insert into pdf_template_fields
      (id, template_id, field_id, field_name, field_type, acro_field_name, required,
       page_number, x, y, width, height, options_json, validation_json, section_key,
       display_order, font_size, group_id, group_value, parent_field_id, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertGroup = db.prepare(`
    insert into field_groups
      (id, template_id, group_type, group_name, acro_group_name, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `);

  const countFieldsForTemplate = db.prepare(
    'select count(*) as n from pdf_template_fields where template_id = ?',
  );
  const countStaleRadioFields = db.prepare(
    `select count(*) as n from pdf_template_fields
     where template_id = ? and field_type = 'radio_option' and group_id is null`,
  );
  const deleteFieldsForTemplate = db.prepare('delete from pdf_template_fields where template_id = ?');
  const deleteGroupsForTemplate = db.prepare('delete from field_groups where template_id = ?');

  const seedAll = db.transaction(() => {
    let seededTemplates = 0;
    let seededFields = 0;
    let seededGroups = 0;

    for (const t of templates) {
      const paths = templatePaths.get(t.id);
      if (!paths) continue;
      const { sourceRelPath, acroformRelPath } = paths;

      insertTemplate.run(
        t.id, practice.id, t.template_key, t.version, t.name,
        sourceRelPath, acroformRelPath,
        t.status, staff.id, t.created_at, t.updated_at,
      );
      updateTemplatePaths.run(sourceRelPath, acroformRelPath, t.id);

      // If the seed data has radio_option fields with group_ids, but the DB has those fields
      // with group_id=null, the template was seeded before group support was added.
      // Clear it so the seeder re-runs with correct group_id values.
      const seedHasGroups = groups.some((g) => g.template_id === t.id);
      if (seedHasGroups) {
        const stale = (countStaleRadioFields.get(t.id) as { n: number }).n;
        if (stale > 0) {
          deleteFieldsForTemplate.run(t.id);
          deleteGroupsForTemplate.run(t.id);
          console.log(`[seed] cleared ${stale} stale radio fields for template ${t.template_key} (group_id was null)`);
        }
      }

      // Skip field seeding if this template already has fields — DB is the source of truth.
      const existing = (countFieldsForTemplate.get(t.id) as { n: number }).n;
      if (existing > 0) continue;

      const now = nowIso();
      const templateGroups = groups.filter((g) => g.template_id === t.id);
      const templateFields = fields.filter((f) => f.template_id === t.id);

      for (const g of templateGroups) {
        insertGroup.run(g.id, g.template_id, g.group_type, g.group_name, g.acro_group_name, g.created_at, now);
      }
      for (const f of templateFields) {
        insertField.run(
          f.id, f.template_id, f.field_id, f.field_name, f.field_type,
          f.acro_field_name, f.required, f.page_number,
          f.x, f.y, f.width, f.height,
          f.options_json, f.validation_json, f.section_key,
          f.display_order, f.font_size ?? 12,
          f.group_id ?? null, f.group_value ?? null, f.parent_field_id ?? null,
          now, now,
        );
      }

      seededTemplates++;
      seededFields += templateFields.length;
      seededGroups += templateGroups.length;
    }

    return { seededTemplates, seededFields, seededGroups };
  });

  try {
    const { seededTemplates, seededFields, seededGroups } = seedAll();
    if (seededTemplates > 0) {
      console.log(`[seed] bootstrapped ${seededTemplates} new template(s) with ${seededFields} field(s) and ${seededGroups} group(s)`);
    } else {
      console.log('[seed] all templates already seeded — skipping field overwrite (DB is source of truth)');
    }
  } catch (err) {
    console.error('[seed] template seed failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Copy all published templates from the reference practice (nurturekidspediatrics) to
 * `targetPracticeId`. Each template gets a new UUID so it is fully owned by the new practice
 * and editable independently. PDF files are shared at the filesystem level (same relative paths).
 * Already-present templates (same template_key + version for that practice) are skipped.
 *
 * Called automatically when a new practice signs up, and available via the admin API for
 * practices that were created before this feature existed.
 *
 * Returns a summary of what was copied.
 */
export function provisionDefaultTemplatesForPractice(
  targetPracticeId: string,
  byUserId: string,
): { copied: number; skipped: number; errors: string[] } {
  const refPractice = db
    .prepare('select id from practices where slug = ?')
    .get(REFERENCE_PRACTICE_SLUG) as { id: string } | undefined;

  if (!refPractice) {
    return { copied: 0, skipped: 0, errors: ['Reference practice not found — templates cannot be provisioned'] };
  }

  const refTemplates = db
    .prepare(`select * from pdf_templates where practice_id = ? and status = 'published' order by template_key, version`)
    .all(refPractice.id) as TemplateDbRow[];

  if (refTemplates.length === 0) {
    return { copied: 0, skipped: 0, errors: ['Reference practice has no published templates'] };
  }

  const errors: string[] = [];
  const now = nowIso();
  let copied = 0;
  let skipped = 0;

  const copyAll = db.transaction(() => {
    for (const src of refTemplates) {
      // Check if this practice already has this template_key at this version
      const alreadyExists = db
        .prepare('select id from pdf_templates where practice_id = ? and template_key = ? and version = ?')
        .get(targetPracticeId, src.template_key, src.version);

      if (alreadyExists) {
        skipped += 1;
        continue;
      }

      const newTemplateId = randomUUID();

      // Copy the template row — same PDF paths (shared filesystem) and status
      try {
        db.prepare(
          `insert into pdf_templates
             (id, practice_id, template_key, version, name,
              source_pdf_path, acroform_pdf_path, status,
              created_by, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newTemplateId,
          targetPracticeId,
          src.template_key,
          src.version,
          src.name,
          src.source_pdf_path,
          src.acroform_pdf_path ?? null,
          'published',
          byUserId,
          now,
          now,
        );
      } catch (e) {
        errors.push(`template ${src.template_key}@v${src.version}: ${(e as Error).message}`);
        continue;
      }

      // Copy field groups, remapping template_id
      const srcGroups = db
        .prepare('select * from field_groups where template_id = ?')
        .all(src.id) as GroupRecord[];
      const groupIdMap = new Map<string, string>();
      for (const g of srcGroups) {
        const newGroupId = randomUUID();
        groupIdMap.set(g.id, newGroupId);
        try {
          db.prepare(
            `insert into field_groups
               (id, template_id, group_type, group_name, acro_group_name, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?)`,
          ).run(newGroupId, newTemplateId, g.group_type, g.group_name, g.acro_group_name, now, now);
        } catch {
          // non-fatal — field won't be grouped
        }
      }

      // Copy template fields, remapping template_id and group_id
      const srcFields = db
        .prepare('select * from pdf_template_fields where template_id = ? order by display_order asc')
        .all(src.id) as FieldRecord[];
      for (const f of srcFields) {
        const newFieldId = randomUUID();
        const remappedGroupId = f.group_id ? (groupIdMap.get(f.group_id) ?? null) : null;
        try {
          db.prepare(
            `insert into pdf_template_fields
               (id, template_id, field_id, field_name, field_type, acro_field_name, required,
                page_number, x, y, width, height, options_json, validation_json,
                section_key, display_order, font_size, group_id, group_value, parent_field_id,
                created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            newFieldId, newTemplateId, f.field_id, f.field_name, f.field_type,
            f.acro_field_name, f.required, f.page_number,
            f.x, f.y, f.width, f.height,
            f.options_json, f.validation_json, f.section_key ?? null,
            f.display_order, f.font_size ?? 12,
            remappedGroupId, f.group_value ?? null, f.parent_field_id ?? null,
            now, now,
          );
        } catch {
          // non-fatal
        }
      }

      copied += 1;
    }
  });

  try {
    copyAll();
  } catch (e) {
    errors.push(`Transaction failed: ${(e as Error).message}`);
  }

  return { copied, skipped, errors };
}
