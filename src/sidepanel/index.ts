import { initSidePanelApp } from "./app";

const container = document.querySelector<HTMLElement>("#app");

if (!container) {
  throw new Error("Le conteneur du side panel est introuvable.");
}

void initSidePanelApp(container);
