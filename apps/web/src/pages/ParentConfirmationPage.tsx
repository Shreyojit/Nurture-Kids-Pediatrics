import { Link, useParams } from 'react-router-dom';
import { getLocal } from '../lib/storage';

export function ParentConfirmationPage() {
  const { slug = 'nurturekidspediatrics', sessionId = '' } = useParams();
  const start = getLocal<Record<string, any>>(`pediform_start_${sessionId}`, {});
  const isLoggedIn = Boolean(getLocal<string | null>('pediform_parent_token', null));

  return (
    <div className="card mobile">
      <h2>Paperwork Submitted</h2>
      <p>Thank you! Your paperwork is complete. You do not need to fill it in again.</p>
      <p>
        Confirmation Code: <strong>{start.confirmation_code ?? 'N/A'}</strong>
      </p>
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
