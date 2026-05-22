import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import '../styles/patientPortal.css';

type PortalInfo = {
  assignment_count: number;
  practice_name: string;
};

type VerifiedAssignment = {
  assignment_id: string;
  template_name: string;
  template_key?: string;
  session_id: string | null;
  practice_slug: string;
  template_id: string;
  status: string;
};

type VerifyResult = {
  patient_first_name: string;
  practice_name: string;
  next_appointment_date: string | null;
  next_appointment_time: string | null;
  assignments: VerifiedAssignment[];
};

function formSubtitle(templateName: string, templateKey?: string): string {
  const key = (templateKey ?? templateName).toLowerCase();
  if (key.includes('registration') || key.includes('patient_registration')) {
    return 'New patient info and insurance';
  }
  if (key.includes('mchat') || key.includes('m-chat')) {
    return 'Developmental screening';
  }
  if (key.includes('asq')) {
    return 'Ages & stages questionnaire';
  }
  return 'Complete before your visit';
}

function formatAppointmentLabel(date: string | null, time: string | null): string | null {
  if (!date?.trim()) return null;
  const datePart = date.trim().slice(0, 10);
  const parsed = new Date(time?.trim() ? `${datePart}T${time.trim()}` : datePart);
  if (Number.isNaN(parsed.getTime())) {
    return time?.trim() ? `${date} at ${time}` : date;
  }
  const day = parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  if (!time?.trim()) return day;
  const timeLabel = parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${timeLabel}`;
}

function DocumentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  );
}

function FormListIcon({ done }: { done?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
      {done ? <path d="M9 15l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="patient-portal-page">
      <div className="patient-portal-shell">{children}</div>
    </div>
  );
}

export function PatientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const [verified, setVerified] = useState<VerifyResult | null>(null);
  const [cachedIdentity, setCachedIdentity] = useState<{
    firstName: string;
    lastName: string;
  } | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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
      const result = await api<VerifyResult>(`/api/portal/${token}/verify`, {
        method: 'POST',
        body: JSON.stringify({ first_name: firstName, last_name: lastName }),
      });
      setCachedIdentity({ firstName, lastName });
      setVerified(result);
    } catch (e: unknown) {
      setVerifyError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleRefresh() {
    if (!cachedIdentity || !token) return;
    setRefreshing(true);
    try {
      const result = await api<VerifyResult>(`/api/portal/${token}/verify`, {
        method: 'POST',
        body: JSON.stringify({
          first_name: cachedIdentity.firstName,
          last_name: cachedIdentity.lastName,
        }),
      });
      setVerified(result);
      await loadInfo();
    } catch {
      // non-fatal
    } finally {
      setRefreshing(false);
    }
  }

  const practiceName = verified?.practice_name ?? info?.practice_name ?? 'Your pediatric practice';

  const { todoForms, doneForms, progressPct, doneCount, totalCount } = useMemo(() => {
    const assignments = verified?.assignments ?? [];
    const todo = assignments.filter((a) => a.status !== 'completed');
    const done = assignments.filter((a) => a.status === 'completed');
    const total = assignments.length;
    const completed = done.length;
    return {
      todoForms: todo,
      doneForms: done,
      doneCount: completed,
      totalCount: total,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [verified]);

  const appointmentLabel = verified
    ? formatAppointmentLabel(verified.next_appointment_date, verified.next_appointment_time)
    : null;

  if (loading) {
    return (
      <PortalShell>
        <div className="patient-portal-card">
          <p style={{ textAlign: 'center', color: '#6b7c8f', margin: 0 }}>Loading your forms…</p>
        </div>
      </PortalShell>
    );
  }

  if (loadError) {
    return (
      <PortalShell>
        <div className="patient-portal-card">
          <h2 className="patient-portal-title">Link not found</h2>
          <p className="patient-portal-subtitle">
            This link is invalid or has expired. Please contact {practiceName} for a new link.
          </p>
        </div>
      </PortalShell>
    );
  }

  if (verified) {
    const childName = verified.patient_first_name?.trim() || 'your child';

    return (
      <PortalShell>
        <div className="patient-portal-card">
          <button
            type="button"
            className="patient-portal-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Check for new forms'}
          </button>

          <h1 className="patient-portal-greeting">Hi, {childName}&apos;s family!</h1>
          <p className="patient-portal-from">From {practiceName}</p>

          {appointmentLabel ? (
            <div className="patient-portal-appointment">
              <CalendarIcon />
              <span>Appointment: {appointmentLabel}</span>
            </div>
          ) : null}

          {totalCount > 0 ? (
            <div className="patient-portal-progress">
              <div className="patient-portal-progress-meta">
                <span>
                  {doneCount} of {totalCount} {totalCount === 1 ? 'form' : 'forms'} done
                </span>
                <span>{progressPct}%</span>
              </div>
              <div className="patient-portal-progress-bar">
                <div className="patient-portal-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          ) : null}

          {totalCount === 0 ? (
            <p className="patient-portal-subtitle" style={{ textAlign: 'center', padding: '16px 0' }}>
              No forms are assigned right now. Check back later or contact your provider.
            </p>
          ) : (
            <>
              {todoForms.length > 0 ? (
                <>
                  <p className="patient-portal-section-label">STILL TO DO</p>
                  <div className="patient-portal-form-list">
                    {todoForms.map((a) => (
                      <div key={a.assignment_id} className="patient-portal-form-item">
                        <div className="patient-portal-form-icon todo">
                          <FormListIcon />
                        </div>
                        <div className="patient-portal-form-body">
                          <p className="patient-portal-form-name">{a.template_name}</p>
                          <p className="patient-portal-form-desc">
                            {formSubtitle(a.template_name, a.template_key)}
                          </p>
                        </div>
                        {a.session_id ? (
                          <button
                            type="button"
                            className="patient-portal-start-btn"
                            onClick={() =>
                              navigate(`/p/${a.practice_slug}/session/${a.session_id}/overview`)
                            }
                          >
                            Start
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {doneForms.length > 0 ? (
                <>
                  <p className="patient-portal-section-label">COMPLETED</p>
                  <div className="patient-portal-form-list">
                    {doneForms.map((a) => (
                      <div key={a.assignment_id} className="patient-portal-form-item is-done">
                        <div className="patient-portal-form-icon done">
                          <FormListIcon done />
                        </div>
                        <div className="patient-portal-form-body">
                          <p className="patient-portal-form-name">{a.template_name}</p>
                          <p className="patient-portal-form-desc">Submitted</p>
                        </div>
                        <span className="patient-portal-done-label">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Done
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}

          <p className="patient-portal-footer">
            Completed forms go directly to {practiceName}. Please finish all forms before your visit.
          </p>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="patient-portal-card">
        <div className="patient-portal-notice">
          <div className="patient-portal-notice-icon">
            <DocumentIcon />
          </div>
          <p style={{ margin: 0 }}>
            <strong>{practiceName}</strong> sent you forms to fill out before your visit.
          </p>
        </div>

        <h1 className="patient-portal-title">Confirm your identity</h1>
        <p className="patient-portal-subtitle">
          Enter your child&apos;s name to access the forms. This keeps your information secure.
        </p>

        <form onSubmit={handleVerify}>
          <div className="patient-portal-fields">
            <div className="patient-portal-field">
              <label htmlFor="portal-first-name">Child&apos;s first name</label>
              <input
                id="portal-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoFocus
                placeholder="e.g. Harper"
                autoComplete="given-name"
              />
            </div>
            <div className="patient-portal-field">
              <label htmlFor="portal-last-name">Child&apos;s last name</label>
              <input
                id="portal-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                placeholder="e.g. Jackson"
                autoComplete="family-name"
              />
            </div>
          </div>

          {verifyError ? (
            <div className="patient-portal-error">
              {verifyError.includes('does not match')
                ? 'The name you entered does not match our records. Please try again.'
                : verifyError}
            </div>
          ) : null}

          <button type="submit" className="patient-portal-submit" disabled={verifying}>
            <DocumentIcon />
            {verifying ? 'Verifying…' : 'View my forms'}
          </button>
        </form>

        <p className="patient-portal-footer">
          Your link is private and unique to your family. Forms submitted here go directly to{' '}
          {practiceName}.
        </p>
      </div>
    </PortalShell>
  );
}
