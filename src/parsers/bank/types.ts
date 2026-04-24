import type {
  LayoutAnalysisResult,
  ReconstructedStatementTable,
  StatementExtractionResult
} from "../../core/types/extraction";

export interface BankParserInput {
  layout: LayoutAnalysisResult;
  reconstructedTable: ReconstructedStatementTable;
  parserTemplateOverride?: string | null;
  rawOcrPages?: Array<{
    pageNumber: number;
    text: string;
  }>;
}

export interface BankParser {
  bankId: string;
  canParse(layout: LayoutAnalysisResult): boolean;
  parse(input: BankParserInput): StatementExtractionResult;
}
