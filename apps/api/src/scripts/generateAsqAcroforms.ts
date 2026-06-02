/**
 * Generates acroform PDFs for ASQ templates that are missing embedded form fields.
 * Run once to produce the bundled PDFs that get committed to seeds/pdfs/:
 *
 *   npx tsx src/scripts/generateAsqAcroforms.ts
 *
 * The output files replace the placeholder PDFs in seeds/pdfs/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAcroformPdfFromFieldDefinitions } from '../lib/acroformEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEEDS_DIR = path.join(__dirname, '..', 'seeds');
const PDFS_DIR = path.join(SEEDS_DIR, 'pdfs');
const DATA_FILE = path.join(SEEDS_DIR, 'templateSeedData.json');

type FieldRecord = {
  id: string; template_id: string; field_id: string; field_name: string;
  field_type: string; acro_field_name: string; required: number;
  page_number: number; x: number; y: number; width: number; height: number;
  options_json: string; validation_json: string; section_key: string | null;
  display_order: number; font_size: number;
  group_id: string | null; group_value: string | null; parent_field_id: string | null;
};
type GroupRecord = {
  id: string; template_id: string; group_type: string;
  group_name: string; acro_group_name: string; created_at: string;
};

const TARGETS: Array<{ id: string; source: string; acroform: string }> = [
  { id: '30684745-8590-471d-b842-e3eb6d5c16cd', source: 'asq9mos_source.pdf',  acroform: 'asq9mos_acroform.pdf' },
  { id: '0428202b-938a-4a88-b422-a58343de4726', source: 'asq12mos_source.pdf', acroform: 'asq12mos_acroform.pdf' },
  { id: '46a56232-79fd-4bc2-afc0-632de573b214', source: 'asq18mos_source.pdf', acroform: 'asq18mos_acroform.pdf' },
  { id: 'd5dc70ff-7d29-4f74-9aea-c387eec9e6c4', source: 'asq24mos_source.pdf', acroform: 'asq24mos_acroform.pdf' },
  { id: '06a6b2e5-7746-431b-a49b-50e2e35f3156', source: 'asq36mos_source.pdf', acroform: 'asq36mos_acroform.pdf' },
  { id: '3761fe08-1151-4f61-8411-75c78332ca2e', source: 'asq48mos_source.pdf', acroform: 'asq48mos_acroform.pdf' },
];

async function main() {
  const { fields, groups } = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as {
    fields: FieldRecord[];
    groups: GroupRecord[];
  };

  for (const target of TARGETS) {
    const sourcePdfPath = path.join(PDFS_DIR, target.source);
    const outputPdfPath = path.join(PDFS_DIR, target.acroform);

    if (!fs.existsSync(sourcePdfPath)) {
      console.error(`Source PDF not found: ${sourcePdfPath}`);
      continue;
    }

    const templateFields = fields.filter((f) => f.template_id === target.id);
    const templateGroups = groups.filter((g) => g.template_id === target.id);

    console.log(`Generating ${target.acroform}: ${templateFields.length} fields, ${templateGroups.length} groups...`);

    await buildAcroformPdfFromFieldDefinitions({
      sourcePdfPath,
      outputPdfPath,
      fields: templateFields.map((f) => ({
        field_id: f.field_id,
        field_name: f.field_name,
        field_type: f.field_type,
        acro_field_name: f.acro_field_name,
        page_number: f.page_number,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        options_json: f.options_json,
        font_size: f.font_size,
        group_id: f.group_id,
        group_value: f.group_value,
      })),
      groups: templateGroups.map((g) => ({
        id: g.id,
        group_type: g.group_type,
        group_name: g.group_name,
        acro_group_name: g.acro_group_name,
      })),
    });

    console.log(`  Written: ${outputPdfPath}`);
  }

  console.log('Done. Commit the updated files in apps/api/src/seeds/pdfs/');
}

main().catch((err) => { console.error(err); process.exit(1); });
