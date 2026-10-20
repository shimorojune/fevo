/**
 * One user. The dashboard signs in with a username and password and gets a
 * signed session cookie; training posts with a separate publish key.
 *
 *   AUTH_USER           the username
 *   AUTH_PASSWORD_HASH  from `pnpm --filter @fevo/api hash-password`
 *   SESSION_SECRET      signs session cookies; 32+ random bytes
 *   PUBLISH_KEY         bearer token for fevo publish and the training hook
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export interface AuthConfig {
  user: string;
  passwordHash: string;
  sessionSecret: string;
  publishKey: string;
  /** Mark cookies Secure. Off only for plain-http local dev. */
  secureCookies?: boolean;
}

const COOKIE = "fevo_session";
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = scryptSync(password, Buffer.from(salt, "base64url"), want.length, { ...SCRYPT, N: Number(n) });
  return timingSafeEqual(got, want);
}

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createAuth(cfg: AuthConfig) {
  const sign = (payload: string) => createHmac("sha256", cfg.sessionSecret).update(payload).digest("base64url");
  const failures = new Map<string, number[]>();

  const session = (c: Context): string | undefined => {
    const raw = getCookie(c, COOKIE);
    if (!raw) return undefined;
    const [payload, sig] = raw.split(".");
    if (!payload || !sig || !equal(sig, sign(payload))) return undefined;
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; exp: number };
    return u === cfg.user && exp > Date.now() ? u : undefined;
  };

  return {
    /** Check credentials and set the cookie. At most 5 failed attempts per address per 15 minutes. */
    login(c: Context, user: string, password: string, address: string): "ok" | "bad" | "locked" {
      const now = Date.now();
      const recent = (failures.get(address) ?? []).filter((t) => now - t < 15 * 60_000);
      if (recent.length >= 5) return "locked";
      if (!equal(user, cfg.user) || !checkPassword(password, cfg.passwordHash)) {
        failures.set(address, [...recent, now]);
        return "bad";
      }
      failures.delete(address);
      const payload = Buffer.from(JSON.stringify({ u: cfg.user, exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
      setCookie(c, COOKIE, `${payload}.${sign(payload)}`, {
        httpOnly: true,
        secure: cfg.secureCookies ?? true,
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_DAYS * 86_400,
      });
      return "ok";
    },
    logout(c: Context) {
      deleteCookie(c, COOKIE, { path: "/" });
    },
    user: session,
    /** Signed-in dashboard user. */
    requireUser: (async (c, next) => {
      if (!session(c)) return c.json({ error: "Sign in first." }, 401);
      await next();
    }) as MiddlewareHandler,
    /** fevo publish and the training hook. */
    requireKey: (async (c, next) => {
      const h = c.req.header("authorization") ?? "";
      if (!h.startsWith("Bearer ") || !equal(h.slice(7), cfg.publishKey)) return c.json({ error: "Bad or missing publish key." }, 401);
      await next();
    }) as MiddlewareHandler,
  };
}

export type Auth = ReturnType<typeof createAuth>;
