import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const tesseractCoreFiles = [
  "tesseract-core.wasm",
  "tesseract-core.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd.wasm",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd.wasm",
  "tesseract-core-relaxedsimd.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js"
];

function copyTesseractAssets(): PluginOption {
  return {
    name: "copy-tesseract-assets",
    closeBundle() {
      const targetRoot = resolve(projectRoot, "dist/assets/tesseract");
      const targetCore = resolve(targetRoot, "core");
      const targetLang = resolve(targetRoot, "lang");

      rmSync(targetRoot, { recursive: true, force: true });
      mkdirSync(targetCore, { recursive: true });
      mkdirSync(targetLang, { recursive: true });

      copyFileSync(
        resolve(projectRoot, "node_modules/tesseract.js/dist/worker.min.js"),
        resolve(targetRoot, "worker.min.js")
      );

      for (const fileName of tesseractCoreFiles) {
        copyFileSync(
          resolve(projectRoot, "node_modules/tesseract.js-core", fileName),
          resolve(targetCore, fileName)
        );
      }

      copyFileSync(
        resolve(projectRoot, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
        resolve(targetLang, "eng.traineddata.gz")
      );
      copyFileSync(
        resolve(projectRoot, "node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz"),
        resolve(targetLang, "fra.traineddata.gz")
      );
    }
  };
}

export default defineConfig({
  plugins: [copyTesseractAssets()],
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: {
        sidepanel: resolve(projectRoot, "sidepanel.html"),
        viewer: resolve(projectRoot, "viewer.html"),
        background: resolve(projectRoot, "src/background.ts")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]"
      }
    }
  }
});
