export const PATIENT_DOCUMENT_TYPE_OPTIONS = [
  { value: 'vaccine_record', label: 'Vaccine record' },
  { value: 'lab_report', label: 'Lab report' },
  { value: 'referral', label: 'Referral document' },
  { value: 'insurance', label: 'Insurance document' },
  { value: 'visit_summary', label: 'Visit summary' },
  { value: 'consent_form', label: 'Consent form' },
  { value: 'other', label: 'Other document' },
] as const;

export function patientDocumentTypeLabel(type: string): string {
  const match = PATIENT_DOCUMENT_TYPE_OPTIONS.find((o) => o.value === type);
  return match?.label ?? type.replace(/_/g, ' ');
}
