import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <div className="container">
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ marginBottom: 8 }}>PediForm Pro</h1>
        <p style={{ fontSize: 16, marginTop: 0 }}>
          Template-driven pediatric intake platform for parent registration, staff review, and PDF-ready documentation.
        </p>

        <div className="actions" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 20 }}>
          <Link to="/parent/login">
            <button>Parent Login</button>
          </Link>
          <Link to="/staff/login">
            <button className="secondary">Admin Login</button>
          </Link>
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <div className="card">
          <h3>For Parents</h3>
          <p>Log in to view available intake forms and complete questionnaires online.</p>
          <Link to="/parent/forms">Go To Parent Forms</Link>
        </div>

        <div className="card">
          <h3>For Admin Staff</h3>
          <p>Manage forms, send forms to families, and review completed intake.</p>
          <Link to="/staff/patients">Open today's patients</Link>
        </div>
      </div>
    </div>
  );
}
