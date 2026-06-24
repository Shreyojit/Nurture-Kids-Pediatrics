import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ASQScoreSummary } from '../components/ASQScoreSummary';

type Field = {
  id: string;
  field_name: string;
  field_key: string;
  field_type: string;
  page_number: number;
  group_name: string | null;
  option_value: string | null;
};

type Value = {
  field_id: string;
  field_key: string;
  value: string;
};

type Submission = {
  id: string;
  template_id: string;
  status: string;
  communication_total: number | null;
  gross_motor_total: number | null;
  fine_motor_total: number | null;
  problem_solving_total: number | null;
  personal_social_total: number | null;
  generated_pdf_path: string | null;
  created_at: string;
  values: Value[];
  fields: Field[];
};

const DOMAIN_KEYS = [
  'communication_total',
  'gross_motor_total',
  'fine_motor_total',
  'problem_solving_total',
  'personal_social_total',
] as const;

export function ASQSubmissionView() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [sub, setSub] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    if (!submissionId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api<Submission>(`/api/asq/submissions/${submissionId}`);
      setSub(data);
      if (data.generated_pdf_path) {
        setDownloadUrl(`/api/asq/submissions/${submissionId}/download`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGeneratePdf() {
    if (!submissionId) return;
    setGenerating(true);
    setError('');
    try {
      const result = await api<{ download_url: string }>(
        `/api/asq/submissions/${submissionId}/generate-pdf`,
        { method: 'POST' },
      );
      setDownloadUrl(result.download_url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="page-shell">
        <div className="container"><p>Loading…</p></div>
      </div>
    );
  }

  if (error && !sub) {
    return (
      <div className="page-shell">
        <div className="container">
          <div className="alert alert-error">{error}</div>
        </div>
      </div>
    );
  }

  if (!sub) return null;

  const responseMap: Record<string, string> = {};
  for (const v of sub.values) responseMap[v.field_key] = v.value;

  const hasScores = DOMAIN_KEYS.some((k) => sub[k] !== null);

  return (
    <div className="page-shell">
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>ASQ-3 Submission</h1>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>
              ID: {sub.id} · Created: {new Date(sub.created_at).toLocaleString()}
            </p>
          </div>
          <Link
            to={`/staff/asq/${sub.template_id}/fill/${sub.id}`}
            className="btn btn-outline"
            style={{ fontSize: 13 }}
          >
            Edit Responses
          </Link>
          {downloadUrl ? (
            <a href={downloadUrl} className="btn btn-primary" target="_blank" rel="noreferrer">
              Download Filled PDF
            </a>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void handleGeneratePdf()}
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Generate Filled PDF'}
            </button>
          )}
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {/* Status badge */}
        <div style={{ marginBottom: 24 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '4px 14px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 700,
              background: sub.status === 'completed' ? 'var(--color-success-bg)' : sub.status === 'scored' ? '#eff6ff' : '#f9fafb',
              color: sub.status === 'completed' ? 'var(--color-success)' : sub.status === 'scored' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              border: `1px solid ${sub.status === 'completed' ? '#86efac' : sub.status === 'scored' ? '#bfdbfe' : '#e5e7eb'}`,
            }}
          >
            {sub.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        {/* ── Score Summary ── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="card-title" style={{ marginBottom: 16 }}>ASQ-3 Domain Scores</h2>
          <ASQScoreSummary
            scores={{
              communication_total: sub.communication_total,
              gross_motor_total: sub.gross_motor_total,
              fine_motor_total: sub.fine_motor_total,
              problem_solving_total: sub.problem_solving_total,
              personal_social_total: sub.personal_social_total,
            }}
          />
          {!hasScores && (
            <p style={{ marginTop: 12, fontSize: 13 }}>
              <Link to={`/staff/asq/${sub.template_id}/fill/${sub.id}`}>
                Fill out the form
              </Link>{' '}
              to calculate scores.
            </p>
          )}
        </div>

        {/* ── Responses table ── */}
        <div className="card">
          <h2 className="card-title" style={{ marginBottom: 16 }}>
            Recorded Responses ({sub.values.length})
          </h2>
          {sub.values.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
              No responses saved yet.{' '}
              <Link to={`/staff/asq/${sub.template_id}/fill/${sub.id}`}>Fill the form.</Link>
            </p>
          ) : (
            <table className="table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Field Key</th>
                  <th>Value</th>
                  <th>Field Type</th>
                </tr>
              </thead>
              <tbody>
                {sub.values.map((v) => {
                  const field = sub.fields.find(
                    (f) =>
                      (f.field_type === 'radio' && f.group_name === v.field_key) ||
                      f.field_key === v.field_key,
                  );
                  return (
                    <tr key={v.field_key}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.field_key}</td>
                      <td>
                        {v.value === 'checked' ? (
                          <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>☑ Checked</span>
                        ) : v.value === 'yes' ? (
                          <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>Yes (10)</span>
                        ) : v.value === 'sometimes' ? (
                          <span style={{ color: '#d97706', fontWeight: 700 }}>Sometimes (5)</span>
                        ) : v.value === 'not_yet' ? (
                          <span style={{ color: 'var(--color-error)', fontWeight: 700 }}>Not Yet (0)</span>
                        ) : (
                          <span>{v.value}</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--color-text-muted)' }}>
                        {field?.field_type ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
