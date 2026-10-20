import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Segmented } from "@/components/ui/segmented";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/session";
import { currentTheme, setTheme, type Theme } from "@/lib/theme";

const NAV = [
  { to: "/models", label: "Models" },
  { to: "/run", label: "Run" },
  { to: "/history", label: "History" },
  { to: "/compare", label: "Compare" },
  { to: "/benchmarks", label: "Benchmarks" },
  { to: "/batches", label: "Batches" },
];

export function Mark() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold tracking-[-0.02em]">
      <svg width="20" height="12" viewBox="0 0 22 14" aria-hidden="true">
        <polyline points="1,12 6,4 10,9 15,2 21,6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      fevo
    </span>
  );
}

/** The app bar: mark, the screens with a sliding underline, and the account menu. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const [line, setLine] = useState<{ left: number; width: number } | null>(null);
  const [theme, setT] = useState<Theme>(currentTheme);
  const themeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const on = nav.current?.querySelector<HTMLElement>("a.active");
    setLine(on ? { left: on.offsetLeft, width: on.offsetWidth } : null);
    // On a phone the links scroll sideways; keep the current one in view.
    on?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] px-4 max-[980px]:block max-[980px]:h-auto">
      <header className="flex h-[52px] items-center gap-7 border-b border-border max-[980px]:gap-4">
        <NavLink to="/models" aria-label="fevo, models">
          <Mark />
        </NavLink>
        <nav ref={nav} aria-label="Primary" className="relative flex min-w-0 flex-1 gap-[22px] pb-px overflow-x-auto whitespace-nowrap text-muted-foreground [scrollbar-width:none] max-[980px]:gap-4">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `py-1 transition-colors hover:text-foreground ${isActive ? "active text-foreground" : ""}`}>
              {n.label}
            </NavLink>
          ))}
          {line && <span aria-hidden className="absolute bottom-0 h-0.5 bg-foreground transition-[left,width] duration-[260ms] ease-[cubic-bezier(.2,.8,.2,1)]" style={{ left: line.left, width: line.width }} />}
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account"
            className="grid size-[26px] place-items-center rounded-full border border-border bg-muted text-[11px] font-medium text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground data-[state=open]:border-muted-foreground data-[state=open]:text-foreground"
          >
            {(user ?? "?").slice(0, 1).toUpperCase()}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <b className="text-[13px] font-medium">{user}</b>
              <span className="text-xs font-normal text-muted-foreground">Signed in</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div ref={themeRef} className="flex items-center justify-between gap-3 px-2.5 py-2 text-[13px]">
              Theme
              <Segmented
                label="Theme"
                value={theme}
                onChange={(t) => {
                  setT(t);
                  setTheme(t, themeRef.current?.querySelector<HTMLElement>(`[data-state="on"]`) ?? themeRef.current);
                }}
                items={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </div>
            <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main key={pathname} className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] animate-rise max-[980px]:block">
        {children}
      </main>
    </div>
  );
}

/** Page head: one title and one line under it, with optional controls on the right. */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-5 py-3">
      <div className="min-w-0">
        <h1 className="m-0 text-xl leading-tight font-medium tracking-[-0.025em]">{title}</h1>
        {sub && <div className="text-[12.5px] text-muted-foreground">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3.5">{children}</div>}
    </div>
  );
}
