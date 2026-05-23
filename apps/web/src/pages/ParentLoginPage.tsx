import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getPatientSession, setPatientSession, type PatientPortalAccess } from '../lib/patientSession';
function normalizeAccess(raw: Record<string, unknown>): PatientPortalAccess {
  const practiceNames = Array.isArray(raw.practice_names)
    ? (raw.practice_names as string[]).map(String)
    : raw.practice_name
      ? [String(raw.practice_name)]
      : [];

  const singlePractice =
    raw.practice_name != null && String(raw.practice_name).trim()
      ? String(raw.practice_name)
      : practiceNames.length === 1
        ? practiceNames[0]
        : null;

  const forms = ((raw.forms as PatientPortalAccess['forms']) ?? []).map((f) => ({
    ...f,
    practice_name: String(f.practice_name ?? singlePractice ?? ''),
  }));

  return {
    patient_first_name: String(raw.patient_first_name ?? ''),
    practice_name: singlePractice,
    practice_names: practiceNames,
    next_appointment_date: (raw.next_appointment_date as string | null) ?? null,
    next_appointment_time: (raw.next_appointment_time as string | null) ?? null,
    forms,
    documents: (raw.documents as PatientPortalAccess['documents']) ?? [],
  };
}

type Props = {
  onPatientSession?: () => void;
};

export function ParentLoginPage({ onPatientSession }: Props) {
  const navigate = useNavigate();
  const existing = getPatientSession();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (existing) {
    return <Navigate to="/parent/dashboard" replace />;
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const raw = await api<Record<string, unknown>>('/api/patient-portal/access', {
        method: 'POST',
        body: JSON.stringify({ first_name: firstName, last_name: lastName, dob }),
      });
      const access = normalizeAccess(raw);
      setPatientSession({
        identity: { firstName: firstName.trim(), lastName: lastName.trim(), dob: dob.trim().slice(0, 10) },
        access,
      });
      onPatientSession?.();
      navigate('/parent/dashboard');
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.toLowerCase().includes('no record') || msg.toLowerCase().includes('mismatch')) {
        setError(
          'We could not find a record with that name and date of birth. Check your spelling, or register as a new patient below.',
        );
      } else {
        setError(msg || 'Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="patient-portal-page">
      <div className="patient-portal-shell">
        <div className="patient-portal-card">
          <div className="text-center" style={{ marginBottom: 20 }}>
            <div className="brand-kicker">PediForm Pro</div>
            <h1 className="patient-portal-title" style={{ marginBottom: 6 }}>
              Patient sign-in
            </h1>
            <p className="patient-portal-subtitle" style={{ margin: 0 }}>
              Use your child&apos;s first name, last name, and date of birth. No email, password, or practice name
              needed.
            </p>
          </div>

          <form onSubmit={handleSignIn}>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="signin-first">First name</label>
              <input
                id="signin-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
                placeholder="e.g. Leo"
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="signin-last">Last name</label>
              <input
                id="signin-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="family-name"
                placeholder="e.g. Kim"
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 18 }}>
              <label htmlFor="signin-dob">Date of birth</label>
              <input id="signin-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
            </div>

            {error ? <div className="patient-portal-error">{error}</div> : null}

            <button type="submit" className="patient-portal-submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <hr className="divider" />

          <p className="text-muted text-center" style={{ margin: '0 0 12px' }}>
            <strong>New to our practice?</strong> Register with the same information to start intake.
          </p>
          <Link to="/parent/register" className="btn-outline-link">
            New patient registration
          </Link>
        </div>
      </div>
    </div>
  );
}
