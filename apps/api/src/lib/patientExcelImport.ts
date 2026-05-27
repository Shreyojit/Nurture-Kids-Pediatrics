import * as XLSX from 'xlsx';

export type PatientVisitTypeEnum = 'new_patient' | 'well_child' | 'sick' | 'follow_up';

/** One validated row ready for DB insert (after parse + required-field checks). */
export type PatientExcelImportRow = {
  /** 1-based spreadsheet row number (for error messages). */
  sheetRow: number;
  childFirstName: string;
  childLastName: string;
  childDob: string;
  visitType: PatientVisitTypeEnum;
  rawVisitType: string | null;
  patientAcctNo: string | null;
  externalPatientKey: string;
  preferredLanguage: string | null;
  sex: string | null;
  raceEthnicity: string | null;
  nextAppointmentDate: string | null;
  nextAppointmentTime: string | null;
  appointmentVisitType: string | null;
  appointmentVisitReason: string | null;
  appointmentProviderName: string | null;
  /** Appointment Facility Group Name — the regional grouping (e.g. "Texas Region"). */
  appointmentFacilityGroupName: string | null;
  /** Appointment Facility Name — the actual clinic (e.g. "Sunshine Pediatrics – Houston"). */
  appointmentFacilityName: string | null;
  guardianPhones: string | null;
  guardianEmail: string | null;
  guardianAddress: string | null;
  primaryInsuranceCompany: string | null;
  primaryInsuranceMemberId: string | null;
  appointmentInsuranceCompany: string | null;
  appointmentInsuranceMemberId: string | null;
};

export type PatientExcelParseResult = {
  rows: PatientExcelImportRow[];
  errors: string[];
  total_rows: number;
};

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYmdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function excelSerialToYMD(serial: number): string | null {
  const whole = Math.floor(serial);
  if (whole < 1) return null;
  const ms = EXCEL_EPOCH_MS + whole * 86400000;
  return formatYmdUtc(new Date(ms));
}

/** Time from Excel datetime fraction or time-only serial (< 1). */
export function excelSerialToHHmm(serial: number): string | null {
  const frac = serial >= 1 ? serial - Math.floor(serial) : serial;
  if (!Number.isFinite(frac) || frac <= 1e-8) return null;
  const totalMinutes = Math.min(Math.round(frac * 24 * 60), 24 * 60 - 1);
  if (totalMinutes < 0) return null;
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getCell(raw: Record<string, unknown>, normalizedHeader: string): unknown {
  for (const [k, v] of Object.entries(raw)) {
    if (normalizeHeader(k) === normalizedHeader) return v;
  }
  return undefined;
}

/** Map Visit Type column text to stored visit_type enum (patients.visit_type). */
export function mapVisitTypeFromText(raw: string | null | undefined): PatientVisitTypeEnum {
  const s = (raw ?? '').toLowerCase();
  if (!s.trim()) return 'new_patient';
  if (
    s.includes('well') ||
    s.includes('checkup') ||
    s.includes('check-up') ||
    s.includes('check up') ||
    s.includes('annual') ||
    s.includes('preventive') ||
    s.includes('physical exam') ||
    s.includes('wellness')
  ) {
    return 'well_child';
  }
  if (s.includes('sick')) return 'sick';
  if (s.includes('follow')) return 'follow_up';
  return 'new_patient';
}

function normalizeDateValue(val: unknown): string | null {
  if (val == null || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return formatYmdUtc(val);
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    const ymd = excelSerialToYMD(val);
    if (ymd) return ymd;
    return null;
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t) return null;
    const iso = t.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return formatYmdUtc(d);
  }
  return null;
}

function normalizeTimeValue(val: unknown): string | null {
  if (val == null || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${pad2(val.getUTCHours())}:${pad2(val.getUTCMinutes())}`;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return excelSerialToHHmm(val);
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t) return null;
    const m24 = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m24) {
      const hh = Math.min(23, parseInt(m24[1], 10));
      const mm = Math.min(59, parseInt(m24[2], 10));
      return `${pad2(hh)}:${pad2(mm)}`;
    }
    const d = new Date(`1970-01-01T${t}`);
    if (!Number.isNaN(d.getTime())) {
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
  }
  return null;
}

function str(val: unknown): string {
  if (val == null || val === '') return '';
  return String(val).trim();
}

/** First non-empty trimmed string among normalized header aliases. */
function mget(m: Record<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const v = str(m[a]);
    if (v) return v;
  }
  return '';
}

function buildAddress(row: Record<string, string>): string | null {
  const full = str(row['patient full address']);
  if (full) return full;
  const parts = [
    str(row['patient address line 1']),
    str(row['patient address line 2']),
    [str(row['patient city']), str(row['patient state']), str(row['patient zip code'])].filter(Boolean).join(', '),
  ].filter(Boolean);
  const joined = parts.join('\n').trim();
  return joined || null;
}

function buildPhones(row: Record<string, string>): string | null {
  const segments: string[] = [];
  const home = str(row['patient home phone']);
  const cell = str(row['patient cell phone']);
  const work = str(row['patient work phone']);
  if (home) segments.push(`Home: ${home}`);
  if (cell) segments.push(`Cell: ${cell}`);
  if (work) segments.push(`Work: ${work}`);
  return segments.length ? segments.join(' | ') : null;
}

function buildRaceEthnicity(row: Record<string, string>): string | null {
  const race = str(row['patient race']);
  const eth = str(row['patient ethnicity']);
  if (race && eth) return `${race} / ${eth}`;
  return race || eth || null;
}

function buildExternalPatientKey(acctNo: string | null, first: string, last: string, dob: string): string {
  const a = acctNo?.trim();
  if (a) return `acct:${a}`;
  return `nm:${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${dob}`;
}

function rowToNormalizedMap(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = normalizeHeader(k);
    if (!nk) continue;
    out[nk] = str(v);
  }
  return out;
}

function rowIsBlank(m: Record<string, string>): boolean {
  return Object.values(m).every((v) => !str(v));
}

/**
 * Parse the first worksheet of an Excel upload into normalized import rows.
 * Requires first name, last name, and DOB per non-blank row.
 */
export function parsePatientExcelBuffer(buffer: Buffer): PatientExcelParseResult {
  const errors: string[] = [];
  const rows: PatientExcelImportRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
  } catch (e) {
    return {
      rows: [],
      errors: [`Could not read Excel file: ${(e as Error).message}`],
      total_rows: 0,
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: ['Workbook has no worksheets'], total_rows: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  const total_rows = objects.length;

  objects.forEach((raw, idx) => {
    const sheetRow = idx + 2;
    const m = rowToNormalizedMap(raw);
    if (rowIsBlank(m)) return;

    const first = str(m['patient first name']);
    const last = str(m['patient last name']);
    const dobRaw = normalizeDateValue(getCell(raw, 'patient dob'));

    const acct = str(m['patient acct no']) || null;

    if (!first || !last || !dobRaw) {
      errors.push(`Row ${sheetRow}: Patient First Name, Patient Last Name, and Patient DOB are required`);
      return;
    }

    const visitRaw = str(m['visit type']) || null;
    const visitType = mapVisitTypeFromText(visitRaw);

    const apptDate = normalizeDateValue(getCell(raw, 'appointment date'));
    const apptTime = normalizeTimeValue(getCell(raw, 'appointment start time'));

    const dob = dobRaw;

    rows.push({
      sheetRow,
      childFirstName: first,
      childLastName: last,
      childDob: dob,
      visitType,
      rawVisitType: visitRaw,
      patientAcctNo: acct,
      externalPatientKey: buildExternalPatientKey(acct, first, last, dob),
      preferredLanguage: str(m['patient language']) || null,
      sex: str(m['patient gender']) || null,
      raceEthnicity: buildRaceEthnicity(m),
      nextAppointmentDate: apptDate,
      nextAppointmentTime: apptTime,
      appointmentVisitType: visitRaw,
      appointmentVisitReason: str(m['visit reason']) || null,
      appointmentProviderName: str(m['appointment provider name']) || null,
      appointmentFacilityGroupName:
        mget(m, 'appointment facility group name', 'facility group name', 'facility group', 'region') || null,
      appointmentFacilityName:
        mget(m, 'appointment facility name', 'facility name', 'clinic name', 'clinic') || null,
      guardianPhones: buildPhones(m),
      guardianEmail: mget(m, 'patient e-mail', 'patient email') || null,
      guardianAddress: buildAddress(m),
      primaryInsuranceCompany: str(m['primary insurance name']) || null,
      primaryInsuranceMemberId: str(m['primary insurance subscriber no']) || null,
      appointmentInsuranceCompany: str(m['appointment insurance name']) || null,
      appointmentInsuranceMemberId: str(m['appointment insurance subscriber no']) || null,
    });
  });

  return { rows, errors, total_rows };
}
