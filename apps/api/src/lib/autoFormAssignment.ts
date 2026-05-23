import { listPublishedTemplatesForPractice } from '../db/templateQueries.js';
import { createAssignment, hasActiveAssignmentForPatientTemplate } from '../db/assignmentQueries.js';

export type AgeGroup =
  | 'newborn'
  | '2_week'
  | '2_month'
  | '4_month'
  | '6_month'
  | '9_month'
  | '12_month'
  | '15_month'
  | '18_month'
  | '24_month'
  | '30_month'
  | '3_year'
  | '4_year'
  | '5_6_year'
  | '7_11_year'
  | '12_18_year';

/** Form labels per age group for well-visit auto-assignment. */
export const AGE_GROUP_FORMS: Record<AgeGroup, string[]> = {
  newborn: ['New Patient Paperwork'],
  '2_week': ['EPDS'],
  '2_month': ['EPDS'],
  '4_month': [],
  '6_month': ['LEAD'],
  '9_month': ['ASQ', 'LEAD'],
  '12_month': ['TB', 'LEAD'],
  '15_month': ['TB', 'LEAD'],
  '18_month': ['ASQ', 'MCHAT', 'TB', 'LEAD'],
  '24_month': ['ASQ', 'MCHAT', 'TB', 'LEAD'],
  '30_month': ['ASQ', 'TB', 'LEAD'],
  '3_year': ['ASQ', 'TB', 'LEAD'],
  '4_year': ['ASQ', 'TB', 'LEAD'],
  '5_6_year': ['TB', 'LEAD'],
  '7_11_year': ['TB'],
  '12_18_year': ['PHQ-9'],
};

/** Well-child milestone ages in months (closest-match for DOB → age group). */
const AGE_MILESTONES: Array<{ group: AgeGroup; months: number }> = [
  { group: 'newborn', months: 0 },
  { group: '2_week', months: 0.5 },
  { group: '2_month', months: 2 },
  { group: '4_month', months: 4 },
  { group: '6_month', months: 6 },
  { group: '9_month', months: 9 },
  { group: '12_month', months: 12 },
  { group: '15_month', months: 15 },
  { group: '18_month', months: 18 },
  { group: '24_month', months: 24 },
  { group: '30_month', months: 30 },
  { group: '3_year', months: 36 },
  { group: '4_year', months: 48 },
  { group: '5_6_year', months: 66 },
  { group: '7_11_year', months: 108 },
  { group: '12_18_year', months: 180 },
];

/** Keyword fragments that each form label matches against template name/key. */
const FORM_KEY_MAP: Record<string, string[]> = {
  'New Patient Paperwork': ['registration', 'new_patient', 'paperwork', 'patient_registration'],
  EPDS: ['epds'],
  LEAD: ['lead'],
  ASQ: ['asq'],
  MCHAT: ['mchat', 'm-chat'],
  TB: ['_tb', 'tb_', ':tb', ' tb', 'tuberculosis'],
  'PHQ-9': ['phq'],
};

/** Raw visit-type phrases from schedule imports that trigger age-based auto-assignment. */
const PREVENTIVE_VISIT_PHRASES = [
  'well check',
  'well visit',
  'well child',
  'well-child',
  'wellcare',
  'well care',
  'annual checkup',
  'annual check-up',
  'annual check up',
  'annual physical',
  'annual exam',
  'preventive',
  'physical exam',
  'checkup',
  'check-up',
  'check up',
  'wellness',
  'wcc',
];

export function parseDobToDate(dob: string): Date | null {
  const s = String(dob ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ageInMonths(dob: string, asOf = new Date()): number | null {
  const birth = parseDobToDate(dob);
  if (!birth) return null;
  let months = (asOf.getFullYear() - birth.getUTCFullYear()) * 12 + (asOf.getMonth() - birth.getUTCMonth());
  if (asOf.getUTCDate() < birth.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Map DOB to the nearest well-child age bucket (see AGE_GROUP_FORMS). */
export function getAgeGroup(dob: string, asOf = new Date()): AgeGroup | null {
  const m = ageInMonths(dob, asOf);
  if (m === null) return null;
  if (m > 216) return '12_18_year';

  let best = AGE_MILESTONES[0];
  let bestDist = Math.abs(m - best.months);
  for (const milestone of AGE_MILESTONES) {
    const dist = Math.abs(m - milestone.months);
    if (dist < bestDist) {
      bestDist = dist;
      best = milestone;
    }
  }
  return best.group;
}

export function isWellVisit(visitType: string | null | undefined): boolean {
  const v = String(visitType ?? '').toLowerCase().trim();
  if (!v) return false;
  if (v === 'well_child' || v === 'well') return true;
  return PREVENTIVE_VISIT_PHRASES.some((phrase) => v.includes(phrase));
}

function templateMatchesLabel(name: string, key: string, label: string): boolean {
  const nameLower = name.toLowerCase();
  const keyLower = key.toLowerCase();
  const fragments = FORM_KEY_MAP[label] ?? [label.toLowerCase()];
  return fragments.some((f) => nameLower.includes(f) || keyLower.includes(f));
}

export function resolveFormLabelsToTemplates(
  practiceId: string,
  labels: string[],
): Array<{ id: string; name: string; template_key: string }> {
  if (labels.length === 0) return [];
  const published = listPublishedTemplatesForPractice(practiceId);
  const seen = new Set<string>();
  const matched: Array<{ id: string; name: string; template_key: string }> = [];
  for (const label of labels) {
    const t = published.find(
      (p) => !seen.has(p.id) && templateMatchesLabel(String(p.name), String(p.template_key), label),
    );
    if (t) {
      seen.add(t.id);
      matched.push({ id: String(t.id), name: String(t.name), template_key: String(t.template_key) });
    }
  }
  return matched;
}

export type AutoAssignResult = {
  patient_id: string;
  age_group: AgeGroup | null;
  form_labels: string[];
  matched_templates: Array<{ id: string; name: string }>;
  assignments_created: number;
  assignments_skipped: number;
};

export function autoAssignForWellVisit(input: {
  practiceId: string;
  patientId: string;
  childDob: string;
  visitType: string | null;
  assignedBy: string;
  expiresInDays?: number;
}): AutoAssignResult {
  const empty: AutoAssignResult = {
    patient_id: input.patientId,
    age_group: null,
    form_labels: [],
    matched_templates: [],
    assignments_created: 0,
    assignments_skipped: 0,
  };

  if (!isWellVisit(input.visitType)) return empty;

  const group = getAgeGroup(input.childDob);
  const labels = group ? (AGE_GROUP_FORMS[group] ?? []) : [];
  const templates = resolveFormLabelsToTemplates(input.practiceId, labels);

  let created = 0;
  let skipped = 0;
  for (const t of templates) {
    if (
      hasActiveAssignmentForPatientTemplate(input.patientId, input.practiceId, t.id)
    ) {
      skipped += 1;
      continue;
    }
    try {
      createAssignment({
        practiceId: input.practiceId,
        patientId: input.patientId,
        templateId: t.id,
        assignedBy: input.assignedBy,
        expiresInDays: input.expiresInDays ?? 14,
      });
      created += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    patient_id: input.patientId,
    age_group: group,
    form_labels: labels,
    matched_templates: templates.map((t) => ({ id: t.id, name: t.name })),
    assignments_created: created,
    assignments_skipped: skipped,
  };
}
