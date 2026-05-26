import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type Props = {
  onAuthenticated: (token: string, practiceName: string) => void;
};

export function StaffLoginPage({ onAuthenticated }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@nurturekidspediatrics.com');
  const [password, setPassword] = useState('Admin@12345');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function login(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api<{ token: string; user: { practice_name: string } }>('/api/staff/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, practice_name: practiceName }),
      });
      onAuthenticated(result.token, result.user.practice_name);
      navigate('/staff/patients');
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
              Admin login
            </h1>
            <p className="patient-portal-subtitle" style={{ margin: 0 }}>
              Sign in with your practice credentials.
            </p>
          </div>

          <form onSubmit={login}>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="admin-practice">Practice name</label>
              <input
                id="admin-practice"
                value={practiceName}
                onChange={(e) => setPracticeName(e.target.value)}
                placeholder="e.g. Nurture Kids Pediatrics"
                autoComplete="organization"
                required
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="admin-email">Email</label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 18 }}>
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error ? <div className="patient-portal-error">{error}</div> : null}

            <button type="submit" className="patient-portal-submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <hr className="divider" />

          <p className="text-muted text-center" style={{ margin: '0 0 12px' }}>
            New practice?{' '}
            <Link to="/staff/register">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
