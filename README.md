# EDITOR_KIM

![EDITOR_KIM](assets/hero.png)

A local Windows editor that changes PDF text objects directly and removes sensitive text for real. It also includes Markdown editing and an optional AI assistant powered by Claude Code or ChatGPT through Codex, with no API key required.

[한국어](README.ko.md) · [Plan](PLAN.md)

## Features

- Direct PDF text-object editing with the original embedded font, falling back to a subset Malgun Gothic for missing glyphs
- Redaction that removes the selected characters from the PDF and verifies the removal by re-extracting text
- Page tools: extract/delete pages, merge PDFs, export pages as PNG/JPEG, insert an image, and reduce file size by downsampling
- Open PDFs straight from a browser or mail client via the Windows "Open with" association (temp-file downloads show a banner and save with "Save As")
- Undo/redo, multi-line editing, fit-to-width, and move
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

Click a text box, edit it, and press Enter to confirm. Text keeps its original embedded font where possible; characters missing from that font fall back to Malgun Gothic. The **폰트 맞추기** (font match) dialog opens for image-backed hidden text or a text box where you've already chosen a font — pick an installed font or import a TTF, preview the result, and apply with undo support. An AI font recommendation runs only when you press the recommend button in the dialog; only plain TTF fonts are supported, not OTF or variable fonts.

![Redaction pipeline](assets/redaction.svg)

Text redaction removes the selected characters from the PDF object, adds a covering rectangle, and re-extracts the page text to confirm the removal. Text inside a scanned image can only be visually covered, not removed.

## PDF tools

The toolbar's **페이지** menu holds these document-level tools (all undoable except image export):

- **페이지 추출** — extract/delete pages via checkbox thumbnails or a `1,3-5` range
- **병합** — merge several PDFs in a chosen order
- **이미지로 내보내기** — export pages as PNG/JPEG at 96–300 dpi into a folder
- **이미지 삽입** — insert a JPEG/PNG; drag to move, handle to resize
- **용량 줄이기** — downsample images above a dpi threshold, re-encode as JPEG, optional target size (transparent images skipped)

## Shortcuts

| Key | Action |
|---|---|
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+J` | Toggle AI panel |
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
