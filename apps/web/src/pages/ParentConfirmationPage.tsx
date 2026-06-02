import { Link, useLocation, useParams } from 'react-router-dom';
import { getLocal } from '../lib/storage';
import { getPatientSession } from '../lib/patientSession';

export function ParentConfirmationPage() {
  const { slug = 'nurturekidspediatrics', sessionId = '' } = useParams();
  const { state } = useLocation();
  const start = getLocal<Record<string, any>>(`pediform_start_${sessionId}`, {});
  const hasPatientSession = Boolean(getPatientSession());
  const isLoggedIn = Boolean(getLocal<string | null>('pediform_parent_token', null)) || hasPatientSession;
  const allPortalFormsDone = Boolean((state as any)?.allPortalFormsDone);

  return (
    <div className="card mobile">
      <h2>{allPortalFormsDone ? 'All Forms Complete!' : 'Paperwork Submitted'}</h2>
      <p>
        {allPortalFormsDone
          ? 'All your forms have been submitted. Thank you — your provider will be in touch.'
          : 'Thank you! Your paperwork is complete. You do not need to fill it in again.'}
      </p>
      <p>
        Confirmation Code: <strong>{start.confirmation_code ?? 'N/A'}</strong>
      </p>
      {hasPatientSession && (
        <Link to="/parent/dashboard">
          <button style={{ marginTop: 16 }}>Back to My Forms</button>
        </Link>
      )}
      {!isLoggedIn && (
        <>
          <p style={{ marginTop: 16, color: '#4b5563' }}>
            <strong>Optional:</strong> Create an account to access your records in the future.
          </p>
          <Link to={`/p/${slug}/session/${sessionId}/create-account`}>
            <button>Create Account (Optional)</button>
          </Link>
        </>
      )}
    </div>
  );
}
