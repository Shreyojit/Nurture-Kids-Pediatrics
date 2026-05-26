export const PATIENT_DOCUMENT_TYPES = [
  'vaccine_record',
  'lab_report',
  'referral',
  'insurance',
  'visit_summary',
  'consent_form',
  'other',
] as const;

export type PatientDocumentType = (typeof PATIENT_DOCUMENT_TYPES)[number];

const LABELS: Record<PatientDocumentType, string> = {
  vaccine_record: 'Vaccine record',
  lab_report: 'Lab report',
  referral: 'Referral document',
  insurance: 'Insurance document',
  visit_summary: 'Visit summary',
  consent_form: 'Consent form',
  other: 'Other document',
};

export function isPatientDocumentType(value: string): value is PatientDocumentType {
  return (PATIENT_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function patientDocumentTypeLabel(type: string): string {
  if (isPatientDocumentType(type)) return LABELS[type];
  return type.replace(/_/g, ' ');
}
