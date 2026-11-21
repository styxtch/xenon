import React, { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AppIcon } from "../components/common/AppIcon";
import { DropZoneWell } from "../components/common/DropZoneWell";
import { InlineImportProgress } from "../components/common/InlineImportProgress";
import {
  OutputTargetCard,
  deriveDefaultFilename,
  resolveOutputPath,
} from "../components/common/OutputTargetCard";
import { RedactionCanvas } from "../components/security/RedactionCanvas";
import { SignatureInspector } from "../components/security/SignatureInspector";
import { WatermarkInspector } from "../components/security/WatermarkInspector";
import {
  getXenonTileUrl,
  isTauriRuntime,
  tauriClient,
} from "../lib/tauriClient";
import { useImportProgressStore } from "../stores/importProgressStore";
import { useProcessModalStore } from "../stores/processModalStore";
import { runWithMinimumProgress } from "../lib/progressTiming";
import {
  isP12Path,
  isPdfPath,
  useDragDropStore,
} from "../stores/dragDropStore";
import { useHistoryStore } from "../stores/historyStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import { toolFileSig, useToolFilesStore } from "../stores/toolFilesStore";
import type { RedactionBox } from "../types/xenon";

type SecuritySubTab = "protect" | "unlock" | "vsign" | "sign" | "watermark" | "redact";

interface SecuritySignViewProps {
  onOpenFiles: () => void;
}
const EMPTY_PATHS: string[] = [];

export const SecuritySignView: React.FC<SecuritySignViewProps> = ({
  onOpenFiles,
}) => {
  const [subTab, setSubTab] = useState<SecuritySubTab>("protect");
  const [outputFilename, setOutputFilename] = useState<string>("");
  const [previewDocId, setPreviewDocId] = useState<string>("");

  // Protect AES-256 state
  const [encLevel, setEncLevel] = useState<"aes-256" | "aes-128" | "pdf2-aes256">("aes-256");
  const [userPassword, setUserPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [allowPrint, setAllowPrint] = useState(true);
  const [allowCopy, setAllowCopy] = useState(false);
  const [allowModify, setAllowModify] = useState(false);
  const [allowFormFill, setAllowFormFill] = useState(true);

  // Unlock state
  const [unlockPassword, setUnlockPassword] = useState("");

  // Signature state
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [p12Path, setP12Path] = useState(settings.p12KeystorePath);
  const [p12Subject, setP12Subject] = useState(settings.p12KeystoreSubject);
  const [p12Passphrase, setP12Passphrase] = useState("");
  const [sigReason, setSigReason] = useState("Approved & Signed Offline");
  const [sigLocation, setSigLocation] = useState("Local Workstation");
  const [sigContact, setSigContact] = useState("security@xenon.local");
  const [stampPage, setStampPage] = useState(1);
  const [stampX, setStampX] = useState(36);
  const [stampY, setStampY] = useState(36);
  const [stampW, setStampW] = useState(180);
  const [stampH, setStampH] = useState(64);
  const [sigImagePath, setSigImagePath] = useState("");

  // Watermark state
  const [wmKind, setWmKind] = useState<"text" | "image">("text");
  const [wmText, setWmText] = useState("CONFIDENTIAL — XENON");
  const [wmFontSize, setWmFontSize] = useState(44);
  const [wmColorHex, setWmColorHex] = useState("#4EDEA3");
  const [wmOpacity, setWmOpacity] = useState(0.35);
  const [wmRotation, setWmRotation] = useState(45);
  const [wmLayer, setWmLayer] = useState<"foreground" | "background">("foreground");
  const [wmTargetPages, setWmTargetPages] = useState("all");
  const [flattenAll, setFlattenAll] = useState(true);
  const [previewPageCount, setPreviewPageCount] = useState(1);
  const [previewPageDims, setPreviewPageDims] = useState<
    Array<{ widthPts: number; heightPts: number }>
  >([]);

  // Redaction state
  const [redactionBoxes, setRedactionBoxes] = useState<RedactionBox[]>([]);
  const [preserveUnredactedText, setPreserveUnredactedText] = useState(true);

  const [isExecuting, setIsExecuting] = useState(false);
  const [processingPercent, setProcessingPercent] = useState(0);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toolKey = `security:${subTab}`;
  const setActiveToolKey = useToolFilesStore((s) => s.setActiveToolKey);
  const securityPdfPath = useToolFilesStore(
    (s) => (s.filesByTool[toolKey] ?? EMPTY_PATHS)[0] ?? ""
  );
  const setToolFiles = useToolFilesStore((s) => s.setToolFiles);
  const clearToolFiles = useToolFilesStore((s) => s.clearToolFiles);
  const markToolFileImported = useToolFilesStore((s) => s.markToolFileImported);
  const setSecurityPdfPath = (path: string) => setToolFiles(toolKey, [path]);
  const clearSecurityPdfPath = () => clearToolFiles(toolKey);

  useEffect(() => {
    setActiveToolKey(toolKey);
    setResultMessage(null);
    setErrorMessage(null);
  }, [toolKey, setActiveToolKey]);

  useEffect(() => {
    if (settings.p12KeystorePath && !p12Path) {
      setP12Path(settings.p12KeystorePath);
      setP12Subject(settings.p12KeystoreSubject);
    }
  }, [settings.p12KeystorePath, settings.p12KeystoreSubject, p12Path]);

  const outputDir = settings.primaryDestinationFolder || "Exports";

  useEffect(() => {
    if (!securityPdfPath) {
      setPreviewDocId("");
      setPreviewPageCount(1);
      return;
    }
    if (!isTauriRuntime()) {
      setPreviewDocId("");
      setPreviewPageCount(1);
      return;
    }
    const sig = toolFileSig(toolKey, securityPdfPath);
    const cached = useToolFilesStore.getState().previewMetaBySig[sig];
    if (cached) {
      setPreviewDocId(cached.docId);
      setPreviewPageCount(cached.pageCount);
      return;
    }
    let cancelled = false;
    const fileName = securityPdfPath.split(/[\\/]/).pop() ?? "Document.pdf";
    useImportProgressStore
      .getState()
      .startImport("Loading PDF security metadata...", fileName, 1);
    void (async () => {
      try {
        const dto = await tauriClient.openPdf(securityPdfPath);
        await useImportProgressStore.getState().finishImportAsync();
        if (!cancelled) {
          const pageCount = Math.max(1, dto.pageCount);
          markToolFileImported(toolKey, securityPdfPath, {
            docId: dto.docId,
            pageCount,
          });
          setPreviewDocId(dto.docId);
          setPreviewPageCount(pageCount);
          setPreviewPageDims(
            dto.pages.map((p) => ({
              widthPts: p.widthPts || 595.28,
              heightPts: p.heightPts || 841.89,
            }))
          );
        }
      } catch {
        useImportProgressStore.getState().cancelImport();
        if (!cancelled) {
          setPreviewDocId("");
          setPreviewPageCount(1);
          setPreviewPageDims([]);
        }
      }
    })();
    return () => {
      cancelled = true;
      useImportProgressStore.getState().cancelImport();
    };
  }, [securityPdfPath, toolKey, markToolFileImported]);

  const watermarkTileUrl = previewDocId
    ? getXenonTileUrl(previewDocId, 1, 560, 0)
    : null;

  useEffect(() => {
    const suffixMap: Record<SecuritySubTab, string> = {
      protect: "protected",
      unlock: "unlocked",
      vsign: "signed_visual",
      sign: "signed",
      watermark: "watermarked",
      redact: "redacted",
    };
    setOutputFilename(
      deriveDefaultFilename(securityPdfPath, "Document", suffixMap[subTab])
    );
  }, [securityPdfPath, subTab]);

  useEffect(() => {
    return useDragDropStore.getState().registerHandler(
      (droppedPaths) => {
        const pdfs = droppedPaths.filter(isPdfPath);
        const certs = droppedPaths.filter(isP12Path);

        if (pdfs.length > 0) {
          setSecurityPdfPath(pdfs[0]);
          setResultMessage(null);
          setErrorMessage(null);
        }
        if (certs.length > 0) {
          const certPath = certs[0];
          const certName =
            certPath.split(/[\\/]/).pop() || "PKCS#12 Certificate";
          setP12Path(certPath);
          setP12Subject(certName);
          setSubTab("sign");
          setResultMessage(`Loaded PKCS#12 certificate: ${certPath}`);
          setErrorMessage(null);
        }
      },
      "Drop a PDF file (or .p12/.pfx certificate) into Security & Sign"
    );
  }, [setSecurityPdfPath]);

  const getResolvedOutputPath = (fallbackSuffix: string, overrideName?: string) => {
    const fallbackName =
      deriveDefaultFilename(securityPdfPath, "Document", fallbackSuffix) ||
      `Document_${fallbackSuffix}.pdf`;
    return resolveOutputPath(
      outputDir,
      overrideName ?? outputFilename,
      fallbackName
    );
  };

  const handlePickPdf = async () => {
    if (!isTauriRuntime()) {
      onOpenFiles();
      return;
    }
    const picked = await open({
      multiple: false,
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    if (typeof picked === "string") {
      setSecurityPdfPath(picked);
      setResultMessage(null);
      setErrorMessage(null);
    }
  };

  const handleClearPdf = () => {
    clearSecurityPdfPath();
    setResultMessage(null);
    setErrorMessage(null);
  };

  const refreshMetricsAndLogs = async () => {
    await useHistoryStore.getState().fetchDashboardMetrics();
    await useTelemetryStore.getState().loadLogs();
  };

  const handleEncrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!securityPdfPath) return;
    const outPath = getResolvedOutputPath("protected");
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths([outPath], "Encrypt PDF");
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const res = await runWithMinimumProgress(
        () =>
          tauriClient.encryptPdf({
            inputPath: securityPdfPath,
            outputPath: finalOutPath,
            encryption: {
              level: encLevel,
              userPassword: userPassword || undefined,
              ownerPassword: ownerPassword || undefined,
              allowPrint,
              allowCopy,
              allowModify,
              allowFormFill,
            },
            flattenAll: false,
            sanitizeXmp: settings.sanitizeMetadataXmp,
          }),
        setProcessingPercent
      );
      setResultMessage(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: "PDF Encryption Completed",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!securityPdfPath) return;
    const outPath = getResolvedOutputPath("unlocked");
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths([outPath], "Unlock PDF");
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const res = await runWithMinimumProgress(
        () =>
          tauriClient.decryptPdf(
            securityPdfPath,
            unlockPassword,
            finalOutPath
          ),
        setProcessingPercent
      );
      setResultMessage(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: "PDF Decryption Completed",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleGenerateLocalP12 = async () => {
    try {
      const info = await tauriClient.generateDemoP12(
        "XENON_Local_Signer",
        p12Passphrase || "xenon-secret"
      );
      setP12Path(info.p12Path);
      setP12Subject(info.subject);
      updateSetting("p12KeystorePath", info.p12Path);
      updateSetting("p12KeystoreSubject", info.subject);
      setResultMessage(`Created PKCS#12 certificate: ${info.p12Path}`);
      await useTelemetryStore.getState().loadLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    }
  };

  const handleSignPdf = async () => {
    if (!securityPdfPath) return;
    const outPath = getResolvedOutputPath("signed");
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths([outPath], "Digital Sign PDF");
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const res = await runWithMinimumProgress(
        () =>
          tauriClient.signPdfPkcs12({
            inputPath: securityPdfPath,
            outputPath: finalOutPath,
            pkcs12Signature: {
              p12Path,
              passphrase: p12Passphrase || undefined,
              reason: sigReason,
              location: sigLocation,
              contactInfo: sigContact,
              visualStamp: {
                page: stampPage,
                x: stampX,
                y: stampY,
                w: stampW,
                h: stampH,
                signatureImagePath: sigImagePath || undefined,
              },
            },
            flattenAll: false,
            sanitizeXmp: false,
          }),
        setProcessingPercent
      );
      setResultMessage(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: "Digital Signature Applied",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleStampVisualSignature = async () => {
    if (!securityPdfPath || !sigImagePath) return;
    const outPath = getResolvedOutputPath("signed");
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths(
      [outPath],
      "Stamp Visual Signature"
    );
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const res = await runWithMinimumProgress(
        () =>
          tauriClient.stampVisualSignature({
            inputPath: securityPdfPath,
            outputPath: finalOutPath,
            imagePath: sigImagePath,
            page: stampPage,
            x: stampX,
            y: stampY,
            w: stampW,
            h: stampH,
          }),
        setProcessingPercent
      );
      setResultMessage(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: "Visual Signature Stamped",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleApplyWatermark = async () => {
    if (!securityPdfPath) return;
    const outPath = getResolvedOutputPath("watermarked");
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths([outPath], "Apply Watermark");
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const res = await runWithMinimumProgress(
        () =>
          tauriClient.applyWatermark({
            inputPath: securityPdfPath,
            outputPath: finalOutPath,
            watermark: {
              kind: wmKind,
              text: wmText,
              opacity: wmOpacity,
              rotationDeg: wmRotation,
              fontSizePts: wmFontSize,
              colorHex: wmColorHex,
              layer: wmLayer,
              targetPages: (() => {
                const raw = wmTargetPages.trim();
                if (!raw || raw.toLowerCase() === "all") return "all" as const;
                const nums = new Set<number>();
                for (const part of raw.split(",")) {
                  const seg = part.trim();
                  if (!seg) continue;
                  if (seg.includes("-")) {
                    const [aStr, bStr] = seg.split("-");
                    const a = Number(aStr?.trim());
                    const b = Number(bStr?.trim());
                    if (Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a) {
                      for (let p = a; p <= Math.min(b, 5000); p++) nums.add(p);
                    }
                  } else {
                    const n = Number(seg);
                    if (Number.isInteger(n) && n >= 1) nums.add(n);
                  }
                }
                return nums.size > 0 ? Array.from(nums).sort((a, b) => a - b) : ("all" as const);
              })(),
            },
            flattenAll,
            sanitizeXmp: settings.sanitizeMetadataXmp,
          }),
        setProcessingPercent
      );
      setResultMessage(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: "Watermark Applied",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleFlattenOnly = async () => {
    if (!securityPdfPath) return;
    const trimmed = outputFilename.trim();
    const effectiveFlattenName = /_watermarked\.pdf$/i.test(trimmed)
      ? trimmed.replace(/_watermarked\.pdf$/i, "_flattened.pdf")
      : trimmed;
    const outPath = getResolvedOutputPath("flattened", effectiveFlattenName);
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths([outPath], "Flatten Annotations");
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const res = await runWithMinimumProgress(
        () => tauriClient.flattenPdf(securityPdfPath, finalOutPath),
        setProcessingPercent
      );
      setResultMessage(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: "Annotations Flattened",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExecuteRedaction = async () => {
    if (!securityPdfPath) return;
    const outPath = getResolvedOutputPath("redacted");
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths([outPath], "True Redaction Burn-In");
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const res = await runWithMinimumProgress(
        () =>
          tauriClient.trueRedact({
            inputPath: securityPdfPath,
            outputPath: finalOutPath,
            redactions: {
              boxes: redactionBoxes,
              preserveUnredactedText,
              burnInDpi: 300,
            },
            flattenAll: true,
            sanitizeXmp: true,
          }),
        setProcessingPercent
      );
      setResultMessage(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: "True Redaction Completed",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-lg bg-tag-security/15 border border-tag-security/30 flex items-center justify-center text-tag-security">
              <AppIcon name="lock" className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-headline-md text-headline-md text-text-primary">
                  Security, Digital Sign &amp; Watermark
                </h1>
                <span className="font-caption text-caption px-2 py-0.5 rounded-full bg-tag-security/15 text-tag-security border border-tag-security/30">
                  AES-256 + PKCS#12 Incremental + Flatten
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-text-muted mt-0.5">
                Active PDF:{" "}
                <span className="font-mono-metric text-text-primary">
                  {securityPdfPath
                    ? securityPdfPath.split(/[\\/]/).pop()
                    : "No PDF selected"}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {securityPdfPath && (
              <button
                type="button"
                onClick={handleClearPdf}
                className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default hover:border-status-danger/50 text-text-secondary hover:text-error font-body-sm text-body-sm flex items-center gap-1.5 transition-colors"
              >
                <AppIcon name="close" className="w-4 h-4" />
                <span>Remove File</span>
              </button>
            )}
            <button
              type="button"
              onClick={handlePickPdf}
              className="px-3.5 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary font-body-sm text-body-sm flex items-center gap-1.5"
            >
              <AppIcon name="file_open" className="w-4 h-4 text-primary" />
              <span>Select PDF</span>
            </button>
          </div>
        </div>

        <div className="inline-flex p-1 bg-surface-elevated rounded-lg border border-border-subtle self-start flex-wrap">
          {(
            [
              { id: "protect", label: "Protect AES-256" },
              { id: "unlock", label: "Unlock PDF" },
              { id: "vsign", label: "Visual Sign (PNG/JPG)" },
              { id: "sign", label: "Digital Sign (.p12)" },
              { id: "watermark", label: "Watermark & Flatten" },
              { id: "redact", label: "True Redaction" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSubTab(tab.id);
                setResultMessage(null);
                setErrorMessage(null);
              }}
              className={`px-3 py-1.5 rounded-md font-body-sm text-body-sm transition-colors ${
                subTab === tab.id
                  ? "bg-surface-active text-text-primary font-medium"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {resultMessage && (
        <div className="p-3 rounded-xl bg-status-success/10 border border-status-success/30 font-body-sm text-body-sm text-status-success break-words">
          {resultMessage}
        </div>
      )}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-error-container/40 border border-status-danger/40 font-body-sm text-body-sm text-error break-words">
          {errorMessage}
        </div>
      )}

      {subTab === "redact" ? (
        <div className="flex flex-col gap-space-md">
          <InlineImportProgress />
          <RedactionCanvas
          docId={previewDocId}
          inputPdfPath={securityPdfPath}
          pageCount={previewPageCount}
          boxes={redactionBoxes}
          preserveUnredactedText={preserveUnredactedText}
          outputTargetCard={
            <OutputTargetCard
              outputFilename={outputFilename}
              onChangeOutputFilename={setOutputFilename}
              disabled={!securityPdfPath}
              isProcessing={isExecuting}
              processingPercent={processingPercent}
              processingLabel="Burning 300 DPI redactions..."
            >
              <button
                type="button"
                onClick={() => void handleExecuteRedaction()}
                disabled={
                  isExecuting || !securityPdfPath || redactionBoxes.length === 0
                }
                className="w-full py-3 rounded-lg bg-error-container hover:bg-status-danger disabled:opacity-50 text-white font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
              >
                <AppIcon
                  name={isExecuting ? "refresh" : "verified_user"}
                  className={`w-5 h-5 ${isExecuting ? "animate-spin" : ""}`}
                />
                <span>
                  {isExecuting
                    ? "Burning 300 DPI Redactions..."
                    : "Execute 300 DPI Burn-in"}
                </span>
              </button>
            </OutputTargetCard>
          }
          onAddBox={(box) => setRedactionBoxes((prev) => [...prev, box])}
          onAddBoxes={(items) => setRedactionBoxes((prev) => [...prev, ...items])}
          onUpdateBox={(idx, next) =>
            setRedactionBoxes((prev) =>
              prev.map((item, i) => (i === idx ? next : item))
            )
          }
          onRemoveBox={(idx) =>
            setRedactionBoxes((prev) => prev.filter((_, i) => i !== idx))
          }
          onClearBoxes={() => setRedactionBoxes([])}
          onTogglePreserveText={setPreserveUnredactedText}
        />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
          <div className="xl:col-span-8">
            {subTab === "watermark" ? (
              <div className="bg-surface-card border border-border-default rounded-xl p-space-xl flex flex-col items-center justify-center gap-4">
                <div className="w-full flex items-center justify-between flex-wrap gap-2">
                  <span className="font-headline-sm text-headline-sm text-text-primary">
                    Live Watermark Overlay Preview
                  </span>
                  <span className="font-mono-metric text-caption text-text-muted">
                    Layer: {wmLayer} • {Math.round(wmOpacity * 100)}% opacity • {wmRotation}°
                  </span>
                </div>
                <InlineImportProgress className="w-full" />
                {!securityPdfPath && (
                  <div className="w-full p-2.5 rounded-lg bg-surface-elevated/70 border border-border-subtle font-caption text-caption text-text-muted text-center">
                    No PDF selected — drop a PDF here or click Select PDF above to preview your actual document page.
                  </div>
                )}
                <div className="w-72 aspect-[1/1.414] rounded-lg bg-surface-container border border-border-default relative overflow-hidden shadow-inner">
                  {watermarkTileUrl ? (
                    <img
                      src={watermarkTileUrl}
                      alt="Watermark Preview"
                      draggable={false}
                      className="w-full h-full object-contain pointer-events-none select-none bg-white"
                    />
                  ) : (
                    <div className="w-full h-full p-6 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="w-20 h-2.5 rounded bg-tag-security/40" />
                        <div className="w-full h-2 rounded bg-text-disabled/30" />
                        <div className="w-5/6 h-2 rounded bg-text-disabled/25" />
                        <div className="w-2/3 h-2 rounded bg-text-disabled/25" />
                      </div>
                      <div className="w-full h-24 rounded bg-surface-elevated border border-border-subtle" />
                      <div className="space-y-1.5">
                        <div className="w-full h-2 rounded bg-text-disabled/20" />
                        <div className="w-3/4 h-2 rounded bg-text-disabled/20" />
                      </div>
                    </div>
                  )}

                  {/* Live rotated overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span
                      className="font-bold tracking-wider whitespace-nowrap select-none"
                      style={{
                        color: wmColorHex,
                        opacity: wmOpacity,
                        fontSize: `${Math.max(12, Math.round(wmFontSize * 0.45))}px`,
                        transform: `rotate(${-wmRotation}deg)`,
                      }}
                    >
                      {wmKind === "text" ? wmText || "WATERMARK" : "[IMAGE STAMP]"}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-surface-card border border-border-default rounded-xl p-space-xl flex flex-col gap-space-md">
                {!securityPdfPath && (
                  <DropZoneWell
                    title="Drag & drop a PDF (or .p12/.pfx cert) here, or click to select"
                    subtitle="Files opened here stay independent from Organize PDF Workspace."
                    onSelectFiles={handlePickPdf}
                    accentClass="text-tag-security"
                  />
                )}
                <InlineImportProgress />
                {securityPdfPath ? (
                  <div className="p-3 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-between gap-2">
                    <span className="font-mono-metric text-caption text-text-secondary truncate">
                      Target Path: {securityPdfPath}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearPdf}
                      title="Remove PDF"
                      className="p-1 rounded hover:bg-surface-card text-text-muted hover:text-error shrink-0 transition-colors"
                    >
                      <AppIcon name="close" className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-surface-elevated/50 border border-border-subtle font-caption text-caption text-text-muted">
                    No PDF selected — drag &amp; drop a PDF above or click Select PDF.
                  </div>
                )}

                {(subTab === "sign" || subTab === "vsign") && previewDocId && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
                        {subTab === "vsign"
                          ? `Page ${stampPage} — Drag Signature to Move, Drag Corner to Resize`
                          : `Click Page ${stampPage} to Position Signature Stamp`}
                      </span>
                      <span className="font-mono-metric text-caption text-primary">
                        X: {Math.round(stampX)}, Y: {Math.round(stampY)} • {Math.round(stampW)}×{Math.round(stampH)}pt
                      </span>
                    </div>
                    <div
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const xPts = ((e.clientX - rect.left) / rect.width) * 595.28;
                        const yFromTop = ((e.clientY - rect.top) / rect.height) * 841.89;
                        const w = subTab === "vsign" ? stampW : 180;
                        const h = subTab === "vsign" ? stampH : 48;
                        const pdfY = Math.max(
                          4,
                          Math.min(841.89 - h - 4, Math.round(841.89 - yFromTop - h / 2))
                        );
                        setStampX(
                          Math.max(4, Math.min(595.28 - w - 4, Math.round(xPts - w / 2)))
                        );
                        setStampY(pdfY);
                      }}
                      style={{
                        aspectRatio: (() => {
                          const d = previewPageDims[Math.max(0, Math.min(stampPage, previewPageCount) - 1)];
                          return d ? `${d.widthPts} / ${d.heightPts}` : "595.28 / 841.89";
                        })(),
                      }}
                      className="w-full max-w-[460px] mx-auto rounded-lg border border-border-default bg-bg-canvas relative overflow-hidden cursor-crosshair select-none"
                    >
                      <img
                        src={getXenonTileUrl(previewDocId, Math.min(stampPage, previewPageCount), 520, 0) ?? undefined}
                        alt={`Signature placement page ${stampPage}`}
                        draggable={false}
                        className="w-full h-full object-fill pointer-events-none select-none bg-white"
                      />
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const container = e.currentTarget.parentElement;
                          if (!container) return;
                          const rect = container.getBoundingClientRect();
                          const startClientX = e.clientX;
                          const startClientY = e.clientY;
                          const origX = stampX;
                          const origY = stampY;
                          const w = subTab === "vsign" ? stampW : 180;
                          const h = subTab === "vsign" ? stampH : 48;
                          const onMove = (mv: PointerEvent) => {
                            const dxPts = ((mv.clientX - startClientX) / rect.width) * 595.28;
                            const dyPts = ((mv.clientY - startClientY) / rect.height) * 841.89;
                            setStampX(
                              Math.max(4, Math.min(595.28 - w, Math.round(origX + dxPts)))
                            );
                            setStampY(
                              Math.max(4, Math.min(841.89 - h, Math.round(origY - dyPts)))
                            );
                          };
                          const onUp = () => {
                            window.removeEventListener("pointermove", onMove);
                            window.removeEventListener("pointerup", onUp);
                          };
                          window.addEventListener("pointermove", onMove);
                          window.addEventListener("pointerup", onUp);
                        }}
                        style={{
                          left: `${Math.max(0, Math.min(100 - ((subTab === "vsign" ? stampW : 180) / 595.28) * 100, (stampX / 595.28) * 100))}%`,
                          top: `${Math.max(0, Math.min(100 - ((subTab === "vsign" ? stampH : 48) / 841.89) * 100, ((841.89 - stampY - (subTab === "vsign" ? stampH : 48)) / 841.89) * 100))}%`,
                          width: `${((subTab === "vsign" ? stampW : 180) / 595.28) * 100}%`,
                          height: `${((subTab === "vsign" ? stampH : 48) / 841.89) * 100}%`,
                        }}
                        className="absolute rounded border-2 border-primary bg-primary/10 flex items-center justify-center font-mono-metric text-[10px] text-primary font-semibold cursor-move"
                      >
                        {subTab === "vsign" ? (
                          <>
                            {sigImagePath && isTauriRuntime() ? (
                              <img
                                src={convertFileSrc(sigImagePath)}
                                alt="Signature preview"
                                draggable={false}
                                className="w-full h-full object-fill pointer-events-none select-none"
                              />
                            ) : (
                              <span className="pointer-events-none px-1 text-center">
                                Select PNG / JPG
                              </span>
                            )}
                            <div
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                const container = e.currentTarget.parentElement?.parentElement;
                                if (!container) return;
                                const rect = container.getBoundingClientRect();
                                const startClientX = e.clientX;
                                const startClientY = e.clientY;
                                const origW = stampW;
                                const origH = stampH;
                                const origTop = 841.89 - stampY - origH;
                                const onMove = (mv: PointerEvent) => {
                                  const dxPts = ((mv.clientX - startClientX) / rect.width) * 595.28;
                                  const dyPts = ((mv.clientY - startClientY) / rect.height) * 841.89;
                                  const nextW = Math.max(40, Math.min(595.28 - stampX, Math.round(origW + dxPts)));
                                  const nextH = Math.max(20, Math.min(841.89 - origTop, Math.round(origH + dyPts)));
                                  setStampW(nextW);
                                  setStampH(nextH);
                                  setStampY(Math.max(4, Math.round(841.89 - origTop - nextH)));
                                };
                                const onUp = () => {
                                  window.removeEventListener("pointermove", onMove);
                                  window.removeEventListener("pointerup", onUp);
                                };
                                window.addEventListener("pointermove", onMove);
                                window.addEventListener("pointerup", onUp);
                              }}
                              title="Drag corner to resize signature"
                              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-sm bg-primary border border-white cursor-nwse-resize shadow"
                            />
                          </>
                        ) : (
                          "PKCS#12 Stamp"
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="xl:col-span-4">
            {subTab === "protect" && (
              <form
                onSubmit={handleEncrypt}
                className="flex flex-col gap-space-md"
              >
                <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    AES Encryption &amp; Permissions
                  </h2>
                  <select
                    value={encLevel}
                    onChange={(e) =>
                      setEncLevel(
                        e.target.value as "aes-256" | "aes-128" | "pdf2-aes256"
                      )
                    }
                    className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary"
                  >
                    <option value="aes-256">AES-256 bit (Acrobat 9.0+)</option>
                    <option value="aes-128">AES-128 bit (Acrobat 7.0+)</option>
                    <option value="pdf2-aes256">PDF 2.0 AES-256 bit + UTF-8</option>
                  </select>

                  <div>
                    <label className="block font-caption text-caption text-text-muted mb-1">
                      User Password (Required to Open)
                    </label>
                    <input
                      type="password"
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                      placeholder="Enter open password..."
                      className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary"
                    />
                  </div>

                  <div>
                    <label className="block font-caption text-caption text-text-muted mb-1">
                      Owner Password (Permissions Lock)
                    </label>
                    <input
                      type="password"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      placeholder="Optional owner password..."
                      className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary"
                    />
                  </div>

                  <div className="space-y-2 pt-1 border-t border-border-subtle">
                    {[
                      { label: "Allow Printing", val: allowPrint, set: setAllowPrint },
                      { label: "Allow Copy Text", val: allowCopy, set: setAllowCopy },
                      { label: "Allow Modifying", val: allowModify, set: setAllowModify },
                      { label: "Allow Form Filling", val: allowFormFill, set: setAllowFormFill },
                    ].map((perm) => (
                      <label
                        key={perm.label}
                        className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated border border-border-subtle cursor-pointer"
                      >
                        <span className="font-body-sm text-body-sm text-text-primary">
                          {perm.label}
                        </span>
                        <input
                          type="checkbox"
                          checked={perm.val}
                          onChange={(e) => perm.set(e.target.checked)}
                          className="w-4 h-4 accent-primary"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <OutputTargetCard
                  outputFilename={outputFilename}
                  onChangeOutputFilename={setOutputFilename}
                  disabled={!securityPdfPath}
                  isProcessing={isExecuting}
                  processingPercent={processingPercent}
                  processingLabel="Encrypting PDF via QPDF..."
                >
                  <button
                    type="submit"
                    disabled={isExecuting || !securityPdfPath}
                    className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
                  >
                    <AppIcon
                      name={isExecuting ? "refresh" : "lock"}
                      className={`w-5 h-5 ${isExecuting ? "animate-spin" : ""}`}
                    />
                    <span>
                      {isExecuting ? "Encrypting..." : "Encrypt & Protect PDF"}
                    </span>
                  </button>
                </OutputTargetCard>
              </form>
            )}

            {subTab === "unlock" && (
              <form
                onSubmit={handleUnlock}
                className="flex flex-col gap-space-md"
              >
                <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    Unlock Protected PDF
                  </h2>
                  <div>
                    <label className="block font-caption text-caption text-text-muted mb-1">
                      Document Password
                    </label>
                    <input
                      type="password"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      placeholder="Enter password to decrypt..."
                      className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary"
                    />
                  </div>
                </div>

                <OutputTargetCard
                  outputFilename={outputFilename}
                  onChangeOutputFilename={setOutputFilename}
                  disabled={!securityPdfPath}
                  isProcessing={isExecuting}
                  processingPercent={processingPercent}
                  processingLabel="Decrypting PDF via QPDF..."
                >
                  <button
                    type="submit"
                    disabled={
                      isExecuting || !securityPdfPath || !unlockPassword
                    }
                    className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
                  >
                    <AppIcon name="vpn_key" className="w-5 h-5" />
                    <span>
                      {isExecuting
                        ? "Decrypting..."
                        : "Decrypt & Save Unlocked PDF"}
                    </span>
                  </button>
                </OutputTargetCard>
              </form>
            )}

            {subTab === "vsign" && (
              <div className="flex flex-col gap-space-md">
                <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AppIcon name="draw" className="w-5 h-5 text-tag-security" />
                      <h2 className="font-headline-sm text-headline-sm text-text-primary">
                        Visual Signature (PNG / JPG)
                      </h2>
                    </div>
                    {sigImagePath && (
                      <button
                        type="button"
                        onClick={() => setSigImagePath("")}
                        className="font-caption text-caption text-error hover:underline"
                      >
                        Clear Image
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      if (!isTauriRuntime()) return;
                      const picked = await open({
                        multiple: false,
                        filters: [
                          {
                            name: "Signature Image",
                            extensions: ["png", "jpg", "jpeg", "webp"],
                          },
                        ],
                      });
                      if (typeof picked === "string") {
                        setSigImagePath(picked);
                      }
                    }}
                    className="w-full py-2.5 px-3 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-text-primary flex items-center justify-center gap-2"
                  >
                    <AppIcon name="image" className="w-4 h-4 text-primary" />
                    <span className="truncate">
                      {sigImagePath
                        ? sigImagePath.split(/[\\/]/).pop()
                        : "Select PNG / JPG Signature"}
                    </span>
                  </button>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block font-caption text-caption text-text-muted mb-1">
                        Page
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={previewPageCount}
                        value={stampPage}
                        onChange={(e) =>
                          setStampPage(
                            Math.min(previewPageCount, Math.max(1, Number(e.target.value)))
                          )
                        }
                        className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="block font-caption text-caption text-text-muted mb-1">
                        Width (pt)
                      </label>
                      <input
                        type="number"
                        min={40}
                        max={500}
                        value={stampW}
                        onChange={(e) =>
                          setStampW(Math.max(40, Math.min(500, Number(e.target.value))))
                        }
                        className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="block font-caption text-caption text-text-muted mb-1">
                        Height (pt)
                      </label>
                      <input
                        type="number"
                        min={20}
                        max={400}
                        value={stampH}
                        onChange={(e) =>
                          setStampH(Math.max(20, Math.min(400, Number(e.target.value))))
                        }
                        className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
                      />
                    </div>
                  </div>
                </div>

                <OutputTargetCard
                  outputFilename={outputFilename}
                  onChangeOutputFilename={setOutputFilename}
                  disabled={!securityPdfPath}
                  isProcessing={isExecuting}
                  processingPercent={processingPercent}
                  processingLabel="Stamping PNG/JPG signature..."
                >
                  <button
                    type="button"
                    onClick={() => void handleStampVisualSignature()}
                    disabled={isExecuting || !securityPdfPath || !sigImagePath}
                    className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
                  >
                    <AppIcon
                      name={isExecuting ? "refresh" : "draw"}
                      className={`w-5 h-5 ${isExecuting ? "animate-spin" : ""}`}
                    />
                    <span>
                      {isExecuting
                        ? "Stamping Signature..."
                        : "Stamp PNG / JPG Signature"}
                    </span>
                  </button>
                </OutputTargetCard>
              </div>
            )}

            {subTab === "sign" && (
              <div className="flex flex-col gap-space-md">
                <SignatureInspector
                  p12Path={p12Path}
                  p12Subject={p12Subject}
                  passphrase={p12Passphrase}
                  reason={sigReason}
                  location={sigLocation}
                  contactInfo={sigContact}
                  stampPage={stampPage}
                  stampX={stampX}
                  stampY={stampY}
                  onChangeP12Path={(p, s) => {
                    setP12Path(p);
                    setP12Subject(s);
                  }}
                  onChangePassphrase={setP12Passphrase}
                  onChangeReason={setSigReason}
                  onChangeLocation={setSigLocation}
                  onChangeContactInfo={setSigContact}
                  onChangeStampPage={setStampPage}
                  onChangeStampPos={(x, y) => {
                    setStampX(x);
                    setStampY(y);
                  }}
                  onGenerateDemoCert={() => void handleGenerateLocalP12()}
                />

                <OutputTargetCard
                  outputFilename={outputFilename}
                  onChangeOutputFilename={setOutputFilename}
                  disabled={!securityPdfPath}
                  isProcessing={isExecuting}
                  processingPercent={processingPercent}
                  processingLabel="Signing PDF with PKCS#12 CMS..."
                >
                  <button
                    type="button"
                    onClick={() => void handleSignPdf()}
                    disabled={isExecuting || !securityPdfPath || !p12Path}
                    className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
                  >
                    <AppIcon
                      name={isExecuting ? "refresh" : "verified"}
                      className={`w-5 h-5 ${isExecuting ? "animate-spin" : ""}`}
                    />
                    <span>
                      {isExecuting
                        ? "Signing Incrementally..."
                        : "Sign PDF (PAdES Incremental)"}
                    </span>
                  </button>
                </OutputTargetCard>
              </div>
            )}

            {subTab === "watermark" && (
              <div className="flex flex-col gap-space-md">
                <WatermarkInspector
                  kind={wmKind}
                  text={wmText}
                  fontSizePts={wmFontSize}
                  colorHex={wmColorHex}
                  opacity={wmOpacity}
                  rotationDeg={wmRotation}
                  layer={wmLayer}
                  targetPages={wmTargetPages}
                  flattenAll={flattenAll}
                  onChangeKind={setWmKind}
                  onChangeText={setWmText}
                  onChangeFontSize={setWmFontSize}
                  onChangeColor={setWmColorHex}
                  onChangeOpacity={setWmOpacity}
                  onChangeRotation={setWmRotation}
                  onChangeLayer={setWmLayer}
                  onChangeTargetPages={setWmTargetPages}
                  onToggleFlatten={setFlattenAll}
                />

                <OutputTargetCard
                  outputFilename={outputFilename}
                  onChangeOutputFilename={setOutputFilename}
                  disabled={!securityPdfPath}
                  isProcessing={isExecuting}
                  processingPercent={processingPercent}
                  processingLabel="Applying watermark / flattening..."
                >
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void handleApplyWatermark()}
                      disabled={isExecuting || !securityPdfPath}
                      className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
                    >
                      <AppIcon name="bolt" className="w-5 h-5" />
                      <span>
                        {isExecuting
                          ? "Applying Watermark..."
                          : "Apply Watermark & Export"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleFlattenOnly()}
                      disabled={isExecuting || !securityPdfPath}
                      className="w-full py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-50 border border-border-default text-text-primary font-body-sm text-body-sm transition-colors"
                    >
                      Flatten Interactive Fields Only
                    </button>
                  </div>
                </OutputTargetCard>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
