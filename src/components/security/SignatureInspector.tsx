import React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../../lib/tauriClient";
import { AppIcon } from "../common/AppIcon";

interface SignatureInspectorProps {
  p12Path: string;
  p12Subject: string;
  passphrase: string;
  reason: string;
  location: string;
  contactInfo: string;
  stampPage: number;
  stampX: number;
  stampY: number;
  onChangeP12Path: (p: string, subject: string) => void;
  onChangePassphrase: (v: string) => void;
  onChangeReason: (v: string) => void;
  onChangeLocation: (v: string) => void;
  onChangeContactInfo: (v: string) => void;
  onChangeStampPage: (v: number) => void;
  onChangeStampPos: (x: number, y: number) => void;
  onGenerateDemoCert: () => void;
}

export const SignatureInspector: React.FC<SignatureInspectorProps> = ({
  p12Path,
  p12Subject,
  passphrase,
  reason,
  location,
  contactInfo,
  stampPage,
  stampX,
  stampY,
  onChangeP12Path,
  onChangePassphrase,
  onChangeReason,
  onChangeLocation,
  onChangeContactInfo,
  onChangeStampPage,
  onChangeStampPos,
  onGenerateDemoCert,
}) => {
  const handleBrowseP12 = async () => {
    if (!isTauriRuntime()) return;
    const picked = await open({
      multiple: false,
      filters: [{ name: "PKCS#12 Certificate", extensions: ["p12", "pfx"] }],
    });
    if (typeof picked === "string") {
      onChangeP12Path(picked, picked.split(/[\\/]/).pop() ?? "Loaded .p12");
    }
  };

  return (
    <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AppIcon name="vpn_key" className="w-5 h-5 text-tag-security" />
          <h2 className="font-headline-sm text-headline-sm text-text-primary">
            PKCS#12 Incremental Signer
          </h2>
        </div>
        <span className="font-mono-metric text-[10px] px-2 py-0.5 rounded bg-surface-elevated text-tag-security border border-border-subtle">
          PAdES / CMS
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-caption">
          <span className="text-text-secondary">Keystore (.p12 / .pfx)</span>
          <span className="text-status-success font-mono-metric truncate max-w-[170px]">
            {p12Subject || "Not loaded"}
          </span>
        </div>
        <div className="px-2.5 py-2 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-between gap-2">
          <span className="font-mono-metric text-caption text-text-secondary truncate">
            {p12Path || "No PKCS#12 file selected"}
          </span>
          {p12Path && (
            <button
              type="button"
              onClick={() => onChangeP12Path("", "No certificate loaded")}
              title="Clear PKCS#12 keystore"
              className="p-0.5 rounded hover:bg-surface-card text-text-muted hover:text-error shrink-0 transition-colors"
            >
              <AppIcon name="close" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBrowseP12}
            className="flex-1 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-text-primary"
          >
            Browse .p12...
          </button>
          <button
            type="button"
            onClick={onGenerateDemoCert}
            className="flex-1 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-primary"
          >
            Generate Local .p12
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        <div>
          <label className="block font-caption text-caption text-text-muted mb-1">
            Certificate Passphrase
          </label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => onChangePassphrase(e.target.value)}
            placeholder="Enter .p12 passphrase..."
            className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
          />
        </div>

        <div>
          <label className="block font-caption text-caption text-text-muted mb-1">
            Signing Reason
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => onChangeReason(e.target.value)}
            className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Location
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => onChangeLocation(e.target.value)}
              className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2.5 font-body-sm text-body-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Contact Info
            </label>
            <input
              type="text"
              value={contactInfo}
              onChange={(e) => onChangeContactInfo(e.target.value)}
              className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2.5 font-body-sm text-body-sm text-text-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Page
            </label>
            <input
              type="number"
              min={1}
              value={stampPage}
              onChange={(e) => onChangeStampPage(Math.max(1, Number(e.target.value)))}
              className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
            />
          </div>
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Stamp X
            </label>
            <input
              type="number"
              value={stampX}
              onChange={(e) => onChangeStampPos(Number(e.target.value), stampY)}
              className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
            />
          </div>
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Stamp Y
            </label>
            <input
              type="number"
              value={stampY}
              onChange={(e) => onChangeStampPos(stampX, Number(e.target.value))}
              className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
