import { runExtractionPipeline } from "../pipeline/extractionPipeline";
import { exportStatementToJson } from "../export/statement-export-service";

export async function processBankStatementFile(file: File): Promise<string> {
  const result = await runExtractionPipeline(file);
  return exportStatementToJson(result);
}
