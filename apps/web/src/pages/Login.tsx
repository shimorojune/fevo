import { useState } from "react";
import { useSession } from "../lib/session";

export function Login() {
  const { signIn } = useSession();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <div className="wrap page" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <form
        className="panel panel-pad stack"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          signIn(user, password).catch((err: Error) => {
            setError(err.message);
            setBusy(false);
          });
        }}
      >
        <label className="stack" style={{ gap: 6 }}>
          <span className="label">Username</span>
          <input type="text" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} autoFocus required />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="label">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error-box small">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
