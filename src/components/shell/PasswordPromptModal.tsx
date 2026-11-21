import React, { useState } from "react";
import { useDocumentStore } from "../../stores/documentStore";
import { AppIcon } from "../common/AppIcon";

export const PasswordPromptModal: React.FC = () => {
  const isOpen = useDocumentStore((s) => s.isPasswordModalOpen);
  const pendingPath = useDocumentStore((s) => s.pendingProtectedPath);
  const storeError = useDocumentStore((s) => s.passwordError);
  const closePasswordPrompt = useDocumentStore((s) => s.closePasswordPrompt);
  const openPdfFile = useDocumentStore((s) => s.openPdfFile);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setLocalError("Please enter the PDF User or Owner password.");
      return;
    }
    if (!pendingPath) return;

    setSubmitting(true);
    try {
      const ok = await openPdfFile(pendingPath, password);
      if (ok) {
        setPassword("");
        setLocalError("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || storeError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-surface-card border border-border-default rounded-xl p-6 shadow-2xl flex flex-col gap-4"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center text-tag-security">
              <AppIcon name="lock" className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-headline-sm text-headline-sm text-text-primary">
                Password-Protected PDF
              </h2>
              <p className="font-caption text-caption text-text-muted">
                Enter password to unlock locally via QPDF / PDFium
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closePasswordPrompt}
            className="text-text-muted hover:text-text-primary"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2 rounded-lg bg-surface-elevated border border-border-subtle font-mono-metric text-caption text-text-secondary truncate">
          {pendingPath}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-body-sm text-body-sm text-text-primary font-medium">
            Document Password
          </label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setLocalError("");
            }}
            placeholder="Enter password..."
            className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
          />
          {displayError && (
            <span className="font-caption text-caption text-error">{displayError}</span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={closePasswordPrompt}
            className="px-3.5 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-secondary font-body-sm text-body-sm border border-border-default"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-primary-container hover:bg-primary-fixed text-on-primary-container font-body-sm text-body-sm font-semibold"
          >
            {submitting ? "Unlocking..." : "Unlock PDF"}
          </button>
        </div>
      </form>
    </div>
  );
};
