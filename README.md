# Conitech PrepCompta

Base fonctionnelle de l'extension Chrome Manifest V3 pour la préparation comptable Conitech.

## Portée actuelle

- structure TypeScript modulaire
- Manifest V3 avec side panel
- modèles de domaine pour la section Relevés bancaires
- stockage local de l'état applicatif
- side panel initial avec période et suivi de progression

## Architecture extraction comptable (MVP)

Le projet inclut une pipeline modulaire de preparation comptable orientee PDF texte, PDF image (OCR) et PDF hybride.

### Arborescence

```text
src/
	core/
		models/
			index.ts
		types/
			extraction.ts
		utils/
			number-parsing.ts
			pdfjs.ts
	modules/
		pdf-inspection/
			pdf-inspector.ts
			pdf-text-extractor.ts
		pdf-rendering/
			pdf-renderer.ts
		ocr/
			ocr-engine.ts
			ocr-service.ts
			tesseract-ocr-engine.ts
		layout-analysis/
			layout-analyzer.ts
		table-reconstruction/
			index.ts
			table-builder.ts
	parsers/
		bank/
			bmo/
				bmo-parser.ts
			desjardins/
				README.md
			parser-registry.ts
			types.ts
	pipeline/
		extractionPipeline.ts
	validation/
		statement-validation-service.ts
	normalization/
		statement-normalizer.ts
	export/
		statement-export-service.ts
	examples/
		run-bmo-pipeline-example.ts
```

### Pipeline imposee

1. inspection PDF (`modules/pdf-inspection/pdf-inspector.ts`)
2. decision OCR/texte/hybride
3. rendu haute resolution des pages OCR (`modules/pdf-rendering/pdf-renderer.ts`)
4. OCR avec coordonnees (`modules/ocr/ocr-service.ts` + moteur injecte)
5. analyse de layout (`modules/layout-analysis/layout-analyzer.ts`)
6. reconstruction table (`modules/table-reconstruction/table-builder.ts`)
7. parsing metier BMO (`parsers/bank/bmo/bmo-parser.ts`)
8. validation comptable (`validation/statement-validation-service.ts`)

### Point d'entree

```ts
runExtractionPipeline(file: File): Promise<StatementExtractionResult>
```

Implementation: `src/pipeline/extractionPipeline.ts`

### Exemple d'utilisation

```ts
import { processBankStatementFile } from "./src/examples/run-bmo-pipeline-example";

const jsonResult = await processBankStatementFile(fileInput.files![0]);
console.log(jsonResult);
```

## Scripts

- `npm install`
- `npm run check`
- `npm run build`
- `npm run dev`

## Chargement dans Chrome

1. Exécuter `npm install`
2. Exécuter `npm run build`
3. Ouvrir `chrome://extensions`
4. Activer le mode développeur
5. Charger le dossier `dist`
