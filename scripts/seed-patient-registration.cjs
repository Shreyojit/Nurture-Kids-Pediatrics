/**
 * Seed script: Replace patient_registration template fields with
 * comprehensive new patient paperwork form (River Ridge Pediatrics PDF).
 *
 * Run: node scripts/seed-patient-registration.cjs
 */

const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', 'apps', 'data', 'pediform.db');
const TEMPLATE_ID = '1da4ed73-bd00-4e1f-9d42-ed10ffa2253b';

const db = new Database(DB_PATH);
const now = () => new Date().toISOString();

// ─── helpers ────────────────────────────────────────────────────────────────

const insertField = db.prepare(`
  INSERT INTO pdf_template_fields (
    id, template_id, field_id, field_name, field_type, acro_field_name, required,
    page_number, x, y, width, height, options_json, validation_json,
    section_key, display_order, font_size, group_id, group_value, parent_field_id,
    created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?
  )
`);

function field(opts) {
  const {
    field_id,
    field_name,
    field_type = 'text',
    required = false,
    options = [],
    section_key,
    display_order,
    page_number = 1,
  } = opts;
  const ts = now();
  insertField.run(
    randomUUID(),
    TEMPLATE_ID,
    field_id,
    field_name,
    field_type,
    field_id,          // acro_field_name matches field_id
    required ? 1 : 0,
    page_number,
    50, 700, 200, 18,  // placeholder coords
    JSON.stringify(options),
    '{}',
    section_key,
    display_order,
    12,
    null, null, null,  // group_id, group_value, parent_field_id
    ts, ts,
  );
}

// ─── main ────────────────────────────────────────────────────────────────────

const seedAll = db.transaction(() => {
  // 1. Clear existing fields & groups for this template
  db.prepare('DELETE FROM pdf_template_fields WHERE template_id = ?').run(TEMPLATE_ID);
  db.prepare('DELETE FROM field_groups WHERE template_id = ?').run(TEMPLATE_ID);

  // ── STEP 1: Patient Information ───────────────────────────────────────────
  const S1 = '1. Patient Information';
  field({ field_id: 'child_last_name',              field_name: 'Last Name',                  required: true,  section_key: S1, display_order: 10 });
  field({ field_id: 'child_first_name',             field_name: 'First Name',                 required: true,  section_key: S1, display_order: 20 });
  field({ field_id: 'child_middle_initial',         field_name: 'Middle Initial',                              section_key: S1, display_order: 30 });
  field({ field_id: 'child_sex',                    field_name: 'Sex',                        field_type: 'radio', required: true, options: ['Male', 'Female'], section_key: S1, display_order: 40 });
  field({ field_id: 'child_ssn',                    field_name: 'Social Security Number',                      section_key: S1, display_order: 60 });
  field({ field_id: 'child_home_phone',             field_name: 'Home Phone',                                  section_key: S1, display_order: 70 });
  field({ field_id: 'child_address',                field_name: 'Address',                    required: true,  section_key: S1, display_order: 80 });
  field({ field_id: 'child_apt',                    field_name: 'Apt #',                                       section_key: S1, display_order: 90 });
  field({ field_id: 'child_city',                   field_name: 'City',                       required: true,  section_key: S1, display_order: 100 });
  field({ field_id: 'child_state',                  field_name: 'State',                      required: true,  section_key: S1, display_order: 110 });
  field({ field_id: 'child_zip',                    field_name: 'Zip Code',                   required: true,  section_key: S1, display_order: 120 });
  field({ field_id: 'emergency_contact_name',       field_name: 'Emergency Contact Name',                      section_key: S1, display_order: 130 });
  field({ field_id: 'emergency_contact_relationship', field_name: 'Emergency Contact Relationship',            section_key: S1, display_order: 140 });
  field({ field_id: 'emergency_contact_phone',      field_name: 'Emergency Contact Phone',                     section_key: S1, display_order: 150 });

  // ── STEP 2: Guardian 1 ────────────────────────────────────────────────────
  const S2 = '2. Guardian 1';
  field({ field_id: 'g1_type',           field_name: 'Relationship to Patient',  field_type: 'radio', required: true, options: ['Mother', 'Father', 'Other'], section_key: S2, display_order: 10 });
  field({ field_id: 'g1_name',           field_name: 'Full Name',                required: true,  section_key: S2, display_order: 20 });
  field({ field_id: 'g1_ssn',            field_name: 'Social Security Number',                    section_key: S2, display_order: 40 });
  field({ field_id: 'g1_email',          field_name: 'Email Address',            required: true,  section_key: S2, display_order: 50 });
  field({ field_id: 'g1_home_phone',     field_name: 'Home Phone',                                section_key: S2, display_order: 60 });
  field({ field_id: 'g1_work_phone',     field_name: 'Work Phone',                                section_key: S2, display_order: 70 });
  field({ field_id: 'g1_cell_phone',     field_name: 'Cell Phone',                                section_key: S2, display_order: 80 });
  field({ field_id: 'g1_marital_status', field_name: 'Marital Status',           field_type: 'radio', options: ['Single', 'Married', 'Separated', 'Divorced', 'Widowed'], section_key: S2, display_order: 90 });
  field({ field_id: 'g1_address_same',   field_name: 'Home Address Same as Patient?', field_type: 'radio', options: ['Yes', 'No'], section_key: S2, display_order: 100 });
  field({ field_id: 'g1_address',        field_name: 'Address (if different)',                    section_key: S2, display_order: 110 });
  field({ field_id: 'g1_city',           field_name: 'City',                                      section_key: S2, display_order: 120 });
  field({ field_id: 'g1_state',          field_name: 'State',                                     section_key: S2, display_order: 130 });
  field({ field_id: 'g1_zip',            field_name: 'Zip Code',                                  section_key: S2, display_order: 140 });

  // ── STEP 3: Guardian 2 ────────────────────────────────────────────────────
  const S3 = '3. Guardian 2 (if applicable)';
  field({ field_id: 'g2_type',           field_name: 'Relationship to Patient',  field_type: 'radio', options: ['Mother', 'Father', 'Other'], section_key: S3, display_order: 10 });
  field({ field_id: 'g2_name',           field_name: 'Full Name',                                 section_key: S3, display_order: 20 });
  field({ field_id: 'g2_ssn',            field_name: 'Social Security Number',                    section_key: S3, display_order: 40 });
  field({ field_id: 'g2_email',          field_name: 'Email Address',                             section_key: S3, display_order: 50 });
  field({ field_id: 'g2_home_phone',     field_name: 'Home Phone',                                section_key: S3, display_order: 60 });
  field({ field_id: 'g2_work_phone',     field_name: 'Work Phone',                                section_key: S3, display_order: 70 });
  field({ field_id: 'g2_cell_phone',     field_name: 'Cell Phone',                                section_key: S3, display_order: 80 });
  field({ field_id: 'g2_marital_status', field_name: 'Marital Status',           field_type: 'radio', options: ['Single', 'Married', 'Separated', 'Divorced', 'Widowed'], section_key: S3, display_order: 90 });
  field({ field_id: 'g2_address_same',   field_name: 'Home Address Same as Patient?', field_type: 'radio', options: ['Yes', 'No'], section_key: S3, display_order: 100 });
  field({ field_id: 'g2_address',        field_name: 'Address (if different)',                    section_key: S3, display_order: 110 });
  field({ field_id: 'g2_city',           field_name: 'City',                                      section_key: S3, display_order: 120 });
  field({ field_id: 'g2_state',          field_name: 'State',                                     section_key: S3, display_order: 130 });
  field({ field_id: 'g2_zip',            field_name: 'Zip Code',                                  section_key: S3, display_order: 140 });

  // ── STEP 4: Insurance ─────────────────────────────────────────────────────
  const S4 = '4. Insurance';
  field({ field_id: 'primary_insurance_company',    field_name: 'Primary Insurance Company',                   section_key: S4, display_order: 10 });
  field({ field_id: 'primary_policyholder_name',    field_name: 'Primary Policyholder Name',                   section_key: S4, display_order: 20 });
  field({ field_id: 'secondary_insurance_company',  field_name: 'Secondary Insurance Company',                 section_key: S4, display_order: 40 });
  field({ field_id: 'secondary_policyholder_name',  field_name: 'Secondary Policyholder Name',                 section_key: S4, display_order: 50 });

  // ── STEP 5: Medical History ───────────────────────────────────────────────
  const S5 = '5. Medical History';
  field({ field_id: 'info_provided_by',   field_name: 'Information Provided By',                           section_key: S5, display_order: 10 });
  field({ field_id: 'reason_for_visit',   field_name: 'Reason for Visit',          field_type: 'textarea', required: true, section_key: S5, display_order: 20 });
  field({ field_id: 'current_medications', field_name: 'Current Medications',       field_type: 'textarea', section_key: S5, display_order: 30 });
  field({ field_id: 'allergy_medications', field_name: 'Medication Allergies',                              section_key: S5, display_order: 40 });
  field({ field_id: 'allergy_foods',       field_name: 'Food Allergies',                                   section_key: S5, display_order: 50 });
  field({ field_id: 'allergy_other',       field_name: 'Other Allergies',                                  section_key: S5, display_order: 60 });

  // Past Medical History checkboxes
  const pmh = [
    ['pmh_eyes',          'Eyes'],
    ['pmh_heart',         'Heart'],
    ['pmh_muscle',        'Muscle'],
    ['pmh_ears',          'Ears'],
    ['pmh_stomach',       'Stomach or Intestines'],
    ['pmh_bone',          'Bone Problems'],
    ['pmh_nose',          'Nose'],
    ['pmh_kidneys',       'Kidneys'],
    ['pmh_skin',          'Skin'],
    ['pmh_throat',        'Throat'],
    ['pmh_lungs',         'Lungs / Asthma'],
    ['pmh_endocrine',     'Endocrine'],
    ['pmh_neurological',  'Neurological'],
    ['pmh_genetic',       'Genetic Disorder'],
    ['pmh_psychiatric',   'Psychiatric Disorder'],
    ['pmh_developmental', 'Developmental Disorder'],
    ['pmh_other',         'Other'],
  ];
  pmh.forEach(([id, name], i) => {
    field({ field_id: id, field_name: `Past Medical Hx: ${name}`, field_type: 'checkbox', section_key: S5, display_order: 70 + i * 10 });
  });

  field({ field_id: 'pmh_notes',             field_name: 'Past Medical History Notes',  field_type: 'textarea', section_key: S5, display_order: 250 });
  field({ field_id: 'past_hospitalizations', field_name: 'Past Hospitalizations / Major Procedures / Serious Injuries', field_type: 'textarea', section_key: S5, display_order: 260 });
  field({ field_id: 'surgeries',             field_name: 'Surgeries',                  field_type: 'textarea', section_key: S5, display_order: 270 });

  // ── STEP 6: Birth History ─────────────────────────────────────────────────
  const S6 = '6. Birth History';
  field({ field_id: 'adopted',                      field_name: 'Adopted',                     field_type: 'radio', options: ['Yes', 'No'], section_key: S6, display_order: 10 });
  field({ field_id: 'pregnancy_history',            field_name: "Mother's Pregnancy History",   field_type: 'radio', options: ['Uncomplicated', 'Complications'], section_key: S6, display_order: 20 });
  field({ field_id: 'pregnancy_complications',      field_name: 'Complication Details',                             section_key: S6, display_order: 30 });
  field({ field_id: 'baby_born',                    field_name: 'Baby Born',                   field_type: 'radio', options: ['Term', 'Preterm'], section_key: S6, display_order: 40 });
  field({ field_id: 'preterm_weeks',                field_name: 'If Preterm – How Many Weeks',                      section_key: S6, display_order: 50 });
  field({ field_id: 'feeding',                      field_name: 'Feeding',                     field_type: 'radio', options: ['Breast', 'Formula', 'Both'], section_key: S6, display_order: 60 });
  field({ field_id: 'delivery_hospital',            field_name: 'Hospital',                                         section_key: S6, display_order: 70 });
  field({ field_id: 'delivery_city_state',          field_name: 'City, State',                                      section_key: S6, display_order: 80 });
  field({ field_id: 'birth_weight',                 field_name: 'Birth Weight',                                     section_key: S6, display_order: 90 });
  field({ field_id: 'delivery_type',               field_name: 'Delivery Type',               field_type: 'radio', options: ['Vaginal Delivery', 'Cesarean Section', 'Forceps Used'], section_key: S6, display_order: 100 });
  field({ field_id: 'cesarean_reason',              field_name: 'C-Section Reason',                                 section_key: S6, display_order: 110 });
  field({ field_id: 'breathing_problems',           field_name: 'Baby Had Breathing Problems', field_type: 'radio', options: ['Yes', 'No'], section_key: S6, display_order: 120 });
  field({ field_id: 'oxygen_given',                 field_name: 'Baby Given Oxygen',           field_type: 'radio', options: ['Yes', 'No'], section_key: S6, display_order: 130 });
  field({ field_id: 'jaundice',                     field_name: 'Jaundice',                    field_type: 'radio', options: ['Yes', 'No'], section_key: S6, display_order: 140 });
  field({ field_id: 'phototherapy',                 field_name: 'Required Phototherapy',       field_type: 'radio', options: ['Yes', 'No'], section_key: S6, display_order: 150 });
  field({ field_id: 'other_delivery_problems',      field_name: 'Other Problems After Delivery', field_type: 'textarea', section_key: S6, display_order: 160 });
  field({ field_id: 'immunized',                    field_name: 'Is Your Child Immunized?',    field_type: 'radio', options: ['Yes', 'No'], section_key: S6, display_order: 170 });
  field({ field_id: 'immunization_record_provided', field_name: 'Immunization Record Provided Today?', field_type: 'radio', options: ['Yes', 'No'], section_key: S6, display_order: 180 });
  field({ field_id: 'menstrual_periods_begun',      field_name: '(Girls) Have Menstrual Periods Begun?', field_type: 'radio', options: ['Yes', 'No', 'N/A'], section_key: S6, display_order: 190 });
  field({ field_id: 'menstrual_age',                field_name: '(Girls) If Yes, At What Age?',                   section_key: S6, display_order: 200 });

  // ── STEP 7: Family & Social History ──────────────────────────────────────
  const S7 = '7. Family & Social History';
  field({ field_id: 'family_smoke',      field_name: 'Do Any Family Members Smoke?', field_type: 'radio', options: ['Yes', 'No'], section_key: S7, display_order: 10 });
  field({ field_id: 'animal_contact',    field_name: 'Contact with Animals?',         field_type: 'radio', options: ['Yes', 'No'], section_key: S7, display_order: 20 });
  field({ field_id: 'animal_type',       field_name: 'Animal Type',                                        section_key: S7, display_order: 30 });
  field({ field_id: 'child_lives_with',  field_name: 'Child Lives With',                                   section_key: S7, display_order: 40 });
  field({ field_id: 'father_occupation', field_name: "Father's Occupation",                                section_key: S7, display_order: 50 });
  field({ field_id: 'mother_occupation', field_name: "Mother's Occupation",                                section_key: S7, display_order: 60 });
  field({ field_id: 'parents_status',    field_name: 'Parents Are',                   field_type: 'radio', options: ['Single', 'Married', 'Divorced', 'Remarried', 'Deceased'], section_key: S7, display_order: 70 });
  field({ field_id: 'father_age',        field_name: "Father's Age",                                       section_key: S7, display_order: 80 });
  field({ field_id: 'mother_age',        field_name: "Mother's Age",                                       section_key: S7, display_order: 90 });
  field({ field_id: 'brothers_ages',     field_name: "Brother's Age(s)",                                   section_key: S7, display_order: 100 });
  field({ field_id: 'sisters_ages',      field_name: "Sister's Age(s)",                                    section_key: S7, display_order: 110 });

  // Family disease history (Yes/No per condition)
  const fhConditions = [
    ['fh_deafness',            'Deafness'],
    ['fh_eye_disease',         'Eye Disease'],
    ['fh_tuberculosis',        'Tuberculosis'],
    ['fh_asthma',              'Asthma'],
    ['fh_diabetes',            'Diabetes'],
    ['fh_endocrine',           'Endocrine (Hormone) / Thyroid'],
    ['fh_anemia',              'Anemia / Bleeding Disorder'],
    ['fh_gi_disorder',         'Gastrointestinal Disorder'],
    ['fh_kidney_disease',      'Kidney Disease'],
    ['fh_heart_disease',       'Heart Disease / Stroke'],
    ['fh_high_bp',             'High Blood Pressure'],
    ['fh_high_cholesterol',    'High Cholesterol'],
    ['fh_muscle_bone',         'Muscle or Bone Disease'],
    ['fh_seizures',            'Seizures'],
    ['fh_developmental_delay', 'Developmental Delay'],
    ['fh_birth_defects',       'Birth Defects'],
    ['fh_chromosome_disorder', 'Chromosome Disorder'],
    ['fh_cancer',              'Cancer'],
    ['fh_psychiatric',         'Psychiatric'],
  ];
  fhConditions.forEach(([id, name], i) => {
    field({ field_id: id, field_name: `Family Hx: ${name}`, field_type: 'radio', options: ['Yes', 'No'], section_key: S7, display_order: 120 + i * 10 });
  });

  field({ field_id: 'family_history_notes', field_name: 'Family History Notes', field_type: 'textarea', section_key: S7, display_order: 320 });

  // ── STEP 8: Consents & Authorizations ─────────────────────────────────────
  const S8 = '8. Consents & Authorizations';
  field({ field_id: 'consent_to_treat',         field_name: 'I authorize evaluation and treatment by River Ridge Pediatrics providers and staff', field_type: 'checkbox', required: true, section_key: S8, display_order: 10 });
  field({ field_id: 'financial_policy_agree',   field_name: 'I have read and agree to the Financial Policy', field_type: 'checkbox', required: true, section_key: S8, display_order: 20 });
  field({ field_id: 'insurance_auth_agree',     field_name: 'I authorize River Ridge Pediatrics to verify, file insurance claims, and release required medical information to my insurer', field_type: 'checkbox', required: true, section_key: S8, display_order: 30 });
  field({ field_id: 'privacy_practices_reviewed', field_name: 'I have reviewed the Notice of Privacy Practices', field_type: 'checkbox', required: true, section_key: S8, display_order: 40 });
  field({ field_id: 'imm_registry_consent',     field_name: "ImmTrac2 – Texas Immunization Registry Consent", field_type: 'radio', options: ["Yes – Include my child's information", "No – Do not include my child's information"], section_key: S8, display_order: 50 });
  field({ field_id: 'non_parent_only_parents',  field_name: 'Only parents/guardians are authorized to bring this child in (check if no additional persons authorized)', field_type: 'checkbox', section_key: S8, display_order: 60 });
  field({ field_id: 'authorized_person_1_name', field_name: 'Authorized Person 1 – Name',          section_key: S8, display_order: 70 });
  field({ field_id: 'authorized_person_1_rel',  field_name: 'Authorized Person 1 – Relationship',  section_key: S8, display_order: 80 });
  field({ field_id: 'authorized_person_2_name', field_name: 'Authorized Person 2 – Name',          section_key: S8, display_order: 90 });
  field({ field_id: 'authorized_person_2_rel',  field_name: 'Authorized Person 2 – Relationship',  section_key: S8, display_order: 100 });
  field({ field_id: 'credit_card_auth',         field_name: 'I authorize River Ridge Pediatrics to charge my credit card on file for patient-responsible balances', field_type: 'checkbox', section_key: S8, display_order: 110 });
  field({ field_id: 'guardian_printed_name',    field_name: 'Printed Name of Parent / Legal Guardian', required: true,  section_key: S8, display_order: 120 });
  field({ field_id: 'guardian_signature',       field_name: 'Signature of Parent / Legal Guardian',    field_type: 'signature', required: true,  section_key: S8, display_order: 130 });
  field({ field_id: 'signature_date',           field_name: 'Date',                                    field_type: 'date', required: true, section_key: S8, display_order: 140 });
  field({ field_id: 'relationship_to_patient',  field_name: 'Relationship to Patient',                 required: true,  section_key: S8, display_order: 150 });

  const count = db.prepare('SELECT COUNT(*) as c FROM pdf_template_fields WHERE template_id = ?').get(TEMPLATE_ID);
  console.log(`✓ Inserted ${count.c} fields across 8 steps for template ${TEMPLATE_ID}`);
});

seedAll();
db.close();
console.log('Done.');
