import { Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./app/session";
import { ProtectedRoute } from "./app/ProtectedRoute";
import { LoginPage } from "./features/auth/LoginPage";
import { SignupPage } from "./features/auth/SignupPage";
import { OrgListPage } from "./features/org/OrgListPage";
import { OrgDashboardPage } from "./features/org/OrgDashboardPage";
import { TeamDetailPage } from "./features/team/TeamDetailPage";
import { CanvasPage } from "./canvas/CanvasPage";
import { AcceptInvitePage } from "./features/invite/AcceptInvitePage";
import { MyTasksPage } from "./features/myTasks/MyTasksPage";
import { AccountPage } from "./features/account/AccountPage";

export function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/orgs" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        {/* Public: handles its own unauthenticated state (login/signup with a
            redirect back here), since ProtectedRoute's blanket redirect would
            drop the ?token= query string. */}
        <Route path="/invite/accept" element={<AcceptInvitePage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/orgs" element={<OrgListPage />} />
          <Route path="/orgs/:orgId" element={<OrgDashboardPage />} />
          <Route path="/orgs/:orgId/my-tasks" element={<MyTasksPage />} />
          <Route path="/orgs/:orgId/teams/:teamId" element={<TeamDetailPage />} />
          <Route path="/orgs/:orgId/voids/:voidId" element={<CanvasPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/orgs" replace />} />
      </Routes>
    </SessionProvider>
  );
}
