export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type EvidenceType = 'PERMISSIONS' | 'USAGE' | 'DATA_USAGE' | 'NETWORK';

export interface DataUsageInfo {
  mobileBytes: number | null;
  wifiBytes: number | null;
  available: boolean;
}

export interface NetworkFinding {
  severity: Severity;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
}

export interface CombinedRiskResult {
  totalScore: number;
  level: RiskLevel;
  evidenceCoverage: EvidenceType[];
  explanations: string[];
}

export interface AppRisk {
  appName: string;
  packageName: string;
  permissions: string[];
  foregroundMinutes: number;

  // Separated Permission-Only Risk
  permissionScore: number; // 0..40
  permissionRiskLevel: RiskLevel;

  // Authoritative Combined Risk (derived from classifyRiskScore(combinedScore))
  combinedScore: number; // 0..100
  combinedRiskLevel: RiskLevel;
  riskLevel: RiskLevel; // Mirrors combinedRiskLevel for full backward and display consistency

  // Legacy permission-only category (preserved for migration reconciliation audit)
  legacyRiskLevel?: RiskLevel;

  isSystemApp: boolean;
  lastUsedTime: string;
  dataUsage?: DataUsageInfo | null;
  scoreExplanations: string[];
  networkFindingsCount: number;
  lastChangedAt?: string;
}

export interface ImportedFinding {
  id?: number;
  severity: Severity;
  issueType: string;
  host: string;
  path: string;
  attributedPackage: string | null;
  importedAt: string;
  importBatch?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  synthetic?: boolean;
}

export interface ImportResult {
  findings: ImportedFinding[];
  duplicatesSkipped: number;
  parseErrors: string[];
  format: string;
}

export interface ScanResult {
  riskList: AppRisk[];
  formattedScanTime: string;
  scanReason: string;
  usageAccessGranted: boolean;
}

export type ChangeEventType =
  | 'PERMISSION_CHANGED'
  | 'NEW_FINDING'
  | 'SCORE_DELTA'
  | 'CATEGORY_TRANSITION';

export interface ChangeEvent {
  id: string;
  timestamp: string;
  packageName: string;
  appName: string;
  type: ChangeEventType;
  description: string;
  oldScore?: number;
  newScore?: number;
  oldCategory?: RiskLevel;
  newCategory?: RiskLevel;
  dismissed?: boolean;
}

export interface BurpEventPayload {
  issueType: string;
  severity: Severity;
  host: string;
  path: string;
  attributedPackage?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  eventId?: string;
  timestamp?: string;
  synthetic?: boolean;
}

export interface BridgeStatus {
  listening: boolean;
  port: number;
  endpoint: string;
  tokenConfigured: boolean;
  eventsReceivedCount: number;
  duplicatesBlockedCount: number;
  lastEventAt: string | null;
}
