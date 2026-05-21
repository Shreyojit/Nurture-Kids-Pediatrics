import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, authHeader } from '../lib/api';
import { setLocal } from '../lib/storage';

type Props = {
  token: string | null;
};

type ParentFormCard = {
  id: string;
  template_key: string;
  title: string;
  description: string;
  version: number;
  visit_type: string;
  acroform_ready: boolean;
  practice_slug: string;
  practice_id: string;
};

type PatientInfo = {
  child_first_name: string;
  child_last_name: string;
  child_dob: string;
};

type Practice = {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
};

export function ParentFormsPage({ token }: Props) {
  const navigate = useNavigate();
  const [forms, setForms] = useState<ParentFormCard[]>([]);
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/parent/login');
      return;
    }

    setLoading(true);
    setError('');

    Promise.all([
      api<{ practice_slug: string; practice_id: string; forms: (Omit<ParentFormCard, 'practice_slug' | 'practice_id'>)[] }>('/api/parent/forms', {
        headers: authHeader(token),
      }),
      api<{ account: { email: string }; patients: PatientInfo[] }>('/api/parent/me', {
        headers: authHeader(token),
      }),
    ])
      .then(([formsResponse, meResponse]) => {
        const slug = formsResponse.practice_slug;
        setForms(
          (formsResponse.forms ?? []).map((f) => ({
            ...f,
            practice_slug: slug,
            practice_id: formsResponse.practice_id ?? '',
          }))
        );
        if (meResponse.patients.length > 0) {
          setPatient(meResponse.patients[0]);
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, navigate]);

  async function handleStartForm(form: ParentFormCard) {
    if (!patient || !token) return;

    setStarting(form.id);
    setError('');
    try {
      // Fetch practice info if not yet loaded
      let practiceInfo = practice;
      if (!practiceInfo) {
        practiceInfo = await api<Practice>(`/api/practices/${form.practice_slug}`);
        setPractice(practiceInfo);
      }

      const submission = await api<{ session_id: string; confirmation_code: string; template_version: string }>(
        '/api/submissions',
        {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            practice_id: practiceInfo.id,
            template_key: form.template_key,
            child_first_name: patient.child_first_name,
            child_last_name: patient.child_last_name,
            visit_type: form.visit_type,
          }),
        }
      );

      setLocal(`pediform_start_${submission.session_id}`, {
        child_first_name: patient.child_first_name,
        child_last_name: patient.child_last_name,
        visit_type: form.visit_type,
        practice: practiceInfo,
        confirmation_code: submission.confirmation_code,
      });

      navigate(`/p/${form.practice_slug}/session/${submission.session_id}/overview`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(null);
    }
  }

  if (!token) {
    return null;
  }

  return (
    <div className="container">
      <div className="card">
        <h2>Parent Forms</h2>
        <p>Select a published form to begin intake.</p>
        {error ? <div className="error">{error}</div> : null}
        {loading ? <p>Loading forms...</p> : null}
        {!loading && forms.length === 0 ? <p>No forms are currently available for your practice.</p> : null}

        <div className="row" style={{ marginTop: 12 }}>
          {forms.map((form) => (
            <div key={form.id} className="card" style={{ background: '#f8fbff' }}>
              <h3 style={{ marginBottom: 8 }}>{form.title}</h3>
              <p style={{ minHeight: 48 }}>{form.description}</p>
              <div style={{ fontSize: 12, marginBottom: 10 }}>
                <strong>Template:</strong> {form.template_key} v{form.version}
              </div>
              <button
                onClick={() => handleStartForm(form)}
                disabled={starting === form.id || !patient}
              >
                {starting === form.id ? 'Starting...' : form.acroform_ready ? 'Start Form' : 'Start Form (No AcroForm PDF yet)'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
