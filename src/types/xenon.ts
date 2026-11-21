export type SuiteCategory = "organize" | "optimize" | "convert" | "security";

export type EngineName = "qpdf" | "ghostscript" | "pdfium" | "lopdf_crypto";

export type ActiveViewId =
  | "dashboard"
  | "batch-queue"
  | "organize-pdf"
  | "optimize-repair"
  | "convert-ocr"
  | "security-sign"
  | "settings";

export interface PageReorderSpec {
  sourceDocId: string;
  originalPageNumber: number; // 1-based
  rotationDelta: 0 | 90 | 180 | 270;
  cropBox?: [number, number, number, number];
}

export interface OrganizeOptions {
  pages: PageReorderSpec[];
  retainBookmarksToc: boolean;
  standardizeToA4: boolean;
  pdfVersionProfile: "1.7" | "2.0" | "pdfa-2b";
  outputPath: string;
}

export interface SplitOptions {
  inputPath: string;
  mode: "range" | "extract_selected" | "every_n_pages" | "burst";
  rangeSpec?: string;
  everyNPages?: number;
  selectedPages?: number[];
  mergeExtractedIntoSinglePdf: boolean;
  outputDir: string;
  namingPattern: string;
}

export interface CompressOptions {
  inputPaths: string[];
  profile: "screen" | "ebook" | "printer" | "prepress" | "custom";
  customDpi?: number;
  customJpegQuality?: number;
  linearizeFastWeb: boolean;
  sanitizeMetadata: boolean;
  outputDir: string;
  namingPattern: string;
}

export interface SizeEstimateResult {
  originalBytes: number;
  estimatedBytes: number;
  estimatedReductionPercent: number;
  imageStreamBytes: number;
}

export interface PdfToImagesOptions {
  inputPath: string;
  format: "jpeg" | "png" | "webp" | "tiff";
  dpi: number;
  pageRange?: string;
  outputDir: string;
  filenamePrefix?: string;
}

export interface ImagesToPdfOptions {
  imagePaths: string[];
  paperSize: "a4" | "letter" | "fit_to_image";
  orientation: "portrait" | "landscape" | "auto";
  marginPts: number;
  outputPath: string;
}

export interface OcrPdfOptions {
  inputPath: string;
  languages: ("eng" | "ind")[];
  dpi: 150 | 300 | 600;
  outputToPdfA: boolean;
  pdfAConformance?: "pdfa-1b" | "pdfa-2b" | "pdfa-3b";
  outputPath: string;
}

export interface ComparePdfsOptions {
  leftPdfPath: string;
  rightPdfPath: string;
  dpi: number;
}

export interface PageDiffSummary {
  pageNumber: number;
  pixelDifferenceRatio: number;
  heatmapDataUrl: string;
  textChanges: {
    changeType: "insert" | "delete" | "equal";
    text: string;
    bounds?: [number, number, number, number];
  }[];
}

export interface FormFieldSpec {
  id: string;
  name: string;
  fieldType: "text" | "checkbox" | "radio" | "dropdown";
  pageNumber: number;
  rect: [number, number, number, number];
  value: string | boolean;
  options?: string[];
  required?: boolean;
  readOnly?: boolean;
}

export interface RedactionBox {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fillColorHex?: string;
  label?: string;
}

export interface WatermarkSpec {
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
  opacity: number;
  rotationDeg: number;
  fontSizePts?: number;
  colorHex?: string;
  layer: "foreground" | "background";
  targetPages?: "all" | number[];
}

export interface SecuritySignOptions {
  inputPath: string;
  outputPath: string;
  encryption?: {
    level: "aes-256" | "aes-128" | "pdf2-aes256";
    userPassword?: string;
    ownerPassword?: string;
    allowPrint: boolean;
    allowCopy: boolean;
    allowModify: boolean;
    allowFormFill: boolean;
  };
  pkcs12Signature?: {
    p12Path: string;
    passphrase?: string;
    useKeyringPassphrase?: boolean;
    reason?: string;
    location?: string;
    contactInfo?: string;
    visualStamp?: {
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      signatureImagePath?: string;
    };
  };
  watermark?: WatermarkSpec;
  redactions?: {
    boxes: RedactionBox[];
    preserveUnredactedText: boolean;
    burnInDpi: 300;
  };
  flattenAll: boolean;
  sanitizeXmp: boolean;
}

export interface JobTickEvent {
  jobId: string;
  documentName: string;
  category: SuiteCategory;
  operationLabel: string;
  completedTicks: number;
  percentage: number;
  status: "queued" | "processing" | "paused" | "completed" | "failed";
  originalBytes: number;
  outputBytes?: number;
  outputPath?: string;
  error?: string;
  createdLabel?: string;
}

export interface DashboardMetrics {
  processedTodayCount: number;
  processedTodayDelta: number;
  totalSpaceSavedBytes: number;
  averageCompressionRatioPercent: number;
  securedFilesCount: number;
  weeklyThroughput: { dayLabel: string; count: number }[];
  recentDocuments: JobTickEvent[];
}

export interface EngineDiagnosticStatus {
  name: EngineName;
  displayName: string;
  version: string;
  binaryPath: string;
  sha256: string;
  sha256Verified: boolean;
  status: "connected_bundled" | "active_ffi" | "embedded" | "error";
  description: string;
}

export interface EngineTestResult {
  name: string;
  success: boolean;
  version: string;
  binaryPath: string;
  sha256: string;
  output: string;
  latencyMs: number;
}

export interface AppSettings {
  sandboxWorkerThreads: boolean;
  workerThreads: number;
  memoryCacheLimitMb: number;
  tempCacheDir: string;
  hardwareAccelerationGpu: boolean;
  defaultEncryptionLevel: string;
  p12KeystorePath: string;
  p12KeystoreSubject: string;
  autoFlattenOnSave: boolean;
  sanitizeMetadataXmp: boolean;
  outputNamingPattern: string;
  primaryDestinationFolder: string;
  preserveModificationTimestamp: boolean;
  desktopNotificationOnComplete: boolean;
}

export interface HardwareTelemetry {
  ramUsedMb: number;
  totalRamGb: number;
  cpuUsagePercent: number;
  physicalCores: number;
  activeWorkerThreads: number;
  memoryCacheLimitMb: number;
  tempCacheSizeBytes: number;
  targetArch: string;
}

export type LogLevel = "INFO" | "CMD" | "WARN" | "ERR";

export interface EngineLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  engine: string;
  message: string;
}

export interface OpenedPageMeta {
  pageNumber: number;
  widthPts: number;
  heightPts: number;
  rotation: number;
  mediaBox: [number, number, number, number];
  cropBox?: [number, number, number, number];
  textPreview: string[];
}

export interface OpenedDocumentDto {
  docId: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  pdfVersion: string;
  isEncrypted: boolean;
  hasBookmarks: boolean;
  pages: OpenedPageMeta[];
}

export interface OrganizeExecutionResult {
  outputPath: string;
  pageCount: number;
  originalBytes: number;
  outputBytes: number;
  durationMs: number;
  qpdfCommand: string;
}

export interface MergeQueueItem {
  docId: string;
  filePath: string;
  fileName: string;
  pageCount: number;
  fileSizeBytes: number;
}

export interface CompressExecutionResult {
  inputPath: string;
  outputPath: string;
  originalBytes: number;
  outputBytes: number;
  reductionPercent: number;
  pageCount: number;
  durationMs: number;
  gsCommand: string;
}

export interface RepairExecutionResult {
  outputPath: string;
  recoveredPages: number;
  fixedXrefEntries: number;
  originalBytes: number;
  outputBytes: number;
  durationMs: number;
  commandLog: string;
}

export interface SanitizeResult {
  outputPath: string;
  originalBytes: number;
  outputBytes: number;
  removedMetadataStreams: number;
  strippedInfoKeys: number;
  prunedOrphanObjects: number;
  durationMs: number;
}

export interface OptimizeSingleResult {
  outputPath: string;
  originalBytes: number;
  outputBytes: number;
  pageCount: number;
  durationMs: number;
  commandLog: string;
}

export interface SecurityExecutionResult {
  outputPath: string;
  originalBytes: number;
  outputBytes: number;
  pageCount: number;
  durationMs: number;
  commandLog: string;
  summary: string;
}

export interface KeystoreInfoDto {
  p12Path: string;
  subject: string;
  fingerprintSha256: string;
}
