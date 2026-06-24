type Scores = {
  communication_total: number | null;
  gross_motor_total: number | null;
  fine_motor_total: number | null;
  problem_solving_total: number | null;
  personal_social_total: number | null;
};

// ASQ-3 48-Month cutoffs (from the information summary page of the form)
const CUTOFFS: Record<string, number> = {
  communication_total: 30.72,
  gross_motor_total: 32.78,
  fine_motor_total: 15.81,
  problem_solving_total: 31.30,
  personal_social_total: 26.60,
};

const DOMAINS = [
  { key: 'communication_total', label: 'Communication' },
  { key: 'gross_motor_total', label: 'Gross Motor' },
  { key: 'fine_motor_total', label: 'Fine Motor' },
  { key: 'problem_solving_total', label: 'Problem Solving' },
  { key: 'personal_social_total', label: 'Personal-Social' },
] as const;

function scoreColor(score: number | null, cutoff: number) {
  if (score === null) return '#9ca3af';
  if (score >= cutoff) return 'var(--color-success)';
  if (score >= cutoff - 10) return '#d97706'; // close to cutoff
  return 'var(--color-error)';
}

function scoreLabel(score: number | null, cutoff: number) {
  if (score === null) return 'Not scored';
  if (score >= cutoff) return 'On track';
  if (score >= cutoff - 10) return 'Monitor';
  return 'Below cutoff';
}

export function ASQScoreSummary({ scores }: { scores: Scores }) {
  const hasAnyScore = DOMAINS.some((d) => scores[d.key] !== null);

  if (!hasAnyScore) {
    return (
      <div style={{ padding: '16px', background: 'var(--color-bg-subtle)', borderRadius: 8, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
        Scores not calculated yet. Save the form to compute domain scores.
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700 }}>Domain</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700 }}>Score</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700 }}>Cutoff</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700 }}>Status</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700 }}>Bar</th>
            </tr>
          </thead>
          <tbody>
            {DOMAINS.map((d) => {
              const score = scores[d.key];
              const cutoff = CUTOFFS[d.key];
              const color = scoreColor(score, cutoff);
              const pct = score !== null ? Math.min(100, (score / 60) * 100) : 0;
              const cutoffPct = (cutoff / 60) * 100;

              return (
                <tr
                  key={d.key}
                  style={{ borderBottom: '1px solid var(--color-border-table)' }}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{d.label}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color }}>
                    {score ?? '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    {cutoff}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 700,
                        background: score === null ? '#f3f4f6' : score >= cutoff ? 'var(--color-success-bg)' : score >= cutoff - 10 ? '#fffbeb' : 'var(--color-error-bg)',
                        color,
                        border: `1px solid ${score === null ? '#e5e7eb' : score >= cutoff ? '#86efac' : score >= cutoff - 10 ? '#fde68a' : 'var(--color-error-border)'}`,
                      }}
                    >
                      {scoreLabel(score, cutoff)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', width: 200 }}>
                    <div
                      style={{
                        position: 'relative',
                        height: 10,
                        background: '#e5e7eb',
                        borderRadius: 6,
                        overflow: 'visible',
                      }}
                    >
                      {/* Score bar */}
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          height: '100%',
                          width: `${pct}%`,
                          background: color,
                          borderRadius: 6,
                          transition: 'width 0.4s',
                        }}
                      />
                      {/* Cutoff marker */}
                      <div
                        style={{
                          position: 'absolute',
                          left: `${cutoffPct}%`,
                          top: -3,
                          width: 2,
                          height: 16,
                          background: '#374151',
                          borderRadius: 1,
                        }}
                        title={`Cutoff: ${cutoff}`}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12 }}>
        Scoring: YES = 10 · SOMETIMES = 5 · NOT YET = 0. Max per domain = 60.
        Scores at or above the cutoff indicate development appears to be on schedule.
      </p>
    </div>
  );
}
