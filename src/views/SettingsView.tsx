import React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AppIcon } from "../components/common/AppIcon";
import { formatBytes, isTauriRuntime } from "../lib/tauriClient";
import {
  useSettingsStore,
  type SettingsCategoryTab,
} from "../stores/settingsStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import type { EngineName } from "../types/xenon";

const CATEGORY_TABS: {
  id: SettingsCategoryTab;
  label: string;
  icon: string;
  iconClass: string;
}[] = [
  { id: "all", label: "All Settings", icon: "tune", iconClass: "" },
  {
    id: "engines",
    label: "Backend Engines",
    icon: "terminal",
    iconClass: "text-tag-organize",
  },
  {
    id: "hardware",
    label: "Performance & Hardware",
    icon: "memory",
    iconClass: "text-tag-optimize",
  },
  {
    id: "security",
    label: "Security & Certificates",
    icon: "shield",
    iconClass: "text-tag-security",
  },
  {
    id: "presets",
    label: "Presets & Output",
    icon: "compress",
    iconClass: "text-tag-convert",
  },
];

const NAMING_TOKENS = [
  "{filename}",
  "{date}",
  "{time}",
  "{compression_ratio}",
  "{page_count}",
];

const ENGINE_STATUS_LABEL: Record<string, string> = {
  connected_bundled: "Connected (Bundled)",
  active_ffi: "Active (Rust FFI)",
  embedded: "Native Embedded",
  error: "Verification Error",
};

export const SettingsView: React.FC = () => {
  const settings = useSettingsStore((s) => s.settings);
  const activeTab = useSettingsStore((s) => s.activeCategoryTab);
  const isSaving = useSettingsStore((s) => s.isSaving);
  const saveSuccess = useSettingsStore((s) => s.saveSuccess);
  const hasUnsavedChanges = useSettingsStore((s) => s.hasUnsavedChanges);
  const setActiveTab = useSettingsStore((s) => s.setActiveCategoryTab);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const restoreDefaults = useSettingsStore((s) => s.restoreDefaults);
  const clearCache = useSettingsStore((s) => s.clearCache);
  const appendNamingToken = useSettingsStore((s) => s.appendNamingToken);

  const engines = useTelemetryStore((s) => s.engines);
  const telemetry = useTelemetryStore((s) => s.telemetry);
  const testingEngine = useTelemetryStore((s) => s.testingEngine);
  const isVerifyingAll = useTelemetryStore((s) => s.isVerifyingAll);
  const testSingleEngine = useTelemetryStore((s) => s.testSingleEngine);
  const runDiagnostics = useTelemetryStore((s) => s.runDiagnostics);
  const refreshTelemetry = useTelemetryStore((s) => s.refreshTelemetry);
  const toggleLogsDrawer = useTelemetryStore((s) => s.toggleLogsDrawer);

  const showCard = (card: Exclude<SettingsCategoryTab, "all">) =>
    activeTab === "all" || activeTab === card;

  const handleBrowseFolder = async (field: "tempCacheDir" | "primaryDestinationFolder") => {
    if (!isTauriRuntime()) return;
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      updateSetting(field, selected);
    }
  };

  const handleLoadKeystore = async () => {
    if (!isTauriRuntime()) {
      updateSetting("p12KeystorePath", "C:\\Users\\xenon\\certs\\corporate_signer.p12");
      updateSetting("p12KeystoreSubject", "Valid local PKCS#12 keystore");
      return;
    }
    const selected = await open({
      multiple: false,
      filters: [{ name: "PKCS#12 Certificate", extensions: ["p12", "pfx"] }],
    });
    if (typeof selected === "string") {
      updateSetting("p12KeystorePath", selected);
      updateSetting("p12KeystoreSubject", selected.split(/[\\/]/).pop() ?? "Loaded .p12");
    }
  };

  const handleClearCache = async () => {
    await clearCache();
    await refreshTelemetry();
  };

  const allVerified = engines.length > 0 && engines.every((e) => e.sha256Verified);

  return (
    <div className="flex flex-col w-full">
      {/* Top Command & Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md mb-space-xl">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-space-sm flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-text-primary font-bold tracking-tight">
              Settings &amp; System Preferences
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-elevated font-mono-metric text-mono-metric text-primary border border-border-default">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
              Tauri Core: Sandboxed
            </span>
          </div>
          <p className="font-body-default text-body-default text-text-muted">
            Configure bundled Rust native binaries, Ghostscript CLI parameters, hardware allocation, and security defaults.
          </p>
        </div>

        <div className="flex items-center gap-space-sm self-start md:self-auto">
          <button
            type="button"
            onClick={() => restoreDefaults()}
            className="px-3.5 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors font-body-medium text-body-medium border border-border-default flex items-center gap-1.5"
          >
            <AppIcon name="history" className="w-[18px] h-[18px]" />
            <span>Restore Defaults</span>
          </button>
          <button
            type="button"
            onClick={() => saveSettings()}
            disabled={isSaving || !hasUnsavedChanges}
            className={`px-4 py-2 rounded-lg transition-all font-body-medium text-body-medium font-semibold shadow-sm flex items-center gap-1.5 ${
              saveSuccess
                ? "bg-status-success text-on-primary-container"
                : hasUnsavedChanges
                  ? "bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary active:scale-95"
                  : "bg-surface-elevated text-text-muted border border-border-default opacity-75 cursor-not-allowed"
            }`}
          >
            <AppIcon
              name={
                isSaving
                  ? "refresh"
                  : saveSuccess || !hasUnsavedChanges
                    ? "done_all"
                    : "check_circle"
              }
              className={`w-[18px] h-[18px] ${isSaving ? "animate-spin" : ""}`}
            />
            <span>
              {isSaving
                ? "Saving Rust IPC..."
                : saveSuccess
                  ? "Saved & Applied!"
                  : hasUnsavedChanges
                    ? "Save Changes"
                    : "Saved"}
            </span>
          </button>
        </div>
      </div>

      {/* Horizontal Category Bar */}
      <div className="w-full bg-surface-card rounded-xl p-1.5 border border-border-default mb-space-xl flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg font-body-medium text-body-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-surface-active text-primary border border-border-default"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                }`}
              >
                <AppIcon name={tab.icon} className={`w-4 h-4 ${isActive ? "" : tab.iconClass}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div className="hidden lg:flex items-center gap-2 text-text-muted font-mono-metric text-mono-metric px-3 py-1 bg-surface-container rounded-lg border border-border-subtle">
          <AppIcon
            name="verified"
            className={`w-3.5 h-3.5 ${allVerified ? "text-status-success" : "text-tag-optimize"}`}
          />
          <span>
            {allVerified
              ? "All 4 bundled engines synchronized (0 IPC latency)"
              : "Verifying bundled PDF engines..."}
          </span>
        </div>
      </div>

      {/* 2x2 Settings Card Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-xl">
        {/* CARD 1: Tauri Rust Core & Bundled Binaries */}
        {showCard("engines") && (
          <div className="bg-surface-card rounded-xl p-space-xl border border-border-default flex flex-col gap-space-lg shadow-sm">
            <div className="flex items-center justify-between border-b border-border-subtle pb-space-sm gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center text-tag-organize">
                  <AppIcon name="terminal" className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    Tauri Rust Core &amp; Bundled Binaries
                  </h2>
                  <p className="font-caption text-caption text-text-muted">
                    Local binary paths, SHA-256 verification, and version health
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full font-mono-metric text-caption bg-surface-elevated text-text-secondary border border-border-subtle shrink-0">
                Arch: {telemetry.targetArch}
              </span>
            </div>

            {engines.map((engine) => (
              <div
                key={engine.name}
                className="bg-surface-elevated rounded-lg p-3.5 border border-border-default flex flex-col gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        engine.sha256Verified ? "bg-status-success" : "bg-status-danger"
                      }`}
                    />
                    <span className="font-body-medium text-body-medium text-text-primary font-semibold">
                      {engine.displayName}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-caption font-mono-metric border ${
                      engine.sha256Verified
                        ? "bg-[#22C55E]/10 text-status-success border-status-success/30"
                        : "bg-status-danger/10 text-status-danger border-status-danger/30"
                    }`}
                  >
                    {ENGINE_STATUS_LABEL[engine.status] ?? engine.status}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 bg-surface-card p-2 rounded border border-border-subtle">
                  <span className="font-mono-metric text-caption text-text-muted truncate select-all">
                    {engine.binaryPath}
                  </span>
                  <button
                    type="button"
                    onClick={() => testSingleEngine(engine.name as EngineName)}
                    disabled={testingEngine === engine.name}
                    className="px-2.5 py-1 rounded bg-surface-elevated hover:bg-surface-hover text-text-primary font-caption text-caption border border-border-default transition-colors flex items-center gap-1 whitespace-nowrap"
                  >
                    <AppIcon name="play_arrow" className="w-3.5 h-3.5 text-primary" />
                    <span>
                      {testingEngine === engine.name ? "Testing..." : "Test Binary"}
                    </span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 text-caption text-text-muted">
                  <span className="truncate">{engine.description}</span>
                  {engine.sha256 && (
                    <span className="font-mono-metric text-[10px] text-text-secondary shrink-0">
                      SHA256: {engine.sha256.slice(0, 12)}…
                    </span>
                  )}
                </div>
              </div>
            ))}

            <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
              <div className="flex flex-col gap-0.5 pr-2">
                <span className="font-body-medium text-body-medium text-text-primary">
                  Run binaries in isolated sandbox worker threads
                </span>
                <span className="font-caption text-caption text-text-muted">
                  Prevents process halts during abnormal corrupt PDF stream termination
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.sandboxWorkerThreads}
                  onChange={(e) =>
                    updateSetting("sandboxWorkerThreads", e.target.checked)
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-active rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container" />
              </label>
            </div>
          </div>
        )}

        {/* CARD 2: Hardware & Multi-Threading Allocation */}
        {showCard("hardware") && (
          <div className="bg-surface-card rounded-xl p-space-xl border border-border-default flex flex-col gap-space-lg shadow-sm">
            <div className="flex items-center justify-between border-b border-border-subtle pb-space-sm">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center text-tag-optimize">
                  <AppIcon name="memory" className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    Hardware &amp; Multi-Threading Allocation
                  </h2>
                  <p className="font-caption text-caption text-text-muted">
                    CPU thread pools, byte-bounded RAM cache, and GPU rasterization
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full font-mono-metric text-caption bg-surface-elevated text-tag-optimize border border-border-subtle">
                {telemetry.physicalCores} Physical Cores
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-body-medium text-body-medium text-text-primary font-medium">
                  Worker Thread Pool
                </span>
                <span className="font-mono-metric text-mono-metric text-primary font-semibold">
                  {settings.workerThreads} Threads (Detected {telemetry.physicalCores} Cores)
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={Math.max(1, telemetry.physicalCores)}
                value={Math.min(settings.workerThreads, Math.max(1, telemetry.physicalCores))}
                onChange={(e) => updateSetting("workerThreads", Number(e.target.value))}
                className="w-full accent-primary-container bg-surface-elevated rounded-lg h-2 cursor-pointer"
              />
              <div className="flex justify-between text-caption font-mono-metric text-text-muted">
                <span>1 Thread (Minimal)</span>
                <span>{Math.min(8, telemetry.physicalCores)} Threads (Recommended)</span>
                <span>{telemetry.physicalCores} Max</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-body-medium text-body-medium text-text-primary font-medium">
                  Memory Cache Limit
                </span>
                <span className="font-mono-metric text-mono-metric text-tag-organize font-semibold">
                  {settings.memoryCacheLimitMb} MB RAM Buffer
                </span>
              </div>
              <input
                type="range"
                min={512}
                max={8192}
                step={256}
                value={settings.memoryCacheLimitMb}
                onChange={(e) =>
                  updateSetting("memoryCacheLimitMb", Number(e.target.value))
                }
                className="w-full accent-tag-organize bg-surface-elevated rounded-lg h-2 cursor-pointer"
              />
              <p className="font-caption text-caption text-text-muted">
                Allocates byte-bounded LRU memory chunks for instant multi-page PDFium tile previews.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-body-medium text-body-medium text-text-primary font-medium">
                Temporary Processing Directory
              </span>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 bg-surface-elevated px-3 py-2 rounded-lg border border-border-default font-mono-metric text-mono-metric text-text-secondary truncate">
                  {settings.tempCacheDir || "/tmp/xenon_cache"}
                </div>
                <button
                  type="button"
                  onClick={() => handleBrowseFolder("tempCacheDir")}
                  className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-sm text-body-sm border border-border-default transition-colors whitespace-nowrap"
                >
                  Change...
                </button>
                <button
                  type="button"
                  onClick={handleClearCache}
                  className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-status-danger font-body-sm text-body-sm border border-border-default transition-colors whitespace-nowrap flex items-center justify-center gap-1"
                >
                  <AppIcon name="delete_sweep" className="w-4 h-4" />
                  <span>Clear Cache ({formatBytes(telemetry.tempCacheSizeBytes)})</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-border-subtle flex items-center justify-between">
              <div className="flex flex-col gap-0.5 pr-2">
                <span className="font-body-medium text-body-medium text-text-primary">
                  Hardware Acceleration (GPU Canvas Rasterization)
                </span>
                <span className="font-caption text-caption text-text-muted">
                  Utilize GPU compositing for ultra-smooth 60fps PDF zoom and grid drag-and-drop
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.hardwareAccelerationGpu}
                  onChange={(e) =>
                    updateSetting("hardwareAccelerationGpu", e.target.checked)
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-active rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container" />
              </label>
            </div>
          </div>
        )}

        {/* CARD 3: Default Security & PDF/A Compliance */}
        {showCard("security") && (
          <div className="bg-surface-card rounded-xl p-space-xl border border-border-default flex flex-col gap-space-lg shadow-sm">
            <div className="flex items-center justify-between border-b border-border-subtle pb-space-sm">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center text-tag-security">
                  <AppIcon name="shield" className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    Default Security &amp; PDF/A Compliance
                  </h2>
                  <p className="font-caption text-caption text-text-muted">
                    Encryption protocols, PKCS#12 keystore, and XMP sanitation policies
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full font-mono-metric text-caption bg-surface-elevated text-tag-security border border-border-subtle">
                ISO 19005-4
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-body-medium text-body-medium text-text-primary font-medium">
                Default Output Encryption Level
              </label>
              <div className="relative">
                <select
                  value={settings.defaultEncryptionLevel}
                  onChange={(e) =>
                    updateSetting("defaultEncryptionLevel", e.target.value)
                  }
                  className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary-container transition-colors appearance-none cursor-pointer"
                >
                  <option value="AES-256 bit (Acrobat 9.0+)">
                    AES-256 bit (Acrobat 9.0+) [Recommended]
                  </option>
                  <option value="AES-128 bit (Acrobat 7.0+)">
                    AES-128 bit (Acrobat 7.0+ Compatibility)
                  </option>
                  <option value="PDF 2.0 AES-256 bit + UTF-8">
                    PDF 2.0 AES-256 bit + UTF-8 Passwords
                  </option>
                </select>
                <span className="absolute right-2.5 top-2.5 text-text-muted pointer-events-none">
                  <AppIcon name="expand_more" className="w-4 h-4" />
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-body-medium text-body-medium text-text-primary font-medium">
                  Digital Signature Keystore (.p12 / .pfx)
                </span>
                <span className="font-caption text-caption text-status-success flex items-center gap-1 font-mono-metric">
                  <AppIcon name="check_circle" className="w-3.5 h-3.5" />
                  <span>{settings.p12KeystoreSubject}</span>
                </span>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 bg-surface-elevated px-3 py-2 rounded-lg border border-border-default font-mono-metric text-mono-metric text-text-secondary truncate">
                  {settings.p12KeystorePath || "No PKCS#12 certificate selected"}
                </div>
                <button
                  type="button"
                  onClick={handleLoadKeystore}
                  className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-sm text-body-sm border border-border-default transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <AppIcon name="vpn_key" className="w-4 h-4 text-tag-security" />
                  <span>Load Certificate...</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2 border-t border-border-subtle">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="font-body-medium text-body-medium text-text-primary">
                    Automatically flatten form fields upon saving
                  </span>
                  <span className="font-caption text-caption text-text-muted">
                    Transforms interactive widgets into immutable PDF visual paths
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.autoFlattenOnSave}
                    onChange={(e) =>
                      updateSetting("autoFlattenOnSave", e.target.checked)
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-surface-active rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="font-body-medium text-body-medium text-text-primary">
                    Sanitize metadata &amp; remove hidden XMP tracking data
                  </span>
                  <span className="font-caption text-caption text-text-muted">
                    Strips GPS coordinates, creator headers, and incremental edit history
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.sanitizeMetadataXmp}
                    onChange={(e) =>
                      updateSetting("sanitizeMetadataXmp", e.target.checked)
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-surface-active rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container" />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* CARD 4: Output & File Handling Preferences */}
        {showCard("presets") && (
          <div className="bg-surface-card rounded-xl p-space-xl border border-border-default flex flex-col gap-space-lg shadow-sm">
            <div className="flex items-center justify-between border-b border-border-subtle pb-space-sm">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center text-tag-convert">
                  <AppIcon name="folder_copy" className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    Output &amp; File Handling Preferences
                  </h2>
                  <p className="font-caption text-caption text-text-muted">
                    Batch naming templates, destination folder, and system alerts
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full font-mono-metric text-caption bg-surface-elevated text-tag-convert border border-border-subtle">
                Auto-Renaming Active
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-body-medium text-body-medium text-text-primary font-medium">
                Default Output Naming Pattern
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={settings.outputNamingPattern}
                  onChange={(e) =>
                    updateSetting("outputNamingPattern", e.target.value)
                  }
                  className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg pl-3 pr-8 font-mono-metric text-mono-metric text-text-primary focus:outline-none focus:border-primary-container transition-colors"
                />
                <span className="absolute right-2.5 top-2.5 text-text-muted pointer-events-none">
                  <AppIcon name="edit" className="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-caption text-caption text-text-muted">Tokens:</span>
                {NAMING_TOKENS.map((tok) => (
                  <button
                    key={tok}
                    type="button"
                    onClick={() => appendNamingToken(tok)}
                    className="px-1.5 py-0.5 rounded bg-surface-container text-text-secondary hover:text-primary font-mono-metric text-caption border border-border-subtle transition-colors"
                  >
                    {tok}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-body-medium text-body-medium text-text-primary font-medium">
                Primary Destination Folder
              </span>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-surface-elevated px-3 py-2 rounded-lg border border-border-default font-mono-metric text-mono-metric text-text-secondary truncate">
                  {settings.primaryDestinationFolder || "Documents/XENON_Exports"}
                </div>
                <button
                  type="button"
                  onClick={() => handleBrowseFolder("primaryDestinationFolder")}
                  className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-sm text-body-sm border border-border-default transition-colors"
                >
                  Browse
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2 border-t border-border-subtle">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="font-body-medium text-body-medium text-text-primary">
                    Preserve original file modification timestamp
                  </span>
                  <span className="font-caption text-caption text-text-muted">
                    Retains POSIX creation and last modified timestamps during rewrites
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.preserveModificationTimestamp}
                    onChange={(e) =>
                      updateSetting("preserveModificationTimestamp", e.target.checked)
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-surface-active rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="font-body-medium text-body-medium text-text-primary">
                    Show native desktop notification upon batch job completion
                  </span>
                  <span className="font-caption text-caption text-text-muted">
                    Triggers OS notification banner when offline queue finishes
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.desktopNotificationOnComplete}
                    onChange={(e) =>
                      updateSetting("desktopNotificationOnComplete", e.target.checked)
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-surface-active rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container" />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Diagnostic Summary Banner */}
      <div className="mt-space-xl bg-surface-card rounded-xl p-space-md border border-border-default flex flex-col md:flex-row items-center justify-between gap-space-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center text-status-success">
            <AppIcon name="terminal" className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-body-medium text-body-medium text-text-primary font-semibold">
                Tauri IPC Status: Connected
              </span>
              <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
            </div>
            <p className="font-caption text-caption text-text-muted">
              All native binaries and shared libraries are verified locally with SHA-256 integrity checksums.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-stretch md:self-auto justify-end flex-wrap">
          <button
            type="button"
            onClick={() => runDiagnostics()}
            disabled={isVerifyingAll}
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-sm text-body-sm border border-border-default transition-colors flex items-center gap-1.5"
          >
            <AppIcon name="bug_report" className="w-4 h-4 text-text-muted" />
            <span>
              {isVerifyingAll ? "Running Diagnostics..." : "Run Full Diagnostic Suite"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleLogsDrawer(true)}
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-sm text-body-sm border border-border-default transition-colors flex items-center gap-1.5"
          >
            <AppIcon name="receipt_long" className="w-4 h-4 text-tag-organize" />
            <span>View Tauri Logs</span>
          </button>
        </div>
      </div>
    </div>
  );
};
