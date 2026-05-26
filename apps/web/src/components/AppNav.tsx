import { Link, useLocation } from 'react-router-dom';
import type { PatientSession } from '../lib/patientSession';

type Props = {
  staffToken?: string | null;
  staffPracticeName?: string | null;
  patientSession?: PatientSession | null;
  onLogout?: () => void;
  appMode?: string;
};

export function AppNav({ staffToken, staffPracticeName, patientSession, onLogout, appMode }: Props) {
  const location = useLocation();
  const isFamilyFillLink =
    location.pathname.includes('/fill/portal') || location.pathname.includes('/fill/bundle');
  const isPatientPortal =
    location.pathname.startsWith('/parent/') || location.pathname.includes('/forms');
  const isAdminOnly = appMode === 'admin';
  const isPatientOnly = appMode === 'patient';

  if (isFamilyFillLink) {
    return (
      <div className="portal-nav">
        <div className="container" style={{ padding: '0 16px', width: 'min(980px, 94vw)', margin: '0 auto' }}>
          <span className="portal-nav-brand">PediForm Pro</span>
          <span className="portal-nav-badge">For families</span>
        </div>
      </div>
    );
  }

  if (patientSession && isPatientPortal && !isAdminOnly) {
    const tab = new URLSearchParams(location.search).get('tab');
    return (
      <div className="portal-nav">
        <div
          className="container"
          style={{
            padding: '0 16px',
            width: 'min(980px, 94vw)',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Link to="/parent/dashboard" className="portal-nav-brand">
            PediForm Pro
          </Link>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Link
              to="/parent/dashboard"
              style={{
                color: tab !== 'downloads' ? '#fff' : 'rgba(255,255,255,0.75)',
                fontWeight: tab !== 'downloads' ? 700 : 400,
                marginLeft: 0,
              }}
            >
              My forms
            </Link>
            <Link
              to="/parent/dashboard?tab=downloads"
              style={{
                color: tab === 'downloads' ? '#fff' : 'rgba(255,255,255,0.75)',
                fontWeight: tab === 'downloads' ? 700 : 400,
                marginLeft: 0,
              }}
            >
              Patient files
            </Link>
            <a
              href="#logout"
              style={{ color: 'rgba(255,255,255,0.9)', marginLeft: 0 }}
              onClick={(e) => {
                e.preventDefault();
                onLogout?.();
              }}
            >
              Sign out
            </a>
          </div>
        </div>
      </div>
    );
  }

  const modeBadge = isAdminOnly ? (
    <span className="mode-badge mode-badge-admin">ADMIN</span>
  ) : isPatientOnly ? (
    <span className="mode-badge mode-badge-patient">PATIENT</span>
  ) : null;

  const isStaffRoute = staffToken && !isPatientOnly;

  return (
    <>
      <div className="nav">
        <div className="container" style={{ padding: '0 16px' }}>
          <Link to="/" style={{ color: '#fff', textDecoration: 'none', marginLeft: 0 }}>
            <strong>PediForm Pro</strong>
            {modeBadge}
          </Link>
          <div>
            {isStaffRoute ? (
              <>
                <Link to="/staff/patients">Today&apos;s Patients</Link>
                <Link to="/staff/assignments">Sent Forms</Link>
                <Link to="/staff/submissions">Completed Forms</Link>
                <Link to="/staff/templates">Form Builder</Link>
                <a
                  href="#logout"
                  onClick={(e) => {
                    e.preventDefault();
                    onLogout?.();
                  }}
                >
                  Logout
                </a>
              </>
            ) : (
              <>
                {!isAdminOnly && <Link to="/parent/login">Patient sign-in</Link>}
                {!isPatientOnly && <Link to="/staff/login">Admin Login</Link>}
              </>
            )}
          </div>
        </div>
      </div>
      {isStaffRoute && staffPracticeName ? (
        <div className="practice-bar">
          <div className="container" style={{ padding: '0 16px' }}>
            <span className="practice-bar-label">Practice:</span>
            <span className="practice-bar-name">{staffPracticeName}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
