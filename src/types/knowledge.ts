export type LlmProvider = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  maxCostPerRun: number | null;
  inputPricePer1k: number | null;
  outputPricePer1k: number | null;
  enabled: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SaveProviderInput = {
  id?: string;
  name: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  maxCostPerRun: number | null;
  inputPricePer1k: number | null;
  outputPricePer1k: number | null;
  enabled: boolean;
  apiKey: string;
};

export type KnowledgeRun = {
  id: string;
  projectId: string;
  providerId: string;
  model: string;
  scopeType: string;
  status: RunStatus;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualCost: number;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type RunStatus =
  | "draft"
  | "awaiting_confirmation"
  | "extracting"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";

export type KnowledgeDocument = {
  id: string;
  runId: string;
  projectId: string;
  docType: DocType;
  title: string;
  markdown: string;
  version: number;
  edited: boolean;
  exportPath: string | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocType = "common_tasks" | "domain_rules" | "pitfalls";

export type ExportSettings = {
  projectId: string;
  exportDir: string;
  commonTasksFilename: string;
  domainRulesFilename: string;
  pitfallsFilename: string;
  overwriteStrategy: string;
};

export type ExportDiff = {
  targetPath: string;
  exists: boolean;
  unifiedDiff: string;
};

export type RunEstimate = {
  sessionCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  timeRange: string;
};

export type ProgressEvent = {
  runId: string;
  phase: string;
  currentStep: number;
  totalSteps: number;
  message: string;
};

export type ScopeConfig = {
  type: "recent_30d" | "all" | "manual";
  sessionIds?: string[];
};
