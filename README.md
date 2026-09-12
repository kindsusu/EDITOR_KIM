# EDITOR_KIM

![EDITOR_KIM](assets/hero.png)

A local Windows editor that changes PDF text objects directly and removes sensitive text for real. It also includes Markdown editing and an optional AI assistant powered by Claude Code or ChatGPT through Codex, with no API key required.

[한국어](README.ko.md) · [Plan](PLAN.md)

## Features

- Direct PDF text-object editing with the original embedded font, falling back to a subset Malgun Gothic for missing glyphs
- Redaction that removes the selected characters from the PDF and verifies the removal by re-extracting text; a search hit can also be masked with "mask the whole line"
- Full-text search (Ctrl+F) across every page with prev/next navigation, a match counter, match-case, and highlighted results
- Page tools: extract/delete pages, rotate a page or a thumbnail 90° at a time, drag-reorder thumbnails, split into N-page files, merge PDFs, export pages as PNG/JPEG, insert an image, and reduce file size by downsampling (single document or several files at once, without opening them)
- A status bar with the current page / total pages, a page-number jump box, and a zoom slider; a sidebar with 파일/페이지 tabs (open files and page thumbnails)
- An empty state with quick tools (merge, reduce several files' size, export images) and a full-window drag-and-drop overlay when no document is open
- Open PDFs straight from a browser or mail client via the Windows "Open with" association (temp-file downloads show a banner and save with "Save As")
- Undo/redo, multi-line editing, fit-to-width, and move
- A progress dialog with a cancel button for long document tools (size reduction, export, split, merge, page cleanup), which restores the document or reports how many files were saved when cancelled
- An undo toast after page deletion, size reduction, rotation, or reordering, separate from the status-bar flash message
- A banner that offers re-sign-in when the AI provider's login expires mid-session (chat, font recommendation)
- Markdown editing with a sanitized live preview
- AI assistant (Claude Code or ChatGPT via Codex) with per-document conversations and font recommendations — sign-in is only requested the first time an AI feature is used

| Before | After |
|---|---|
| ![Before editing](assets/edit-before.png) | ![After editing](assets/edit-after.png) |

## Quick start

Download a portable or setup build from Releases. The setup build registers EDITOR_KIM in Windows' "Open with" list for PDFs (it is not set as the default viewer). Unsigned builds may trigger SmartScreen — choose "More info" then "Run anyway" after checking the source; never disable Windows Defender to get past a block. For development:

```bash
git clone https://github.com/kindsusu/EDITOR_KIM.git
cd EDITOR_KIM
npm install
npm start
```

Double-clicking `run-editor-kim.bat` runs the same source without opening a terminal. Use `npm run serve` for the browser-only mode at <http://localhost:4747>; native file dialogs and PNG insertion are Electron-only there.

## AI sign-in

Nothing is requested at launch — PDF and Markdown editing work without any account. The first time you use the chat panel, press **Send**, or ask for a font recommendation, EDITOR_KIM opens a chooser for **Claude** (Claude Code) or **ChatGPT** (Codex) and walks you through installing and signing in for that provider only. Installation uses WinGet's official packages (`Anthropic.ClaudeCode` or `OpenAI.Codex`); sign-in happens through the provider's own browser flow with your existing subscription. EDITOR_KIM never stores API keys or tokens itself. Once you use an AI feature, the current document text (or the selected region's image, for font recommendations) is sent to the provider you chose.

## PDF editing

![Architecture](assets/architecture.svg)

Click a line, edit it, and press Enter to confirm. PDFs exported from Excel, Hangul or Chromium split one line into many text objects (per font run, sometimes per character); fragments that share a baseline and sit next to each other are merged into one editable box, while table cells stay separate (gap size plus a vertical-rule check). Text keeps its original embedded font where possible; characters missing from that font fall back to Malgun Gothic. The **폰트 맞추기** (font match) dialog opens for image-backed hidden text or a text box where you've already chosen a font — pick an installed font or import a TTF, preview the result, and apply with undo support. An AI font recommendation runs only when you press the recommend button in the dialog; only plain TTF fonts are supported, not OTF or variable fonts.

![Redaction pipeline](assets/redaction.svg)

Text redaction removes the selected characters from the PDF object, adds a covering rectangle, and re-extracts the page text to confirm the removal. Text inside a scanned image can only be visually covered, not removed.

## PDF tools

The toolbar's **페이지** and **문서** groups hold these document-level tools (all undoable except image export and split, which write new files and leave the open document untouched):

- **페이지 정리…** — extract/delete pages via checkbox thumbnails or a `1,3-5` range
- **↺ / ↻** — rotate the current page 90°; a page thumbnail's right-click menu offers the same for that one page, plus "새 파일로 저장…" (save that single page as a new PDF)
- Drag a thumbnail in the sidebar's **페이지** tab to reorder pages
- **분할…** — split the document into N-page files in a chosen folder
- **병합…** — merge several PDFs in a chosen order
- **이미지로 내보내기…** — export pages as PNG/JPEG at 96–300 dpi into a folder
- **이미지 삽입** — insert a JPEG/PNG; drag to move, handle to resize
- **용량 줄이기…** — downsample images above a dpi threshold, re-encode as JPEG, optional target size (transparent images skipped); the empty-state **여러 파일 용량 줄이기…** quick tool runs the same on several PDF files at once, without opening them, and writes `<name>-축소.pdf` next to each

Rotated pages keep their text, redaction, search, and drag-to-move overlays aligned — the UI converts between the PDF's unrotated coordinate space and the rotated on-screen layout for every box and highlight.

## Shortcuts

| Key | Action |
|---|---|
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+J` | Toggle AI panel |
| `Ctrl+F` | Open the search bar |
| `Enter` / `Shift+Enter` (in the search box) | Next / previous match |
| `Esc` (in the search box) | Close the search bar |
| `PageUp` / `PageDown` / `Home` / `End` | Jump a page / to the first / last page |
| `Ctrl` + mouse wheel | Zoom the PDF around the cursor |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / fit page width |
| `Enter` / `Shift+Enter` | Send AI request / new line in the prompt |
| `Esc` (in the prompt) | Stop the streaming AI reply |
| `F12` | Developer tools |

## Development

```bash
npm test
npm audit
npm run dist   # release builds
```

```text
app/                    UI, local server, AI adapters, PDF engine, tests
assets/                 README artwork and diagrams
tools/                  fixture and icon regeneration tools
workspace/              fictional test documents
```

## Limits

- Targets Windows 10+ and is verified on Windows 11.
- Does not directly edit text inside scanned images.
- Complex CJK ligatures, vertical text, and unusual fonts may require fallback.
- Files remain local, but document text included in an AI request is sent to the selected provider.
- Review the license before business or commercial use.

## License

Free for personal, non-commercial use. Company, workplace, or commercial use requires prior written permission from the copyright holder. See [LICENSE](LICENSE).
