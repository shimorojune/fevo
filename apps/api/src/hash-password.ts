/** Print an AUTH_PASSWORD_HASH for the password given on stdin or as an argument. */
import { hashPassword } from "./auth.ts";

const pw = process.argv[2] ?? (await new Promise<string>((res) => {
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => res(s.replace(/\r?\n$/, "")));
}));
if (!pw) {
  console.error("usage: pnpm --filter @fevo/api hash-password <password>   (or pipe it on stdin)");
  process.exit(1);
}
console.log(hashPassword(pw));
