import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, authHeader } from '../lib/api';

type Props = {
  token: string | null;
};

type DuplicatePatient = {
  id: string;
  created_at: string;
  account_id: string | null;
  account_email: string | null;
  submission_count: number;
};

type DuplicateGroup = {
  child_first_name: string;
  child_last_name: string;
  child_dob: string;
  patients: DuplicatePatient[];
};

export function StaffPatientsPage({ token }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<any[]>([]);
  const [error, setError] = useState('');

  const [showDuplicates, setShowDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupError, setDupError] = useState('');
  // Map of groupKey → selected primary patient id
  const [selectedPrimary, setSelectedPrimary] = useState<Record<string, string>>({});
  const [mergingKey, setMergingKey] = useState<string | null>(null);

  function loadPatients() {
    if (!token) return;
    api<any[]>(`/api/staff/patients?search=${encodeURIComponent(search)}`, {
      headers: authHeader(token),
    })
      .then(setPatients)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    if (!token) {
      navigate('/staff/login');
      return;
    }
    loadPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, search, navigate]);

  async function loadDuplicates() {
    if (!token) return;
    setDupLoading(true);
    setDupError('');
    try {
      const result = await api<DuplicateGroup[]>('/api/staff/patients/duplicates', {
        headers: authHeader(token),
      });
      setDuplicates(result);
      // Default primary to the patient with the most submissions (or first)
      const defaults: Record<string, string> = {};
      result.forEach((g) => {
        const key = groupKey(g);
        const best = [...g.patients].sort((a, b) => b.submission_count - a.submission_count)[0];
        defaults[key] = best.id;
      });
      setSelectedPrimary(defaults);
    } catch (e) {
      setDupError((e as Error).message);
    } finally {
      setDupLoading(false);
    }
  }

  function groupKey(g: DuplicateGroup) {
    return `${g.child_first_name}|${g.child_last_name}|${g.child_dob}`;
  }

  async function handleMerge(group: DuplicateGroup) {
    if (!token) return;
    const key = groupKey(group);
    const primaryId = selectedPrimary[key];
    if (!primaryId) return;

    const duplicateIds = group.patients.filter((p) => p.id !== primaryId).map((p) => p.id);
    setMergingKey(key);
    setDupError('');
    try {
      for (const duplicateId of duplicateIds) {
        await api('/api/staff/patients/merge', {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ primary_id: primaryId, duplicate_id: duplicateId }),
        });
      }
      await loadDuplicates();
      loadPatients();
    } catch (e) {
      setDupError((e as Error).message);
    } finally {
      setMergingKey(null);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Staff Patient Workspace</h2>
          <button
            className="secondary"
            onClick={() => {
              setShowDuplicates((v) => {
                if (!v) loadDuplicates();
                return !v;
              });
            }}
          >
            {showDuplicates ? 'Hide Duplicates' : 'Find Duplicates'}
          </button>
        </div>

        <p>
          Need to manage form templates? <Link to="/staff/templates">Open Template Builder</Link>
        </p>

        {showDuplicates && (
          <div style={{ marginBottom: 20, padding: 16, background: '#fffbf0', borderRadius: 8, border: '1px solid #f0d080' }}>
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Duplicate Patients</h3>
            {dupLoading && <p style={{ color: '#888' }}>Scanning for duplicates...</p>}
            {dupError && <div className="error" style={{ marginBottom: 8 }}>{dupError}</div>}
            {!dupLoading && duplicates.length === 0 && (
              <p style={{ color: '#555', margin: 0 }}>No duplicate patients found.</p>
            )}
            {duplicates.map((group) => {
              const key = groupKey(group);
              const isMerging = mergingKey === key;
              return (
                <div
                  key={key}
                  style={{ marginBottom: 16, padding: 14, background: '#fff', borderRadius: 8, border: '1px solid #e8d870' }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {group.child_first_name} {group.child_last_name}
                    <span style={{ fontWeight: 400, color: '#666', marginLeft: 10, fontSize: 13 }}>
                      DOB: {group.child_dob} · {group.patients.length} records
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {group.patients.map((p) => {
                      const isPrimary = selectedPrimary[key] === p.id;
                      return (
                        <label
                          key={p.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 12px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            border: `1px solid ${isPrimary ? '#3b82f6' : '#ddd'}`,
                            background: isPrimary ? '#dbeafe' : '#fafafa',
                          }}
                        >
                          <input
                            type="radio"
                            name={key}
                            value={p.id}
                            checked={isPrimary}
                            onChange={() => setSelectedPrimary((prev) => ({ ...prev, [key]: p.id }))}
                          />
                          <div style={{ flex: 1, fontSize: 13 }}>
                            <span style={{ fontWeight: isPrimary ? 600 : 400 }}>
                              {isPrimary ? 'Keep (primary)' : 'Merge into primary'}
                            </span>
                            <span style={{ color: '#666', marginLeft: 8 }}>
                              {p.submission_count} submission{p.submission_count !== 1 ? 's' : ''}
                              {p.account_email ? ` · ${p.account_email}` : ' · no account'}
                              {' · created '}
                              {new Date(p.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => handleMerge(group)}
                    disabled={isMerging || !selectedPrimary[key]}
                    style={{ fontSize: 13 }}
                  >
                    {isMerging ? 'Merging...' : `Merge into selected`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="row">
          <div className="field">
            <label>Search by Name</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <table className="table">
          <thead>
            <tr>
              <th>Child Name</th>
              <th>DOB</th>
              <th>Visit Type</th>
              <th>Status</th>
              <th>Account</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr key={patient.id}>
                <td>
                  {patient.child_first_name} {patient.child_last_name}
                </td>
                <td>{patient.child_dob}</td>
                <td>{patient.visit_type}</td>
                <td>{patient.latest_submission_status ?? 'n/a'}</td>
                <td>{patient.account_email ?? 'Not linked'}</td>
                <td>
                  <Link to={`/staff/patients/${patient.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
