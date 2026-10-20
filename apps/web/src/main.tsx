import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AgentsProvider } from "./lib/agents";
import { SessionProvider } from "./lib/session";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider fallback={null}>
        <AgentsProvider>
          <App />
        </AgentsProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
