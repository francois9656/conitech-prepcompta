import { buildBankStatementsState, createDefaultPeriod } from "../domain/bank-statements";
import type { AppState, Category } from "../domain/models";

export const DEFAULT_CATEGORIES: Category[] = [
  // REVENUS
  { id: "ventes-eboutique", label: "Ventes - e-Boutique", color: "#16a34a", builtIn: true, hidden: false },
  { id: "ventes-services", label: "Ventes - Services", color: "#15803d", builtIn: true, hidden: false },
  { id: "remboursements-recus", label: "Remboursements reçus", color: "#166534", builtIn: true, hidden: false },
  { id: "revenus-divers", label: "Revenus divers", color: "#14532d", builtIn: true, hidden: false },

  // COÛT DES MARCHANDISES VENDUES
  { id: "achat-marchandises-revente", label: "Achat de marchandises pour revente", color: "#ea580c", builtIn: true, hidden: false },
  { id: "fabrication-sous-traitance", label: "Fabrication - Sous-traitance", color: "#c2410c", builtIn: true, hidden: false },
  { id: "matieres-premieres", label: "Matières premières", color: "#9a3412", builtIn: true, hidden: false },
  { id: "emballage-etiquettes", label: "Emballage et étiquettes", color: "#92400e", builtIn: true, hidden: false },
  { id: "frais-importation-douane", label: "Frais d'importation et douane", color: "#78350f", builtIn: true, hidden: false },

  // TRANSPORT ET VÉHICULES
  { id: "essence", label: "Essence", color: "#65a30d", builtIn: true, hidden: false },
  { id: "entretien-vehicule", label: "Entretien véhicule", color: "#4d7c0f", builtIn: true, hidden: false },
  { id: "immatriculation-assurances-vehicule", label: "Immatriculation et assurances véhicule", color: "#3f6212", builtIn: true, hidden: false },
  { id: "deplacements-kilometrage", label: "Déplacements et kilométrage", color: "#365314", builtIn: true, hidden: false },

  // EXPÉDITION
  { id: "expedition-livraison", label: "Expédition et livraison", color: "#0891b2", builtIn: true, hidden: false },
  { id: "fournitures-expedition", label: "Fournitures d'expédition", color: "#0e7490", builtIn: true, hidden: false },

  // CHEVAUX ET ANIMAUX
  { id: "soins-chevaux", label: "Soins des chevaux", color: "#b45309", builtIn: true, hidden: false },
  { id: "veterinaire", label: "Vétérinaire", color: "#a16207", builtIn: true, hidden: false },
  { id: "supplements-moulee", label: "Suppléments et moulée", color: "#92400e", builtIn: true, hidden: false },
  { id: "ferrure-marechal-ferrant", label: "Ferrure et maréchal-ferrant", color: "#854d0e", builtIn: true, hidden: false },
  { id: "foin-litiere", label: "Foin et litière", color: "#713f12", builtIn: true, hidden: false },

  // BUREAU ET ADMINISTRATION
  { id: "fournitures-bureau", label: "Fournitures de bureau", color: "#2563eb", builtIn: true, hidden: false },
  { id: "logiciels-abonnements", label: "Logiciels et abonnements", color: "#7c3aed", builtIn: true, hidden: false },
  { id: "telephone-internet", label: "Téléphone et internet", color: "#0369a1", builtIn: true, hidden: false },
  { id: "frais-bancaires", label: "Frais bancaires", color: "#475569", builtIn: true, hidden: false },
  { id: "interets-financement", label: "Intérêts et financement", color: "#991b1b", builtIn: true, hidden: false },

  // MARKETING ET VENTES
  { id: "marketing-promotion", label: "Marketing et promotion", color: "#db2777", builtIn: true, hidden: false },
  { id: "commissions-partenariats", label: "Commissions et partenariats", color: "#be185d", builtIn: true, hidden: false },

  // TECHNOLOGIE
  { id: "frais-shopify", label: "Frais Shopify", color: "#6d28d9", builtIn: true, hidden: false },
  { id: "frais-hebergement-web", label: "Frais Hébergement web", color: "#5b21b6", builtIn: true, hidden: false },

  // SERVICES PROFESSIONNELS
  { id: "comptabilite", label: "Comptabilité", color: "#4f46e5", builtIn: true, hidden: false },
  { id: "juridique", label: "Juridique", color: "#4338ca", builtIn: true, hidden: false },

  // TAXES ET GOUVERNEMENT
  { id: "tps-tvq", label: "TPS et TVQ", color: "#374151", builtIn: true, hidden: false },
  { id: "impots-acomptes", label: "Impôts et acomptes", color: "#1f2937", builtIn: true, hidden: false },
  { id: "permis-licences", label: "Permis et licences", color: "#111827", builtIn: true, hidden: false },

  // APPORTS ET FINANCEMENT
  { id: "apport-proprietaire", label: "Apport du propriétaire", color: "#0d9488", builtIn: true, hidden: false },
  { id: "injection-fonds", label: "Injection de fonds", color: "#0f766e", builtIn: true, hidden: false },
  { id: "pret-personnel-entreprise", label: "Prêt personnel à l'entreprise", color: "#115e59", builtIn: true, hidden: false },
  { id: "transfert-comptes", label: "Transfert entre comptes", color: "#134e4a", builtIn: true, hidden: false },

  // DIVERS
  { id: "formation", label: "Formation", color: "#7c2d12", builtIn: true, hidden: false },
  { id: "depenses-diverses", label: "Dépenses diverses", color: "#6b7280", builtIn: true, hidden: false },
  { id: "depenses-a-verifier", label: "Dépenses à vérifier", color: "#f59e0b", builtIn: true, hidden: false }
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
      { id: "r1", pattern: "Université trading", categoryId: "formation" }
    ]
  };
}
