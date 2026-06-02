import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getLocal, setLocal, removeLocal } from '../lib/storage';
import { getPatientSession } from '../lib/patientSession';
import type { FormTemplate } from '../lib/types';
import { TemplateFieldInput } from '../components/TemplateFieldInput';

export function ParentFormPage() {
  const { slug = 'nurturekidspediatrics', sessionId = '', step = '1', formId = 'patient_registration' } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [responses, setResponses] = useState<Record<string, unknown>>(() =>
    getLocal(`pediform_submission_responses_${sessionId}`, {}),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const stepIndex = Math.max(0, Number(step) - 1);

  function normalizeResponsesMap(input: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const [fieldId, raw] of Object.entries(input)) {
      if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
        normalized[fieldId] = (raw as { value: unknown }).value;
      } else {
        normalized[fieldId] = raw;
      }
    }
    return normalized;
  }

  useEffect(() => {
    api<FormTemplate>(`/api/submissions/${sessionId}/template`).then((t) => {
      setTemplate(t);

      const persisted = getLocal<Record<string, unknown>>(`pediform_submission_responses_${sessionId}`, {});
      const remote = normalizeResponsesMap(t.responses ?? {});
      const merged = { ...remote, ...persisted };

      const start = getLocal<Record<string, string>>(`pediform_start_${sessionId}`, {});
      const allFieldIds = new Set(t.steps.flatMap((templateStep) => templateStep.fields.map((field) => field.field_id)));
      if (allFieldIds.has('child_first_name') && (merged.child_first_name ?? '') === '') {
        merged.child_first_name = start.child_first_name ?? '';
      }
      if (allFieldIds.has('child_last_name') && (merged.child_last_name ?? '') === '') {
        merged.child_last_name = start.child_last_name ?? '';
      }
      setResponses(merged);
    });
  }, [sessionId]);

  useEffect(() => {
    setLocal(`pediform_submission_responses_${sessionId}`, responses);
  }, [responses, sessionId]);

  async function doAutosave(stepNumber: number) {
    await api(`/api/submissions/${sessionId}/autosave`, {
      method: 'PATCH',
      body: JSON.stringify({
        step: stepNumber,
        responses,
      }),
    });
  }

  useEffect(() => {
    const timer = setInterval(() => {
      if (!sessionId) return;
      doAutosave(stepIndex + 1).catch(() => undefined);
    }, 30000);

    return () => clearInterval(timer);
  }, [sessionId, stepIndex, responses]);

  const currentStep = useMemo(() => template?.steps[stepIndex] ?? null, [template, stepIndex]);

  if (!template) {
    return (
      <div className="card mobile">
        <p>Loading form...</p>
      </div>
    );
  }

  if (!currentStep) {
    return (
      <div className="card mobile">
        <p style={{ color: '#c0392b' }}>
          This form is not available for step-by-step filling. Please go back and try again.
        </p>
        <button onClick={() => navigate(-1)} style={{ marginTop: 12, background: '#6b7280' }}>
          Go back
        </button>
      </div>
    );
  }

  const safeTemplate = template;
  const safeCurrentStep = currentStep;

  function validateStep() {
    const errors: Record<string, string> = {};

    for (const field of safeCurrentStep.fields) {
      const value = responses[field.field_id];
      if (field.required) {
        if (field.input_type === 'boolean_yes_no') {
          if (value !== true && value !== false) {
            errors[field.field_id] = 'Please select Yes or No / Sí o No.';
          }
        } else if (field.input_type === 'checkbox' && !value) {
          errors[field.field_id] = 'This field is required.';
        } else if (field.input_type !== 'checkbox' && (value === undefined || value === null || value === '')) {
          errors[field.field_id] = 'This field is required.';
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onNext() {
    setError('');
    if (!validateStep()) return;

    setSaving(true);
    try {
      await doAutosave(stepIndex + 1);
      if (stepIndex + 1 >= safeTemplate.steps.length) {
        const completed = await api<{ confirmation_code: string; status: string }>(`/api/submissions/${sessionId}/complete`, {
          method: 'POST',
        });
        const start = getLocal<Record<string, any>>(`pediform_start_${sessionId}`, {});
        setLocal(`pediform_start_${sessionId}`, {
          ...start,
          confirmation_code: completed.confirmation_code,
          completed: true,
        });

        if (getPatientSession()) {
          navigate('/parent/dashboard');
          return;
        }
        const portalAssignments = getLocal<Array<{ session_id: string; status: string; practice_slug: string }>>('pediform_portal_assignments', []);
        const nextForm = portalAssignments.find(
          (a) => a.session_id !== sessionId && a.status !== 'completed',
        );
        if (nextForm) {
          navigate(`/p/${nextForm.practice_slug}/session/${nextForm.session_id}/overview`);
        } else {
          const allDone = portalAssignments.length > 0;
          if (allDone) removeLocal('pediform_portal_assignments');
          navigate(`/p/${slug}/session/${sessionId}/confirmation`, { state: { allPortalFormsDone: allDone } });
        }
      } else {
        navigate(`/p/${slug}/session/${sessionId}/form/${formId}/step/${stepIndex + 2}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function onBack() {
    if (stepIndex === 0) {
      navigate(`/p/${slug}/session/${sessionId}/overview`);
      return;
    }
    navigate(`/p/${slug}/session/${sessionId}/form/${formId}/step/${stepIndex}`);
  }

  return (
    <div className="card mobile">
      <p>
        Step {stepIndex + 1} of {safeTemplate.steps.length}
      </p>
      <h3>{safeCurrentStep.title}</h3>
      {safeCurrentStep.description ? <p>{safeCurrentStep.description}</p> : null}

      {safeCurrentStep.fields.map((field) => (
        <TemplateFieldInput
          key={field.field_id}
          field={field}
          value={responses[field.field_id]}
          error={fieldErrors[field.field_id]}
          onChange={(value) => {
            setResponses((prev) => ({ ...prev, [field.field_id]: value }));
            setFieldErrors((prev) => ({ ...prev, [field.field_id]: '' }));
          }}
          allFields={safeCurrentStep.fields}
          allGroups={template.groups ?? []}
          allValues={responses as Record<string, any>}
          onChangeAll={(updates) => {
            setResponses((prev) => ({ ...prev, ...updates }));
            setFieldErrors((prev) => {
              const cleared: Record<string, string> = {};
              for (const key of Object.keys(updates)) cleared[key] = '';
              return { ...prev, ...cleared };
            });
          }}
        />
      ))}

      {error ? <div className="error">{error}</div> : null}

      <div className="actions">
        <button className="secondary" onClick={onBack} disabled={saving}>
          Back
        </button>
        <button onClick={onNext} disabled={saving}>
          {stepIndex + 1 >= safeTemplate.steps.length ? 'Submit' : 'Next'}
        </button>
      </div>
    </div>
  );
}
