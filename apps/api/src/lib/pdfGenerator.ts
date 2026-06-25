import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

type CanonicalExport = Record<string, any>;

function safe(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function mmddyyyy(input?: string): string {
  if (!input) return '';
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return safe(input);
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const y = dt.getFullYear();
  return `${m}/${d}/${y}`;
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function buildPatientRegistrationFileName(exported: CanonicalExport): string {
  const patient = exported.normalized_patient_data?.patient ?? {};
  const first = safe(patient.child_first_name || exported.payload?.patient?.child?.first_name || 'patient');
  const last = safe(patient.child_last_name || exported.payload?.patient?.child?.last_name || 'unknown');
  return `${sanitizeFileName(`${first}_${last}`)}_patientregistration.pdf`;
}

export function buildSubmissionDownloadFileName(exported: CanonicalExport, formName?: string): string {
  const patient = exported.normalized_patient_data?.patient ?? {};
  const first = safe(patient.child_first_name || exported.payload?.patient?.child?.first_name || 'patient');
  const last = safe(patient.child_last_name || exported.payload?.patient?.child?.last_name || 'unknown');
  const name = formName?.trim() || String(exported.form_id || 'form');
  return `${sanitizeFileName(`${first}_${last}_${name}`)}.pdf`;
}

function pickData(exported: CanonicalExport) {
  const patient = exported.normalized_patient_data?.patient ?? {};
  const guardians = exported.normalized_patient_data?.guardians ?? [];
  const primaryGuardian = guardians.find((g: any) => Number(g.guardian_index) === 1) ?? guardians[0] ?? {};
  const secondaryGuardian = guardians.find((g: any) => Number(g.guardian_index) === 2) ?? {};

  const childFirst = safe(patient.child_first_name || exported.payload?.patient?.child?.first_name);
  const childLast = safe(patient.child_last_name || exported.payload?.patient?.child?.last_name);

  return {
    childName: `${childFirst} ${childLast}`.trim(),
    firstName: childFirst,
    lastName: childLast,
    dob: mmddyyyy(safe(patient.child_dob || exported.payload?.patient?.child?.dob)),
    sex: safe(patient.sex),
    address: safe(primaryGuardian.address),
    phone: safe(primaryGuardian.phone),
    guardianName: safe(primaryGuardian.full_name),
    guardianRelationship: safe(primaryGuardian.relationship),
    secondaryGuardianName: safe(secondaryGuardian.full_name),
    secondaryGuardianDob: mmddyyyy(safe(secondaryGuardian.subscriber_dob || '')),
    today: mmddyyyy(new Date().toISOString()),
  };
}

export async function generateSubmissionPdf(exported: CanonicalExport): Promise<Uint8Array> {
  let PDFDocument: any;
  let StandardFonts: any;
  try {
    const pdfLib = await import('pdf-lib');
    PDFDocument = pdfLib.PDFDocument;
    StandardFonts = pdfLib.StandardFonts;
  } catch {
    throw new Error("Missing dependency 'pdf-lib'. Run: npm install");
  }

  const sourcePath = path.join(config.rootPath, 'NEW PATIENT PAPERWORK.pdf');
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Base PDF template not found: NEW PATIENT PAPERWORK.pdf');
  }

  const srcBytes = fs.readFileSync(sourcePath);
  const pdfDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const data = pickData(exported);

  const pages = pdfDoc.getPages();

  const draw = (pageIndex: number, x: number, y: number, text: string, size = 10) => {
    const page = pages[pageIndex];
    if (!page || !text) return;
    page.drawText(text, {
      x,
      y,
      size,
      font,
    });
  };

  // Page 1
  draw(0, 195, 666, data.childName);
  draw(0, 395, 666, data.address, 9);
  draw(0, 430, 648, data.address, 9);
  draw(0, 190, 635, data.dob);
  draw(0, 430, 635, data.phone);
  draw(0, 74, 79, data.guardianName);
  draw(0, 288, 79, data.today);
  draw(0, 396, 79, data.guardianRelationship);

  // Page 2
  draw(1, 170, 609, data.childName, 11);
  draw(1, 365, 609, data.dob, 11);
  draw(1, 90, 317, data.guardianName, 11);
  draw(1, 90, 264, data.guardianName, 11);
  draw(1, 396, 264, data.today, 11);
  draw(1, 90, 212, data.guardianName, 11);
  draw(1, 90, 159, data.guardianName, 11);
  draw(1, 396, 159, data.today, 11);

  // Page 3 and 4 headers
  draw(2, 160, 678, data.childName, 10);
  draw(2, 430, 678, data.dob, 10);
  draw(3, 160, 678, data.childName, 10);
  draw(3, 430, 678, data.dob, 10);
  draw(3, 72, 177, data.guardianName, 10);
  draw(3, 445, 177, data.today, 10);

  // Page 6 and 7 top right header block
  draw(5, 475, 746, data.childName, 9);
  draw(5, 435, 733, data.dob, 9);
  draw(5, 535, 733, data.today, 9);
  draw(6, 475, 746, data.childName, 9);
  draw(6, 435, 733, data.dob, 9);
  draw(6, 535, 733, data.today, 9);

  // Page 8 repeated child lines
  draw(7, 190, 183, data.childName, 9);
  draw(7, 450, 183, data.dob, 9);
  draw(7, 180, 158, data.childName, 9);
  draw(7, 440, 158, data.dob, 9);
  draw(7, 190, 133, data.childName, 9);
  draw(7, 450, 133, data.dob, 9);
  draw(7, 250, 82, data.guardianName, 9);
  draw(7, 500, 82, data.today, 9);

  // Page 9 patient info form
  draw(8, 90, 697, data.lastName, 8);
  draw(8, 325, 697, data.firstName, 8);
  draw(8, 515, 697, data.sex, 8);
  draw(8, 90, 675, data.dob, 8);
  draw(8, 430, 675, data.phone, 8);
  draw(8, 90, 654, data.address, 8);
  draw(8, 90, 496, data.dob, 8);
  draw(8, 370, 496, data.secondaryGuardianDob, 8);
  draw(8, 90, 453, data.phone, 8);
  draw(8, 360, 453, data.phone, 8);
  draw(8, 90, 360, data.address, 8);
  draw(8, 360, 360, data.address, 8);
  draw(8, 120, 272, data.guardianName, 8);
  draw(8, 390, 272, data.dob, 8);

  // Page 11 (duplicate release form)
  draw(10, 170, 665, data.childName, 10);
  draw(10, 180, 652, data.dob, 10);
  draw(10, 170, 640, data.address, 9);
  draw(10, 180, 627, data.address, 9);
  draw(10, 390, 627, data.phone, 9);
  draw(10, 180, 551, data.address, 9);
  draw(10, 390, 551, data.phone, 9);
  draw(10, 72, 103, data.guardianName, 10);

  // Page 12
  draw(11, 170, 627, data.childName, 11);
  draw(11, 365, 627, data.dob, 11);
  draw(11, 90, 157, data.guardianName, 11);
  draw(11, 90, 104, data.guardianName, 11);
  draw(11, 396, 104, data.today, 11);

  return pdfDoc.save({ useObjectStreams: false });
}
