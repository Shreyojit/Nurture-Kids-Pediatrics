import { Link, useLocation } from 'react-router-dom';

type Props = {
  staffToken?: string | null;
  parentToken?: string | null;
  onLogout?: () => void;
  appMode?: string;
};

export function AppNav({ staffToken, parentToken, onLogout, appMode }: Props) {
  const location = useLocation();
  const isFamilyFillLink =
    location.pathname.includes('/fill/portal') || location.pathname.includes('/fill/bundle');
  const isAdminOnly = appMode === 'admin';
  const isPatientOnly = appMode === 'patient';

  if (isFamilyFillLink) {
    return (
      <div className="portal-nav">
        <div className="container" style={{ width: 'min(980px, 94vw)', margin: '0 auto' }}>
          <span className="portal-nav-brand">PediForm Pro</span>
          <span className="portal-nav-badge">For families</span>
        </div>
      </div>
    );
  }

  const modeBadge = isAdminOnly
    ? <span style={{ fontSize: '0.7rem', background: '#e67e22', color: '#fff', borderRadius: 4, padding: '1px 6px', marginLeft: 8, verticalAlign: 'middle' }}>ADMIN</span>
    : isPatientOnly
      ? <span style={{ fontSize: '0.7rem', background: '#27ae60', color: '#fff', borderRadius: 4, padding: '1px 6px', marginLeft: 8, verticalAlign: 'middle' }}>PATIENT</span>
      : null;

  return (
    <div className="nav">
      <div className="container">
        <Link to="/" style={{ color: '#fff', textDecoration: 'none' }}>
          <strong>PediForm Pro</strong>{modeBadge}
        </Link>
        <div>
          {staffToken && !isPatientOnly ? (
            <>
              <Link to="/staff/patients">Today's Patients</Link>
              <Link to="/staff/assignments">Sent forms</Link>
              <Link to="/staff/submissions">Completed forms</Link>
              <Link to="/staff/templates">Form builder</Link>
              <a href="#logout" onClick={(e) => { e.preventDefault(); onLogout?.(); }}>Logout</a>
            </>
          ) : parentToken && !isAdminOnly ? (
            <>
              <Link to="/parent/dashboard">My Dashboard</Link>
              <Link to="/parent/forms">Forms</Link>
              <a href="#logout" onClick={(e) => { e.preventDefault(); onLogout?.(); }}>Logout</a>
            </>
          ) : (
            <>
              {!isAdminOnly && <Link to="/parent/login">Parent Login</Link>}
              {!isPatientOnly && <Link to="/staff/login">Admin Login</Link>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
