import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";

interface Session {
  user: string | null;
  signIn(user: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/** Asks the API who is signed in; children render only once that's known. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.me().then(
      (r) => setUser(r.user),
      (e: Error) => (e instanceof ApiError && e.status === 401 ? setUser(null) : setError(e.message)),
    );
  }, []);
  if (error) return <div className="p-6 text-destructive">Couldn't reach the fevo API: {error}</div>;
  if (user === undefined) return fallback;
  const session: Session = {
    user,
    async signIn(u, p) {
      setUser((await api.login(u, p)).user);
    },
    async signOut() {
      await api.logout();
      setUser(null);
    },
  };
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider missing");
  return s;
}
