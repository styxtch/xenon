import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ComparePdfsOptions,
  CompressExecutionResult,
  CompressOptions,
  DashboardMetrics,
  EngineDiagnosticStatus,
  EngineLogEntry,
  EngineName,
  EngineTestResult,
  FormFieldSpec,
  HardwareTelemetry,
  ImagesToPdfOptions,
  JobTickEvent,
  KeystoreInfoDto,
  OcrPdfOptions,
  OpenedDocumentDto,
  OptimizeSingleResult,
  OrganizeExecutionResult,
  OrganizeOptions,
  PageDiffSummary,
  PdfToImagesOptions,
  RedactionBox,
  RepairExecutionResult,
  SanitizeResult,
  SecurityExecutionResult,
  SecuritySignOptions,
  SizeEstimateResult,
  SplitOptions,
} from "../types/xenon";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  );
}

const FALLBACK_STORAGE_SETTINGS = "xenon.fallback.settings";
const FALLBACK_STORAGE_METRICS = "xenon.fallback.metrics";
const FALLBACK_STORAGE_DEMO_MODE = "xenon.fallback.demoMode";

const defaultFallbackSettings: AppSettings = {
  sandboxWorkerThreads: true,
  workerThreads: 8,
  memoryCacheLimitMb: 2048,
  tempCacheDir: "C:\\Users\\xenon\\AppData\\Local\\Temp\\xenon_cache",
  hardwareAccelerationGpu: true,
  defaultEncryptionLevel: "AES-256 bit (Acrobat 9.0+)",
  p12KeystorePath: "",
  p12KeystoreSubject: "No certificate loaded",
  autoFlattenOnSave: true,
  sanitizeMetadataXmp: true,
  outputNamingPattern: "{filename}_xenon_{date}",
  primaryDestinationFolder: "Documents\\XENON_Exports",
  preserveModificationTimestamp: true,
  desktopNotificationOnComplete: true,
};

const defaultFallbackMetrics: DashboardMetrics = {
  processedTodayCount: 0,
  processedTodayDelta: 0,
  totalSpaceSavedBytes: 0,
  averageCompressionRatioPercent: 0,
  securedFilesCount: 0,
  weeklyThroughput: [
    { dayLabel: "Mon", count: 0 },
    { dayLabel: "Tue", count: 0 },
    { dayLabel: "Wed", count: 0 },
    { dayLabel: "Thu", count: 0 },
    { dayLabel: "Fri", count: 0 },
  ],
  recentDocuments: [],
};

const showcaseFallbackMetrics: DashboardMetrics = {
  processedTodayCount: 3,
  processedTodayDelta: 2,
  totalSpaceSavedBytes: 36_110_025,
  averageCompressionRatioPercent: 74.0,
  securedFilesCount: 1,
  weeklyThroughput: [
    { dayLabel: "Mon", count: 82 },
    { dayLabel: "Tue", count: 51 },
    { dayLabel: "Wed", count: 86 },
    { dayLabel: "Thu", count: 45 },
    { dayLabel: "Fri", count: 94 },
  ],
  recentDocuments: [
    {
      jobId: "job-seed-1",
      documentName: "Annual_Financial_Audit_2024.pdf",
      category: "optimize",
      operationLabel: "Compress (Medium)",
      completedTicks: 10,
      percentage: 100,
      status: "completed",
      originalBytes: 48_797_794,
      outputBytes: 12_687_769,
      outputPath: "Exports/Annual_Financial_Audit_2024_xenon.pdf",
      createdLabel: "12 Mins ago",
    },
    {
      jobId: "job-seed-2",
      documentName: "Company_Legal_Contracts_Signed.pdf",
      category: "security",
      operationLabel: "Sign & Flatten",
      completedTicks: 10,
      percentage: 100,
      status: "completed",
      originalBytes: 8_808_038,
      outputBytes: 8_808_038,
      outputPath: "Exports/Company_Legal_Contracts_Signed.pdf",
      createdLabel: "1 Hour ago",
    },
    {
      jobId: "job-seed-3",
      documentName: "Engineering_Blueprints_Scan.pdf",
      category: "convert",
      operationLabel: "Split & OCR (PDF/A)",
      completedTicks: 7,
      percentage: 70,
      status: "processing",
      originalBytes: 130_023_424,
      outputPath: "Exports/Engineering_Blueprints_Scan_ocr.pdf",
      createdLabel: "Just now",
    },
    {
      jobId: "job-seed-4",
      documentName: "Batch_HR_Employee_Forms.pdf",
      category: "organize",
      operationLabel: "Merge (18 files)",
      completedTicks: 10,
      percentage: 100,
      status: "completed",
      originalBytes: 36_280_729,
      outputBytes: 36_280_729,
      outputPath: "Exports/Batch_HR_Employee_Forms.pdf",
      createdLabel: "Yesterday",
    },
  ],
};

function readFallback<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeFallback<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors in browser preview
  }
}

export const tauriClient = {
  async getHardwareTelemetry(): Promise<HardwareTelemetry> {
    if (isTauriRuntime()) {
      return invoke<HardwareTelemetry>("get_hardware_telemetry");
    }
    const settings = readFallback(FALLBACK_STORAGE_SETTINGS, defaultFallbackSettings);
    return {
      ramUsedMb: 142,
      totalRamGb: 16.0,
      cpuUsagePercent: 2.1,
      physicalCores: 8,
      activeWorkerThreads: settings.workerThreads,
      memoryCacheLimitMb: settings.memoryCacheLimitMb,
      tempCacheSizeBytes: 0,
      targetArch: "x86_64-pc-windows-msvc",
    };
  },

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    if (isTauriRuntime()) {
      return invoke<DashboardMetrics>("get_dashboard_metrics");
    }
    const demoOn = readFallback(FALLBACK_STORAGE_DEMO_MODE, false);
    return readFallback(
      FALLBACK_STORAGE_METRICS,
      demoOn ? showcaseFallbackMetrics : defaultFallbackMetrics
    );
  },

  async getDemoShowcaseMode(): Promise<boolean> {
    if (isTauriRuntime()) {
      return invoke<boolean>("get_demo_showcase_mode");
    }
    return readFallback(FALLBACK_STORAGE_DEMO_MODE, false);
  },

  async setDemoShowcaseMode(enabled: boolean): Promise<DashboardMetrics> {
    if (isTauriRuntime()) {
      return invoke<DashboardMetrics>("set_demo_showcase_mode", { enabled });
    }
    writeFallback(FALLBACK_STORAGE_DEMO_MODE, enabled);
    const next = enabled ? showcaseFallbackMetrics : defaultFallbackMetrics;
    writeFallback(FALLBACK_STORAGE_METRICS, next);
    return next;
  },

  async verifyEngines(): Promise<EngineDiagnosticStatus[]> {
    if (isTauriRuntime()) {
      return invoke<EngineDiagnosticStatus[]>("verify_engines");
    }
    return [
      {
        name: "ghostscript",
        displayName: "Ghostscript (v10.03.1)",
        version: "v10.03.1",
        binaryPath: "src-tauri/binaries/gs-x86_64-pc-windows-msvc.exe",
        sha256: "b7c4f21a9d08e3a10044b6d8f9e0a123456789abcdef0123456789abcdef0123",
        sha256Verified: true,
        status: "connected_bundled",
        description:
          "High-ratio image downsampling, ISO 19005 PDF/A archival export, and built-in pdfocr24 Tesseract OCR (eng + ind).",
      },
      {
        name: "pdfium",
        displayName: "PDFium Engine (v124.0.6)",
        version: "v124.0.6",
        binaryPath: "src-tauri/resources/lib/pdfium.dll",
        sha256: "c19a4f8821c03d9e112233445566778899aabbccddeeff001122334455667788",
        sha256Verified: true,
        status: "active_ffi",
        description:
          "High-resolution sub-pixel page rasterization, text bounding extraction, and High-DPI True Redaction burn-in.",
      },
      {
        name: "qpdf",
        displayName: "QPDF Native CLI (v11.9.0)",
        version: "v11.9.0",
        binaryPath: "src-tauri/binaries/qpdf-x86_64-pc-windows-msvc.exe",
        sha256: "d40e5a1199887766554433221100ffeeddccbbaa99887766554433221100aabb",
        sha256Verified: true,
        status: "connected_bundled",
        description:
          "Structural normalization, page reordering, stream linearization (Fast Web View), xref repair, and AES-256 encryption.",
      },
      {
        name: "lopdf_crypto",
        displayName: "Lopdf & Rust PDF Core",
        version: "v0.34.0",
        binaryPath: "embedded://rust-core/lopdf-cms",
        sha256: "e81b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef",
        sha256Verified: true,
        status: "embedded",
        description:
          "Zero external dependency, memory-safe PDF parser with stream size estimator, XMP sanitizer, and PKCS#12 CMS signer.",
      },
    ];
  },

  async testEngineBinary(name: EngineName): Promise<EngineTestResult> {
    if (isTauriRuntime()) {
      return invoke<EngineTestResult>("test_engine_binary", { name });
    }
    return {
      name,
      success: true,
      version: name === "ghostscript" ? "v10.03.1" : name === "qpdf" ? "v11.9.0" : "v1.0.0",
      binaryPath: `bundled://${name}`,
      sha256: "verified-local-preview-checksum",
      output: `${name} self-test passed (browser preview fallback)`,
      latencyMs: 12,
    };
  },

  async getAppSettings(): Promise<AppSettings> {
    if (isTauriRuntime()) {
      return invoke<AppSettings>("get_app_settings");
    }
    return readFallback(FALLBACK_STORAGE_SETTINGS, defaultFallbackSettings);
  },

  async saveAppSettings(settings: AppSettings): Promise<AppSettings> {
    if (isTauriRuntime()) {
      return invoke<AppSettings>("save_app_settings", { settings });
    }
    writeFallback(FALLBACK_STORAGE_SETTINGS, settings);
    return settings;
  },

  async restoreDefaultSettings(): Promise<AppSettings> {
    if (isTauriRuntime()) {
      return invoke<AppSettings>("restore_default_settings");
    }
    writeFallback(FALLBACK_STORAGE_SETTINGS, defaultFallbackSettings);
    return defaultFallbackSettings;
  },

  async clearTempCache(): Promise<number> {
    if (isTauriRuntime()) {
      return invoke<number>("clear_temp_cache");
    }
    return 0;
  },

  async getEngineLogs(): Promise<EngineLogEntry[]> {
    if (isTauriRuntime()) {
      return invoke<EngineLogEntry[]>("get_engine_logs");
    }
    return [
      {
        id: "preview-1",
        timestamp: "00:00:01.024",
        level: "INFO",
        engine: "tauri",
        message: "Browser preview mode active (run via `npm run tauri dev` for live Rust SQLite & sidecars).",
      },
    ];
  },

  async clearEngineLogs(): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("clear_engine_logs");
    }
  },

  async cancelRecentJob(jobId: string): Promise<DashboardMetrics> {
    if (isTauriRuntime()) {
      return invoke<DashboardMetrics>("cancel_recent_job", { jobId });
    }
    const current = readFallback(FALLBACK_STORAGE_METRICS, defaultFallbackMetrics);
    const updated: DashboardMetrics = {
      ...current,
      recentDocuments: current.recentDocuments.map((d) =>
        d.jobId === jobId ? { ...d, status: "failed", createdLabel: "Cancelled" } : d
      ),
    };
    writeFallback(FALLBACK_STORAGE_METRICS, updated);
    return updated;
  },

  async rerunRecentJob(jobId: string): Promise<JobTickEvent> {
    if (isTauriRuntime()) {
      return invoke<JobTickEvent>("rerun_recent_job", { jobId });
    }
    const current = readFallback(FALLBACK_STORAGE_METRICS, defaultFallbackMetrics);
    const source =
      current.recentDocuments.find((d) => d.jobId === jobId) ?? current.recentDocuments[0];
    const cloned: JobTickEvent = {
      ...source,
      jobId: `job-${Date.now()}`,
      status: "completed",
      completedTicks: 10,
      percentage: 100,
      createdLabel: "Just now",
    };
    const updated: DashboardMetrics = {
      ...current,
      processedTodayCount: current.processedTodayCount + 1,
      recentDocuments: [cloned, ...current.recentDocuments],
    };
    writeFallback(FALLBACK_STORAGE_METRICS, updated);
    return cloned;
  },

  async openPdf(path: string, password?: string): Promise<OpenedDocumentDto> {
    if (isTauriRuntime()) {
      return invoke<OpenedDocumentDto>("open_pdf", { path, password });
    }
    const name = path.split(/[\\/]/).pop() ?? "Document.pdf";
    return createPreviewOpenedDoc(`doc-${Date.now()}`, path, name, 12);
  },

  async getInitialSamplePdf(): Promise<OpenedDocumentDto> {
    if (isTauriRuntime()) {
      return invoke<OpenedDocumentDto>("get_initial_sample_pdf");
    }
    return createPreviewOpenedDoc(
      "doc-sample-1",
      "Local Workspace Sample",
      "Technical_Specification_v2.4.pdf",
      12
    );
  },

  async insertImagesOrPdf(paths: string[]): Promise<OpenedDocumentDto[]> {
    if (isTauriRuntime()) {
      return invoke<OpenedDocumentDto[]>("insert_images_or_pdf", { paths });
    }
    return paths.map((p, idx) => {
      const name = p.split(/[\\/]/).pop() ?? `Inserted_${idx + 1}.pdf`;
      const isImg = /\.(jpg|jpeg|png|webp|tiff|tif|bmp)$/i.test(name);
      return createPreviewOpenedDoc(`doc-ins-${Date.now()}-${idx}`, p, name, isImg ? 1 : 4);
    });
  },

  async getPageTileSvg(
    docId: string,
    pageNumber: number,
    width: number,
    rotate: number
  ): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("get_page_tile_svg", {
        docId,
        pageNumber,
        width,
        rotate,
      });
    }
    return "";
  },

  async executeOrganizePdf(options: OrganizeOptions): Promise<OrganizeExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<OrganizeExecutionResult>("execute_organize_pdf", { options });
    }
    return {
      outputPath: options.outputPath,
      pageCount: options.pages.length,
      originalBytes: options.pages.length * 1_420_000,
      outputBytes: Math.round(options.pages.length * 1_240_000),
      durationMs: 145,
      qpdfCommand: `qpdf --empty --pages (${options.pages.length} pages) -- "${options.outputPath}"`,
    };
  },

  async executeMergePdfs(
    inputPaths: string[],
    retainBookmarksToc: boolean,
    standardizeToA4: boolean,
    pdfVersionProfile: string,
    outputPath: string
  ): Promise<OrganizeExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<OrganizeExecutionResult>("execute_merge_pdfs", {
        inputPaths,
        retainBookmarksToc,
        standardizeToA4,
        pdfVersionProfile,
        outputPath,
      });
    }
    return {
      outputPath,
      pageCount: inputPaths.length * 8,
      originalBytes: inputPaths.length * 6_400_000,
      outputBytes: inputPaths.length * 6_100_000,
      durationMs: 210,
      qpdfCommand: `qpdf --empty --pages ${inputPaths.join(" ")} -- "${outputPath}"`,
    };
  },

  async executeSplitPdf(options: SplitOptions): Promise<OrganizeExecutionResult[]> {
    if (isTauriRuntime()) {
      return invoke<OrganizeExecutionResult[]>("execute_split_pdf", { options });
    }
    return [
      {
        outputPath: `${options.outputDir}\\split_part1.pdf`,
        pageCount: 4,
        originalBytes: 12_400_000,
        outputBytes: 4_100_000,
        durationMs: 95,
        qpdfCommand: `qpdf "${options.inputPath}" --pages "${options.inputPath}" 1-4 -- split_part1.pdf`,
      },
    ];
  },

  async estimateCompressedSize(
    inputPath: string,
    profile: string,
    customDpi?: number,
    customJpegQuality?: number
  ): Promise<SizeEstimateResult> {
    if (isTauriRuntime()) {
      return invoke<SizeEstimateResult>("estimate_compressed_size", {
        inputPath,
        profile,
        customDpi,
        customJpegQuality,
      });
    }
    const factor =
      profile === "screen"
        ? 0.28
        : profile === "ebook"
          ? 0.44
          : profile === "printer"
            ? 0.72
            : profile === "prepress"
              ? 0.85
              : Math.min(0.9, Math.max(0.2, ((customDpi ?? 150) / 300) * ((customJpegQuality ?? 75) / 100)));
    const orig = 17_196_646;
    const est = Math.round(orig * factor);
    return {
      originalBytes: orig,
      estimatedBytes: est,
      estimatedReductionPercent: Math.round((1 - factor) * 1000) / 10,
      imageStreamBytes: Math.round(orig * 0.76),
    };
  },

  async compressPdf(options: CompressOptions): Promise<CompressExecutionResult[]> {
    if (isTauriRuntime()) {
      return invoke<CompressExecutionResult[]>("compress_pdf", { options });
    }
    return options.inputPaths.map((p) => ({
      inputPath: p,
      outputPath: `${options.outputDir}\\compressed_${p.split(/[\\/]/).pop() ?? "doc.pdf"}`,
      originalBytes: 17_196_646,
      outputBytes: 4_815_060,
      reductionPercent: 72.0,
      pageCount: 12,
      durationMs: 340,
      gsCommand: `gs -sDEVICE=pdfwrite -dPDFSETTINGS=/${options.profile} "${p}"`,
    }));
  },

  async repairPdf(inputPath: string, outputPath: string): Promise<RepairExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<RepairExecutionResult>("repair_pdf", { inputPath, outputPath });
    }
    return {
      outputPath,
      recoveredPages: 12,
      fixedXrefEntries: 148,
      originalBytes: 17_196_646,
      outputBytes: 16_980_200,
      durationMs: 112,
      commandLog: `qpdf --repair "${inputPath}" "${outputPath}"`,
    };
  },

  async linearizePdf(inputPath: string, outputPath: string): Promise<OptimizeSingleResult> {
    if (isTauriRuntime()) {
      return invoke<OptimizeSingleResult>("linearize_pdf", { inputPath, outputPath });
    }
    return {
      outputPath,
      originalBytes: 17_196_646,
      outputBytes: 16_520_100,
      pageCount: 12,
      durationMs: 88,
      commandLog: `qpdf --linearize "${inputPath}" "${outputPath}"`,
    };
  },

  async sanitizeMetadata(inputPath: string, outputPath: string): Promise<SanitizeResult> {
    if (isTauriRuntime()) {
      return invoke<SanitizeResult>("sanitize_metadata", { inputPath, outputPath });
    }
    return {
      outputPath,
      originalBytes: 17_196_646,
      outputBytes: 16_890_000,
      removedMetadataStreams: 2,
      strippedInfoKeys: 6,
      prunedOrphanObjects: 14,
      durationMs: 42,
    };
  },

  async encryptPdf(options: SecuritySignOptions): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("encrypt_pdf", { options });
    }
    return {
      outputPath: options.outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_201_400,
      pageCount: 12,
      durationMs: 74,
      commandLog: `qpdf --encrypt <user> <owner> 256 -- "${options.inputPath}" "${options.outputPath}"`,
      summary: `Encrypted with ${options.encryption?.level ?? "AES-256"}`,
    };
  },

  async decryptPdf(
    inputPath: string,
    password: string,
    outputPath: string
  ): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("decrypt_pdf", {
        inputPath,
        password,
        outputPath,
      });
    }
    return {
      outputPath,
      originalBytes: 17_201_400,
      outputBytes: 17_196_646,
      pageCount: 12,
      durationMs: 55,
      commandLog: `qpdf --decrypt "${inputPath}" "${outputPath}"`,
      summary: "Decrypted PDF protection across 12 page(s)",
    };
  },

  async generateDemoP12(commonName: string, passphrase: string): Promise<KeystoreInfoDto> {
    if (isTauriRuntime()) {
      return invoke<KeystoreInfoDto>("generate_demo_p12", {
        commonName,
        passphrase,
      });
    }
    return {
      p12Path: `C:\\Users\\xenon\\certs\\${commonName.replace(/\W+/g, "_")}.p12`,
      subject: `CN=${commonName} (Local PKCS#12)`,
      fingerprintSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };
  },

  async signPdfPkcs12(options: SecuritySignOptions): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("sign_pdf_pkcs12", { options });
    }
    return {
      outputPath: options.outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_203_900,
      pageCount: 12,
      durationMs: 65,
      commandLog: `lopdf_crypto::incremental_pades_sign -> "${options.outputPath}"`,
      summary: "Signed incrementally with PKCS#12 detached CMS/SHA-256 signature",
    };
  },

  async applyWatermark(options: SecuritySignOptions): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("apply_watermark", { options });
    }
    return {
      outputPath: options.outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_240_120,
      pageCount: 12,
      durationMs: 82,
      commandLog: `lopdf::watermark -> "${options.outputPath}"`,
      summary: `Applied ${options.watermark?.layer ?? "foreground"} watermark across 12 page(s)`,
    };
  },

  async flattenPdf(inputPath: string, outputPath: string): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("flatten_pdf", { inputPath, outputPath });
    }
    return {
      outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_150_000,
      pageCount: 12,
      durationMs: 49,
      commandLog: `lopdf::flatten -> "${outputPath}"`,
      summary: "Flattened interactive annotations across 12 page(s)",
    };
  },

  async trueRedact(options: SecuritySignOptions): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("true_redact", { options });
    }
    const count = options.redactions?.boxes.length ?? 0;
    return {
      outputPath: options.outputPath,
      originalBytes: 17_196_646,
      outputBytes: 18_420_000,
      pageCount: 12,
      durationMs: 280,
      commandLog: `pdfium::true_redaction(dpi=300, boxes=${count}) -> "${options.outputPath}"`,
      summary: `Permanently burned ${count} redaction box(es) at 300 DPI`,
    };
  },

  async findTextRedactionBoxes(params: {
    inputPath: string;
    query: string;
    mode: "text" | "phone" | "email" | "digits";
    caseSensitive: boolean;
    fillColorHex: string;
  }): Promise<RedactionBox[]> {
    if (isTauriRuntime()) {
      return invoke<RedactionBox[]>("find_text_redaction_boxes", params);
    }
    return [];
  },

  async stampVisualSignature(params: {
    inputPath: string;
    outputPath: string;
    imagePath: string;
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("stamp_visual_signature", params);
    }
    return {
      outputPath: params.outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_260_000,
      pageCount: 12,
      durationMs: 55,
      commandLog: `lopdf::visual_signature(page=${params.page}) -> "${params.outputPath}"`,
      summary: `Stamped visual image signature on page ${params.page}`,
    };
  },

  async pdfToImages(options: PdfToImagesOptions): Promise<string[]> {
    if (isTauriRuntime()) {
      return invoke<string[]>("pdf_to_images", { options });
    }
    return [
      `${options.outputDir}\\page_001.${options.format}`,
      `${options.outputDir}\\page_002.${options.format}`,
    ];
  },

  async imagesToPdf(options: ImagesToPdfOptions): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("images_to_pdf", { options });
    }
    return {
      outputPath: options.outputPath,
      originalBytes: options.imagePaths.length * 1_200_000,
      outputBytes: options.imagePaths.length * 840_000,
      pageCount: options.imagePaths.length,
      durationMs: 110,
      commandLog: `pdfium::images_to_pdf(${options.imagePaths.length} images) -> "${options.outputPath}"`,
      summary: `Combined ${options.imagePaths.length} image(s) into ${options.paperSize.toUpperCase()} PDF`,
    };
  },

  async ocrPdf(options: OcrPdfOptions): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("ocr_pdf", { options });
    }
    return {
      outputPath: options.outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_480_000,
      pageCount: 12,
      durationMs: 620,
      commandLog: `gs -sDEVICE=pdfocr24 -sOCRLanguage="${options.languages.join("+")}" -r${options.dpi}`,
      summary: `OCR (${options.languages.join("+")} @ ${options.dpi} DPI) completed across 12 page(s)`,
    };
  },

  async convertPdfA(
    inputPath: string,
    conformance: string,
    outputPath: string
  ): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("convert_pdfa", {
        inputPath,
        conformance,
        outputPath,
      });
    }
    return {
      outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_310_000,
      pageCount: 12,
      durationMs: 190,
      commandLog: `gs -dPDFA=2 -sOutputICCProfile=sRGB.icc "${inputPath}"`,
      summary: `Converted to ISO 19005 ${conformance.toUpperCase()} with embedded sRGB.icc`,
    };
  },

  async comparePdfs(options: ComparePdfsOptions): Promise<PageDiffSummary[]> {
    if (isTauriRuntime()) {
      return invoke<PageDiffSummary[]>("compare_pdfs", { options });
    }
    return [
      {
        pageNumber: 1,
        pixelDifferenceRatio: 0.18,
        heatmapDataUrl: "",
        textChanges: [
          { changeType: "equal", text: "XENON Master Service Agreement payment terms:" },
          { changeType: "delete", text: "net 30 days" },
          { changeType: "insert", text: "net 15 days" },
          { changeType: "equal", text: "from invoice date." },
        ],
      },
    ];
  },

  async getFormFields(inputPath: string): Promise<FormFieldSpec[]> {
    if (isTauriRuntime()) {
      return invoke<FormFieldSpec[]>("get_form_fields", { inputPath });
    }
    return [];
  },

  async saveFormFields(
    inputPath: string,
    outputPath: string,
    fields: FormFieldSpec[],
    flattenOnSave: boolean
  ): Promise<SecurityExecutionResult> {
    if (isTauriRuntime()) {
      return invoke<SecurityExecutionResult>("save_form_fields", {
        inputPath,
        outputPath,
        fields,
        flattenOnSave,
      });
    }
    return {
      outputPath,
      originalBytes: 17_196_646,
      outputBytes: 17_240_000,
      pageCount: 12,
      durationMs: 90,
      commandLog: `lopdf::acroform(fields=${fields.length}, flatten=${flattenOnSave})`,
      summary: `${flattenOnSave ? "Flattened" : "Saved"} ${fields.length} AcroForm widget(s)`,
    };
  },

  async checkExistingPaths(paths: string[]): Promise<string[]> {
    if (isTauriRuntime()) {
      return invoke<string[]>("check_existing_paths", { paths });
    }
    return [];
  },

  async revealInExplorer(path: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("reveal_in_explorer", { path });
    }
  },

  async openFileInOs(path: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("open_file_in_os", { path });
    }
  },

  async pauseBatchJob(jobId: string): Promise<boolean> {
    if (isTauriRuntime()) {
      return invoke<boolean>("pause_batch_job", { jobId });
    }
    return true;
  },

  async resumeBatchJob(jobId: string): Promise<boolean> {
    if (isTauriRuntime()) {
      return invoke<boolean>("resume_batch_job", { jobId });
    }
    return true;
  },

  async cancelBatchJob(jobId: string): Promise<boolean> {
    if (isTauriRuntime()) {
      return invoke<boolean>("cancel_batch_job", { jobId });
    }
    return true;
  },
};

function createPreviewOpenedDoc(
  docId: string,
  filePath: string,
  fileName: string,
  pageCount: number
): OpenedDocumentDto {
  const titles = [
    "Executive Architecture Overview",
    "Zero-Cloud Security & CSP Guarantees",
    "PDFium Rasterization & LRU Tile Cache",
    "QPDF Structural Reordering Pipeline",
    "Ghostscript Downsampling Profiles",
    "ISO 19005 PDF/A Archival Compliance",
    "High-DPI True Redaction Burn-in",
    "PKCS#12 Incremental PAdES Signing",
    "AcroForm Widget Field Specification",
    "SQLite Local Telemetry & KPI Schema",
    "OS Process Tree Suspend/Resume Control",
    "Appendix: Offline SHA-256 Manifest",
  ];
  return {
    docId,
    filePath,
    fileName,
    fileSizeBytes: 17_196_646,
    pageCount,
    pdfVersion: "1.7",
    isEncrypted: false,
    hasBookmarks: true,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      widthPts: 595.28,
      heightPts: 841.89,
      rotation: 0,
      mediaBox: [0, 0, 595.28, 841.89],
      textPreview: [
        `Page ${i + 1} — ${titles[i % titles.length]}`,
        "XENON Private PDF Workspace (Local Core)",
      ],
    })),
  };
}

export function getXenonTileUrl(
  docId: string,
  pageNumber: number,
  width = 320,
  rotate = 0
): string | null {
  if (!isTauriRuntime()) return null;
  const encodedDoc = encodeURIComponent(docId);
  const isWindows =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
  return isWindows
    ? `http://xenon.localhost/tile/${encodedDoc}/${pageNumber}?width=${width}&rotate=${rotate}`
    : `xenon://tile/${encodedDoc}/${pageNumber}?width=${width}&rotate=${rotate}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 100 || idx === 0 ? value.toFixed(0) : value.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}

export function formatCompressionDelta(originalBytes: number, outputBytes?: number): string | null {
  if (!outputBytes || originalBytes <= 0 || outputBytes >= originalBytes) return null;
  const pct = Math.round(((originalBytes - outputBytes) / originalBytes) * 100);
  return `-${pct}%`;
}
