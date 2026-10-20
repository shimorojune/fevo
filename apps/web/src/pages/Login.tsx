import { useState } from "react";
import { Mark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { thumbnailPath } from "@/lib/replay";
import { useSession } from "@/lib/session";
import { useTrack } from "@/lib/useTrack";

export function Login() {
  const { signIn } = useSession();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const track = useTrack("spielberg");
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] px-4">
      <header className="flex h-[52px] items-center border-b border-border">
        <Mark />
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-[980px]:grid-cols-1">
        <div className="grid place-items-center border-r border-border p-8 max-[980px]:hidden">
          <svg viewBox="0 0 620 400" className="h-auto w-full max-w-[620px] animate-fade" aria-hidden="true">
            <defs>
              <linearGradient id="speed" x1="0" x2="1" y1="0" y2="1">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <stop key={i} offset={i / 6} stopColor={`var(--speed-${i}, var(--speed-3))`} />
                ))}
              </linearGradient>
            </defs>
            {track && <path d={thumbnailPath(track, 620, 400, 24)} fill="none" stroke="url(#speed)" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />}
          </svg>
        </div>
        <form
          className="flex w-[min(360px,100%)] flex-col gap-3.5 self-center justify-self-center p-6"
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
          <div>
            <h1 className="m-0 text-[26px] font-medium tracking-[-0.03em]">Sign in to fevo</h1>
            <div className="text-[12.5px] text-muted-foreground">Your models, the laps you run with them, and every result.</div>
          </div>
          <label className="flex flex-col gap-1.5 text-[13px]" htmlFor="u">
            Username
            <input id="u" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} autoFocus required className="h-[38px] rounded-sm border border-border bg-background px-3 text-foreground" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px]" htmlFor="pw">
            Password
            <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-[38px] rounded-sm border border-border bg-background px-3 text-foreground" />
          </label>
          {error && <p className="m-0 text-[13px] text-destructive">{error}</p>}
          <Button variant="default" size="lg" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
