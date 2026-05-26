import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowIso } from './database.js';
import { config } from '../config.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// After tsc, this file is at dist/db/seedTemplates.js
// The entire src/seeds/ folder is copied to dist/seeds/ by the build script
const SEEDS_DIR = path.join(__dirname, '..', 'seeds');
const PDFS_DIR = path.join(SEEDS_DIR, 'pdfs');
const DATA_FILE = path.join(SEEDS_DIR, 'templateSeedData.json');

type TemplateRecord = {
  id: string;
  template_key: string;
  version: number;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
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
};

export function seedTemplates(): void {
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

  const seedAll = db.transaction(() => {
    let seededTemplates = 0;
    let seededFields = 0;
    let seededGroups = 0;

    for (const t of templates) {
      const pdfs = PDF_FILES[t.id];
      if (!pdfs) continue;

      // Always copy PDFs and upsert the template row so new deploys pick up PDF changes.
      const sourceDir = path.join(config.dataPath, 'templates', 'source');
      const acroformDir = path.join(config.dataPath, 'templates', t.id);
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(acroformDir, { recursive: true });

      const sourceRelPath = `templates/source/${pdfs.source}`;
      const acroformRelPath = `templates/${t.id}/acroform_v${t.version}.pdf`;

      const sourceDestPath = path.join(config.dataPath, sourceRelPath);
      const acroformDestPath = path.join(config.dataPath, acroformRelPath);

      const bundledSource = path.join(PDFS_DIR, pdfs.source);
      const bundledAcroform = path.join(PDFS_DIR, pdfs.acroform);

      if (fs.existsSync(bundledSource)) fs.copyFileSync(bundledSource, sourceDestPath);
      if (fs.existsSync(bundledAcroform)) fs.copyFileSync(bundledAcroform, acroformDestPath);

      insertTemplate.run(
        t.id, practice.id, t.template_key, t.version, t.name,
        sourceRelPath, acroformRelPath,
        t.status, staff.id, t.created_at, t.updated_at,
      );
      updateTemplatePaths.run(sourceRelPath, acroformRelPath, t.id);

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
