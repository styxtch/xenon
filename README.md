# XENON — Private PDF Workspace

**Your Documents. Your Device. Your Privacy.**

XENON is a 100% offline, open-source desktop PDF workspace built with **Tauri v2**, **React**, **TypeScript**, and **Rust**. All PDF processing engines, OCR language models, and ICC color profiles are bundled locally so your documents never leave your device.

---

## Core Bundled Engines

1. **PDFium Engine (`pdfium-render` FFI)** — Sub-pixel page rasterization, custom `xenon://` tile cache, PDF-to-Images, character-level text bounding extraction, and High-DPI True Redaction burn-in.
2. **QPDF Native CLI** — Fast structural normalization, page reorder/split/merge, stream linearization (Fast Web View), cross-reference (`xref`) repair, and AES-256 / AES-128 encryption & decryption.
3. **Ghostscript (`gs`)** — High-ratio image downsampling (`Screen`, `Ebook`, `Printer`, `Prepress`, `Custom DPI/Quality`), ISO 19005 PDF/A archival conversion, and built-in Tesseract OCR (`eng` + `ind`).
4. **Lopdf & Rust Crypto** — In-memory stream inspection, size estimation, XMP metadata sanitization, interactive AcroForm editor & flattening, visual PNG/JPG signature stamping, watermarks, and PKCS#12 (`.p12`/`.pfx`) CMS incremental digital signatures.

---

## Tool Suites

- **Organize & Manage PDF Pages:** Visual Page Grid (`dnd-kit` drag-and-drop, Undo/Redo, multi-select, zoom), independent Merge Queue, independent Split & Extract (Range / Selected / Every N / Burst), and Crop & Rotate.
- **Optimize & Repair:** Compress PDF with live stream size estimation, Repair corrupt `xref`, Sanitize hidden metadata/XMP, and Linearize for Fast Web View.
- **Convert, OCR, Compare & AcroForm:** PDF ↔ Images (`PNG`, `JPG`, `WebP`, `TIFF`), Searchable OCR PDF, PDF/A archival, side-by-side PDF Comparison (Visual Diff + Semantic Text Diff), and interactive AcroForm Editor.
- **Security & Sign:** AES-256/128 Encryption, Unlock PDF, Visual Signature (`PNG`/`JPG` drag & resize), PKCS#12 Digital Signature, Watermark & Flatten, and True Redaction (manual draw/move/resize + cross-page auto-redact for Text, Phone, Email, and ID/NIK).

---

## Tech Stack

- **Desktop Shell & Backend:** Rust + Tauri v2 + Tokio + SQLite (`rusqlite`)
- **Frontend:** React + TypeScript + Tailwind CSS + Zustand + `@dnd-kit`
- **Reliability & Security:** Atomic `.part` writes with startup crash recovery, SHA-256 binary integrity manifest verification, OS-level process control (`Pause` / `Resume` / `Cancel`).

---

## Development & Build

### Prerequisites
- Node.js 20+
- Rust stable toolchain (`cargo`, `rustc`)
- Tauri v2 system prerequisites for your OS

### Commands

```bash
# Install frontend dependencies
npm install

# Run desktop app in development mode
npm run tauri dev

# Typecheck and build frontend
npm run build

# Run Rust unit & engine tests
npm run test:rust

# Generate SHA-256 integrity manifest for bundled engines
npm run verify:integrity

# Build production desktop installer
npm run tauri build
```

---

## License

GNU AGPL-3.0-or-later (compatible with bundled Ghostscript).
