import { Link, NavLink, Route, Routes } from "react-router-dom";
import { SOLO_1 as R } from "@fevo/rules";
import { Circuit } from "./pages/Circuit";
import { Circuits } from "./pages/Circuits";
import { Home } from "./pages/Home";
import { Leaderboard } from "./pages/Leaderboard";
import { Rules } from "./pages/Rules";
import { Upload } from "./pages/Upload";
import { ThemeToggle } from "./components/ui";

export function App() {
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
          <nav className="nav" aria-label="Primary">
            <NavLink to="/circuits">Circuits</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/rules">Rules</NavLink>
          </nav>
          <Link to="/upload" className="btn dark">
            Upload an agent
          </Link>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/circuits" element={<Circuits />} />
          <Route path="/circuits/:id" element={<Circuit />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/rules" element={<Rules />} />
        </Routes>
      </main>
      <footer>
        <div className="wrap spread">
          <span>
            Simulator {R.simVersion}, rules {R.id}
          </span>
          <span className="row">
            <Link to="/rules">Rules</Link>
            <Link to="/rules#agent-spec">Agent spec</Link>
            <ThemeToggle />
          </span>
        </div>
      </footer>
    </>
  );
}
