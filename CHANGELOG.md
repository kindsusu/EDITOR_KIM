# Changelog

All notable changes to EDITOR_KIM are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Font matching for a single ungrouped text line: installed static TTF selection, desktop TTF import, glyph checks, size/width controls, and a saved-and-reopened preview before applying with undo support. Selected font IDs are embedded for later edits.
- Claude/Codex image-based font recommendations are gated on PDFium capability: only hidden image-backed text or unsupported source glyphs can call AI. Normal editable text skips AI on both client and server. Recommendations use the selected region and an allowlist of supported installed fonts; manual selection remains available.
- Regression tests cover the AI gate, selected-font persistence, unsupported glyph preservation, and stale selection rejection. Font previews leave the current document untouched; application rejects a changed document.
- **Ctrl + mouse wheel zoom** on PDFs, anchored at the cursor (the text under the pointer stays put). `Ctrl+=` / `Ctrl+-` step the zoom, `Ctrl+0` and the new **폭 맞춤** button fit the page width, clicking the percentage resets to 100%. Wheel events resize the page frames immediately and request crisp renders only after the wheel stops. The zoom level is remembered between launches, and an open edit panel survives zooming with its typed text.
- **Stop** button (and `Esc` in the prompt box) while an AI reply is streaming. The server aborts the Claude process or interrupts the Codex turn when the client disconnects.
- `Enter` sends the AI prompt, `Shift+Enter` inserts a newline (`Ctrl+Enter` still sends). Enter during Hangul composition is ignored.
- Pages render at the display's pixel density (capped at 2×) so text is sharp on 125 % / 150 % scaled screens; page images load lazily, so long documents open with only the visible pages rendered.
- When a resumed chat session no longer exists on the CLI side (update, cleared session files), the request is retried automatically as a fresh conversation with the document re-attached.

### Fixed
- Claude responses preserve Korean characters split across stream chunks and consume the final result even without a trailing newline. Font matching uses the completed JSON, rejects failed/truncated responses even after partial output, and cancels promptly during CLI discovery or generation. Regression coverage includes text-only session resume; live Sonnet/Opus font recommendation and PDF save/reopen checks passed.
- **Codex reported as "not installed" although it was**: with an npm install, `where codex` lists the extension-less shell script before `codex.cmd`, and the app tried to run the script. Executable discovery now prefers `.exe`, then `.cmd`, ignores extension-less entries, and also finds the `codex.exe` bundled with the Codex desktop app.
- Codex App Server failures no longer hang: a spawn error or a failed `initialize` rejects pending requests immediately instead of waiting for the 15 s timeout, and a half-initialized process is no longer kept as "running".
- Save failures (file locked by another program, permission denied) were shown as "저장됨" and the dirty marker cleared; now the reason is shown, the document stays dirty, and the temporary file is removed.
- Removing an edited PDF from the file list left its unsaved edits in the server cache, so reopening the file showed them as a clean document. Removal now asks when dirty and closes the server document; dirty state and undo/redo depth are read from the server on open.
- Rotated or skewed text could not be masked: `/api/pdf/mask` now handles it like fragment text (blank the whole object and cover its bounds) instead of silently skipping it while reporting success.
- Overlapping status flashes left a stale message in the status bar permanently.
- Nudging an edited line with the arrow buttons dropped the group-ungroup button and the mask selection mapping.
- Login polling checked both CLIs every 2 s; it now checks only the provider being set up. Login itself runs in a visible console window, because Claude's login asks which account type to use and a hidden process cannot answer.
- The default Electron menu is removed so `Ctrl+R` (reload, which lost the editing state) and `Ctrl+=` (page-wide zoom) no longer hijack editor shortcuts; DevTools opens with `F12`. Pinch/page zoom is locked.
- The server checks the `Host` header, closing the DNS-rebinding path to local files, and executable paths containing spaces work in `.cmd` (shell) mode.

## [0.5.0] - 2026-09-04

### Added
- **ChatGPT through Codex** with no API key. The app reuses the local `codex login` session, discovers the account's available models through Codex App Server, and streams replies over JSONL.
- Provider-aware setup and health checks for both Claude Code and Codex. Either provider can be used independently.
- Per-document, per-provider conversation sessions. Switching models starts a separate conversation.
- One-click CLI installation through the official WinGet packages (`Anthropic.ClaudeCode` and `OpenAI.Codex`), with no PowerShell script or terminal input.
- A persistent arrow tab on the AI panel boundary, so the panel can be collapsed and reopened independently of model selection.

### Changed
- Replaced the header's Claude toggle with a grouped **Select Model** picker for Claude Code and ChatGPT (Codex) models.
- Restored a separate header chat toggle so the right panel can always be opened and closed with one click or Ctrl+J.
- Codex document conversations run as ephemeral threads in an isolated temporary directory with a read-only sandbox and tool use disabled by instruction.
- AI response metadata identifies the selected model, elapsed time, and subscription source.
- Markdown rendering libraries are bundled locally, and preview HTML is sanitized before display.
- Public documentation and roadmap were reduced to current user and contributor information; the editor-specific launch file was removed.

### Fixed
- Rapid PDF zooming or switching documents no longer lets stale asynchronous renders append pages from an earlier render into the current page list.
- Claude setup no longer uses `ExecutionPolicy Bypass` or pipes a downloaded PowerShell script into execution, avoiding the command pattern that Windows Defender blocked.
- File-list labels are built as text nodes, relative paths are checked with `path.relative`, and cross-origin requests to the local server are rejected.

## [0.4.1] - 2026-09-04

- Removed every remaining trace of the earlier project name from code, docs, license and assets. Internal identifiers renamed (renderer bridge `window.editorKim`, storage keys `editorkim.*`, config file `~/.editor-kim.json` with automatic migration, debug env `EDITORKIM_DEBUG`). PDF content marks are now written as `EditorKimMask` / `EditorKimGroup`; files saved with the earlier mark names are still recognized.

## [0.4.0] - 2026-09-04

- Project and repository renamed to EDITOR_KIM (the old GitHub URL redirects to the new one).
- New hero image.

### Changed
- Mask color now always starts at black on launch (no longer remembered between sessions).
- Toolbar button renamed from "▭ 사각형 가리기" to "▭ 마스킹 삽입".

### Fixed
- Editing invisible text left the old picture of the word behind (a duplicate): the cover rectangle now spans the actual ink extent of the edited word within the overlapping image tiles, without touching neighbouring words. Bold weight is remembered so re-edited fallback text stays bold.
- Revealed (formerly invisible) text turned invisible again after save or undo: PDFium does not record an alpha of exactly 1.0, so the original transparency came back. The text is now written with alpha 254.
- Re-editing text that already uses the fallback font in a reopened document rendered thin, widely spaced glyphs (PDFium substituted a system font). Such objects are now always rebuilt with a fresh subset instead of edited in place.

## [0.3.0] - 2026-09-04

- Invisible text (alpha 0 / render mode 3, the "searchable text under a picture" pattern of PowerPoint exports) can now be edited: the picture is covered with the sampled background color and the text is redrawn on top in the sampled ink color. Such boxes show a dashed gray outline.
- Claude panel starts collapsed on every launch (no longer remembered).

## [0.2.2] - 2026-09-04

- Mask color option: black (default) or the page background sampled at that spot, so a masked table cell blends with the cell fill. Applies to the rectangle tool and to text masking.
- Source-only release (no Windows build).

## [0.2.1] - 2026-09-04

- Windows builds via electron-builder: `EDITOR_KIM-<version>-portable.exe` (run directly, no install) and `EDITOR_KIM-<version>-setup.exe` (installer). `npm run dist`. App icon generated by `tools/make-icon.js`.
- Docs trimmed to what a user needs.
- (The 0.2.1 binaries on the Releases page were published under the project's earlier name.)

## [0.2.0] - 2026-09-04

Feedback round on a real 10-page contract PDF (Word/Excel export, subset Malgun Gothic, tables).

### Added
- **Multi-line edits**: Shift+Enter in the edit panel; each extra line becomes a sibling text object 1.2× the font size below, in the original font when it has the glyphs. Lines follow the text matrix, so italic (skewed) and rotated cells keep every line. New lines are appended on top of the z-order so table-cell fills cannot cover them.
- **Fit to width** ("넘치면"): wrap within the space between the left and right neighbours on the same line (clamped to the page edges), or shrink the glyphs proportionally, or leave as is. Width is measured by setting the text and reading PDFium bounds, not estimated from metrics.
- **Groups**: one box per text object, no automatic line grouping. Shift-click selects several boxes → group / ungroup; groups are stored as the PDFium content mark `EditorKimGroup` and survive save/reload. Multi-line edits auto-group their lines.
- **Claude panel collapsed by default**; toggle with the header button or Ctrl+J.
- App version shown in the header and window title; `run-editor-kim.bat` one-click launcher; artwork hero image.

### Fixed
- Partial masking turning into whole-cell masking on Word/Excel PDFs: the text page omits the trailing space that text objects carry, so char boxes are now aligned to the object text with synthetic zero-width boxes.
- Second and later lines of a bold heading rendered regular (bold is read from the original object before fallback).
- `GET /api/file` on a missing path crashed the server process.
- Drag ghost shows the moving text; selected mask boxes are translucent; the app starts empty with a "recent files" list instead of reopening the last session's files.

## [0.1.0] - 2026-09-04

First working release.

### Added
- **Electron shell** with a Claude Code check at startup. The original release used a PowerShell-based installer; v0.5.0 replaced it with WinGet after Windows Defender feedback. No API key is stored by the app.
- **PDF direct editing** on PDFium (WebAssembly, `@embedpdf/pdfium`): server-side page rendering to PNG, text-object enumeration, `FPDFText_SetText` in the original font, save through PDFium's writer. No pdf.js, no pdf-lib.
- **Missing-glyph detection** for subset fonts by comparing `FPDFFont_GetGlyphPath` against the font's `.notdef` pointer; fallback to Malgun Gothic (bold variant when the original is bold).
- **Fallback font subsetting** with fontkit plus a hand-written cmap format 4 table. A 51 KB Korean PDF grows by ~8 KB per fallback edit instead of ~7.5 MB.
- **Line grouping** for Word/Chromium-exported PDFs that split each line into per-glyph text objects; one editable line per baseline.
- **"Edit this line" panel** with keep-alignment (left / center / right), nudge (0.5 pt, Shift 5 pt) and drag.
- **True redaction**: the selected characters are removed from the text object (prefix / suffix split, suffix repositioned from char boxes), a black rectangle tagged with the PDFium content mark `EditorKimMask` is added, and the page text is re-extracted to verify nothing remains. Rectangle tool for scanned pages (cover only, with a warning).
- **Mask boxes are objects**: hover shows a dashed outline; click to nudge, drag, or delete.
- **Undo / redo** (Ctrl+Z / Ctrl+Y) from up to 20 pre-change snapshots per document.
- **Open files / folders**, opened-files sidebar, recent list, **Save / Save As** (Ctrl+S / Ctrl+Shift+S), four-way close dialog (overwrite / save as / discard / cancel).
- **Markdown editor** with live preview; Claude edits are shown as a line diff to accept or reject. Per-document chat continuity via `--resume`. Default model Sonnet 5, Opus 5 selectable.
- `tools/md2pdf.js`: Markdown → PDF through Chromium's `printToPDF` with embedded subset fonts (used to produce the Korean test fixture).
- Engine self-test `node app/pdf-engine.test.js` (plain Node asserts) covering render, edit, fallback, subsetting, char boxes, move, rect, redaction and save/reload.

### License
- EDITOR_KIM License: free for personal use; business or commercial use only with the author's written approval.
