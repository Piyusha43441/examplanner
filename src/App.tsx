import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedFeatureGate } from './components/ProtectedFeatureGate';
import { PublicFooter } from './components/PublicFooter';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ExamWorkspaceProvider } from './context/ExamWorkspaceContext';
import { SubscriptionProvider } from './context/SubscriptionContext';
import { AboutFounderPage } from './pages/AboutFounderPage';
import { AdminPanelPage } from './pages/AdminPanelPage';
import { AuthPage } from './pages/AuthPage';
import { ClassroomSetupPage } from './pages/ClassroomSetupPage';
import { CreateExamPage } from './pages/CreateExamPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExamHistoryPage } from './pages/ExamHistoryPage';
import { GeneratedPlansPage } from './pages/GeneratedPlansPage';
import { GuidePage } from './pages/GuidePage';
import { InstitutionProfilePage } from './pages/InstitutionProfilePage';
import { PdfReportsPage } from './pages/PdfReportsPage';
import { SeatingPlannerPage } from './pages/SeatingPlannerPage';
import { SettingsPage } from './pages/SettingsPage';
import { StudentDataPage } from './pages/StudentDataPage';
import { SubscribePage } from './pages/SubscribePage';

function AppRoutes() {
  const { firebaseUser, userProfile, institution, authReady, loadingProfile } = useAuth();

  if (!authReady || (firebaseUser && loadingProfile && !institution)) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-600">
          <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
          <div className="text-sm font-medium">Loading EXAM PLANNER workspace...</div>
        </div>
        <PublicFooter />
      </div>
    );
  }

  if (!firebaseUser || !userProfile || !institution) {
    return (
      <Routes>
        <Route path="/about" element={<AboutFounderPage isPublicView />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="*" element={<AuthPage />} />
      </Routes>
    );
  }

  return (
    <SubscriptionProvider>
      <ExamWorkspaceProvider>
        <AppLayout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route
              path="/create-exam"
              element={
                <ProtectedFeatureGate featureName="Create Examination" allowReadOnlyHistoryNotice>
                  <CreateExamPage />
                </ProtectedFeatureGate>
              }
            />
            <Route
              path="/students"
              element={
                <ProtectedFeatureGate featureName="Student Data Manager" allowReadOnlyHistoryNotice>
                  <StudentDataPage />
                </ProtectedFeatureGate>
              }
            />
            <Route
              path="/classrooms"
              element={
                <ProtectedFeatureGate featureName="Classroom Setup" allowReadOnlyHistoryNotice>
                  <ClassroomSetupPage />
                </ProtectedFeatureGate>
              }
            />
            <Route
              path="/planner"
              element={
                <ProtectedFeatureGate featureName="Seating Planner" allowReadOnlyHistoryNotice>
                  <SeatingPlannerPage />
                </ProtectedFeatureGate>
              }
            />
            <Route path="/plans" element={<GeneratedPlansPage />} />
            <Route
              path="/reports"
              element={
                <ProtectedFeatureGate featureName="PDF Reports & Exports" allowReadOnlyHistoryNotice>
                  <PdfReportsPage />
                </ProtectedFeatureGate>
              }
            />
            <Route path="/history" element={<ExamHistoryPage />} />
            <Route path="/subscribe" element={<SubscribePage />} />
            <Route path="/admin" element={<AdminPanelPage />} />
            <Route path="/profile" element={<InstitutionProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/about" element={<AboutFounderPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      </ExamWorkspaceProvider>
    </SubscriptionProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
