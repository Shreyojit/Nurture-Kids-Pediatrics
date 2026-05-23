import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, authHeader } from '../lib/api';
import {
  formatParentPortalAccount,
  formatSubmissionStatus,
  formatVisitType,
} from '../lib/staffLabels';

type Props = {
  token: string | null;
};

type AutoAssignSummary = {
  patient_name: string;
  age_group: string | null;
  form_labels: string[];
  assignments_created: number;
  assignments_skipped?: number;
  existing_patient?: boolean;
};

type BulkUploadResult = {
  inserted: number;
  skipped: number;
  total_rows: number;
  errors: string[];
  imported_patients: Array<{
    id: string;
    child_first_name: string;
    child_last_name: string;
    patient_acct_no: string | null;
  }>;
  auto_form_assignments?: AutoAssignSummary[];
};

function formatNextAppt(patient: Record<string, unknown>): string {
  const d = patient.next_appointment_date;
  const t = patient.next_appointment_time;
  if (!d && !t) return '—';
  if (d && t) return `${d} ${t}`;
  return String(d ?? t ?? '—');
}

export function StaffPatientsPage({ token }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPatients = useCallback(() => {
    if (!token) return Promise.resolve();
    setError('');
    return api<any[]>(`/api/staff/patients?search=${encodeURIComponent(search)}`, {
      headers: authHeader(token),
    })
      .then(setPatients)
      .catch((e) => setError((e as Error).message));
  }, [token, search]);

  useEffect(() => {
    if (!token) {
      navigate('/staff/login');
      return;
    }

    void loadPatients();
  }, [token, search, navigate, loadPatients]);

  async function handleUploadExcel() {
    const f = fileRef.current?.files?.[0];
    if (!f || !token) {
      setUploadMsg('Choose an Excel file first.');
      return;
    }
    setUploading(true);
    setUploadMsg('');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const result = await api<BulkUploadResult>('/api/staff/patients/bulk-upload', {
        method: 'POST',
        headers: authHeader(token),
        body: fd,
      });
      const noteLines = result.errors.slice(0, 8);
      const auto = result.auto_form_assignments ?? [];
      const autoSummary =
        auto.length > 0
          ? ` Auto-assigned forms for ${auto.length} well-visit patient(s) (${auto.reduce((n, a) => n + a.assignments_created, 0)} new assignment(s)).`
          : '';
      const preview =
        result.imported_patients.length > 0
          ? ` First import: ${result.imported_patients[0].child_last_name}, ${result.imported_patients[0].child_first_name}` +
            (result.imported_patients[0].patient_acct_no
              ? ` (Chart # ${result.imported_patients[0].patient_acct_no})`
              : '')
          : '';
      setUploadMsg(
        `✅ Upload successful — inserted ${result.inserted}, skipped ${result.skipped}, total sheet rows ${result.total_rows}.${preview}${autoSummary}${
          noteLines.length ? ` Notes: ${noteLines.join('; ')}` : ''
        }`,
      );
      if (fileRef.current) fileRef.current.value = '';
      await loadPatients();
    } catch (e) {
      setUploadMsg(`❌ Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h2 className="page-title">Today&apos;s Patients</h2>
        <p className="text-muted">
          Need to manage forms? <Link to="/staff/templates">Open form builder</Link>
        </p>
        <div className="row">
          <div className="field">
            <label>Search patients</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ marginTop: '1rem', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="field">
            <label>Import patient schedule</label>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
          </div>
          <button type="button" disabled={uploading || !token} onClick={() => void handleUploadExcel()}>
            {uploading ? 'Importing…' : 'Import schedule'}
          </button>
        </div>
        {uploadMsg ? (
          <p
            style={{
              marginTop: '0.5rem',
              color: uploadMsg.startsWith('✅') ? 'green' : 'red',
              fontWeight: 500,
            }}
          >
            {uploadMsg}
          </p>
        ) : null}

        {error ? <div className="error">{error}</div> : null}

        <table className="table">
          <thead>
            <tr>
              <th>Patient name</th>
              <th>Chart #</th>
              <th>Appointment</th>
              <th>Visit type</th>
              <th>Status</th>
              <th>Parent portal</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr key={patient.id}>
                <td>
                  {patient.child_first_name} {patient.child_last_name}
                </td>
                <td>{patient.patient_acct_no ?? '—'}</td>
                <td>{formatNextAppt(patient)}</td>
                <td>{formatVisitType(patient.visit_type)}</td>
                <td>
                  {patient.latest_submission_status
                    ? formatSubmissionStatus(patient.latest_submission_status)
                    : 'n/a'}
                </td>
                <td>{formatParentPortalAccount(patient.account_email)}</td>
                <td>
                  <Link to={`/staff/patients/${patient.id}`}>View patient</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
