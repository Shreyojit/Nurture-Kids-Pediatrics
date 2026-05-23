export type PatientPortalForm = {
  assignment_id: string;
  template_name: string;
  template_key: string;
  session_id: string | null;
  practice_slug: string;
  practice_name: string;
  template_id: string;
  status: string;
};

export type PatientPortalDocument = {
  id: string;
  document_type: string;
  original_filename: string;
  uploaded_at: string;
  practice_name: string;
};

export type PatientPortalAccess = {
  patient_first_name: string;
  /** Single practice when only one is linked; null when multiple. */
  practice_name: string | null;
  practice_names: string[];
  next_appointment_date: string | null;
  next_appointment_time: string | null;
  forms: PatientPortalForm[];
  documents: PatientPortalDocument[];
};

export type PatientSession = {
  identity: { firstName: string; lastName: string; dob: string };
  access: PatientPortalAccess;
  /** @deprecated Legacy slug from older sessions; not required for sign-in. */
  slug?: string;
};

const STORAGE_KEY = 'pediform_patient_session';

export function getPatientSession(): PatientSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PatientSession;
  } catch {
    return null;
  }
}

export function setPatientSession(session: PatientSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearPatientSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
