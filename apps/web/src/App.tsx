import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/session";
import { History } from "@/pages/History";
import { Login } from "@/pages/Login";
import { Models } from "@/pages/Models";
import { Run } from "@/pages/Run";

export function App() {
  const { user } = useSession();
  if (!user) return <Login />;
  return (
    <AppShell>
      <Routes>
        <Route path="/models" element={<Models />} />
        <Route path="/run" element={<Run />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Navigate to="/models" replace />} />
      </Routes>
    </AppShell>
  );
}
