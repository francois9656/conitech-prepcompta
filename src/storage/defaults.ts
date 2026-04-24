import { buildBankStatementsState, createDefaultPeriod } from "../domain/bank-statements";
import type { AppState, Category } from "../domain/models";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "fournitures-bureau", label: "Fournitures de bureau", color: "#2563eb", builtIn: true, hidden: false },
  { id: "logiciels-abonnements", label: "Logiciels et abonnements", color: "#7c3aed", builtIn: true, hidden: false },
  { id: "publicite-marketing", label: "Publicité et marketing", color: "#db2777", builtIn: true, hidden: false },
  { id: "telecommunications", label: "Télécommunications (internet, cellulaire)", color: "#0891b2", builtIn: true, hidden: false },
  { id: "deplacements-transport", label: "Frais de déplacement (transport)", color: "#0f766e", builtIn: true, hidden: false },
  { id: "essence-vehicule", label: "Essence et véhicule", color: "#65a30d", builtIn: true, hidden: false },
  { id: "repas-representation", label: "Repas et représentation", color: "#ea580c", builtIn: true, hidden: false },
  { id: "hebergement-hotel", label: "Hébergement (hôtel)", color: "#b45309", builtIn: true, hidden: false },
  { id: "entretien-reparations", label: "Entretien et réparations", color: "#64748b", builtIn: true, hidden: false },
  { id: "honoraires-professionnels", label: "Honoraires professionnels", color: "#4f46e5", builtIn: true, hidden: false },
  { id: "assurances", label: "Assurances", color: "#0369a1", builtIn: true, hidden: false },
  { id: "frais-bancaires", label: "Frais bancaires", color: "#475569", builtIn: true, hidden: false },
  { id: "frais-carte-credit", label: "Frais de carte de crédit", color: "#be123c", builtIn: true, hidden: false },
  { id: "interets-carte-credit", label: "Intérêts sur carte de crédit", color: "#991b1b", builtIn: true, hidden: false },
  { id: "loyer-location", label: "Loyer et location", color: "#1d4ed8", builtIn: true, hidden: false },
  { id: "electricite-services-publics", label: "Électricité et services publics", color: "#0d9488", builtIn: true, hidden: false },
  { id: "frais-formation", label: "Frais de formation", color: "#7c2d12", builtIn: true, hidden: false },
  { id: "fournitures-operationnelles", label: "Fournitures opérationnelles", color: "#15803d", builtIn: true, hidden: false },
  { id: "achats-divers", label: "Achats divers", color: "#6b7280", builtIn: true, hidden: false }
];

export function createDefaultAppState(): AppState {
  const period = createDefaultPeriod();

  return {
    ui: {
      themeMode: "system"
    },
    company: {
      name: ""
    },
    bankStatements: buildBankStatementsState(period),
    creditCardStatements: buildBankStatementsState(period, [], "creditCardStatements"),
    invoices: {
      sectionKey: "invoices",
      items: []
    },
    otherCommunications: {
      sectionKey: "otherCommunications",
      items: []
    },
    pdfFiles: {},
    categories: DEFAULT_CATEGORIES,
    categorizationRules: [
      { id: "r1", pattern: "Université trading", categoryId: "frais-formation" }
    ]
  };
}
