import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { FormTemplate } from '../lib/types';

export function ParentOverviewPage() {
  const { slug = 'nurturekidspediatrics', sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<FormTemplate | null>(null);

  useEffect(() => {
    api<FormTemplate>(`/api/submissions/${sessionId}/template`).then((t) => {
      const isMchat = t.form_id === 'mchat' || /^mchat/i.test(t.form_id ?? '');
      if (isMchat) {
        // Always route M-CHAT to the PDF page. PdfFillPage uses overlay mode when
        // field_schema is ready; otherwise it shows a clear error. Falling back to
        // the step form is wrong because M-CHAT templates have no regular steps.
        navigate(`/p/${slug}/session/${sessionId}/pdf-form`, { replace: true });
        return;
      }
      // Non-MCHAT: gate on form_id, not visit_type (commit 106f492)
      if (t.form_id === 'patient_registration') {
        navigate(`/p/${slug}/session/${sessionId}/form/${t.form_id}/step/1`, { replace: true });
      } else if (t.acroform_ready) {
        navigate(`/p/${slug}/session/${sessionId}/pdf-form`, { replace: true });
      } else {
        setTemplate(t);
      }
    }).catch(() => setTemplate(null));
  }, [sessionId]);

  if (!template) return null;

  const isNewPatient = template.form_id === 'patient_registration';

  return (
    <div className="card mobile">
      <h2>What to Expect</h2>
      <p>
        Form: <span className="badge">{template.title}</span>
      </p>
      <p>Estimated time: 8-10 minutes</p>
      <p>Steps: {template.steps.length}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {template.acroform_ready && !isNewPatient ? (
          <Link to={`/p/${slug}/session/${sessionId}/pdf-form`}>
            <button style={{ width: '100%' }}>Fill PDF Directly</button>
          </Link>
        ) : null}
        <Link to={`/p/${slug}/session/${sessionId}/form/${template.form_id}/step/1`}>
          <button
            style={{
              width: '100%',
              background: template.acroform_ready && !isNewPatient ? '#6b7280' : undefined,
            }}
          >
            {template.acroform_ready && !isNewPatient ? 'Fill Step-by-Step Instead' : 'Start Paperwork'}
          </button>
        </Link>
      </div>
    </div>
  );
}
