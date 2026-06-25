import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const TOTAL_STEPS = 8;

const STEP_TITLES = [
  'Patient Information',
  'Guardian 1',
  'Guardian 2',
  'Insurance',
  'Medical History',
  'HIPAA Authorization',
  'Financial Policy',
  'Consent & Authorization',
];

type FormState = Record<string, unknown>;

export function ParentEnrollPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function update(name: string, value: unknown) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function validateStep(): string {
    if (step === 1) {
      if (!String(form.patient_first_name ?? '').trim()) return 'Patient first name is required.';
      if (!String(form.patient_last_name ?? '').trim()) return 'Patient last name is required.';
      if (!String(form.patient_dob ?? '').trim()) return 'Patient date of birth is required.';
    }
    return '';
  }

  function next() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError('');
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function back() {
    setError('');
    setStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    setError('');
    setLoading(true);
    try {
      await api('/api/patient-portal/enroll', {
        method: 'POST',
        body: JSON.stringify({ responses: form }),
      });
      setDone(true);
    } catch (err) {
      setError((err as Error).message || 'Submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="patient-portal-page">
        <div className="patient-portal-shell">
          <div className="patient-portal-card" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 16, color: '#16a34a' }}>✓</div>
            <h2 style={{ color: '#166534', margin: '0 0 10px' }}>Registration Submitted!</h2>
            <p style={{ color: '#374151', marginBottom: 28 }}>
              Your registration has been received. Our office will review it and contact you to complete setup.
            </p>
            <button
              className="patient-portal-submit"
              style={{ width: 'auto', padding: '12px 32px' }}
              onClick={() => navigate('/parent/login')}
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="patient-portal-page"
      style={{ alignItems: 'flex-start', paddingTop: 24, paddingBottom: 40 }}
    >
      <div style={{ width: '100%', maxWidth: 640, margin: '0 auto', padding: '0 16px' }}>
        {/* Header card */}
        <div className="patient-portal-card" style={{ marginBottom: 12, padding: '20px 24px' }}>
          <div className="brand-kicker text-center">PediForm Pro</div>
          <h1 style={{ textAlign: 'center', marginTop: 4, marginBottom: 4, fontSize: 22, fontWeight: 700 }}>
            New Patient Registration
          </h1>
          <p style={{ textAlign: 'center', color: '#6b7280', margin: '0 0 14px', fontSize: 14 }}>
            Step {step} of {TOTAL_STEPS} — {STEP_TITLES[step - 1]}
          </p>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 12 }}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                style={{
                  width: i + 1 === step ? 22 : 10,
                  height: 10,
                  borderRadius: 99,
                  background: i + 1 <= step ? '#1d4ed8' : '#e5e7eb',
                  opacity: i + 1 < step ? 0.5 : 1,
                  transition: 'all 0.25s',
                }}
              />
            ))}
          </div>
          <div style={{ height: 5, background: '#e5e7eb', borderRadius: 99 }}>
            <div
              style={{
                height: 5,
                background: 'linear-gradient(90deg, #1d4ed8, #3b82f6)',
                borderRadius: 99,
                width: `${(step / TOTAL_STEPS) * 100}%`,
                transition: 'width 0.35s ease',
              }}
            />
          </div>
        </div>

        {/* Step content */}
        <div className="patient-portal-card" style={{ marginBottom: 12 }}>
          {step === 1 && <StepPatientInfo form={form} update={update} />}
          {step === 2 && <StepGuardian1 form={form} update={update} />}
          {step === 3 && <StepGuardian2 form={form} update={update} />}
          {step === 4 && <StepInsurance form={form} update={update} />}
          {step === 5 && <StepMedical form={form} update={update} />}
          {step === 6 && <StepHipaa form={form} update={update} />}
          {step === 7 && <StepFinancial form={form} update={update} />}
          {step === 8 && <StepConsent form={form} update={update} />}
        </div>

        {error && (
          <div className="patient-portal-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 1 && (
            <button
              onClick={back}
              style={{
                flex: '0 0 120px',
                padding: '13px 0',
                borderRadius: 10,
                border: '1.5px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}
          {step < TOTAL_STEPS ? (
            <button className="patient-portal-submit" style={{ flex: 1, margin: 0 }} onClick={next}>
              Continue →
            </button>
          ) : (
            <button
              className="patient-portal-submit"
              style={{ flex: 1, margin: 0 }}
              onClick={submit}
              disabled={loading}
            >
              {loading ? 'Submitting…' : 'Submit Registration'}
            </button>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#9ca3af' }}>
          Already registered?{' '}
          <Link to="/parent/login" style={{ color: '#1d4ed8', fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

type FP = { form: FormState; update: (k: string, v: unknown) => void };

function FInput({
  label,
  name,
  form,
  update,
  type = 'text',
  required = false,
  placeholder,
}: FP & { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div className="patient-portal-field" style={{ marginBottom: 10 }}>
      <label htmlFor={name}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        id={name}
        type={type}
        required={required}
        placeholder={placeholder}
        value={String(form[name] ?? '')}
        onChange={(e) => update(name, e.target.value)}
      />
    </div>
  );
}

function FTextarea({ label, name, form, update }: FP & { label: string; name: string }) {
  return (
    <div className="patient-portal-field" style={{ marginBottom: 10 }}>
      <label htmlFor={name}>{label}</label>
      <textarea
        id={name}
        rows={3}
        value={String(form[name] ?? '')}
        onChange={(e) => update(name, e.target.value)}
        style={{
          resize: 'vertical',
          border: '1px solid #d1d5db',
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: 15,
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

function FRadio({
  label,
  name,
  options,
  form,
  update,
}: FP & { label: string; name: string; options: string[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
        {options.map((opt) => (
          <label
            key={opt}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}
          >
            <input type="radio" name={name} checked={form[name] === opt} onChange={() => update(name, opt)} />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );
}

function FCheckboxes({
  label,
  name,
  options,
  form,
  update,
}: FP & { label: string; name: string; options: string[] }) {
  const selected = (form[name] as string[] | undefined) ?? [];
  function toggle(opt: string) {
    const next = selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt];
    update(name, next);
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
        {options.map((opt) => (
          <label
            key={opt}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}
          >
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );
}

function FCheckbox({ label, name, form, update }: FP & { label: string; name: string }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        marginBottom: 14,
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <input
        type="checkbox"
        checked={Boolean(form[name])}
        onChange={(e) => update(name, e.target.checked)}
        style={{ marginTop: 2, flexShrink: 0 }}
      />
      <span>{label}</span>
    </label>
  );
}

function FSignature({ label, name, form, update }: FP & { label: string; name: string }) {
  return (
    <div className="patient-portal-field" style={{ marginBottom: 10 }}>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="text"
        placeholder="Type full legal name as your electronic signature"
        value={String(form[name] ?? '')}
        onChange={(e) => update(name, e.target.value)}
        style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontStyle: 'italic' }}
      />
      <small style={{ color: '#6b7280', fontSize: 11, display: 'block', marginTop: 2 }}>
        Typing your name constitutes an electronic signature.
      </small>
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>{children}</div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        color: '#1d4ed8',
        fontWeight: 700,
        fontSize: 14,
        margin: '20px 0 10px',
        borderBottom: '1px solid #e5e7eb',
        paddingBottom: 5,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </h3>
  );
}

// ── Step 1: Patient Information ───────────────────────────────────────────────
function StepPatientInfo({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: '#111827', fontSize: 18 }}>Patient Information</h2>
      <Row2>
        <FInput label="Last Name" name="patient_last_name" form={form} update={update} required />
        <FInput label="First Name" name="patient_first_name" form={form} update={update} required />
        <FInput label="Middle Initial" name="patient_middle_initial" form={form} update={update} />
        <FInput label="Date of Birth" name="patient_dob" type="date" form={form} update={update} required />
        <FInput label="Social Security #" name="patient_ssn" form={form} update={update} placeholder="XXX-XX-XXXX" />
        <FInput label="Home Phone" name="patient_home_phone" form={form} update={update} />
      </Row2>
      <FRadio label="Sex" name="patient_sex" options={['Male', 'Female']} form={form} update={update} />
      <Row2>
        <FInput label="Address" name="patient_address" form={form} update={update} />
        <FInput label="Apt #" name="patient_apt" form={form} update={update} />
        <FInput label="City" name="patient_city" form={form} update={update} />
        <FInput label="State" name="patient_state" form={form} update={update} />
        <FInput label="Zip Code" name="patient_zip" form={form} update={update} />
      </Row2>
      <SectionTitle>Emergency Contact</SectionTitle>
      <Row2>
        <FInput label="Name" name="emergency_name" form={form} update={update} />
        <FInput label="Relationship" name="emergency_relationship" form={form} update={update} />
        <FInput label="Phone Number" name="emergency_phone" form={form} update={update} />
      </Row2>
    </>
  );
}

// ── Step 2: Guardian 1 ────────────────────────────────────────────────────────
function StepGuardian1({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: '#111827', fontSize: 18 }}>Guardian 1</h2>
      <FRadio
        label="Legal Guardian Type"
        name="guardian1_type"
        options={['Mother', 'Father', 'Other']}
        form={form}
        update={update}
      />
      <Row2>
        <FInput label="Full Name" name="guardian1_name" form={form} update={update} />
        <FInput label="Date of Birth" name="guardian1_dob" type="date" form={form} update={update} />
        <FInput label="SSN" name="guardian1_ssn" form={form} update={update} placeholder="XXX-XX-XXXX" />
        <FInput label="Email Address" name="guardian1_email" type="email" form={form} update={update} />
        <FInput label="Home Phone" name="guardian1_home_phone" form={form} update={update} />
        <FInput label="Work Phone" name="guardian1_work_phone" form={form} update={update} />
        <FInput label="Cell Phone" name="guardian1_cell" form={form} update={update} />
        <FInput label="Other Phone" name="guardian1_other_phone" form={form} update={update} />
      </Row2>
      <FRadio
        label="Marital Status"
        name="guardian1_marital_status"
        options={['Single', 'Married', 'Separated', 'Divorced', 'Widowed']}
        form={form}
        update={update}
      />
      <Row2>
        <FInput label="Address" name="guardian1_address" form={form} update={update} />
        <FInput label="City" name="guardian1_city" form={form} update={update} />
        <FInput label="State" name="guardian1_state" form={form} update={update} />
        <FInput label="Zip" name="guardian1_zip" form={form} update={update} />
      </Row2>
    </>
  );
}

// ── Step 3: Guardian 2 ────────────────────────────────────────────────────────
function StepGuardian2({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 4, color: '#111827', fontSize: 18 }}>Guardian 2</h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>Optional — leave blank if not applicable.</p>
      <FRadio
        label="Legal Guardian Type"
        name="guardian2_type"
        options={['Mother', 'Father', 'Other']}
        form={form}
        update={update}
      />
      <Row2>
        <FInput label="Full Name" name="guardian2_name" form={form} update={update} />
        <FInput label="Date of Birth" name="guardian2_dob" type="date" form={form} update={update} />
        <FInput label="SSN" name="guardian2_ssn" form={form} update={update} placeholder="XXX-XX-XXXX" />
        <FInput label="Email Address" name="guardian2_email" type="email" form={form} update={update} />
        <FInput label="Home Phone" name="guardian2_home_phone" form={form} update={update} />
        <FInput label="Work Phone" name="guardian2_work_phone" form={form} update={update} />
        <FInput label="Cell Phone" name="guardian2_cell" form={form} update={update} />
        <FInput label="Other Phone" name="guardian2_other_phone" form={form} update={update} />
      </Row2>
      <FRadio
        label="Marital Status"
        name="guardian2_marital_status"
        options={['Single', 'Married', 'Separated', 'Divorced', 'Widowed']}
        form={form}
        update={update}
      />
      <Row2>
        <FInput label="Address" name="guardian2_address" form={form} update={update} />
        <FInput label="City" name="guardian2_city" form={form} update={update} />
        <FInput label="State" name="guardian2_state" form={form} update={update} />
        <FInput label="Zip" name="guardian2_zip" form={form} update={update} />
      </Row2>
    </>
  );
}

// ── Step 4: Insurance ─────────────────────────────────────────────────────────
function StepInsurance({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: '#111827', fontSize: 18 }}>Insurance Information</h2>
      <SectionTitle>Primary Insurance</SectionTitle>
      <Row2>
        <FInput label="Insurance Company" name="primary_insurance_company" form={form} update={update} />
        <FInput label="Policyholder Name" name="primary_policyholder" form={form} update={update} />
        <FInput label="Policyholder DOB" name="primary_policyholder_dob" type="date" form={form} update={update} />
        <FInput label="Member ID" name="primary_member_id" form={form} update={update} />
        <FInput label="Group Number" name="primary_group_number" form={form} update={update} />
        <FInput label="Insurance Phone" name="primary_insurance_phone" form={form} update={update} />
      </Row2>
      <SectionTitle>Secondary Insurance</SectionTitle>
      <Row2>
        <FInput label="Insurance Company" name="secondary_insurance_company" form={form} update={update} />
        <FInput label="Policyholder Name" name="secondary_policyholder" form={form} update={update} />
        <FInput label="Policyholder DOB" name="secondary_policyholder_dob" type="date" form={form} update={update} />
        <FInput label="Member ID" name="secondary_member_id" form={form} update={update} />
        <FInput label="Group Number" name="secondary_group_number" form={form} update={update} />
      </Row2>
    </>
  );
}

// ── Step 5: Medical History ───────────────────────────────────────────────────
function StepMedical({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: '#111827', fontSize: 18 }}>Medical History</h2>
      <FInput label="Information Provided By" name="medical_info_by" form={form} update={update} />
      <FTextarea label="Reason for Visit" name="reason_for_visit" form={form} update={update} />
      <FTextarea label="Current Medications (name, dose, frequency)" name="current_medications" form={form} update={update} />
      <FInput label="Medication Allergies" name="allergy_medications" form={form} update={update} />
      <FInput label="Food Allergies" name="allergy_foods" form={form} update={update} />
      <FInput label="Other Allergies" name="allergy_other" form={form} update={update} />
    </>
  );
}

// ── Step 6: HIPAA ─────────────────────────────────────────────────────────────
function StepHipaa({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: '#111827', fontSize: 18 }}>
        HIPAA Authorization / Release of Information
      </h2>
      <Row2>
        <FInput label="Patient Name" name="hipaa_patient_name" form={form} update={update} />
        <FInput label="Patient Date of Birth" name="hipaa_patient_dob" type="date" form={form} update={update} />
        <FInput label="SSN" name="hipaa_ssn" form={form} update={update} />
        <FInput label="Telephone" name="hipaa_phone" form={form} update={update} />
      </Row2>
      <FTextarea
        label="Release From (Physician / Agency Name and Address)"
        name="hipaa_release_from"
        form={form}
        update={update}
      />
      <FTextarea
        label="Released To (Physician / Agency Name and Address)"
        name="hipaa_released_to"
        form={form}
        update={update}
      />
      <FCheckboxes
        label="Type of Information to Release"
        name="hipaa_release_info"
        options={[
          'Entire Medical Record Set',
          'Progress Notes',
          'History / Physicals',
          'Lab / X-Ray Reports',
          'Growth Chart',
          'Immunizations',
          'Other',
        ]}
        form={form}
        update={update}
      />
      <FInput label="Other (specify)" name="hipaa_release_other" form={form} update={update} />
      <FCheckboxes
        label="Reason for Disclosure"
        name="hipaa_reason"
        options={[
          'Transfer of Care',
          'Relocation',
          'Insurance Change',
          'Insurance Eligibility / Benefits',
          'Legal Investigation',
          'Personal Use',
          'Other',
        ]}
        form={form}
        update={update}
      />
      <FInput label="Other Reason (specify)" name="hipaa_reason_other" form={form} update={update} />
      <FSignature
        label="Patient / Legal Guardian Signature"
        name="hipaa_signature"
        form={form}
        update={update}
      />
      <Row2>
        <FInput label="Signature Date" name="hipaa_signature_date" type="date" form={form} update={update} />
        <FInput label="Relationship to Patient" name="hipaa_relationship" form={form} update={update} />
      </Row2>
    </>
  );
}

// ── Step 7: Financial Policy ──────────────────────────────────────────────────
function StepFinancial({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: '#111827', fontSize: 18 }}>
        Financial Policy & Authorizations
      </h2>

      <SectionTitle>Insurance Authorization</SectionTitle>
      <Row2>
        <FInput label="Patient Name" name="insurance_auth_patient_name" form={form} update={update} />
        <FInput
          label="Patient Date of Birth"
          name="insurance_auth_patient_dob"
          type="date"
          form={form}
          update={update}
        />
        <FInput label="Parent / Guardian Name" name="insurance_auth_parent_name" form={form} update={update} />
        <FInput label="Relationship to Patient" name="insurance_auth_relationship" form={form} update={update} />
      </Row2>
      <FSignature label="Signature" name="insurance_auth_signature" form={form} update={update} />
      <FInput label="Date" name="insurance_auth_date" type="date" form={form} update={update} />

      <SectionTitle>Text Message / Email Authorization</SectionTitle>
      <Row2>
        <FInput label="Email Address" name="text_email" type="email" form={form} update={update} />
        <FInput label="Cell Phone for Texting" name="text_cell" form={form} update={update} />
        <FInput label="Patient Name" name="text_patient_name" form={form} update={update} />
        <FInput label="Patient DOB" name="text_patient_dob" type="date" form={form} update={update} />
        <FInput label="Print Name" name="text_print_name" form={form} update={update} />
        <FInput label="Relationship to Patient" name="text_relationship" form={form} update={update} />
        <FInput label="Date" name="text_date" type="date" form={form} update={update} />
      </Row2>
      <FSignature label="Signature" name="text_signature" form={form} update={update} />

      <SectionTitle>Financial Policy</SectionTitle>
      <FCheckbox
        label="I acknowledge that I received a copy of the practice's financial policy and agree to the terms of payment due at the time of service."
        name="financial_policy_ack"
        form={form}
        update={update}
      />
      <Row2>
        <FInput label="Parent / Legal Guardian Name" name="financial_parent_name" form={form} update={update} />
        <FInput label="Date" name="financial_date" type="date" form={form} update={update} />
      </Row2>
      <FSignature label="Signature of Parent / Legal Guardian" name="financial_signature" form={form} update={update} />

      <SectionTitle>Credit Card Authorization</SectionTitle>
      <Row2>
        <FInput label="Patient Name" name="card_patient_name" form={form} update={update} />
        <FInput label="Patient DOB" name="card_patient_dob" type="date" form={form} update={update} />
      </Row2>
      <FCheckbox
        label="I authorize the practice to charge patient-responsible balances to a card on file, including co-pays, deductibles, co-insurance, and non-covered services."
        name="card_on_file_ack"
        form={form}
        update={update}
      />
      <Row2>
        <FInput label="Printed Name of Parent or Guardian" name="card_parent_name" form={form} update={update} />
        <FInput label="Date" name="card_date" type="date" form={form} update={update} />
      </Row2>
      <FSignature label="Signature of Parent or Guardian" name="card_signature" form={form} update={update} />
    </>
  );
}

// ── Step 8: Consent & Non-Parent Authorization ────────────────────────────────
function StepConsent({ form, update }: FP) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: '#111827', fontSize: 18 }}>
        Consent & Authorization
      </h2>

      <SectionTitle>Informed Consent for Assessment and Treatment</SectionTitle>
      <Row2>
        <FInput label="Name" name="consent_name" form={form} update={update} />
        <FInput label="Date of Birth" name="consent_dob" type="date" form={form} update={update} />
      </Row2>
      <FCheckbox
        label="I voluntarily request and consent to medical assessment, care, treatment, and services for the patient named above, and authorize the disclosure of health information as necessary to provide care."
        name="informed_consent_ack"
        form={form}
        update={update}
      />
      <FSignature label="Client Signature" name="client_signature" form={form} update={update} />
      <FInput
        label="Client Signature Date"
        name="client_signature_date"
        type="date"
        form={form}
        update={update}
      />
      <FSignature
        label="Parent / Guardian Signature (for minor patient)"
        name="guardian_consent_signature"
        form={form}
        update={update}
      />
      <FInput
        label="Parent / Guardian Signature Date"
        name="guardian_consent_date"
        type="date"
        form={form}
        update={update}
      />

      <SectionTitle>Non-Parent Authorization</SectionTitle>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
        Complete if someone other than a parent may bring the patient to appointments.
      </p>
      <Row2>
        <FInput label="Your Name" name="nonparent_name" form={form} update={update} />
        <FInput label="Patient Name" name="nonparent_patient_name" form={form} update={update} />
        <FInput label="Patient DOB" name="nonparent_patient_dob" type="date" form={form} update={update} />
        <FInput label="Your DOB" name="nonparent_parent_dob" type="date" form={form} update={update} />
      </Row2>
      <FRadio
        label="Your Relationship to Patient"
        name="nonparent_relationship"
        options={['Mother', 'Father', 'Legal Guardian']}
        form={form}
        update={update}
      />
      <FTextarea
        label="Name of Person(s) Authorized to Bring Patient to Appointments"
        name="authorized_person"
        form={form}
        update={update}
      />
      <FInput label="Their Phone Number" name="authorized_person_phone" form={form} update={update} />
      <FTextarea label="Additional Authorized Person (name)" name="additional_authorized_person" form={form} update={update} />
      <FInput label="Additional Authorized Person Phone" name="additional_authorized_phone" form={form} update={update} />
      <FSignature label="Your Signature" name="nonparent_signature" form={form} update={update} />
      <FInput label="Date" name="nonparent_date" type="date" form={form} update={update} />
    </>
  );
}
