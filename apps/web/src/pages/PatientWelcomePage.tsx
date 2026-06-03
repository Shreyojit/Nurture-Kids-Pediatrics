import { useNavigate } from 'react-router-dom';
import './PatientWelcomePage.css';

const PRACTICE_NAME = import.meta.env.VITE_PRACTICE_NAME as string | undefined;
const PRACTICE_PHONE = import.meta.env.VITE_PRACTICE_PHONE as string | undefined;

export function PatientWelcomePage() {
  const navigate = useNavigate();
  const practiceName = PRACTICE_NAME ?? 'Our Practice';
  const practicePhone = PRACTICE_PHONE ?? null;

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-logo-mark">
          <svg viewBox="0 0 16 16">
            <path d="M8 14s-6-3.5-6-8a6 6 0 0 1 12 0c0 4.5-6 8-6 8z" />
          </svg>
        </div>
        <span className="pw-practice-name">{practiceName} Pediatrics</span>
      </header>

      <main className="pw-main">
        <div className="pw-card">
          <p className="pw-eyebrow">Upcoming wellness visit</p>

          <h1 className="pw-heading">
            Thank you for taking a few minutes — for your child,{' '}
            <em>and for our team.</em> It means a lot.
          </h1>

          <p className="pw-body">
            Completing these forms before your visit gives our care team the chance to review your
            child's health history in advance — so we arrive prepared. That means less time on
            paperwork and more time on what matters: a meaningful conversation about your child's
            growth, development, and wellbeing.
          </p>

          <div className="pw-trust-row">
            <span className="pw-pill">
              <svg viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3.5l2 1.5" />
              </svg>
              About 5 minutes
            </span>
            <span className="pw-pill">
              <svg viewBox="0 0 16 16">
                <rect x="3" y="7" width="10" height="7" rx="1.5" />
                <path d="M5 7V5a3 3 0 0 1 6 0v2" />
              </svg>
              Secure &amp; confidential
            </span>
            <span className="pw-pill">
              <svg viewBox="0 0 16 16">
                <rect x="4" y="2" width="8" height="12" rx="1.5" />
                <line x1="6" y1="13" x2="10" y2="13" />
              </svg>
              Works on any device
            </span>
          </div>

          <div className="pw-info-box">
            <div className="pw-info-icon">
              <svg viewBox="0 0 16 16">
                <circle cx="8" cy="5" r="2.5" />
                <path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5" />
              </svg>
            </div>
            <p>
              To get started, you'll need your child's <strong>full name</strong> and{' '}
              <strong>date of birth.</strong> That's all — no account or password required.
            </p>
          </div>

          <button className="pw-btn" onClick={() => navigate('/parent/login')}>
            Begin your child's forms <span className="pw-btn-arrow">→</span>
          </button>

          <p className="pw-footer-note">
            {practicePhone ? (
              <>
                Questions? We're here —{' '}
                <a href={`tel:${practicePhone}`}>{practicePhone}</a>
                <br />
              </>
            ) : null}
            We look forward to seeing you soon.
          </p>
        </div>
      </main>

      <footer className="pw-page-footer">
        &copy; {new Date().getFullYear()} {practiceName} Pediatrics &nbsp;·&nbsp; Texas &nbsp;·&nbsp;{' '}
        <a href="#">Privacy Policy</a>
      </footer>
    </div>
  );
}
