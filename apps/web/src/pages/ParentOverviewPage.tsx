import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getLocal } from '../lib/storage';
import type { FormTemplate } from '../lib/types';

export function ParentOverviewPage() {
  const { slug = 'sunshine-pediatrics', sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<FormTemplate | null>(null);

  const localVisitType = getLocal<{ visit_type?: string }>(`pediform_start_${sessionId}`, {}).visit_type;

  useEffect(() => {
    api<FormTemplate>(`/api/submissions/${sessionId}/template`).then((t) => {
      const visitType = t.visit_type || localVisitType;
      const isMchat = t.form_id === 'mchat' || /^mchat/i.test(t.form_id ?? '');
      if (isMchat && t.pdf_overlay_ready && (t.field_schema?.fields?.length ?? 0) > 0) {
        navigate(`/p/${slug}/session/${sessionId}/pdf-form`, { replace: true });
        return;
      }
      if (isMchat || visitType === 'new_patient' || t.form_id === 'patient_registration') {
        navigate(`/p/${slug}/session/${sessionId}/form/${t.form_id}/step/1`, { replace: true });
      } else if (t.acroform_ready) {
        navigate(`/p/${slug}/session/${sessionId}/pdf-form`, { replace: true });
      } else {
        setTemplate(t);
      }
    }).catch(() => setTemplate(null));
  }, [sessionId]);

  if (!template) return null;

  const isNewPatient = (template.visit_type || localVisitType) === 'new_patient' || template.form_id === 'patient_registration';

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
