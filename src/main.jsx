import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import AgentContador from "../AgentContador.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AgentContador />
  </StrictMode>
);
