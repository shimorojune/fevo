/**
 * Sign-in with GitHub. The OAuth web flow runs on the API under /api/auth,
 * and the session lives in an httpOnly cookie on the site's origin (Vite
 * proxies /api in dev; put the API behind the same origin in production).
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sessions, users, type Db, type User } from "./db.ts";

export interface AuthOptions {
  /** OAuth app credentials. Without them, GitHub sign-in is off. */
  github?: { clientId: string; clientSecret: string } | undefined;
  /** Where the site lives, e.g. https://fevo.example; the callback URL and post-sign-in redirects use it. */
  siteUrl: string;
  /** Allow POST /api/auth/dev to sign in as any login without GitHub. Local dev and tests only. */
  devLogin?: boolean | undefined;
  /** For tests: stands in for GitHub's token and user endpoints. */
  fetch?: typeof fetch | undefined;
}

const SESSION_COOKIE = "fevo_session";
const STATE_COOKIE = "fevo_oauth_state";
const SESSION_DAYS = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");

/** Only same-site paths, so a crafted link can't bounce a fresh sign-in to another site. */
const safeReturn = (r: string | undefined) => (r && r.startsWith("/") && !r.startsWith("//") && !r.startsWith("/\\") ? r : "/");

export class Auth {
  readonly #db: Db;
  readonly #opts: AuthOptions;
  readonly #secure: boolean;

  constructor(db: Db, opts: AuthOptions) {
    this.#db = db;
    this.#opts = opts;
    this.#secure = opts.siteUrl.startsWith("https:");
  }

  get providers() {
    return { github: !!this.#opts.github, dev: !!this.#opts.devLogin };
  }

  /** The signed-in user for a request, if any. */
  async user(c: Context): Promise<User | undefined> {
    const t = getCookie(c, SESSION_COOKIE);
    if (!t) return undefined;
    const [row] = await this.#db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, sha256(t)));
    return row && row.expiresAt > new Date() ? row.user : undefined;
  }

  async #signIn(c: Context, u: { id: string; login: string; name: string | null; avatarUrl: string | null }) {
    await this.#db
      .insert(users)
      .values(u)
      .onConflictDoUpdate({ target: users.id, set: { login: u.login, name: u.name, avatarUrl: u.avatarUrl } });
    await this.#db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    const t = token();
    await this.#db.insert(sessions).values({ tokenHash: sha256(t), userId: u.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) });
    setCookie(c, SESSION_COOKIE, t, { httpOnly: true, secure: this.#secure, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  }

  routes(app: Hono) {
    const site = this.#opts.siteUrl.replace(/\/$/, "");
    const callback = `${site}/api/auth/github/callback`;
    const http = this.#opts.fetch ?? fetch;

    app.get("/api/me", async (c) => {
      const u = await this.user(c);
      return c.json({ user: u ? { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatarUrl } : null, providers: this.providers });
    });

    app.get("/api/auth/github", (c) => {
      const gh = this.#opts.github;
      if (!gh) return c.json({ error: "GitHub sign-in isn't configured on this server." }, 404);
      const state = token();
      setCookie(c, STATE_COOKIE, `${state}|${safeReturn(c.req.query("return"))}`, {
        httpOnly: true,
        secure: this.#secure,
        sameSite: "Lax",
        path: "/api/auth",
        maxAge: 600,
      });
      const q = new URLSearchParams({ client_id: gh.clientId, redirect_uri: callback, state, allow_signup: "true" });
      return c.redirect(`https://github.com/login/oauth/authorize?${q}`);
    });

    app.get("/api/auth/github/callback", async (c) => {
      const gh = this.#opts.github;
      if (!gh) return c.json({ error: "GitHub sign-in isn't configured on this server." }, 404);
      const [state, ret] = (getCookie(c, STATE_COOKIE) ?? "").split("|");
      deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });
      const fail = (why: string) => c.redirect(`${site}${safeReturn(ret)}${safeReturn(ret).includes("?") ? "&" : "?"}signin=${encodeURIComponent(why)}`);
      if (!state || c.req.query("state") !== state) return fail("expired");
      const code = c.req.query("code");
      if (!code) return fail("cancelled");

      const tok = (await http("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ client_id: gh.clientId, client_secret: gh.clientSecret, code, redirect_uri: callback }),
      }).then((r) => r.json())) as { access_token?: string };
      if (!tok.access_token) return fail("github");
      const res = await http("https://api.github.com/user", {
        headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "fevo" },
      });
      if (!res.ok) return fail("github");
      const gu = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };
      await this.#signIn(c, { id: String(gu.id), login: gu.login, name: gu.name, avatarUrl: gu.avatar_url });
      return c.redirect(`${site}${safeReturn(ret)}`);
    });

    app.post("/api/auth/dev", async (c) => {
      if (!this.#opts.devLogin) return c.json({ error: "Not found." }, 404);
      const { login } = (await c.req.json().catch(() => ({}))) as { login?: unknown };
      if (typeof login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return c.json({ error: "login: 1 to 39 letters, digits or -" }, 400);
      await this.#signIn(c, { id: `dev:${login}`, login, name: null, avatarUrl: null });
      return c.json({ ok: true });
    });

    app.post("/api/auth/logout", async (c) => {
      const t = getCookie(c, SESSION_COOKIE);
      if (t) await this.#db.delete(sessions).where(eq(sessions.tokenHash, sha256(t)));
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ ok: true });
    });
  }
}
