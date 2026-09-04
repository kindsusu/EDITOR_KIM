# Changelog

All notable changes to DAEPIL are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- PDF → Markdown conversion (PDFium text extraction, structure restored by Claude)
- "Export as PDF" button for Markdown documents (the `md2pdf` tool exists; the UI button does not yet)
- One-click prompts in the Claude panel (formal tone, 3-line summary, typo pass, table)
- Windows installer via electron-builder
- Font subsetting for the fallback font is per document; a future version may dedupe glyphs across edits

## [0.1.0] - 2026-09-04

First working release. Built in one day, in work packages reviewed by Claude Fable 5.1 and implemented by Claude Opus 5 / Sonnet 5.

### Added
- **Electron shell** with a Claude Code check at startup: detects `claude`, its login state, and offers install (`irm https://claude.ai/install.ps1 | iex`) and `claude auth login` in a separate PowerShell window. No API key is ever stored; the app spawns `claude -p` under the user's own login.
- **PDF direct editing** on PDFium (WebAssembly, `@embedpdf/pdfium`): server-side page rendering to PNG, text-object enumeration, `FPDFText_SetText` in the original font, save through PDFium's writer. No pdf.js, no pdf-lib.
- **Missing-glyph detection** for subset fonts by comparing `FPDFFont_GetGlyphPath` against the font's `.notdef` pointer; fallback to Malgun Gothic (bold variant when the original is bold).
- **Fallback font subsetting** with fontkit plus a hand-written cmap format 4 table. A 51 KB Korean PDF grows by ~8 KB per fallback edit instead of ~7.5 MB.
- **Line grouping** for Word/Chromium-exported PDFs that split each line into per-glyph text objects; one editable line per baseline.
- **"Edit this line" panel** with keep-alignment (left / center / right), nudge (0.5 pt, Shift 5 pt) and drag.
- **True redaction**: the selected characters are removed from the text object (prefix / suffix split, suffix repositioned from char boxes), a black rectangle tagged with the PDFium content mark `DaepilMask` is added, and the page text is re-extracted to verify nothing remains. Rectangle tool for scanned pages (cover only, with a warning).
- **Mask boxes are objects**: hover shows a dashed outline; click to nudge, drag, or delete.
- **Undo / redo** (Ctrl+Z / Ctrl+Y) from up to 20 pre-change snapshots per document.
- **Open files / folders**, opened-files sidebar, recent list, **Save / Save As** (Ctrl+S / Ctrl+Shift+S), four-way close dialog (overwrite / save as / discard / cancel).
- **Markdown editor** with live preview; Claude edits are shown as a line diff to accept or reject. Per-document chat continuity via `--resume`. Default model Sonnet 5, Opus 5 selectable.
- `tools/md2pdf.js`: Markdown → PDF through Chromium's `printToPDF` with embedded subset fonts (used to produce the Korean test fixture).
- Engine self-test `node app/pdf-engine.test.js` (plain Node asserts) covering render, edit, fallback, subsetting, char boxes, move, rect, redaction and save/reload.

### License
- DAEPIL License: free for personal use; business or commercial use only with the author's written approval.
