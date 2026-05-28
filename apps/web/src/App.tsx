import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppNav } from './components/AppNav';
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
import {
  clearStaffSession,
  getStaffSession,
  hydrateStaffSession,
  setStaffSession,
  staffSessionFromAuth,
  type StaffSession,
} from './lib/staffSession';
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
import { useEffect, useState } from 'react';

// VITE_APP_MODE: 'admin' | 'patient' | undefined (both)
const APP_MODE = import.meta.env.VITE_APP_MODE as string | undefined;
const isAdminOnly = APP_MODE === 'admin';
const isPatientOnly = APP_MODE === 'patient';

export function App() {
  const [patientSession, setPatientSession] = useState<PatientSession | null>(() => getPatientSession());
  const [staffSession, setStaffSessionState] = useState<StaffSession | null>(() => getStaffSession());

  useEffect(() => {
    const existing = getStaffSession();
    if (!existing?.token) return;
    void hydrateStaffSession(existing.token).then((fresh) => {
      if (fresh) setStaffSessionState(fresh);
      else if (existing.email) setStaffSessionState(existing);
    });
  }, []);

  function onPatientSession() {
    setPatientSession(getPatientSession());
  }

  function onStaffAuth(
    token: string,
    user: {
      email: string;
      role: string;
      org_name?: string;
      practice_name?: string;
      location_name?: string | null;
    },
  ) {
    const session = staffSessionFromAuth(token, user);
    setStaffSession(session);
    setStaffSessionState(session);
  }

  function logout() {
    setPatientSession(null);
    setStaffSessionState(null);
    clearPatientSession();
    clearStaffSession();
  }

  const rootRedirect = isPatientOnly
    ? <Navigate to="/parent/login" replace />
    : <HomePage />;

  return (
    <>
      <AppNav
        patientSession={patientSession}
        staffSession={staffSession}
        onLogout={logout}
        appMode={APP_MODE}
      />
      <Routes>
        <Route path="/" element={rootRedirect} />

        {/* Patient login/dashboard — accessible in all modes */}
        <Route path="/parent/login" element={<ParentLoginPage onPatientSession={onPatientSession} />} />
        <Route
          path="/parent/dashboard"
          element={<PatientFamilyDashboard onSessionChange={setPatientSession} />}
        />
        <Route path="/parent/forms" element={<Navigate to="/parent/dashboard" replace />} />

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
          </>
        )}

        {!isPatientOnly && (
          <>
            <Route
              path="/staff/login"
              element={
                <StaffLoginPage
                  onAuthenticated={(token, user) => onStaffAuth(token, user)}
                />
              }
            />
            <Route
              path="/staff/register"
              element={
                <StaffRegisterPage
                  onAuthenticated={(token, user) => onStaffAuth(token, user)}
                />
              }
            />
            <Route path="/staff/patients" element={<StaffPatientsPage token={staffSession?.token ?? null} />} />
            <Route path="/staff/assignments" element={<StaffAssignmentsPage token={staffSession?.token ?? null} />} />
            <Route path="/staff/submissions" element={<StaffSubmissionsPage token={staffSession?.token ?? null} />} />
            <Route path="/staff/patients/:id" element={<StaffPatientDetailPage token={staffSession?.token ?? null} />} />
            <Route path="/staff/templates" element={<StaffTemplatesPage token={staffSession?.token ?? null} />} />
            <Route path="/staff/templates/:id/editor" element={<StaffTemplateEditorPage token={staffSession?.token ?? null} />} />
          </>
        )}

        <Route path="/:practice/fill/portal/:token" element={<PatientPortalPage />} />
        <Route path="/:practice/fill/bundle/:token" element={<BundleVerifyPage />} />
        <Route path="/:practice/fill/:token" element={<AssignmentVerifyPage />} />
        <Route path="/fill/portal/:token" element={<PatientPortalPage />} />
        <Route path="/fill/bundle/:token" element={<BundleVerifyPage />} />
        <Route path="/fill/:token" element={<AssignmentVerifyPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function RedirectToPatientSignIn() {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/parent/login?practice=${slug ?? ''}`} replace />;
}
