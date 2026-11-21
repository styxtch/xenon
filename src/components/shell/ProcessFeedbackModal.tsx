import React, { useEffect } from "react";
import { AppIcon } from "../common/AppIcon";
import { formatBytes, tauriClient } from "../../lib/tauriClient";
import { useProcessModalStore } from "../../stores/processModalStore";

export const ProcessFeedbackModal: React.FC = () => {
  const overwritePrompt = useProcessModalStore((s) => s.overwritePrompt);
  const completionModal = useProcessModalStore((s) => s.completionModal);
  const resolveOverwrite = useProcessModalStore((s) => s.resolveOverwrite);
  const closeCompletion = useProcessModalStore((s) => s.closeCompletion);

  useEffect(() => {
    if (!overwritePrompt && !completionModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (overwritePrompt) resolveOverwrite("cancel");
        else if (completionModal) closeCompletion();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overwritePrompt, completionModal, resolveOverwrite, closeCompletion]);

  if (overwritePrompt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
        <div className="w-full max-w-xl rounded-xl border border-border-default bg-surface-card shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle flex items-center gap-3 bg-amber-500/10">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400">
              <AppIcon name="warning" className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-headline-sm text-headline-sm text-text-primary">
                Output File Already Exists
              </h3>
              <p className="font-caption text-caption text-text-secondary">
                Running <span className="text-text-primary font-medium">{overwritePrompt.operationLabel}</span> will overwrite the existing file(s) below.
              </p>
            </div>
          </div>

          <div className="p-5 space-y-3">
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border-subtle bg-surface-elevated p-3 space-y-1.5">
              {overwritePrompt.paths.map((p) => (
                <div
                  key={p}
                  className="font-mono-metric text-caption text-text-primary break-all flex items-start gap-2"
                >
                  <AppIcon name="description" className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
            <p className="font-caption text-caption text-text-muted">
              Choose <span className="font-semibold text-text-primary">Save as Copy</span> to keep the existing file, or <span className="font-semibold text-text-primary">Cancel &amp; Rename</span> to pick a custom name.
            </p>
          </div>

          <div className="px-5 py-3.5 border-t border-border-subtle bg-surface-elevated/60 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => resolveOverwrite("cancel")}
              className="px-3.5 py-2 rounded-lg border border-border-default bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-sm text-body-sm font-semibold whitespace-nowrap transition-colors"
            >
              Cancel &amp; Rename
            </button>
            {overwritePrompt.allowCopy && (
              <button
                type="button"
                onClick={() => resolveOverwrite("copy")}
                className="px-3.5 py-2 rounded-lg border border-primary/50 bg-primary-container/20 hover:bg-primary-container/35 text-primary font-body-sm text-body-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <AppIcon name="content_copy" className="w-4 h-4" />
                <span>Save as Copy</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => resolveOverwrite("overwrite")}
              className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-body-sm text-body-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm transition-colors"
            >
              <AppIcon name="bolt" className="w-4 h-4" />
              <span>Overwrite &amp; Proceed</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (completionModal) {
    const firstPath = completionModal.outputPaths[0];
    const hasBytes =
      typeof completionModal.originalBytes === "number" &&
      completionModal.originalBytes > 0 &&
      typeof completionModal.outputBytes === "number" &&
      completionModal.outputBytes > 0;
    const deltaPct =
      hasBytes && completionModal.originalBytes! > 0
        ? Math.round(
            ((completionModal.outputBytes! - completionModal.originalBytes!) /
              completionModal.originalBytes!) *
              1000
          ) / 10
        : null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
        <div className="w-full max-w-lg rounded-xl border border-border-default bg-surface-card shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle flex items-center gap-3 bg-surface-elevated/70">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0 text-emerald-400">
              <AppIcon name="check_circle" className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-headline-sm text-headline-sm text-text-primary">
                {completionModal.title}
              </h3>
              <p className="font-caption text-caption text-text-secondary">
                {completionModal.summary}
              </p>
            </div>
            <button
              type="button"
              onClick={closeCompletion}
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <AppIcon name="close" className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {(hasBytes || typeof completionModal.durationMs === "number") && (
              <div className="grid grid-cols-3 gap-2.5">
                {hasBytes && (
                  <div className="rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
                    <div className="font-caption text-caption text-text-muted">Original</div>
                    <div className="text-sm font-semibold text-text-primary font-mono-metric">
                      {formatBytes(completionModal.originalBytes!)}
                    </div>
                  </div>
                )}
                {hasBytes && (
                  <div className="rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
                    <div className="font-caption text-caption text-text-muted">
                      Output{deltaPct !== null ? ` (${deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`})` : ""}
                    </div>
                    <div className="text-sm font-semibold text-emerald-400 font-mono-metric">
                      {formatBytes(completionModal.outputBytes!)}
                    </div>
                  </div>
                )}
                {typeof completionModal.durationMs === "number" && (
                  <div className="rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
                    <div className="font-caption text-caption text-text-muted">Duration</div>
                    <div className="text-sm font-semibold text-text-primary font-mono-metric">
                      {completionModal.durationMs} ms
                    </div>
                  </div>
                )}
              </div>
            )}

            {completionModal.outputPaths.length > 0 && (
              <div className="rounded-lg border border-border-subtle bg-surface-elevated p-3 space-y-1.5 max-h-36 overflow-y-auto">
                <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                  Saved Output ({completionModal.outputPaths.length})
                </div>
                {completionModal.outputPaths.map((p) => (
                  <div key={p} className="font-mono-metric text-caption text-text-primary break-all">
                    {p}
                  </div>
                ))}
              </div>
            )}

            {completionModal.extraDetail && (
              <p className="font-caption text-caption text-text-secondary">
                {completionModal.extraDetail}
              </p>
            )}
          </div>

          <div className="px-5 py-3.5 border-t border-border-subtle bg-surface-elevated/60 flex flex-wrap items-center justify-end gap-2">
            {firstPath && (
              <>
                <button
                  type="button"
                  onClick={() => void tauriClient.openFileInOs(firstPath)}
                  className="px-3.5 py-2 rounded-lg border border-primary/50 bg-primary-container/20 hover:bg-primary-container/35 text-primary font-body-sm text-body-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <AppIcon name="open_in_new" className="w-4 h-4" />
                  <span>Open File</span>
                </button>
                <button
                  type="button"
                  onClick={() => void tauriClient.revealInExplorer(firstPath)}
                  className="px-3.5 py-2 rounded-lg border border-border-default bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-sm text-body-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <AppIcon name="folder_open" className="w-4 h-4 text-primary" />
                  <span>Open Folder</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={closeCompletion}
              className="px-4 py-2 rounded-lg bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary font-body-sm text-body-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <AppIcon name="done_all" className="w-4 h-4" />
              <span>Done</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
