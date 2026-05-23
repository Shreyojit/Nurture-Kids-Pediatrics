import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <div className="page-shell">
      <div className="container" style={{ paddingTop: 0 }}>
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="brand-kicker">PediForm Pro</div>
          <h1 className="page-title">Pediatric intake, simplified</h1>
          <p className="text-muted" style={{ marginTop: 0 }}>
            Template-driven pediatric intake for parent registration, staff review, and PDF-ready documentation.
          </p>

          <div className="actions" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 20 }}>
            <Link to="/parent/login" className="btn-outline-link">
              Patient sign-in
            </Link>
            <Link to="/staff/login" className="btn-outline-link">
              Admin login
            </Link>
          </div>
        </div>

        <div className="row">
          <div className="card">
            <h3>For patients & families</h3>
            <p className="text-muted">
              Access assigned forms and shared patient files using your name and date of birth — no account needed.
            </p>
            <Link to="/parent/login">Patient sign-in</Link>
            {' · '}
            <Link to="/parent/register">New patient registration</Link>
          </div>

          <div className="card">
            <h3>For admin staff</h3>
            <p className="text-muted">Manage forms, send forms to families, and review completed intake.</p>
            <Link to="/staff/patients">Open today&apos;s patients</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
