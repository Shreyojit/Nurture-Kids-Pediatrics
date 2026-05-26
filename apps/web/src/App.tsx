import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppNav } from './components/AppNav';
import { getLocal, removeLocal, setLocal } from './lib/storage';
import { AssignmentVerifyPage } from './pages/AssignmentVerifyPage';
import { BundleVerifyPage } from './pages/BundleVerifyPage';
import { PatientPortalPage } from './pages/PatientPortalPage';
import { HomePage } from './pages/HomePage';
import { ParentConfirmationPage } from './pages/ParentConfirmationPage';
import { PatientFamilyDashboard } from './pages/PatientFamilyDashboard';
import { ParentFormPage } from './pages/ParentFormPage';
import { PdfFillPage } from './pages/PdfFillPage';
import { ParentLoginPage } from './pages/ParentLoginPage';
import { getPatientSession, clearPatientSession, type PatientSession } from './lib/patientSession';
import { ParentOverviewPage } from './pages/ParentOverviewPage';
import { ParentStartPage } from './pages/ParentStartPage';
import { StaffLoginPage } from './pages/StaffLoginPage';
import { StaffRegisterPage } from './pages/StaffRegisterPage';
import { StaffPatientDetailPage } from './pages/StaffPatientDetailPage';
import { StaffPatientsPage } from './pages/StaffPatientsPage';
import { StaffAssignmentsPage } from './pages/StaffAssignmentsPage';
import { StaffSubmissionsPage } from './pages/StaffSubmissionsPage';
import { StaffTemplateEditorPage } from './pages/StaffTemplateEditorPage';
import { StaffTemplatesPage } from './pages/StaffTemplatesPage';
import { useState } from 'react';

// VITE_APP_MODE: 'admin' | 'patient' | undefined (both)
const APP_MODE = import.meta.env.VITE_APP_MODE as string | undefined;
const isAdminOnly = APP_MODE === 'admin';
const isPatientOnly = APP_MODE === 'patient';

// Default practice slug for the patient portal landing
const DEFAULT_SLUG = 'nurturekidspediatrics';

export function App() {
  const [patientSession, setPatientSession] = useState<PatientSession | null>(() => getPatientSession());
  const [staffToken, setStaffToken] = useState<string | null>(() => getLocal('pediform_staff_token', null));
  const [staffPracticeName, setStaffPracticeName] = useState<string | null>(
    () => getLocal('pediform_staff_practice', null),
  );

  function onPatientSession() {
    setPatientSession(getPatientSession());
  }

  function onStaffAuth(token: string, practiceName: string) {
    setStaffToken(token);
    setStaffPracticeName(practiceName);
    setLocal('pediform_staff_token', token);
    setLocal('pediform_staff_practice', practiceName);
  }

  function logout() {
    setPatientSession(null);
    setStaffToken(null);
    setStaffPracticeName(null);
    clearPatientSession();
    removeLocal('pediform_staff_token');
    removeLocal('pediform_staff_practice');
  }

  // Determine the root redirect based on mode
  const rootRedirect = isAdminOnly
    ? <Navigate to="/staff/login" replace />
    : isPatientOnly
      ? <Navigate to="/parent/login" replace />
      : <HomePage />;

  return (
    <>
      <AppNav patientSession={patientSession} staffToken={staffToken} staffPracticeName={staffPracticeName} onLogout={logout} appMode={APP_MODE} />
      <Routes>
        <Route path="/" element={rootRedirect} />

        {/* Patient routes — hidden in admin-only mode */}
        {!isAdminOnly && (
          <>
            <Route path="/p/:slug/forms" element={<Navigate to="/parent/login" replace />} />
            <Route path="/parent/register" element={<ParentStartPage />} />
            <Route path="/p/:slug/register" element={<ParentStartPage />} />
            <Route path="/p/:slug" element={<RedirectToPatientSignIn />} />
            <Route path="/p/:slug/session/:sessionId/overview" element={<ParentOverviewPage />} />
            <Route path="/p/:slug/session/:sessionId/form/:formId/step/:step" element={<ParentFormPage />} />
            <Route path="/p/:slug/session/:sessionId/pdf-form" element={<PdfFillPage />} />
            <Route path="/p/:slug/session/:sessionId/confirmation" element={<ParentConfirmationPage />} />
            <Route path="/parent/login" element={<ParentLoginPage onPatientSession={onPatientSession} />} />
            <Route
              path="/parent/dashboard"
              element={<PatientFamilyDashboard onSessionChange={setPatientSession} />}
            />
            <Route path="/parent/forms" element={<Navigate to="/parent/dashboard" replace />} />
          </>
        )}

        {/* Staff routes — hidden in patient-only mode */}
        {!isPatientOnly && (
          <>
            <Route path="/staff/login" element={<StaffLoginPage onAuthenticated={onStaffAuth} />} />
            <Route path="/staff/register" element={<StaffRegisterPage onAuthenticated={onStaffAuth} />} />
            <Route path="/staff/patients" element={<StaffPatientsPage token={staffToken} />} />
            <Route path="/staff/assignments" element={<StaffAssignmentsPage token={staffToken} />} />
            <Route path="/staff/submissions" element={<StaffSubmissionsPage token={staffToken} />} />
            <Route path="/staff/patients/:id" element={<StaffPatientDetailPage token={staffToken} />} />
            <Route path="/staff/templates" element={<StaffTemplatesPage token={staffToken} />} />
            <Route path="/staff/templates/:id/editor" element={<StaffTemplateEditorPage token={staffToken} />} />
          </>
        )}

        {/* Assignment fill links — accessible in all modes */}
        {/* Practice-scoped URLs (new format: /:practice/fill/...) */}
        <Route path="/:practice/fill/portal/:token" element={<PatientPortalPage />} />
        <Route path="/:practice/fill/bundle/:token" element={<BundleVerifyPage />} />
        <Route path="/:practice/fill/:token" element={<AssignmentVerifyPage />} />
        {/* Legacy URLs without practice prefix — kept for backward compat */}
        <Route path="/fill/portal/:token" element={<PatientPortalPage />} />
        <Route path="/fill/bundle/:token" element={<BundleVerifyPage />} />
        <Route path="/fill/:token" element={<AssignmentVerifyPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
