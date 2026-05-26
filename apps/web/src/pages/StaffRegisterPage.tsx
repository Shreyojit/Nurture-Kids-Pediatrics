import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type Props = {
  onAuthenticated: (token: string, practiceName: string) => void;
};

export function StaffRegisterPage({ onAuthenticated }: Props) {
  const navigate = useNavigate();
  const [practiceName, setPracticeName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!practiceName.trim()) {
      setError('Practice name is required.');
      return;
    }
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await api<{ token: string; user: { practice_name: string } }>(
        '/api/staff/register',
        {
          method: 'POST',
          body: JSON.stringify({ practice_name: practiceName, email, password }),
        },
      );
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
              Create admin account
            </h1>
            <p className="patient-portal-subtitle" style={{ margin: 0 }}>
              Register your practice. If it already exists, your account will be added to it.
            </p>
          </div>

          <form onSubmit={register}>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="reg-practice">Practice name</label>
              <input
                id="reg-practice"
                value={practiceName}
                onChange={(e) => setPracticeName(e.target.value)}
                placeholder="e.g. Nurture Kids Pediatrics"
                autoComplete="organization"
                required
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="reg-email">Email</label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@yourpractice.com"
                autoComplete="username"
                required
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="reg-password">Password</label>
              <input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="patient-portal-field" style={{ marginBottom: 18 }}>
              <label htmlFor="reg-confirm">Confirm password</label>
              <input
                id="reg-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
                required
              />
            </div>

            {error ? <div className="patient-portal-error">{error}</div> : null}

            <button type="submit" className="patient-portal-submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <hr className="divider" />

          <p className="text-muted text-center" style={{ margin: 0 }}>
            Already have an account? <Link to="/staff/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
