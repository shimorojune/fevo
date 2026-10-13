import { createContext, useContext, useState, type ReactNode } from "react";
import exampleGenome from "../../../../examples/example-genome.json?raw";
import exampleMlp from "../../../../examples/example-mlp.json?raw";

export interface Agent {
  id: string;
  name: string;
  text: string;
  demo: boolean;
}

export const DEMO_AGENTS: Agent[] = [
  { id: "demo-mlp", name: "Demo MLP", text: exampleMlp, demo: true },
  { id: "demo-neat", name: "Demo NEAT", text: exampleGenome, demo: true },
];

interface Store {
  agents: Agent[];
  add(name: string, text: string): Agent;
}

const Ctx = createContext<Store | null>(null);

export function AgentsProvider({ children }: { children: ReactNode }) {
  const [uploaded, setUploaded] = useState<Agent[]>([]);
  const store: Store = {
    agents: [...uploaded, ...DEMO_AGENTS],
    add(name, text) {
      const agent = { id: `up-${Date.now()}`, name, text, demo: false };
      setUploaded((u) => [agent, ...u.filter((a) => a.name !== name)]);
      return agent;
    },
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useAgents(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("AgentsProvider missing");
  return s;
}
