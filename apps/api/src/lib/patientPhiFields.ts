/** Date-of-birth field IDs excluded from parent-facing registration (PHI). */
export const PATIENT_REGISTRATION_EXCLUDED_DOB_FIELD_IDS = new Set([
  'child_dob',
  'g1_dob',
  'g2_dob',
  'primary_policyholder_dob',
  'secondary_policyholder_dob',
  'primary_subscriber_dob',
  'secondary_subscriber_dob',
]);

export function isExcludedPatientDobField(fieldId: string): boolean {
  const id = fieldId.trim().toLowerCase();
  if (PATIENT_REGISTRATION_EXCLUDED_DOB_FIELD_IDS.has(id)) return true;
  return id.endsWith('_dob');
}

export function filterPatientRegistrationFields<T extends { field_id: string }>(fields: T[]): T[] {
  return fields.filter((field) => !isExcludedPatientDobField(field.field_id));
}
