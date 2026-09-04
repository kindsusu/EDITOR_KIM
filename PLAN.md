# su-daepil (대필) — 계획

PDF·Markdown 편집기. AI는 Claude Code 로그인(구독)으로 호출하고 API 키는 쓰지 않는다.

## 구조

```
Electron 창 (app/index.html)
   ↕ HTTP/SSE (localhost)
app/server.js  — 파일 읽기/쓰기, Claude 호출 (Node 내장 모듈만)
   ↕ stdin/stdout
claude -p --output-format stream-json   ← Claude Code CLI, 사용자 로그인 그대로
```

- 프로토타입(브라우저 + Node 서버)이 이미 동작함. Electron은 그 위에 창·파일 대화상자·패키징만 얹는다.
- Electron을 고른 이유: 네이티브 폴더/파일 대화상자, Ctrl+S, MD→PDF 내보내기(`printToPDF` 내장), exe 패키징, 그리고 GenOffice PDF 엔진(Electron 기반)을 나중에 이식할 수 있음.

## 모델

| 용도 | 모델 | 이유 |
|---|---|---|
| 기본 | **Claude Sonnet 5** (`--model sonnet`) | 문서 편집 품질 충분, 응답 빠름, 구독 한도 소모가 Opus의 약 1/5 |
| 선택 | Claude Opus 5 (`--model opus`) | 긴 보고서 재작성·복잡한 구조 변경 때 패널에서 전환 |

## 단계

### P1 — 쓸 수 있는 앱 (첫 목표)
- [x] Electron 셸: `app/main.js`가 server.js를 띄우고 창을 연다 (2026-09-04, `npm start` 동작 확인)
- [x] 폴더 열기(네이티브 대화상자) → 작업 폴더 전환, `~/.su-daepil.json`에 기억 — 대화상자는 실제 창에서 직접 확인 필요
- [x] Ctrl+S 저장, 수정됨 ● 표시, 닫을 때 미저장 경고 — 닫기 경고는 실제 창에서 직접 확인 필요
- [x] Claude 대화 이어가기(`--resume` 세션 ID) — 문서당 1세션, 질문 모드만. 편집 모드는 매번 문서 전체를 새로 보냄. [새 대화]로 초기화
- [x] 모델 선택(Sonnet 기본 / Opus) — 응답에 `claude-sonnet-5` 확인
- [x] 시작 시 Claude Code 검사 → 없으면 **설치 화면**: `claude --version`으로 설치 여부, `claude auth status`로 로그인 여부 확인. 미설치면 [설치] 버튼이 공식 설치기(`irm https://claude.ai/install.ps1 | iex`, 관리자 권한 불필요)를 별도 PowerShell 창에서 실행. 미로그인이면 [로그인] 버튼이 `claude`를 별도 창에서 띄워 브라우저 로그인 진행. [다시 확인]으로 재검사. Pro/Max/Team 계정 필요(무료 계정은 Claude Code 불가)
- [x] `npm start`로 실행 (`npm run serve`는 브라우저용, 폴더 열기 버튼 없음)

### P2 — PDF 직접 편집 (메인 기능)

**엔진 결정 (2026-09-04):** GenOffice의 PDF 편집도 자체 코드가 아니라 `@embedpdf/pdfium`(PDFium WASM, MIT + Apache-2.0)이다. 같은 패키지를 npm으로 받아 쓴다. 스파이크(`spike-pdfium.js`)로 Node에서 텍스트 객체 열거 → `FPDFText_SetText` → `FPDFPage_GenerateContent` → 저장 → 재로드 확인 → 렌더까지 검증 완료. pdf.js·pdf-lib 없이 PDFium 하나로 렌더·편집·저장을 다 한다.

역할: Fable 5.1이 계획·계약·검수. 구현은 Opus(엔진) / Sonnet(UI·서버·도구)에 위임.

| WP | 담당 | 내용 |
|---|---|---|
| A | Opus | `app/pdf-engine.js` — PDFium 래퍼. open/render(PNG)/objects/setText/save/close. 글리프 없는 폰트(서브셋)면 시스템 한글 폰트(`C:\Windows\Fonts\malgun.ttf`)로 새 텍스트 객체 생성해 대체. 자체 검사 스크립트 포함 |
| B | Sonnet | `server.js` PDF 엔드포인트 + `index.html` PDF 편집 UI. 서버 렌더 PNG(오프라인), 텍스트 객체 클릭 → 인라인 편집 → 재렌더 → 저장. Claude 패널에서 선택 객체를 고치는 흐름 |
| C | Sonnet | `tools/md2pdf.js` — Electron `printToPDF`로 MD→PDF. 한글 서브셋 폰트가 들어간 실전 테스트 PDF(`workspace/회의록_초안.pdf`) 생성 |

**엔진 계약 (A가 구현, B가 사용):**
```js
const { open } = require('./pdf-engine');
const doc = await open(buffer);           // Buffer → Doc
doc.pageCount;                            // number
doc.pageSize(i);                          // {w, h}  (pt)
await doc.render(i, scale);               // Buffer (PNG)
doc.objects(i);                           // [{idx, type:'text'|'image'|'path'|'other', text, font, size, bounds:{x0,y0,x1,y1}, color:[r,g,b,a]}]  bounds는 PDF pt, 원점 좌하단
doc.setText(i, idx, newText);             // {ok, fallbackFont}  fallbackFont=true면 원본 폰트에 글리프가 없어 시스템 폰트로 교체됨
doc.save();                               // Buffer
doc.close();
```
좌표 변환(UI): `px = x*scale`, `py = (h − y)*scale`.

**서버 엔드포인트 (B):** `GET /api/pdf/info?name` · `GET /api/pdf/page?name&i&scale` (PNG) · `GET /api/pdf/objects?name&i` · `POST /api/pdf/edit {name,i,idx,text}` · `POST /api/pdf/save {name}` · `POST /api/pdf/close {name}`. 문서는 서버 메모리에 name별 캐시.

- [ ] A 엔진
- [ ] B UI·서버
- [ ] C MD→PDF 도구 + 한글 테스트 PDF
- [ ] 검수: 한글 PDF에서 원본 폰트 유지 편집 / 서브셋 폴백 / 저장 후 Acrobat·Edge에서 열림

### P2-후속 — 문서 기능
- [ ] UI에 "PDF로 내보내기" 버튼 (C의 도구를 연결)
- [ ] PDF → MD 변환 (PDFium 텍스트 추출 → Claude로 제목·표 구조 복원)
- [ ] 텍스트 객체 추가·삭제·이동, 이미지 교체
- [ ] 편집 모드: 선택 영역만 고치기
- [ ] 자주 쓰는 지시 버튼: 격식체 변환 / 3줄 요약 / 오탈자 / 표로 정리

### P3 — 배포
- [ ] electron-builder → `su-daepil-Setup-x.y.z.exe` (NSIS)
- [ ] 아이콘, 앱 이름 "대필"
- [ ] README: Claude Code 설치·로그인이 선행 조건

### P4 — 선택
- [ ] PDF 본문 직접 편집: GenOffice `packages/pdf-*` (Apache-2.0) 이식 검토. 큰 작업이라 P1~P3 사용 후 필요성 판단.
- [ ] Codex CLI(ChatGPT 구독) 제공자 추가 — server.js에 spawn 한 줄 분기

## 전제·주의
- Claude Code 설치 + 로그인이 필수. 앱은 토큰을 만지지 않는다.
- 개인 사용 기준. 타인 배포는 Anthropic 약관상 회색 지대.
- 문서 내용이 Claude에 전송됨. 개인정보 문서는 사용자 판단.
