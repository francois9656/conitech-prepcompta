# Conitech PrepCompta

Base fonctionnelle de l'extension Chrome Manifest V3 pour la préparation comptable Conitech.

## Portée actuelle

- structure TypeScript modulaire
- Manifest V3 avec side panel
- modèles de domaine pour la section Relevés bancaires
- stockage local de l'état applicatif
- side panel initial avec période et suivi de progression

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
