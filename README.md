# EDITOR_KIM

![EDITOR_KIM](assets/hero.png)

A local Windows editor that changes PDF text objects directly and removes sensitive text for real. It also includes Markdown editing and a document assistant powered by Claude Code or ChatGPT through Codex. The app does not require an AI API key.

[한국어](README.ko.md) · [Changelog](CHANGELOG.md) · [Plan](PLAN.md)

## Features

- Direct PDF text-object editing and saving with PDFium
- Original embedded-font reuse with subset Malgun Gothic fallback
- Redaction that removes selected characters and verifies extraction
- Undo/redo, multi-line editing, alignment, movement, and fit-to-width
- Markdown editing with a sanitized live preview
- Claude Code or ChatGPT (Codex) model selection
- Per-document AI conversations and assisted text edits

| Before | After |
|---|---|
| ![Before editing](assets/edit-before.png) | ![After editing](assets/edit-after.png) |

## Quick start

Download a portable or setup build from Releases. To run the source without using a terminal, download the repository and double-click `run-editor-kim.bat`. Node.js 22 or newer is required once; dependencies are installed automatically.

For development:

```bash
git clone https://github.com/kindsusu/EDITOR_KIM.git
cd EDITOR_KIM
npm install
npm start
```

Use `npm run serve` for the browser-only mode at <http://localhost:4747>. Native file dialogs are available only in Electron.

Unsigned development builds may trigger Windows SmartScreen. Run them only after checking the source and file hash. Do not bypass Windows Defender or relax execution policy when an install is blocked.

## AI installation and sign-in

Choose a provider under **Select Model**. If it is not ready, the app provides installation and login buttons. See OpenAI's [official authentication guide](https://learn.chatgpt.com/docs/auth) for the Codex sign-in behavior.

1. WinGet installs the official `Anthropic.ClaudeCode` or `OpenAI.Codex` package for the current user.
2. The app launches the provider's browser authentication.
3. Sign in with the appropriate Claude or ChatGPT subscription account.
4. EDITOR_KIM detects completion and lists the models available to that account.

An existing ChatGPT browser session can make authentication quicker, but first-time Codex use still requires completing the `codex login` browser flow once. Codex then caches the session and EDITOR_KIM reuses it. The app never reads or copies credential files.

Developer diagnostics only:

```bash
codex login
codex login status
claude auth login
claude auth status
```

On a headless machine, Codex also supports `codex login --device-auth`. Never commit credential files such as `auth.json`.

Sending an AI request sends the current document text to the selected provider. Claude usage follows the Claude Code subscription; Codex usage follows the ChatGPT/Codex plan. EDITOR_KIM itself neither requests nor stores API keys.

## AI panel

- Toggle it at any time with **💬 Chat**, the arrow tab on the panel edge, or `Ctrl+J`.
- Selecting a model opens the panel, but model choice and panel visibility are independent.
- Collapse it with `×` or the same edge tab.
- Changing provider or model starts a new conversation.

## PDF editing and redaction

![Architecture](assets/architecture.svg)

Click text, edit it, and press Enter. Text that PDFium can handle keeps the normal editing path. Stale renders are discarded during rapid zoom or document switches, preventing pages from different documents from mixing.

**폰트 맞추기 (Match font)** handles a single ungrouped text box, one line of up to 2,000 characters. Hidden image-backed text or missing source glyphs open the font dialog; a connected AI recommends candidates only for these exceptional cases. Select an installed font or import a static TTF in the Electron app, adjust size and width fitting, preview the saved-and-reopened result, then apply and save. Undo and redo are supported. Later supported edits with the selected font do not call AI.

Font recommendations send only the selected region image, its text, and the supported font catalog to the selected provider. AI suggests similar installed fonts; it does not identify the original with certainty or generate font files. Supply the original TTF for the same typeface. OTF/CFF and variable fonts are not supported. Imported external TTF files must be added again after restarting for further editing; saved PDFs still display their embedded subsets. Manual selection works without AI.

![Redaction pipeline](assets/redaction.svg)

Text redaction removes the selected characters from the PDF object, adds a rectangle, and re-extracts page text to verify removal. A scanned image can only be visually covered; this does not remove OCR data embedded elsewhere.

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

## Development and verification

```bash
npm test
npm audit
```

The tests cover PDF rendering, editing, font fallback, redaction, save/reopen behavior, provider parsing, and UI safety checks. Create Windows packages with `npm run dist` only when preparing a release.

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
