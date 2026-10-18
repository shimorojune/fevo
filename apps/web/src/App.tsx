import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { SOLO_1 as R } from "@fevo/rules";
import { Benchmarks } from "./pages/Benchmarks";
import { Circuit } from "./pages/Circuit";
import { Circuits } from "./pages/Circuits";
import { Login } from "./pages/Login";
import { Models } from "./pages/Models";
import { Rules } from "./pages/Rules";
import { TrainingRun, TrainingRuns } from "./pages/Training";
import { Upload } from "./pages/Upload";
import { ThemeToggle } from "./components/ui";
import { useSession } from "./lib/session";

export function App() {
  const { user, signOut } = useSession();
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand">
            <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
              <polyline points="1,12 6,4 10,9 15,2 21,6" fill="none" stroke="#1F5FD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            fevo
          </Link>
          {user && (
            <>
              <nav className="nav" aria-label="Primary">
                <NavLink to="/models">Models</NavLink>
                <NavLink to="/circuits">Tracks</NavLink>
                <NavLink to="/benchmarks">Benchmarks</NavLink>
                <NavLink to="/training">Training</NavLink>
                <NavLink to="/rules">Rules</NavLink>
              </nav>
              <Link to="/upload" className="btn dark">
                Run a file
              </Link>
            </>
          )}
        </div>
      </header>
      <main>
        {user ? (
          <Routes>
            <Route path="/" element={<Navigate to="/models" replace />} />
            <Route path="/models" element={<Models />} />
            <Route path="/circuits" element={<Circuits />} />
            <Route path="/circuits/:id" element={<Circuit />} />
            <Route path="/benchmarks" element={<Benchmarks />} />
            <Route path="/training" element={<TrainingRuns />} />
            <Route path="/training/:id" element={<TrainingRun />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="*" element={<Navigate to="/models" replace />} />
          </Routes>
        ) : (
          <Login />
        )}
      </main>
      <footer>
        <div className="wrap spread">
          <span>
            Simulator {R.simVersion}, rules {R.id}
          </span>
          <span className="row">
            {user && (
              <button type="button" className="theme-toggle" onClick={() => void signOut()}>
                Sign out {user}
              </button>
            )}
            <ThemeToggle />
          </span>
        </div>
      </footer>
    </>
  );
}
