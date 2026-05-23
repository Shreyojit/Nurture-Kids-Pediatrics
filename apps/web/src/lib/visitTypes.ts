/** Stored `patients.visit_type` values — required on registration; not used on patient sign-in. */
export type PatientVisitType = 'new_patient' | 'well_child' | 'sick' | 'follow_up';

export const PATIENT_VISIT_TYPE_SELECT_OPTIONS: Array<{ value: PatientVisitType; label: string }> = [
  { value: 'new_patient', label: 'New patient' },
  { value: 'well_child', label: 'Well check / well visit / annual checkup' },
  { value: 'sick', label: 'Sick visit' },
  { value: 'follow_up', label: 'Follow-up' },
];
