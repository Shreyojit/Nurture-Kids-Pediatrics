import path from 'node:path';
import { db } from './database.js';
import { config } from '../config.js';

export function runMigrations(): void {
  db.exec(`
    create table if not exists practices (
      id text primary key,
      name text not null,
      slug text not null unique,
      logo_url text,
      settings_json text not null,
      created_at text not null
    );

    create table if not exists staff_users (
      id text primary key,
      email text not null unique,
      password_hash text not null,
      practice_id text not null,
      role text not null check(role in ('admin', 'staff')),
      is_active integer not null default 1,
      created_at text not null,
      foreign key(practice_id) references practices(id)
    );

    create table if not exists patient_accounts (
      id text primary key,
      email text not null unique,
      password_hash text not null,
      practice_id text not null,
      created_at text not null,
      last_login_at text,
      foreign key(practice_id) references practices(id)
    );

    create table if not exists patients (
      id text primary key,
      practice_id text not null,
      account_id text,
      child_first_name text not null,
      child_last_name text not null,
      child_dob text not null,
      visit_type text not null,
      preferred_language text,
      sex text,
      race_ethnicity text,
      created_at text not null,
      updated_at text not null,
      foreign key(practice_id) references practices(id),
      foreign key(account_id) references patient_accounts(id)
    );

    create table if not exists guardians (
      id text primary key,
      patient_id text not null,
      guardian_index integer not null,
      full_name text,
      relationship text,
      phone text,
      email text,
      address text,
      employer text,
      ssn_last4 text,
      created_at text not null,
      updated_at text not null,
      unique(patient_id, guardian_index),
      foreign key(patient_id) references patients(id)
    );

    create table if not exists insurance_policies (
      id text primary key,
      patient_id text not null,
      policy_order integer not null,
      company text,
      subscriber_name text,
      subscriber_dob text,
      group_number text,
      member_id text,
      created_at text not null,
      updated_at text not null,
      unique(patient_id, policy_order),
      foreign key(patient_id) references patients(id)
    );

    create table if not exists pharmacies (
      id text primary key,
      patient_id text not null unique,
      name text,
      address text,
      zip text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists medical_history (
      id text primary key,
      patient_id text not null unique,
      gestational_age text,
      birth_weight text,
      birth_complications text,
      hospitalizations text,
      surgeries text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists concerns (
      id text primary key,
      patient_id text not null unique,
      visit_reason text,
      development_concerns text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists allergies (
      id text primary key,
      patient_id text not null,
      allergy_type text not null,
      allergy_name text,
      reaction text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists medications (
      id text primary key,
      patient_id text not null,
      medication_name text,
      dose text,
      frequency text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists immunizations (
      id text primary key,
      patient_id text not null unique,
      status text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists family_history (
      id text primary key,
      patient_id text not null,
      condition_name text,
      present integer not null default 0,
      notes text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists social_history (
      id text primary key,
      patient_id text not null unique,
      household_adults integer,
      household_children integer,
      smokers_in_home integer,
      pets text,
      daycare_school text,
      nutrition text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists provider_preferences (
      id text primary key,
      patient_id text not null unique,
      physician_preference text,
      referral_source text,
      referring_provider text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists consents_signatures (
      id text primary key,
      patient_id text not null unique,
      agreed integer not null default 0,
      typed_name text,
      signature_data text,
      signed_at text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id)
    );

    create table if not exists submissions (
      id text primary key,
      practice_id text not null,
      patient_id text,
      form_id text not null,
      template_version text not null,
      visit_type text not null,
      status text not null check(status in ('in_progress', 'completed', 'exported')),
      form_data_json text not null,
      forms_completed_json text not null,
      template_id text,
      template_version_num integer,
      responses_json text not null default '{}',
      completed_pdf_path text,
      confirmation_code text not null unique,
      submitted_at text,
      exported_at text,
      exported_by text,
      ip_address text,
      created_at text not null,
      updated_at text not null,
      foreign key(practice_id) references practices(id),
      foreign key(patient_id) references patients(id),
      foreign key(exported_by) references staff_users(id)
    );

    create table if not exists submission_events (
      id integer primary key autoincrement,
      submission_id text not null,
      practice_id text not null,
      actor_type text not null,
      actor_id text,
      event_type text not null,
      event_payload_json text not null,
      created_at text not null,
      foreign key(submission_id) references submissions(id)
    );

    create table if not exists pdf_templates (
      id text primary key,
      practice_id text not null,
      template_key text not null,
      version integer not null,
      name text not null,
      source_pdf_path text not null,
      acroform_pdf_path text,
      status text not null check(status in ('draft', 'published', 'archived')),
      created_by text,
      created_at text not null,
      updated_at text not null,
      foreign key(practice_id) references practices(id),
      foreign key(created_by) references staff_users(id),
      unique(practice_id, template_key, version)
    );

    create table if not exists pdf_template_fields (
      id text primary key,
      template_id text not null,
      field_id text not null,
      field_name text not null,
      field_type text not null,
      acro_field_name text not null,
      required integer not null default 0,
      page_number integer not null default 1,
      x real not null default 0,
      y real not null default 0,
      width real not null default 120,
      height real not null default 18,
      options_json text not null default '[]',
      validation_json text not null default '{}',
      section_key text,
      display_order integer not null default 0,
      created_at text not null,
      updated_at text not null,
      foreign key(template_id) references pdf_templates(id) on delete cascade,
      unique(template_id, field_id),
      unique(template_id, acro_field_name)
    );

    create table if not exists template_publish_events (
      id integer primary key autoincrement,
      template_id text not null,
      practice_id text not null,
      published_by text not null,
      created_at text not null,
      foreign key(template_id) references pdf_templates(id) on delete cascade,
      foreign key(practice_id) references practices(id),
      foreign key(published_by) references staff_users(id)
    );

    create table if not exists field_groups (
      id text primary key,
      template_id text not null,
      group_type text not null check(group_type in ('radio', 'checkbox', 'boxed_input')),
      group_name text not null,
      acro_group_name text not null,
      created_at text not null,
      updated_at text not null,
      foreign key(template_id) references pdf_templates(id) on delete cascade,
      unique(template_id, acro_group_name)
    );

    create table if not exists form_assignments (
      id text primary key,
      practice_id text not null,
      patient_id text not null,
      template_id text not null,
      assigned_by text not null,
      token text not null unique,
      status text not null check(status in ('pending', 'in_progress', 'completed', 'expired')),
      submission_id text,
      expires_at text not null,
      created_at text not null,
      updated_at text not null,
      foreign key(practice_id) references practices(id),
      foreign key(patient_id) references patients(id),
      foreign key(template_id) references pdf_templates(id),
      foreign key(assigned_by) references staff_users(id)
    );

    create index if not exists idx_submissions_practice_status on submissions(practice_id, status);
    create index if not exists idx_patients_practice_name on patients(practice_id, child_last_name, child_first_name);
    create index if not exists idx_pdf_templates_practice_key_status on pdf_templates(practice_id, template_key, status);
    create index if not exists idx_pdf_template_fields_template_section_order on pdf_template_fields(template_id, section_key, display_order);
    create index if not exists idx_field_groups_template on field_groups(template_id);
    create table if not exists assignment_bundles (
      id text primary key,
      practice_id text not null,
      patient_id text not null,
      assigned_by text not null,
      token text not null unique,
      expires_at text not null,
      created_at text not null,
      updated_at text not null,
      foreign key(practice_id) references practices(id),
      foreign key(patient_id) references patients(id),
      foreign key(assigned_by) references staff_users(id)
    );

    create index if not exists idx_form_assignments_token on form_assignments(token);
    create index if not exists idx_form_assignments_patient on form_assignments(patient_id);
    create index if not exists idx_form_assignments_practice_status on form_assignments(practice_id, status);
    create index if not exists idx_assignment_bundles_token on assignment_bundles(token);
  `);

  ensureBundleColumns();
  ensureSubmissionColumns();
  ensurePatientImportColumns();
  ensureAppointmentsTable();
  migrateLegacyPatientAppointmentColumns();
  ensureFieldColumns();
  ensureTemplateSchemaColumn();
  migrateSubmissionsCheckConstraint();
  normalizeTemplatePaths();
}

function ensureTemplateSchemaColumn(): void {
  const rows = db.prepare(`pragma table_info(pdf_templates)`).all() as Array<{ name: string }>;
  const names = new Set(rows.map((r) => r.name));
  if (!names.has('field_schema_json')) {
    db.exec(`alter table pdf_templates add column field_schema_json text not null default '{"fields":[]}'`);
  }
}

function ensureBundleColumns(): void {
  try {
    db.exec(`alter table form_assignments add column bundle_id text references assignment_bundles(id)`);
  } catch {
    // column already exists
  }
}

function migrateSubmissionsCheckConstraint(): void {
  // Check if the submissions table already allows 'expired' status.
  // SQLite stores the CREATE statement in sqlite_master — we inspect it to detect
  // whether the migration has already been applied.
  const row = db
    .prepare(`select sql from sqlite_master where type='table' and name='submissions'`)
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'expired'")) return; // already migrated or table missing

  // Recreate the table with the expanded CHECK constraint (in_progress, completed, exported, expired).
  // Use a transaction so the rename + copy + drop is atomic.
  db.exec(`
    pragma foreign_keys = off;
    drop table if exists submissions_new;

    create table submissions_new (
      id text primary key,
      practice_id text not null,
      patient_id text,
      form_id text not null,
      template_version text not null,
      visit_type text not null,
      status text not null check(status in ('in_progress', 'completed', 'exported', 'expired')),
      form_data_json text not null,
      forms_completed_json text not null,
      template_id text,
      template_version_num integer,
      responses_json text not null default '{}',
      completed_pdf_path text,
      confirmation_code text not null unique,
      submitted_at text,
      exported_at text,
      exported_by text,
      ip_address text,
      created_at text not null,
      updated_at text not null,
      foreign key(practice_id) references practices(id),
      foreign key(patient_id) references patients(id),
      foreign key(exported_by) references staff_users(id)
    );

    insert into submissions_new
    select
      id, practice_id, patient_id, form_id, template_version, visit_type, status,
      form_data_json, forms_completed_json, template_id, template_version_num,
      coalesce(responses_json, '{}'),
      completed_pdf_path, confirmation_code, submitted_at, exported_at, exported_by,
      ip_address, created_at, updated_at
    from submissions;
    drop table submissions;
    alter table submissions_new rename to submissions;

    pragma foreign_keys = on;
  `);
}

function ensureFieldColumns(): void {
  const rows = db.prepare(`pragma table_info(pdf_template_fields)`).all() as Array<{ name: string }>;
  const names = new Set(rows.map((r) => r.name));

  if (!names.has('font_size')) {
    db.exec(`alter table pdf_template_fields add column font_size real default 12`);
  }
  if (!names.has('group_id')) {
    db.exec(`alter table pdf_template_fields add column group_id text`);
  }
  if (!names.has('group_value')) {
    db.exec(`alter table pdf_template_fields add column group_value text`);
  }
  if (!names.has('parent_field_id')) {
    db.exec(`alter table pdf_template_fields add column parent_field_id text`);
  }
}

/**
 * Convert any absolute PDF paths stored in pdf_templates to paths relative to
 * config.dataPath. Runs once on startup — skips rows that are already relative.
 */
function normalizeTemplatePaths(): void {
  const rows = db
    .prepare(`select id, source_pdf_path, acroform_pdf_path from pdf_templates`)
    .all() as Array<{ id: string; source_pdf_path: string; acroform_pdf_path: string | null }>;

  const prefix = config.dataPath + path.sep;

  const updateSource = db.prepare(`update pdf_templates set source_pdf_path = ? where id = ?`);
  const updateAcroform = db.prepare(`update pdf_templates set acroform_pdf_path = ? where id = ?`);

  for (const row of rows) {
    if (row.source_pdf_path?.startsWith(prefix)) {
      updateSource.run(row.source_pdf_path.slice(prefix.length), row.id);
    }
    if (row.acroform_pdf_path?.startsWith(prefix)) {
      updateAcroform.run(row.acroform_pdf_path.slice(prefix.length), row.id);
    }
  }
}

function ensureSubmissionColumns(): void {
  const rows = db.prepare(`pragma table_info(submissions)`).all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));

  if (!names.has('template_id')) {
    db.exec(`alter table submissions add column template_id text`);
  }
  if (!names.has('template_version_num')) {
    db.exec(`alter table submissions add column template_version_num integer`);
  }
  if (!names.has('responses_json')) {
    db.exec(`alter table submissions add column responses_json text not null default '{}'`);
  }
  if (!names.has('completed_pdf_path')) {
    db.exec(`alter table submissions add column completed_pdf_path text`);
  }
}

function ensurePatientImportColumns(): void {
  const rows = db.prepare(`pragma table_info(patients)`).all() as Array<{ name: string }>;
  const names = new Set(rows.map((r) => r.name));

  const add = (col: string, ddl: string) => {
    if (!names.has(col)) {
      db.exec(`alter table patients add column ${ddl}`);
      names.add(col);
    }
  };

  add('external_patient_key', 'external_patient_key text');
  add('patient_acct_no', 'patient_acct_no text');
  add('import_source', 'import_source text');
  add('imported_at', 'imported_at text');

  db.exec(
    `create unique index if not exists idx_patients_practice_external_key on patients(practice_id, external_patient_key) where external_patient_key is not null`,
  );
}

function ensureAppointmentsTable(): void {
  db.exec(`
    create table if not exists appointments (
      id text primary key,
      practice_id text not null,
      patient_id text not null,
      external_appointment_key text,
      appointment_date text,
      appointment_time text,
      visit_type_raw text,
      visit_reason text,
      provider_name text,
      facility_name text,
      import_source text,
      imported_at text,
      created_at text not null,
      updated_at text not null,
      foreign key(patient_id) references patients(id) on delete cascade,
      foreign key(practice_id) references practices(id)
    );

    create index if not exists idx_appointments_patient on appointments(patient_id);
    create index if not exists idx_appointments_practice_created on appointments(practice_id, created_at);
    create unique index if not exists idx_appointments_practice_external
      on appointments(practice_id, external_appointment_key) where external_appointment_key is not null;
  `);
}

/** Move appointment fields from legacy patients columns into appointments, then drop those columns. */
function migrateLegacyPatientAppointmentColumns(): void {
  const cols = db.prepare(`pragma table_info(patients)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('next_appointment_date') && !names.has('appointment_visit_type')) {
    return;
  }

  try {
    db.exec(`
      insert into appointments (
        id, practice_id, patient_id, external_appointment_key,
        appointment_date, appointment_time, visit_type_raw, visit_reason,
        provider_name, facility_name, import_source, imported_at, created_at, updated_at
      )
      select lower(hex(randomblob(16))), practice_id, id,
             'legacy:' || id,
             nullif(trim(next_appointment_date), ''),
             nullif(trim(next_appointment_time), ''),
             nullif(trim(appointment_visit_type), ''),
             nullif(trim(appointment_visit_reason), ''),
             nullif(trim(appointment_provider_name), ''),
             nullif(trim(appointment_facility_name), ''),
             import_source, imported_at, created_at, updated_at
      from patients
      where (
        nullif(trim(next_appointment_date), '') is not null
        or nullif(trim(next_appointment_time), '') is not null
        or nullif(trim(appointment_visit_type), '') is not null
        or nullif(trim(appointment_visit_reason), '') is not null
        or nullif(trim(appointment_provider_name), '') is not null
        or nullif(trim(appointment_facility_name), '') is not null
      )
        and not exists (select 1 from appointments a where a.external_appointment_key = 'legacy:' || patients.id)
    `);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[migrate] legacy patient appointment copy failed:', err);
    return;
  }

  for (const col of [
    'next_appointment_date',
    'next_appointment_time',
    'appointment_visit_type',
    'appointment_visit_reason',
    'appointment_provider_name',
    'appointment_facility_name',
  ]) {
    if (!names.has(col)) continue;
    try {
      db.exec(`alter table patients drop column ${col}`);
    } catch {
      // SQLite without drop column support or column already removed
    }
  }
}
