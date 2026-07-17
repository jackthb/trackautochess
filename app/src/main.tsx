import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LegendaryDiscordOverlayApp } from "./components/LegendaryPoolOverlay";
import "./styles/theme.css";
import "./styles/app.css";

const isLegendaryOverlay =
  new URLSearchParams(window.location.search).get("overlay") === "legendary";

if (isLegendaryOverlay) {
  document.documentElement.classList.add("legendary-overlay-root");
  document.body.classList.add("legendary-overlay-root");
  document.title = "Legendaries";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isLegendaryOverlay ? <LegendaryDiscordOverlayApp /> : <App />}
  </StrictMode>
);
