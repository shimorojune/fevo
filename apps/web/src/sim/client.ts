import type { Request, Response } from "./protocol";

type Listener = (m: Response) => void;

let worker: Worker | null = null;
let nextId = 1;
const listeners = new Map<number, Listener>();

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<Response>) => listeners.get(e.data.id)?.(e.data);
  }
  return worker;
}

/** Check an agent and run its three official laps; messages stream to onMessage. Returns a cancel function. */
export function runAgent(trackId: string, agentText: string, onMessage: Listener): () => void {
  const id = nextId++;
  listeners.set(id, (m) => {
    onMessage(m);
    if (m.type === "done" || m.type === "failed" || (m.type === "checked" && !m.ok)) listeners.delete(id);
  });
  const req: Request = { id, type: "run", trackId, agentText };
  get().postMessage(req);
  return () => listeners.delete(id);
}
