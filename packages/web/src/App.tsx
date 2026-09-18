import { Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./app/session";
import { ProtectedRoute } from "./app/ProtectedRoute";
import { LeftPanelProvider } from "./app/LeftPanelContext";
import { LeftPanel } from "./app/LeftPanel";
import { ToastHost } from "./ui/Toast";
import { LoginPage } from "./features/auth/LoginPage";
import { SignupPage } from "./features/auth/SignupPage";
import { VerifyEmailPage } from "./features/auth/VerifyEmailPage";
import { OrgListPage } from "./features/org/OrgListPage";
import { OrgDashboardPage } from "./features/org/OrgDashboardPage";
import { VoidCreateWizardPage } from "./features/void/VoidCreateWizardPage";
import { VoidSettingsPage } from "./features/void/VoidSettingsPage";
import { CanvasPage } from "./canvas/CanvasPage";
import { AcceptInvitePage } from "./features/invite/AcceptInvitePage";
import { MyTasksPage } from "./features/myTasks/MyTasksPage";
import { AccountPage } from "./features/account/AccountPage";

export function App() {
  return (
    <SessionProvider>
      <LeftPanelProvider>
        {/* Rendered once, reachable from every authenticated page (including
            CanvasPage, which has its own header rather than AppShell's) —
            see app/LeftPanelContext.tsx. */}
        <LeftPanel />
        <ToastHost />
        <Routes>
          <Route path="/" element={<Navigate to="/orgs" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          {/* Public: handles its own unauthenticated state (login/signup with a
              redirect back here), since ProtectedRoute's blanket redirect would
              drop the ?token= query string. */}
          <Route path="/invite/accept" element={<AcceptInvitePage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/orgs" element={<OrgListPage />} />
            <Route path="/orgs/:orgId" element={<OrgDashboardPage />} />
            <Route path="/orgs/:orgId/my-tasks" element={<MyTasksPage />} />
            <Route path="/orgs/:orgId/voids/new" element={<VoidCreateWizardPage />} />
            <Route path="/orgs/:orgId/voids/:voidId/settings" element={<VoidSettingsPage />} />
            <Route path="/orgs/:orgId/voids/:voidId" element={<CanvasPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/orgs" replace />} />
        </Routes>
      </LeftPanelProvider>
    </SessionProvider>
  );
}
