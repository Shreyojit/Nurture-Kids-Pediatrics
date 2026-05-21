import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authHeader, api } from '../lib/api';

type Props = {
  token: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  in_progress: 'In Progress',
  completed: 'Completed',
  exported: 'Exported',
  expired: 'Expired',
};

export function ParentDashboardPage({ token }: Props) {
  const [data, setData] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api('/api/parent/me', { headers: authHeader(token) })
      .then(setData)
      .catch((e) => setError((e as Error).message));
    api('/api/parent/submissions', { headers: authHeader(token) })
      .then((r) => setSubmissions((r as any).submissions ?? []))
      .catch(() => {});
  }, [token]);

  if (!token) {
    return (
      <div className="card mobile">
        <p>Please login to view your dashboard.</p>
        <Link to="/parent/login"><button>Login</button></Link>
      </div>
    );
  }

  return (
    <div className="card mobile">
      <h2>My Dashboard</h2>
      {error ? <div className="error">{error}</div> : null}
      {!data ? <p>Loading...</p> : null}
      {data ? (
        <>
          <p>Account: {data.account.email}</p>

          <h3>My Children</h3>
          {data.patients.length === 0 ? <p>No linked children yet.</p> : null}
          {data.patients.map((patient: any) => (
            <div key={patient.id} className="card" style={{ marginBottom: 10 }}>
              <strong>
                {patient.child_first_name} {patient.child_last_name}
              </strong>
              <div>Visit Type: {patient.visit_type}</div>
            </div>
          ))}

          <h3 style={{ marginTop: 24 }}>My Submissions</h3>
          {submissions.length === 0 ? <p>No submissions yet.</p> : null}
          {submissions.map((s: any) => (
            <div key={s.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>
                  {s.child_first_name} {s.child_last_name}
                </strong>
                <span
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: s.status === 'completed' || s.status === 'exported' ? '#d4edda' : '#fff3cd',
                    color: s.status === 'completed' || s.status === 'exported' ? '#155724' : '#856404',
                  }}
                >
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                Confirmation: <strong>{s.confirmation_code}</strong>
              </div>
              {s.submitted_at ? (
                <div style={{ fontSize: 13, color: '#666' }}>
                  Submitted: {new Date(s.submitted_at).toLocaleDateString()}
                </div>
              ) : null}
            </div>
          ))}

          <div style={{ marginTop: 16 }}>
            <Link to="/parent/forms"><button className="secondary">Browse Available Forms</button></Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
