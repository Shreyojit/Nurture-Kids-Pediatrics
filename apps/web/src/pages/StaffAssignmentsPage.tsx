import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, authHeader } from '../lib/api';
import { formatAssignmentStatus } from '../lib/staffLabels';

type Props = {
  token: string | null;
};

type PublishedTemplate = {
  id: string;
  name: string;
  template_key: string;
};

type AssignmentRecord = {
  id: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
  child_first_name: string;
  child_last_name: string;
  child_dob: string;
  template_name: string;
  assigned_by_email: string;
  submission_id: string | null;
};

type BundleResult = {
  bundle_id: string | null;
  bundle_token: string;
  patient_name: string;
  template_names: string[];
  fill_url: string;
  qr_code_data_url: string;
  portal_url?: string;
  expires_at: string;
};

type PatientSearchResult = {
  id: string;
  child_first_name: string;
  child_last_name: string;
  child_dob: string;
  patient_acct_no: string | null;
  account_email: string | null;
};

export function StaffAssignmentsPage({ token }: Props) {
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<PublishedTemplate[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [patientMode, setPatientMode] = useState<'existing' | 'new'>('existing');

  // Existing patient search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // New patient fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');

  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);

  const [createdBundle, setCreatedBundle] = useState<BundleResult | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [showQrId, setShowQrId] = useState<string | null>(null);

  const [smsPhone, setSmsPhone] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState('');

  const [emailAddress, setEmailAddress] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState('');

  async function loadTemplates() {
    if (!token) return;
    try {
      const result = await api<any[]>('/api/staff/templates', { headers: authHeader(token) });
      setTemplates(
        result
          .filter((t: any) => t.status === 'published')
          .map((t: any) => ({ id: t.id, name: t.name, template_key: t.template_key })),
      );
    } catch {
      // non-fatal
    }
  }

  async function loadAssignments() {
    if (!token) return;
    try {
      const result = await api<AssignmentRecord[]>('/api/staff/assignments', { headers: authHeader(token) });
      setAssignments(result);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    if (!token) {
      navigate('/staff/login');
      return;
    }
    loadTemplates();
    loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setSelectedPatient(null);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      if (!token) return;
      setSearchLoading(true);
      try {
        const results = await api<PatientSearchResult[]>(
          `/api/staff/patients?search=${encodeURIComponent(value.trim())}`,
          { headers: authHeader(token) },
        );
        setSearchResults(results);
        setShowDropdown(true);
      } catch {
        // non-fatal
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }

  function selectPatient(p: PatientSearchResult) {
    setSelectedPatient(p);
    setSearchQuery(`${p.child_first_name} ${p.child_last_name}`);
    setShowDropdown(false);
    setSearchResults([]);
    if (p.account_email) setEmailAddress(p.account_email);
  }

  function toggleTemplate(id: string) {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }

  function canCreate() {
    if (selectedTemplateIds.length === 0) return false;
    if (patientMode === 'existing') return !!selectedPatient;
    return !!firstName.trim() && !!lastName.trim() && !!dob;
  }

  async function handleCreate() {
    if (!token || !canCreate()) return;
    setSubmitting(true);
    setError('');
    setSmsResult('');
    setEmailResult('');
    try {
      const days = expiresInDays >= 1 ? expiresInDays : 7;
      const body =
        patientMode === 'existing'
          ? {
              patient_id: selectedPatient!.id,
              template_ids: selectedTemplateIds,
              expires_in_days: days,
            }
          : {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              dob,
              template_ids: selectedTemplateIds,
              expires_in_days: days,
            };

      const result = await api<BundleResult>('/api/staff/assignments', {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(body),
      });
      setCreatedBundle(result);
      setShowForm(false);
      setShowQrId(null);
      // Reset form
      setSelectedPatient(null);
      setSearchQuery('');
      setFirstName('');
      setLastName('');
      setDob('');
      setSelectedTemplateIds([]);
      setExpiresInDays(7);
      await loadAssignments();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteAssignment(id: string) {
    if (!token) return;
    if (!window.confirm('Delete this assignment? This cannot be undone.')) return;
    try {
      await api(`/api/staff/assignments/${id}`, { method: 'DELETE', headers: authHeader(token) });
      await loadAssignments();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleSendSms() {
    if (!token || !smsPhone || !createdBundle?.bundle_id) return;
    setSmsSending(true);
    setSmsResult('');
    try {
      await api(`/api/staff/assignments/bundle/${createdBundle.bundle_id}/send-sms`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({ phone: smsPhone }),
      });
      setSmsResult('SMS sent.');
    } catch (e) {
      setSmsResult(`Failed: ${(e as Error).message}`);
    } finally {
      setSmsSending(false);
    }
  }

  async function handleSendEmail() {
    if (!token || !emailAddress || !createdBundle?.bundle_id) return;
    setEmailSending(true);
    setEmailResult('');
    try {
      await api(`/api/staff/assignments/bundle/${createdBundle.bundle_id}/send-email`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({ email: emailAddress }),
      });
      setEmailResult('Email sent.');
    } catch (e) {
      setEmailResult(`Failed: ${(e as Error).message}`);
    } finally {
      setEmailSending(false);
    }
  }

  function copyLink(id: string, url: string) {
    const onSuccess = () => {
      setCopiedLinkId(id);
      setTimeout(() => setCopiedLinkId(null), 2000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(onSuccess).catch(() => fallbackCopy(url, onSuccess));
    } else {
      fallbackCopy(url, onSuccess);
    }
  }

  function fallbackCopy(url: string, onSuccess: () => void) {
    const el = document.createElement('textarea');
    el.value = url;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    if (document.execCommand('copy')) onSuccess();
    document.body.removeChild(el);
  }

  async function viewLink(a: AssignmentRecord) {
    if (!token) return;
    try {
      const result = await api<{ fill_url: string; qr_code_data_url: string; bundle_id: string | null; portal_url?: string }>(
        `/api/staff/assignments/${a.id}/link`,
        { headers: authHeader(token) },
      );
      setCreatedBundle({
        bundle_id: result.bundle_id,
        bundle_token: '',
        patient_name: `${a.child_first_name} ${a.child_last_name}`,
        template_names: [a.template_name],
        fill_url: result.fill_url,
        qr_code_data_url: result.qr_code_data_url,
        portal_url: result.portal_url,
        expires_at: a.expires_at,
      });
      setShowQrId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const statusStyle = (status: string) => ({
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    background: status === 'completed' ? '#d4edda' : status === 'expired' ? '#f8d7da' : status === 'in_progress' ? '#fff3cd' : '#cfe2ff',
    color: status === 'completed' ? '#155724' : status === 'expired' ? '#721c24' : status === 'in_progress' ? '#856404' : '#084298',
  });

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Forms sent to families</h2>
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setCreatedBundle(null);
              setError('');
            }}
          >
            {showForm ? 'Cancel' : '+ Send a form'}
          </button>
        </div>

        {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}

        {showForm && (
          <div className="card" style={{ background: '#f0f7ff', marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Send a form</h3>

            {/* Patient mode toggle */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 6, overflow: 'hidden', border: '1px solid #c5d8f0', width: 'fit-content' }}>
              <button
                onClick={() => setPatientMode('existing')}
                style={{
                  borderRadius: 0,
                  border: 'none',
                  background: patientMode === 'existing' ? '#2563eb' : '#fff',
                  color: patientMode === 'existing' ? '#fff' : '#333',
                  padding: '6px 16px',
                  fontWeight: patientMode === 'existing' ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                Existing Patient
              </button>
              <button
                onClick={() => setPatientMode('new')}
                style={{
                  borderRadius: 0,
                  border: 'none',
                  borderLeft: '1px solid #c5d8f0',
                  background: patientMode === 'new' ? '#2563eb' : '#fff',
                  color: patientMode === 'new' ? '#fff' : '#333',
                  padding: '6px 16px',
                  fontWeight: patientMode === 'new' ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                New Patient
              </button>
            </div>

            {patientMode === 'existing' ? (
              <div style={{ marginBottom: 12 }}>
                <div className="field" ref={dropdownRef} style={{ position: 'relative', maxWidth: 360 }}>
                  <label>Search Patient</label>
                  <input
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search by first or last name..."
                    autoComplete="off"
                  />
                  {searchLoading && (
                    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Searching...</div>
                  )}
                  {showDropdown && searchResults.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #c5d8f0',
                      borderRadius: 6,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      zIndex: 100,
                      maxHeight: 220,
                      overflowY: 'auto',
                    }}>
                      {searchResults.map((p) => (
                        <div
                          key={p.id}
                          onClick={() => selectPatient(p)}
                          style={{
                            padding: '10px 14px',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f0f0f0',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f7ff')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                        >
                          <div style={{ fontWeight: 600 }}>{p.child_first_name} {p.child_last_name}</div>
                          <div style={{ fontSize: 12, color: '#666' }}>{p.patient_acct_no ? `Chart #${p.patient_acct_no}` : ''}  {p.account_email ? ` · ${p.account_email}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {showDropdown && searchResults.length === 0 && !searchLoading && searchQuery.trim() && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #c5d8f0',
                      borderRadius: 6,
                      padding: '10px 14px',
                      fontSize: 13,
                      color: '#888',
                      zIndex: 100,
                    }}>
                      No patients found. Try "New Patient" to create one.
                    </div>
                  )}
                </div>
                {selectedPatient && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#dbeafe', borderRadius: 6, border: '1px solid #3b82f6', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, maxWidth: 360 }}>
                    <span style={{ flex: 1 }}>
                      <strong>{selectedPatient.child_first_name} {selectedPatient.child_last_name}</strong>
                      {selectedPatient.patient_acct_no && <span style={{ color: '#555', marginLeft: 8 }}>Chart #{selectedPatient.patient_acct_no}</span>}
                    </span>
                    <button
                      onClick={() => { setSelectedPatient(null); setSearchQuery(''); }}
                      style={{ fontSize: 11, padding: '2px 8px', color: '#c00', borderColor: '#c00', background: 'transparent' }}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="row" style={{ marginBottom: 0 }}>
                <div className="field">
                  <label>First Name</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
                </div>
                <div className="field">
                  <label>Last Name</label>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
                </div>
                <div className="field">
                  <label>Date of Birth</label>
                  <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </div>
              </div>
            )}

            <div className="row" style={{ marginBottom: 12 }}>
              <div className="field">
                <label>Expires After (days)</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  style={{ width: 80 }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                Forms to send
                {selectedTemplateIds.length > 0 && (
                  <span style={{ fontWeight: 400, color: '#555', marginLeft: 8 }}>
                    ({selectedTemplateIds.length} selected)
                  </span>
                )}
              </label>
              {templates.length === 0 ? (
                <p style={{ fontSize: 13, color: '#888' }}>No active forms available.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {templates.map((t) => (
                    <label
                      key={t.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        background: selectedTemplateIds.includes(t.id) ? '#dbeafe' : '#fff',
                        border: `1px solid ${selectedTemplateIds.includes(t.id) ? '#3b82f6' : '#ddd'}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTemplateIds.includes(t.id)}
                        onChange={() => toggleTemplate(t.id)}
                        style={{ width: 16, height: 16 }}
                      />
                      <span>{t.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleCreate}
              disabled={submitting || !canCreate()}
            >
              {submitting
                ? 'Creating...'
                : `Send ${selectedTemplateIds.length > 1 ? `${selectedTemplateIds.length} forms` : 'form'}`}
            </button>
            {patientMode === 'new' && (
              <p style={{ fontSize: 12, color: '#666', marginTop: 8, marginBottom: 0 }}>
                If no patient record exists for this name + DOB, one will be created automatically.
              </p>
            )}
          </div>
        )}

        {createdBundle && (
          <div style={{ marginTop: 16, padding: 16, background: '#fff', borderRadius: 8, border: '1px solid #b3d4f7' }}>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>
              Form sent to <em>{createdBundle.patient_name}</em>
            </h3>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
              Forms: {createdBundle.template_names.join(', ')}
            </p>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
              These assignments expire: {new Date(createdBundle.expires_at).toLocaleDateString()}
            </p>
            <div style={{ marginBottom: 12, padding: '10px 12px', background: '#eef6ff', borderRadius: 6, border: '1px solid #b3d4f7' }}>
              <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: '#1a56db' }}>
                Patient Portal Link (permanent)
              </p>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#555' }}>
                Share this one link — all current and future assignments for this patient will appear here automatically.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => copyLink('bundle', createdBundle.fill_url)}>
                  {copiedLinkId === 'bundle' ? 'Copied!' : 'Copy Portal Link'}
                </button>
                <button className="secondary" onClick={() => setShowQrId(showQrId === 'bundle' ? null : 'bundle')}>
                  {showQrId === 'bundle' ? 'Hide QR' : 'Show QR Code'}
                </button>
              </div>
            </div>
            {showQrId === 'bundle' && (
              <img
                src={createdBundle.qr_code_data_url}
                alt="QR code"
                style={{ marginBottom: 12, border: '1px solid #ddd', borderRadius: 4, display: 'block' }}
              />
            )}
            {createdBundle.bundle_id && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240, padding: 12, background: '#f8faff', borderRadius: 8, border: '1px solid #dde' }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Send via SMS</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="tel"
                      placeholder="+15551234567"
                      value={smsPhone}
                      onChange={(e) => setSmsPhone(e.target.value)}
                      style={{ width: 160 }}
                    />
                    <button onClick={handleSendSms} disabled={smsSending || !smsPhone}>
                      {smsSending ? 'Sending...' : 'Send SMS'}
                    </button>
                  </div>
                  {smsResult && (
                    <p style={{ marginTop: 6, fontSize: 13, color: smsResult.startsWith('Failed') ? '#c00' : '#0a0' }}>
                      {smsResult}
                    </p>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 240, padding: 12, background: '#f8faff', borderRadius: 8, border: '1px solid #dde' }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Send via Email</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="email"
                      placeholder="patient@example.com"
                      value={emailAddress}
                      onChange={(e) => setEmailAddress(e.target.value)}
                      style={{ width: 200 }}
                    />
                    <button onClick={handleSendEmail} disabled={emailSending || !emailAddress}>
                      {emailSending ? 'Sending...' : 'Send Email'}
                    </button>
                  </div>
                  {emailResult && (
                    <p style={{ marginTop: 6, fontSize: 13, color: emailResult.startsWith('Failed') ? '#c00' : '#0a0' }}>
                      {emailResult}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {assignments.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3>All sent forms</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Form</th>
                  <th>Status</th>
                  <th>Sent by</th>
                  <th>Link expires</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.child_first_name} {a.child_last_name}</td>
                    <td>{a.template_name}</td>
                    <td><span style={statusStyle(a.status)}>{formatAssignmentStatus(a.status)}</span></td>
                    <td>{a.assigned_by_email}</td>
                    <td>{new Date(a.expires_at).toLocaleDateString()}</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(a.status === 'pending' || a.status === 'in_progress') && (
                        <button
                          className="secondary"
                          style={{ fontSize: 12, padding: '2px 8px' }}
                          onClick={() => viewLink(a)}
                        >
                          Copy link
                        </button>
                      )}
                      <button
                        className="secondary"
                        style={{ fontSize: 12, padding: '2px 8px', color: '#c00', borderColor: '#c00' }}
                        onClick={() => handleDeleteAssignment(a.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {assignments.length === 0 && !showForm && (
          <p style={{ marginTop: 24, color: '#666' }}>No forms sent yet. Click "+ Send a form" to get started.</p>
        )}
      </div>
    </div>
  );
}
