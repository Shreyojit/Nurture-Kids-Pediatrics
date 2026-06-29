import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type Props = {
  onAuthenticated: (
    token: string,
    user: {
      email: string;
      role: string;
      org_name?: string;
      practice_name?: string;
      location_name?: string | null;
    },
  ) => void;
};

export function StaffRegisterPage({ onAuthenticated }: Props) {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!orgName.trim()) {
      setError('Organization name is required.');
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
      const result = await api<{
        token: string;
        user: {
          email: string;
          role: string;
          org_name: string;
          location_name?: string | null;
          practice_name: string;
        };
      }>('/api/staff/register', {
        method: 'POST',
        body: JSON.stringify({
          org_name: orgName.trim(),
          location_name: locationName.trim() || undefined,
          state: state.trim() || undefined,
          city: city.trim() || undefined,
          email,
          password,
        }),
      });
      onAuthenticated(result.token, result.user);
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
        <div className="patient-portal-card" style={{ maxWidth: 480 }}>
          <div className="text-center" style={{ marginBottom: 20 }}>
            <div className="brand-kicker">PediForm Pro</div>
            <h1 className="patient-portal-title" style={{ marginBottom: 6 }}>
              Create admin account
            </h1>
            <p className="patient-portal-subtitle" style={{ margin: 0 }}>
              Register your organization. Multiple locations and staff accounts can be added to the same org.
            </p>
          </div>

          <form onSubmit={register}>
            {/* ── Organization ─────────────────────────── */}
            <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-brand)', margin: '0 0 8px' }}>
              Organization / Group
            </p>

            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="reg-org">Organization name <span style={{ color: '#e53e3e' }}>*</span></label>
              <input
                id="reg-org"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Lone Star Pediatrics"
                autoComplete="organization"
                required
              />
              <span style={{ fontSize: 12, color: '#888' }}>
                This is the top-level group. All locations under it share the same patient data.
              </span>
            </div>

            {/* ── Location (optional) ───────────────────── */}
            <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-brand)', margin: '16px 0 8px' }}>
              Location / Branch <span style={{ fontSize: 11, fontWeight: 400, color: '#888', textTransform: 'none' }}>(optional)</span>
            </p>

            <div className="patient-portal-field" style={{ marginBottom: 10 }}>
              <label htmlFor="reg-location">Branch / Location name</label>
              <input
                id="reg-location"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g. Texas, Sunshine Pediatrics, Downtown"
              />
              <span style={{ fontSize: 12, color: '#888' }}>
                Leave blank if you run a single-location practice.
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div className="patient-portal-field">
                <label htmlFor="reg-state">State</label>
                <input
                  id="reg-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. TX"
                  maxLength={50}
                />
              </div>
              <div className="patient-portal-field">
                <label htmlFor="reg-city">City</label>
                <input
                  id="reg-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Houston"
                />
              </div>
            </div>

            {/* ── Credentials ───────────────────────────── */}
            <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-brand)', margin: '16px 0 8px' }}>
              Account credentials
            </p>

            <div className="patient-portal-field" style={{ marginBottom: 14 }}>
              <label htmlFor="reg-email">Email <span style={{ color: '#e53e3e' }}>*</span></label>
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
              <label htmlFor="reg-password">Password <span style={{ color: '#e53e3e' }}>*</span></label>
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
              <label htmlFor="reg-confirm">Confirm password <span style={{ color: '#e53e3e' }}>*</span></label>
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
