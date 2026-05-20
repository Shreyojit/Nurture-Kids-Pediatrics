import { MCHAT_FORM_META, MCHAT_QUESTIONS, isMchatTemplateKey } from './mchatRDefinition.js';

export type MchatPatientField = {
  field_id: string;
  label: string;
  label_es: string;
  input_type: 'boolean_yes_no';
  required: boolean;
  options: string[];
  validation_rules: Record<string, unknown>;
  font_size: number;
  group_id: string | null;
  group_value: string | null;
  parent_field_id: string | null;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MchatPatientStep = {
  step_id: string;
  title: string;
  description?: string;
  fields: MchatPatientField[];
};

export type PdfMarkerField = {
  field_id: string;
  field_type: string;
  parent_field_id: string | null;
  group_value: string | null;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const QUESTIONS_PER_STEP = 5;

export function buildMchatPatientTemplate(template: Record<string, unknown>) {
  const steps: MchatPatientStep[] = [];
  for (let i = 0; i < MCHAT_QUESTIONS.length; i += QUESTIONS_PER_STEP) {
    const chunk = MCHAT_QUESTIONS.slice(i, i + QUESTIONS_PER_STEP);
    const stepNum = Math.floor(i / QUESTIONS_PER_STEP) + 1;
    steps.push({
      step_id: `mchat_part_${stepNum}`,
      title: `Questions ${i + 1}–${i + chunk.length}`,
      description: 'Answer Yes or No / Sí o No for each item.',
      fields: chunk.map((q) => ({
        field_id: q.field_id,
        label: q.label_en,
        label_es: q.label_es,
        input_type: 'boolean_yes_no' as const,
        required: true,
        options: [...q.display_options_en],
        validation_rules: {
          mchat_index: q.index,
          display_options_es: q.display_options_es,
        },
        font_size: 14,
        group_id: null,
        group_value: null,
        parent_field_id: null,
        page_number: 1,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      })),
    });
  }

  return {
    form_id: String(template.template_key ?? MCHAT_FORM_META.form_id),
    template_id: String(template.id ?? ''),
    version: String(template.version ?? MCHAT_FORM_META.version),
    title: String(template.name ?? MCHAT_FORM_META.title),
    form_type: MCHAT_FORM_META.formType,
    languages: [...MCHAT_FORM_META.languages],
    steps,
    groups: [] as unknown[],
    acroform_ready: false,
    mchat_json_form: true,
    source_pdf_required: Boolean(template.source_pdf_path),
  };
}

/**
 * Maps staff marker group_value (yes/no, yes_en, no_es, sí, etc.) to a yes/no bucket
 * so multiple boxes per answer accumulate instead of overwriting.
 */
export function normalizeMchatMarkerGroup(raw: string | null): 'yes' | 'no' | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'no' || s === 'n' || s.startsWith('no_') || s.endsWith('_no')) return 'no';
  if (s === 'yes' || s === 'y' || s.startsWith('yes_') || s.endsWith('_yes')) return 'yes';
  if (s === 'sí' || s === 'si') return 'yes';
  return null;
}

export function extractMchatPdfMarkers(dbFields: Array<Record<string, unknown>>): PdfMarkerField[] {
  return dbFields
    .filter((f) => String(f.field_type ?? '') === 'pdf_marker')
    .map((f) => ({
      field_id: String(f.field_id ?? ''),
      field_type: 'pdf_marker',
      parent_field_id: f.parent_field_id ? String(f.parent_field_id) : null,
      group_value: f.group_value ? String(f.group_value).toLowerCase() : null,
      page_number: Number(f.page_number ?? 1),
      x: Number(f.x ?? 0),
      y: Number(f.y ?? 0),
      width: Number(f.width ?? 12),
      height: Number(f.height ?? 12),
    }));
}

/** Resolve parent_field_id (DB uuid) to response field_id (mchat_q01). */
export function resolveMarkerParentFieldId(
  marker: PdfMarkerField,
  dbFields: Array<Record<string, unknown>>,
): string | null {
  if (!marker.parent_field_id) return null;
  const parent = dbFields.find((f) => String(f.id ?? '') === marker.parent_field_id || String(f.field_id ?? '') === marker.parent_field_id);
  if (!parent) {
    if (/^mchat_q\d{2}$/i.test(marker.parent_field_id)) return marker.parent_field_id;
    return null;
  }
  return String(parent.field_id ?? '');
}

export { isMchatTemplateKey };
