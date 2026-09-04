# DAEPIL (대필)

![DAEPIL — edit text. remove it for real.](assets/hero.png)

> a PDF & Markdown editor that runs Claude through your own Claude Code login, by **su** ([kindsusu](https://github.com/kindsusu))

<p align="center">
  <a href="README.md"><b>English</b></a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/kindsusu/DAEPIL/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/kindsusu/DAEPIL/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="version 0.2.1" src="https://img.shields.io/badge/version-0.2.1-d97757">
  <img alt="engine PDFium (WASM)" src="https://img.shields.io/badge/engine-PDFium%20(WASM)-1A2B28">
  <img alt="no API key" src="https://img.shields.io/badge/API%20key-none-2C7A4B">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-0E6B5C">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078D4">
  <a href="LICENSE"><img alt="License: personal use free, commercial by approval" src="https://img.shields.io/badge/license-personal%20use%20%C2%B7%20commercial%20by%20approval-A96A00"></a>
  <img alt="Korean-first" src="https://img.shields.io/badge/Korean-first-B3372B">
</p>

**A local desktop editor that edits the text inside a PDF — in the original font — and redacts it for real.**

Most "PDF editors" draw over the page. The text underneath stays in the file, so a black bar over a national ID number still leaks it to Ctrl+F, to copy-paste, and to every text extractor. DAEPIL rewrites the page content stream instead: it changes the text object, keeps the embedded font, splits the object around the characters you redact, and then **re-extracts the page text to prove they are gone**. The AI panel does not need an API key — the app spawns the Claude Code CLI under the login you already have, so a Pro or Max subscription is enough.

## Contents

- [Before / after](#before--after)
- [How it works](#how-it-works)
- [True redaction](#true-redaction)
- [Quick start](#quick-start)
- [Sample output](#sample-output)
- [Who it's for](#who-its-for)
- [Method](#method)
- [What's inside](#whats-inside)
- [Compared to the alternatives](#compared-to-the-alternatives)
- [Limits](#limits)
- [Requirements](#requirements)
- [Contributors](#contributors) · [License](#license)

---

## Before / after

Fictional meeting minutes exported from Chromium, so every line is split into per-glyph text objects with a subset Malgun Gothic Bold font — the hard case. Rendered by DAEPIL's own engine, not a screenshot of another viewer.

<table>
<tr><th>before</th><th>after</th></tr>
<tr>
<td><img src="assets/edit-before.png" alt="Original page: heading ends in (초안), attendee list intact"></td>
<td><img src="assets/edit-after.png" alt="Edited page: heading now ends in (확정) in the original bold font; one attendee name replaced by a black bar"></td>
</tr>
</table>

Two edits happened on the right. The heading changed from *(초안)* to *(확정)* through `FPDFText_SetText` on the original font object — no fallback font, no re-layout. The name *재무팀장* in the attendee line was redacted: its four glyph objects were removed from the content stream and a single black rectangle was added over their union. Reproduce it with `npm run assets`.

---

## How it works

![Architecture: Electron window, local server, PDFium engine, Claude Code CLI; documents stay on the machine](assets/architecture.svg)

Three processes, one machine. The Electron window talks to a local HTTP/SSE server written with Node built-ins. The server owns the PDF engine — PDFium compiled to WebAssembly via [`@embedpdf/pdfium`](https://www.npmjs.com/package/@embedpdf/pdfium) — and renders pages to PNG, enumerates text objects, applies edits and saves through PDFium's own writer. No pdf.js, no pdf-lib.

For AI, the server runs `claude -p --output-format stream-json` with the prompt on stdin and streams the tokens back. Nothing is stored: not a key, not a token. Whether the call is billed is between you and Anthropic — on a Pro/Max plan it is covered by the subscription, and the panel shows the API-equivalent cost so you can see what you are not paying.

---

## True redaction

![Redaction pipeline: select, split the text object, add a marked black rectangle, verify by re-extracting page text](assets/redaction.svg)

The redact call is the reason this project exists. Given a text object and a character range it:

1. reads per-character boxes from PDFium (`FPDFText_GetTextObject` maps every character on the page back to the object that drew it — no coordinate heuristics);
2. sets the object's text to the prefix, creates a new object for the suffix with the same font, size, color and matrix, and shifts it by the distance between character boxes (measured error: 0.17 pt);
3. adds a filled black path over the union of the removed boxes, tagged with the PDFium content mark `DaepilMask` so the box remains a selectable, movable, deletable object after save and reload;
4. re-extracts the page text and refuses to call it done if the removed string is still present.

Scanned pages are different: there is no text to remove, so the rectangle tool only covers pixels, and the UI says so.

---

## Quick start

Requires [Claude Code](https://code.claude.com/docs/en/setup) installed and logged in (Pro, Max or Team — the free plan cannot use Claude Code). The app checks on startup and offers to install (`irm https://claude.ai/install.ps1 | iex`) and log in (`claude auth login`) in a separate PowerShell window.

```bash
git clone https://github.com/kindsusu/DAEPIL.git
cd DAEPIL
npm install
npm start
```

On Windows you can skip the terminal after cloning: double-click **`run-daepil.bat`** — it checks for Node, runs `npm install` on first launch, then starts the app.

Then: **📂 파일 열기** → pick a PDF → hover a line, click it → type → Enter → Ctrl+S. Keys that matter:

| key | does |
|---|---|
| Enter / Esc | apply / cancel the line edit |
| Ctrl+S / Ctrl+Shift+S | save / save as |
| Ctrl+Z / Ctrl+Y | undo / redo (20 snapshots per document) |
| ◀ ▲ ▼ ▶ (Shift) | nudge the line 0.5 pt (5 pt) · or drag it |
| 선택 글자 가리기 | redact the characters selected in the panel |
| ▭ 사각형 가리기 | rectangle cover for scanned pages |

Browser only, no Electron: `npm run serve` and open http://localhost:4747 (no file dialogs; lists `workspace/`). Markdown → PDF with embedded subset fonts: `npm run md2pdf -- in.md out.pdf`.

---

## Sample output

The engine self-test, `npm test`, on the fixtures in `workspace/`:

```console
$ npm test

pageSize { w: 595, h: 842 }
objects[0] {"idx":0,"type":"text","text":"GenOffice-lite prototype - sample PDF","font":"Helvetica","size":12, ...}
render bytes 36162
setText(한글) { ok: true, fallbackFont: true }
setText(라틴) { ok: true, fallbackFont: false }
[회의록_초안.pdf] font=AAAAAA+MalgunGothicBold "월 " → {"ok":true,"fallbackFont":true} (폴백 폰트)
[회의록_초안.pdf] 원본 글자 재입력 → {"ok":true,"fallbackFont":false}
charBoxes 37 {"ch":"G","x0":60.576,"y0":739.784,"x1":68.448,"y1":748.844}
redact {"ok":true,"rects":[{"x0":125.668,"y0":627.332,"x1":149.732,"y1":637.116}],"inserted":6}
suffix 위치 오차 -0.168 pt
사각형 영역 {"dark":147,"n":147,"frac":1}
[회의록] 마스킹 저장·재열기 OK 57751 bytes

OK — 모든 검사 통과
```

`frac: 1` means every pixel inside the redaction rectangle rendered black; the line below it checks that the suffix still renders as text. The Korean fixture is fictional and generated by `tools/md2pdf.js`.

---

## Who it's for

- **People who handle other people's documents** — HR, admin, legal — and need to fix a date on a signed PDF or black out an ID number without sending the file to a web service.
- **Korean-first users.** Word and HWP exports embed subset fonts; DAEPIL detects missing glyphs correctly on those fonts and falls back to Malgun Gothic (bold when the original is bold), subsetting the fallback so a 51 KB file grows by ~8 KB, not 7.5 MB.
- **Claude subscribers** who want document AI without an API bill.

It is not for teams (single user, no server), not for scanned-only archives (cover only), and not yet for macOS or Linux (untested; the fallback font path is Windows).

---

## Method

The project was built as a series of small work packages, each with a written contract and a check it had to pass before merging. [`PLAN.md`](PLAN.md) is the running log — decisions, contracts, and the traps found on the way. A few of those traps shaped the design:

- **Subset CID fonts do not say "no glyph".** `FPDFFont_GetGlyphPath` returns the `.notdef` path for missing characters, and every missing character shares that pointer. DAEPIL probes two Private Use Area code points to learn the notdef pointer and compares against it. `FPDFFont_GetGlyphWidth` is useless here — it returns a default width.
- **fontkit's TTF subset has no `cmap`.** pdfkit draws by glyph ID and never needed one; PDFium maps Unicode through the cmap and renders tofu without it. DAEPIL writes a format 4 cmap and splices it into the sfnt directory. `name`, `OS/2` and `post` are not required.
- **Automatic line grouping merges table cells.** A baseline-and-gap heuristic was tried and removed. Now one text object is one box; the user groups boxes with Shift-click, and the grouping is stored as the PDFium content mark `DaepilGroup`. Only the lines produced by a multi-line edit are grouped automatically.
- **`FPDFText_SetText(obj, "")` traps the WASM module.** Empty text is replaced by a single space at the engine boundary, so every caller is safe.

---

## What's inside

```
app/
  main.js            Electron shell: window, file/save dialogs, four-way close dialog
  preload.js         window.daepil bridge (openFiles, openFolder, saveAs)
  server.js          local HTTP/SSE: files, PDF endpoints, undo snapshots, Claude Code spawn
  pdf-engine.js      PDFium wrapper: open · render · objects · setText · charBoxes · move · addRect · redact · pageText · save
  pdf-engine.test.js plain Node asserts, run by CI on windows-latest
  index.html         the whole UI, no framework
tools/
  md2pdf.js          Markdown → PDF through Chromium printToPDF (embedded subset fonts)
  demo-assets.js     regenerates assets/edit-before.png and edit-after.png with the engine
workspace/           fictional fixtures: 회의록_초안.md / .pdf, sample.pdf
PLAN.md              the working plan and review log
```

Dependencies: `@embedpdf/pdfium` (engine), `fontkit` (fallback subsetting), `electron` (dev). Everything else is Node built-ins.

---

## Compared to the alternatives

| | DAEPIL | GenOffice | Adobe Acrobat | pdf.js-based editors | Stirling-PDF |
|---|---|---|---|---|---|
| edits text in the original font | yes (PDFium) | yes (same PDFium approach) | yes | no — annotations over the page | no |
| redaction removes the text | yes, verified by re-extraction | — | yes | no (cover-up) | partial (page flatten) |
| where the document goes | stays local | local | local / cloud | local | your server |
| AI | Claude Code login, no key | BYOK or Genspark login | Adobe AI (paid) | — | — |
| scope | PDF + Markdown | Word · Excel · PowerPoint · PDF · MD | PDF | PDF | PDF utilities |
| platform | Windows (tested) | Win · macOS · Linux | Win · macOS | any | Docker |
| license | personal free · commercial by approval | Apache-2.0 | commercial | mostly open | MIT |

GenOffice is the closest relative — DAEPIL took the engine choice from it and left the office suite behind.

---

## Limits

- **Windows only, so far.** The fallback font is read from `C:\Windows\Fonts`. macOS/Linux need a font path and a test run.
- **Rotated text is not edited.** `redact` returns `reason: 'rotated'` rather than guessing.
- **Scanned pages are covered, not redacted.** Removing pixels from the underlying image is future work.
- **Undo snapshots are whole documents.** 20 × a 600 KB PDF is 12 MB of memory per open file; fine for office documents, not for 200-page scans.
- **The server trusts absolute paths.** It is a local, single-user app; paths only ever come from the OS file dialog. Do not expose port 4747.
- **Distribution is a gray area.** Running Claude Code under your own login for your own use is what the tool is for. Shipping DAEPIL to third parties is an Anthropic terms question, and the license reflects that.

---

## Requirements

- Windows 10 or later (tested on Windows 11)
- Node.js 22+ (tested on 24), Electron 44 (installed by `npm install`)
- Claude Code, installed and logged in — Pro, Max or Team
- Malgun Gothic (ships with Windows) for the Hangul fallback

---

## Contributors

- **su / [kindsusu](https://github.com/kindsusu)** — direction, product decisions, testing on real documents
- Built with Claude Code.

## License

Free for personal use. Business or commercial use is prohibited unless approved in writing by the author — see [`LICENSE`](LICENSE). Bundled components keep their own licenses: PDFium (Apache-2.0), @embedpdf/pdfium (MIT), fontkit (MIT), Electron (MIT).
