/** Serve tools/replay/out on http://localhost:4173 (pnpm --filter @fevo/replay-viewer serve). */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const out = new URL("../out/", import.meta.url);
const port = Number(process.env.PORT ?? 4173);
createServer(async (req, res) => {
  const name = (req.url ?? "/").split("?")[0] === "/" ? "replay.html" : (req.url ?? "").slice(1).split("?")[0]!;
  if (name.includes("..") || name.includes("/")) return void res.writeHead(404).end();
  try {
    const body = await readFile(new URL(name, out));
    res.writeHead(200, { "content-type": name.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found; run pnpm --filter @fevo/replay-viewer replay first");
  }
}).listen(port, "localhost", () => console.log(`replay viewer on http://localhost:${port}`));
