import "../../styles/base.css";
import { getAppState } from "../../storage/app-storage";

const container = document.querySelector<HTMLElement>("#app");

if (!container) {
  throw new Error("Le conteneur viewer est introuvable.");
}

void initViewer(container);

async function initViewer(root: HTMLElement): Promise<void> {
  const monthKey = new URLSearchParams(window.location.search).get("monthKey");
  const state = await getAppState();

  if (!monthKey) {
    renderMessage(root, "Aucun mois sélectionné.");
    return;
  }

  const month = state.bankStatements.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!month || !month.fileId) {
    renderMessage(root, "Aucun document disponible pour ce mois.");
    return;
  }

  const file = state.pdfFiles[month.fileId];
  if (!file) {
    renderMessage(root, "Le document n'existe plus dans le stockage local.");
    return;
  }

  const pdfUrl = createPdfObjectUrl(file.dataBase64);
  window.addEventListener(
    "beforeunload",
    () => {
      URL.revokeObjectURL(pdfUrl);
    },
    { once: true }
  );

  root.innerHTML = `
    <main class="viewer-shell">
      <div class="viewer-stage">
        <div class="viewer-toolbar">
          <div>
            <p class="eyebrow">Vue détaillée</p>
            <h1>${month.label}</h1>
          </div>
          <p class="helper-text">${file.fileName} · ${file.pageCount ?? "?"} page(s)</p>
        </div>
        ${file.previewPageDataUrl ? `<img class="pdf-preview-image" src="${file.previewPageDataUrl}" alt="Aperçu première page" />` : ""}
        <iframe class="pdf-frame" src="${pdfUrl}" title="Document PDF"></iframe>
      </div>
    </main>
  `;
}

function renderMessage(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <main class="viewer-shell">
      <div class="viewer-stage">
        <div class="viewer-toolbar">
          <div>
            <p class="eyebrow">Vue détaillée</p>
            <h1>Document bancaire</h1>
          </div>
        </div>
        <p class="viewer-empty">${message}</p>
      </div>
    </main>
  `;
}

function createPdfObjectUrl(base64Data: string): string {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}
