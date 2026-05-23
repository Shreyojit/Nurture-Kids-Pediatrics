import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { setLocal } from '../lib/storage';
import { PATIENT_VISIT_TYPE_SELECT_OPTIONS, type PatientVisitType } from '../lib/visitTypes';

type Practice = {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
};

export function ParentStartPage() {
  const { slug = 'nurturekidspediatrics' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const templateKey = searchParams.get('template_key')?.trim() || '';

  const requestedVisitType = searchParams.get('visit_type');
  const defaultVisitType =
    requestedVisitType === 'well_child' || requestedVisitType === 'sick' || requestedVisitType === 'follow_up'
      ? requestedVisitType
      : 'new_patient';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{
    child_first_name: string;
    child_last_name: string;
    child_dob: string;
    visit_type: PatientVisitType;
  }>({
    child_first_name: '',
    child_last_name: '',
    child_dob: '',
    visit_type: defaultVisitType as PatientVisitType,
  });

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.child_first_name || !form.child_last_name || !form.child_dob || !form.visit_type) {
      setError('Please fill all required fields.');
      return;
    }

    setLoading(true);
    try {
      const practice = await api<Practice>(`/api/practices/${slug}`);
      const submission = await api<{ session_id: string; confirmation_code: string; template_version: string }>(
        '/api/submissions',
        {
          method: 'POST',
          body: JSON.stringify({
            practice_id: practice.id,
            template_key: templateKey || undefined,
            ...form,
          }),
        },
      );

      setLocal(`pediform_start_${submission.session_id}`, {
        ...form,
        practice,
        confirmation_code: submission.confirmation_code,
      });

      navigate(`/p/${slug}/session/${submission.session_id}/overview`);
    } catch (err) {
      setError((err as Error).message);
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
              New patient registration
            </h1>
            <p className="patient-portal-subtitle" style={{ margin: 0 }}>
              Enter your child&apos;s information to begin intake. Use the same details when you sign in later.
            </p>
          </div>

          <form onSubmit={handleContinue}>
            <div className="patient-portal-fields">
              <div className="patient-portal-field">
                <label htmlFor="reg-first">First name</label>
                <input
                  id="reg-first"
                  value={form.child_first_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, child_first_name: e.target.value }))}
                  autoComplete="given-name"
                  required
                />
              </div>
              <div className="patient-portal-field">
                <label htmlFor="reg-last">Last name</label>
                <input
                  id="reg-last"
                  value={form.child_last_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, child_last_name: e.target.value }))}
                  autoComplete="family-name"
                  required
                />
              </div>
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="reg-dob">Date of birth</label>
              <input
                id="reg-dob"
                type="date"
                value={form.child_dob}
                onChange={(e) => setForm((prev) => ({ ...prev, child_dob: e.target.value }))}
                required
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 18 }}>
              <label htmlFor="reg-visit">Visit type *</label>
              <select
                id="reg-visit"
                value={form.visit_type}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, visit_type: e.target.value as PatientVisitType }))
                }
                required
              >
                {PATIENT_VISIT_TYPE_SELECT_OPTIONS.map((opt) => (
                  <option key={opt.value + opt.label} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {error ? <div className="patient-portal-error">{error}</div> : null}

            <button type="submit" className="patient-portal-submit" disabled={loading}>
              {loading ? 'Starting…' : 'Continue'}
            </button>
          </form>

          <p className="text-muted text-center" style={{ marginTop: 16, marginBottom: 0 }}>
            Already registered? <Link to="/parent/login">Patient sign-in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
