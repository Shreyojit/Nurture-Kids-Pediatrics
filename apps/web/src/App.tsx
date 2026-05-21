import { Navigate, Route, Routes } from 'react-router-dom';
import { AppNav } from './components/AppNav';
import { getLocal, removeLocal, setLocal } from './lib/storage';
import { AssignmentVerifyPage } from './pages/AssignmentVerifyPage';
import { BundleVerifyPage } from './pages/BundleVerifyPage';
import { PatientPortalPage } from './pages/PatientPortalPage';
import { HomePage } from './pages/HomePage';
import { ParentConfirmationPage } from './pages/ParentConfirmationPage';
import { ParentCreateAccountPage } from './pages/ParentCreateAccountPage';
import { ParentDashboardPage } from './pages/ParentDashboardPage';
import { ParentFormPage } from './pages/ParentFormPage';
import { PdfFillPage } from './pages/PdfFillPage';
import { ParentFormsPage } from './pages/ParentFormsPage';
import { ParentLoginPage } from './pages/ParentLoginPage';
import { ParentOverviewPage } from './pages/ParentOverviewPage';
import { ParentStartPage } from './pages/ParentStartPage';
import { StaffLoginPage } from './pages/StaffLoginPage';
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
const DEFAULT_SLUG = 'sunshine-pediatrics';

export function App() {
  const [parentToken, setParentToken] = useState<string | null>(() => getLocal('pediform_parent_token', null));
  const [staffToken, setStaffToken] = useState<string | null>(() => getLocal('pediform_staff_token', null));

  function onParentAuth(token: string) {
    setParentToken(token);
    setLocal('pediform_parent_token', token);
  }

  function onStaffAuth(token: string) {
    setStaffToken(token);
    setLocal('pediform_staff_token', token);
  }

  function logout() {
    setParentToken(null);
    setStaffToken(null);
    removeLocal('pediform_parent_token');
    removeLocal('pediform_staff_token');
  }

  // Determine the root redirect based on mode
  const rootRedirect = isAdminOnly
    ? <Navigate to="/staff/login" replace />
    : isPatientOnly
      ? <Navigate to={`/p/${DEFAULT_SLUG}`} replace />
      : <HomePage />;

  return (
    <>
      <AppNav parentToken={parentToken} staffToken={staffToken} onLogout={logout} appMode={APP_MODE} />
      <Routes>
        <Route path="/" element={rootRedirect} />

        {/* Patient routes — hidden in admin-only mode */}
        {!isAdminOnly && (
          <>
            <Route path="/p/:slug" element={<ParentStartPage parentToken={parentToken} />} />
            <Route path="/p/:slug/session/:sessionId/overview" element={<ParentOverviewPage />} />
            <Route path="/p/:slug/session/:sessionId/form/:formId/step/:step" element={<ParentFormPage />} />
            <Route path="/p/:slug/session/:sessionId/pdf-form" element={<PdfFillPage />} />
            <Route path="/p/:slug/session/:sessionId/confirmation" element={<ParentConfirmationPage />} />
            <Route
              path="/p/:slug/session/:sessionId/create-account"
              element={<ParentCreateAccountPage onAuthenticated={onParentAuth} />}
            />
            <Route path="/parent/login" element={<ParentLoginPage onAuthenticated={onParentAuth} />} />
            <Route path="/parent/forms" element={<ParentFormsPage token={parentToken} />} />
            <Route path="/parent/dashboard" element={<ParentDashboardPage token={parentToken} />} />
          </>
        )}

        {/* Staff routes — hidden in patient-only mode */}
        {!isPatientOnly && (
          <>
            <Route path="/staff/login" element={<StaffLoginPage onAuthenticated={onStaffAuth} />} />
            <Route path="/staff/patients" element={<StaffPatientsPage token={staffToken} />} />
            <Route path="/staff/assignments" element={<StaffAssignmentsPage token={staffToken} />} />
            <Route path="/staff/submissions" element={<StaffSubmissionsPage token={staffToken} />} />
            <Route path="/staff/patients/:id" element={<StaffPatientDetailPage token={staffToken} />} />
            <Route path="/staff/templates" element={<StaffTemplatesPage token={staffToken} />} />
            <Route path="/staff/templates/:id/editor" element={<StaffTemplateEditorPage token={staffToken} />} />
          </>
        )}

        {/* Assignment fill links — accessible in all modes */}
        <Route path="/fill/portal/:token" element={<PatientPortalPage />} />
        <Route path="/fill/bundle/:token" element={<BundleVerifyPage />} />
        <Route path="/fill/:token" element={<AssignmentVerifyPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
