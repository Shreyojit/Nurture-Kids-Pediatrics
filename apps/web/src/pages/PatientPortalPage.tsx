import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type PortalInfo = {
  assignment_count: number;
};

type VerifiedAssignment = {
  assignment_id: string;
  template_name: string;
  session_id: string;
  practice_slug: string;
  template_id: string;
  status: string;
};

export function PatientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const [verified, setVerified] = useState<VerifiedAssignment[] | null>(null);
  const [verifiedName, setVerifiedName] = useState('');
  const [cachedIdentity, setCachedIdentity] = useState<{
    firstName: string;
    lastName: string;
    dob: string;
  } | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function loadInfo() {
    if (!token) return;
    try {
      const data = await api<PortalInfo>(`/api/portal/${token}`);
      setInfo(data);
    } catch (e: unknown) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError('');
    setVerifying(true);
    try {
      const result = await api<{ patient_first_name: string; assignments: VerifiedAssignment[] }>(
        `/api/portal/${token}/verify`,
        {
          method: 'POST',
          body: JSON.stringify({ first_name: firstName, last_name: lastName, dob }),
        },
      );
      setCachedIdentity({ firstName, lastName, dob });
      setVerifiedName(result.patient_first_name);
      setVerified(result.assignments);
    } catch (e: unknown) {
      setVerifyError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleRefresh() {
    if (!cachedIdentity) return;
    setRefreshing(true);
    try {
      const result = await api<{ patient_first_name: string; assignments: VerifiedAssignment[] }>(
        `/api/portal/${token}/verify`,
        {
          method: 'POST',
          body: JSON.stringify({
            first_name: cachedIdentity.firstName,
            last_name: cachedIdentity.lastName,
            dob: cachedIdentity.dob,
          }),
        },
      );
      setVerifiedName(result.patient_first_name);
      setVerified(result.assignments);
      await loadInfo();
    } catch {
      // non-fatal
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="card">Loading your forms...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="container">
        <div className="card">
          <h2>Link Not Found</h2>
          <p style={{ color: '#666' }}>
            This portal link is invalid. Please contact your healthcare provider.
          </p>
        </div>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Your Forms</h2>
            <button
              className="secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Check for New Forms'}
            </button>
          </div>
          {verifiedName && (
            <p style={{ color: '#555', marginBottom: 24 }}>
              Hi <strong>{verifiedName}</strong>! Please fill out each form below.
            </p>
          )}
          {verified.length === 0 ? (
            <p style={{ color: '#666', textAlign: 'center', padding: '24px 0' }}>
              No forms are currently assigned. Check back later or contact your provider.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {verified.map((a) => (
                <div
                  key={a.assignment_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px',
                    background: a.status === 'completed' ? '#f0faf0' : '#f8faff',
                    borderRadius: 8,
                    border: `1px solid ${a.status === 'completed' ? '#b7ddb7' : '#dde'}`,
                    minHeight: 64,
                  }}
                >
                  <p style={{ fontWeight: 600, margin: 0, flex: 1, paddingRight: 16 }}>{a.template_name}</p>
                  <div style={{ flexShrink: 0, width: 100, textAlign: 'right' }}>
                    {a.status !== 'completed' ? (
                      <button
                        onClick={() => navigate(`/p/${a.practice_slug}/session/${a.session_id}/overview`)}
                        style={{ width: '100%' }}
                      >
                        Fill Form
                      </button>
                    ) : (
                      <span style={{ fontSize: 13, color: '#1a8a1a', fontWeight: 600 }}>✓ Completed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 12, color: '#999', marginTop: 20, textAlign: 'center' }}>
            This is your permanent forms portal. New forms assigned by your provider will appear here automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
        <h2>Your Forms Portal</h2>
        {info && info.assignment_count > 0 && (
          <p style={{ color: '#555', marginBottom: 24 }}>
            You have {info.assignment_count === 1 ? '1 form' : `${info.assignment_count} forms`} ready to fill out.
            Please confirm your identity to continue.
          </p>
        )}
        {(!info || info.assignment_count === 0) && (
          <p style={{ color: '#555', marginBottom: 24 }}>
            Please confirm your identity to view your forms.
          </p>
        )}

        <form onSubmit={handleVerify}>
          <div className="row">
            <div className="field">
              <label>First Name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoFocus
                placeholder="First name"
              />
            </div>
            <div className="field">
              <label>Last Name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                placeholder="Last name"
              />
            </div>
          </div>
          <div className="field">
            <label>Date of Birth</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              required
            />
          </div>

          {verifyError && (
            <div className="error" style={{ marginBottom: 12 }}>
              {verifyError.includes('does not match')
                ? 'The name or date of birth you entered does not match our records. Please try again.'
                : verifyError}
            </div>
          )}

          <button type="submit" className="btn" disabled={verifying} style={{ width: '100%' }}>
            {verifying ? 'Verifying...' : 'View My Forms'}
          </button>
        </form>

        <p style={{ fontSize: 12, color: '#999', marginTop: 16, textAlign: 'center' }}>
          This is your permanent forms portal link. New forms assigned by your provider will appear here automatically.
        </p>
      </div>
    </div>
  );
}
