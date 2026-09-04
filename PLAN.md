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
|---|---|
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


| WP | 내용 |
|---|---|
| A | `app/pdf-engine.js` — PDFium 래퍼. open/render(PNG)/objects/setText/save/close. 글리프 없는 폰트(서브셋)면 시스템 한글 폰트(`C:\Windows\Fonts\malgun.ttf`)로 새 텍스트 객체 생성해 대체. 자체 검사 스크립트 포함 |
| B | `server.js` PDF 엔드포인트 + `index.html` PDF 편집 UI. 서버 렌더 PNG(오프라인), 텍스트 객체 클릭 → 인라인 편집 → 재렌더 → 저장. Claude 패널에서 선택 객체를 고치는 흐름 |
| C | `tools/md2pdf.js` — Electron `printToPDF`로 MD→PDF. 한글 서브셋 폰트가 들어간 실전 테스트 PDF(`workspace/회의록_초안.pdf`) 생성 |

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

- [x] A 엔진 (2026-09-04) — 글리프 검사는 `FPDFFont_GetGlyphPath`의 notdef 포인터 비교. PNG는 `EPDF_PNG_EncodeRGBA`. 검수 후 보강: 굵은 원본이면 `malgunbd.ttf` 폴백, 빈 문자열 가드
- [x] B UI·서버 (2026-09-04) — 조각 객체를 기준선·인접성으로 한 줄로 묶어 편집. 확정 시 첫 조각에 전체 텍스트, 나머지는 공백
- [x] C MD→PDF 도구 + 한글 테스트 PDF (2026-09-04)
- [x] 검수 : 회의록 PDF 제목을 브라우저에서 고쳐 Ctrl+S → 재열기 시 반영 확인. 원본 서브셋에 있는 글자는 원본 폰트, 없는 글자는 맑은 고딕(굵기 일치)으로 같은 자리에 렌더
- [ ] Edge·Acrobat에서 저장본 열어 육안 확인 (사용자)

**검수에서 드러난 다음 과제**
- [x] **D 폴백 폰트 서브셋 (2026-09-04).** fontkit(순수 JS·동기)으로 쓰인 글자만 서브셋. fontkit은 cmap을 안 만들어서 format 4 cmap을 직접 써서 붙임(PDFium은 cmap 없으면 전부 □). 결과: 회의록 PDF 51KB → 폴백 편집 1회 +8KB, 2회 +21KB (이전 +7.5MB). 굵기별로 "지금까지 쓴 글자" 합집합 서브셋 1개 유지
- [x] E 일괄 편집 엔드포인트 `POST /api/pdf/edits` + 줄 폭 초과·겹침 경고 (2026-09-04)

### P2-F — 실사용 피드백 반영 (2026-09-04, 사용자가 실제 계약서 PDF 10쪽으로 시험)
사용자 지적 3건. 엔진은 해당 PDF(맑은 고딕 서브셋 1종, 셀 단위 텍스트 객체)를 문제없이 읽음.
- [x] **파일 직접 열기.**  사이드바 = 열어 둔 파일 목록(절대경로, localStorage). "파일 열기"(복수 선택) + "폴더 열기"(폴더 안 파일 모두 추가). × 로 목록에서 제거. 서버 `safe()`가 절대경로를 그대로 받음 — 로컬 단일 사용자 앱 전제
- [x] **레이아웃.** `grid-template-rows:40px minmax(0,1fr)` + 각 열 `min-height:0`. 64개 항목으로 확인
- [x] **편집 패널.** 줄 아래 떠 있는 "이 줄 고치기" 패널로 교체. 검수에서 육안 확인

### P2-G/H/I — 다른 이름으로 저장 · 위치 이동 · 마스킹 (2026-09-04 사용자 요청 "전부 진행")

| WP | 내용 |
|---|---|
| G | **다른 이름으로 저장.** Electron 저장 대화상자 → `POST /api/pdf/saveas {name,to}` / MD도 동일. 저장 후 새 경로가 현재 문서·목록에 추가 |
| H | **엔진 확장** (`pdf-engine.js`): `charBoxes` · `move` · `addRect` · `redact` · `pageText`. 마스킹은 글자를 실제로 제거하고 그 자리에 검은 사각형 |
| I | **UI·서버** (G·H 완료 후): 편집 패널에 정렬 유지(왼/가운데/오른쪽)·화살표 이동·드래그, 글자 범위 선택 후 "가리기", 사각형 드래그 가리기, 저장 후 텍스트 잔존 검사 |

**엔진 계약 추가 (H가 구현, I가 사용):**
```js
doc.charBoxes(i, idx)                   // [{ch, x0,y0,x1,y1}]  텍스트 객체 idx의 글자별 상자 (PDF pt)
doc.move(i, idxs, dx, dy)               // {ok}  객체들을 평행이동 (FPDFPageObj_Transform)
doc.addRect(i, {x0,y0,x1,y1}, [r,g,b,a]) // {idx}  채운 사각형 객체 추가
doc.redact(i, idx, from, to)            // {ok, rects:[{x0,y0,x1,y1}]}  글자 [from,to)를 텍스트에서 제거하고 검은 사각형으로 덮음. 앞뒤 글자는 제자리 유지
doc.pageText(i)                         // string  검증용 페이지 전체 텍스트
```
마스킹 원칙: 검은 사각형만 얹으면 글자가 밑에 남아 복사·검색된다. 반드시 텍스트를 제거한다. 이미지(스캔본)는 덮기만 되므로 경고.

- [x] G 다른 이름으로 저장  — Ctrl+Shift+S, 저장 후 캐시를 새 경로로 재키잉
- [x] H 엔진  — 객체↔글자 대응은 `FPDFText_GetTextObject`로 정확. 뒷부분 재배치 오차 0.17pt. Chromium 한 글자 조각은 `charmap` 실패 → 조각 단위 폴백
- [x] I UI  — 정렬 유지(왼/가운데/오른쪽, 오른쪽 정렬 시험에서 x1 오차 0.000pt), ◀▲▼▶ 0.5pt(Shift 5pt), 드래그 이동, 선택 글자 가리기, 줄 전체 가리기, ▭ 사각형 가리기, 가린 뒤 텍스트 잔존 검사
- [x] 검수  — sample.pdf에서 "local" 가리기 → 렌더에 검은 블록, 페이지 텍스트에서 제거 확인. 엔진 시험 전부 통과
- [ ] 사용자 확인: 실제 계약서에서 주민번호 뒷자리 가리기 → 저장 → Edge에서 열어 복사·검색으로 남았는지 확인

### P2-J/K — 실행 취소 · 가림 상자 편집 (2026-09-04 사용자 피드백)
- 라이선스 확정: 개인 용도 무료, 기업·상업 용도는 원칙 불가·저작권자 승인 시 허용. `LICENSE` 작성, package.json `SEE LICENSE IN LICENSE`.
- [x] **J 실행 취소/다시 실행 (2026-09-04).** 편집+정렬이동은 요청 2건이라 취소도 2단계. PDFium에 undo가 없으므로 서버가 변경 전 `doc.save()` 바이트를 문서별 스택(최대 20)에 쌓고, 취소 시 그 바이트로 다시 연다. Ctrl+Z / Ctrl+Y, 상단 버튼. 편집·이동·가리기·사각형 모두 대상
- [x] **K 가림 상자 편집 (2026-09-04).** `FPDFPageObj_AddMark`는 JS 문자열을 그대로 받음. 마크는 저장·재열기 후에도 유지 확인. 만든 사각형에 PDFium 콘텐츠 마크 `DaepilMask`를 붙여 저장 후에도 식별. `objects()`가 `mask:true`로 표시. UI에서 점선 테두리로 보이고 클릭 → 삭제·화살표 이동·드래그. 엔진에 `removeObject` 추가

- [x] **L 닫을 때 선택 (2026-09-04).** 실제 창에서 네 버튼 동작은 사용자 확인 필요. 미저장 상태로 창을 닫으면 네 가지: 이 문서에 덮어쓰기 / 다른 이름으로 저장 / 저장하지 않고 닫기 / 취소. main.js 닫기 핸들러에서 렌더러의 save·saveAs를 호출

### P2-M — 공개 저장소 정비 (2026-09-04, "su-multi-geo 수준으로")
- [x] 영어 README(히어로·배지·목차·전후 비교·구조·마스킹 다이어그램·빠른 시작·샘플 출력·대상·방법·구성·비교표·한계·요구사항·기여자·라이선스) + README.ko.md
- [x] assets: hero.svg · architecture.svg · redaction.svg · edit-before/after.png(엔진 실제 렌더, `npm run assets`)
- [x] CHANGELOG.md(0.1.0), .github/workflows/ci.yml(windows-latest에서 `npm test` + ubuntu 구문 검사), .editorconfig, package.json 메타(description·repository·keywords·engines·test)
- [x] GitHub 저장소 설명 영어화 + 토픽 10개
- 함정: 위임한 두 에이전트가 세션 한도(429)로 시작도 못 함 → 직접 작성. 마스킹 그림 예시 번호에 사용자 계약서의 실제 번호를 옮겨 쓴 것을 검수에서 발견해 가짜 번호로 교체하고 저장소 전체 grep으로 확인

### P2-O — 드래그 고스트 · 마스크 반투명 · 새로 시작 (2026-09-04 사용자 피드백 3건)
- [x] 글자 줄을 드래그할 때 글자가 함께 움직여 보이게 — 페이지 이미지의 해당 영역을 캔버스로 복사해 마우스를 따라가는 고스트, 원래 자리는 흰색. Esc 취소 
- [x] 가림 상자를 선택·드래그할 때 반투명하게 — 선택 시 흰색 55% 덮개, 드래그 고스트 투명도 0.6 
- [x] 앱을 다시 켰을 때 이전 파일이 자동으로 열리지 않게 — 열어 둔 목록은 sessionStorage, "최근 파일" 접힘 목록은 유지. 없어진 파일은 안내 후 제거 
- [x] 검수 중 발견: `GET /api/file`이 없는 파일에 헤더를 먼저 보내고 스트림 오류로 서버 프로세스가 죽음 → 존재 확인 후 404, 스트림 error 핸들러 

### P2-P — 버그: 선택 가리기가 전체 가리기로 (2026-09-04 사용자 보고)
- 원인: Word/Excel 출력 PDF는 텍스트 객체 끝에 공백이 붙는데(계약서 1쪽 97개 중 50개) PDFium 텍스트 페이지는 그 공백을 내놓지 않음 → `charBoxes` 길이 ≠ 텍스트 길이 → `redact`가 `charmap`으로 실패 → 서버 폴백이 객체 전체를 가림.
- [x] 수정: `charBoxes`가 빠진 공백 자리에 0폭 합성 상자를 끼워 텍스트와 1:1로 정렬 . 계약서 97/97 대응, 셀 가운데 부분 마스킹 성공. 회귀 시험 추가.

### P2-Q — 여러 줄 편집 (2026-09-04 사용자 보고: 편집 상자에서 줄바꿈하면 □만 들어가고 한 줄로 나옴)
- 원인: PDF 텍스트 객체는 한 줄. '\n'은 폰트에 없는 글자라 □로 그려짐.
- [x] 수정: `setText`가 '\n'으로 나눠 첫 줄은 기존 객체에, 나머지 줄은 같은 폰트·크기·색의 새 객체를 행간(크기×1.2, `LINE_HEIGHT`)만큼 아래(idx+k)에 삽입. 줄마다 원본 폰트/폴백 판단. UI는 나머지 조각을 먼저 비우고 첫 조각을 마지막에 보내 인덱스 밀림 방지. Shift+Enter 안내, 줄 추가 시 겹침 안내 
- 한계: 아래 기존 줄을 밀어내지 않는다(재배치 없음). 겹치면 드래그로 옮긴다. 회전 텍스트는 첫 줄만

### P2-R — 긴 글이 옆 글자와 겹침 (2026-09-04 사용자 보고)
- [x] `fitText(i, idx, text, maxWidth, mode)`: wrap = 실제 SetText 후 bounds로 폭을 재며 단어 단위 줄바꿈 → 여러 줄 배치, shrink = 행렬 a·d 축소, none = 그대로. `POST /api/pdf/fit`
- [x] UI "넘치면: 줄바꿈(기본)/글자 축소/그대로". 사용 가능한 폭 = 같은 줄 왼쪽 이웃 끝 ~ 오른쪽 이웃 시작(없으면 본문 좌우 끝). 검수: 제목을 긴 문장으로 바꿔 본문 폭 안에서 2줄로
- 한계: 줄바꿈으로 늘어난 줄은 아래 기존 줄을 밀어내지 않는다(표 보호). "아래 줄 밀어내기" 옵션은 후속 검토

### P2-S — 영어 줄바꿈 시 글자 사라짐 · 버전 표시 · 페이지 경계 (2026-09-04 사용자 보고)
- 원인 1: 추가 줄 객체를 원래 글자 바로 뒤(idx+k)에 끼웠더니 표 문서에서는 그 뒤에 오는 셀 배경 채움이 새 줄을 덮음 → 글자가 안 보임. **추가 줄은 맨 뒤(가장 위 z-순서)에** 넣고 `lineIdxs`로 위치를 돌려줌
- 원인 2: 둘째 줄 굵기를 폴백 객체("Untitled")에서 읽어 보통 굵기로 → 원래 객체에서 미리 읽음
- [x] 헤더와 창 제목에 `v0.1.0` (package.json에서). `/api/health`가 `appVersion` 반환
- [x] 줄바꿈 폭을 페이지 여백(18pt) 안으로 clamp — 이웃이 없어도 페이지를 벗어나지 않음
- 한글은 되고 영어만 문제였던 이유: 한글 시험은 표가 없는 시험지로만 했고, 사용자는 표 문서(계약서)에서 시험함

### P2-T — 이탤릭 셀 줄바꿈 · Claude 패널 접기 (2026-09-04 사용자 보고)
- 원인: 계약일자 셀은 기울임 행렬(synthetic italic, c≠0). 줄바꿈 코드가 이를 회전 텍스트로 보고 둘째 줄을 버림 → "Shift+Enter 시 글자가 없어짐"
- [x] 행간 이동을 행렬에 통과시켜 계산(e −= k·lh·c, f −= k·lh·d). 기울임·회전 모두 줄이 따라감. 회전 가드 제거. 계약서 날짜 셀에서 두 줄·기울임 유지 확인
- [x] Claude 패널 기본 접힘. 헤더 "💬 Claude" 버튼 / Ctrl+J로 열고 닫음, 선택 기억

### P2-U — 상자 = 객체 하나, 그룹은 사용자가 (2026-09-04 사용자 결정)
> *"한줄로 묶는 기능 자체가 왜 필요하지? 다른 박스일 수도 있으니 원 박스를 유지하는 형태가 낫고, Shift키로 여러 박스를 한번에 선택 시 그룹설정 및 그룹해제 기능을 넣어줘."*
- [x] 자동 줄 묶기(기준선·간격 휴리스틱) 제거. 텍스트 객체 하나 = 상자 하나
- [x] 그룹은 PDF 콘텐츠 마크 `DaepilGroup(id)`로 저장. 줄바꿈 편집으로 생긴 줄들은 자동으로 같은 그룹(한 줄로 되돌리면 해제). 저장·재열기 후 유지
- [x] Shift 클릭으로 여러 상자 선택 → 화면 하단 바 [그룹 설정] / [선택 해제]. 그룹 상자 패널에 [그룹 해제]. `POST /api/pdf/group`
- [x] 그룹 텍스트는 위→아래·왼→오른쪽으로 잇고 기준선이 다르면 줄바꿈. 편집 시 첫 객체만 남기고 전체 텍스트를 다시 넣음. 가리기 범위 매핑은 구분 문자 길이 반영
- 검수: sample.pdf 상자 8개 → Shift 클릭 2개 묶기 → 7개, 그룹 상자에 두 줄 텍스트·해제 버튼. 엔진 시험에 그룹 저장/설정/해제 추가
- 영향: Chromium 출력물(글자 단위 조각)은 상자가 글자마다 생긴다. 그런 문서는 Shift 클릭으로 묶어 편집

### P2-V — 가림 색: 검정 / 배경색 자동 추출 (2026-09-04 사용자 요청)
- [x] 엔진 `sampleColor(i, bounds)`: 페이지를 1배로 렌더해 영역 픽셀을 32단계로 양자화, 최빈 묶음의 평균색. 글자·선은 소수라 배경색이 나옴
- [x] `/api/pdf/rect`·`/api/pdf/mask`의 `color:'auto'` → 사각형마다 그 자리 색 추출. `redact(..., color)`도 동일. 툴바 "가림: 검정/배경색" 선택(기억)
- 검수: 흰 페이지 → (255,255,255), 검은 사각형 위 → (0,0,0), 계약서 노란 셀 → (251,251,193)으로 라벨을 가리니 셀과 구분 안 됨
- 한계: 그러데이션·사진 위에서는 주 색 하나로만 덮여 티가 남. 그 경우 검정을 쓰는 편이 낫다

### P2-후속 — 문서 기능
- [ ] UI에 "PDF로 내보내기" 버튼 (C의 도구를 연결)
- [ ] PDF → MD 변환 (PDFium 텍스트 추출 → Claude로 제목·표 구조 복원)
- [ ] 텍스트 객체 추가·삭제·이동, 이미지 교체
- [ ] 편집 모드: 선택 영역만 고치기
- [ ] 자주 쓰는 지시 버튼: 격식체 변환 / 3줄 요약 / 오탈자 / 표로 정리

### P3 — 배포 (2026-09-04 진행)
- [x] electron-builder 설정(package.json `build`): portable + nsis, x64, asar. 아이콘은 `tools/make-icon.js`(Electron 오프스크린 캡처 → build/icon.png, 빌더가 .ico 변환)
- [x] `npm run dist` → `dist/DAEPIL-0.2.1-portable.exe`, `dist/DAEPIL-0.2.1-setup.exe` (각 약 102MB). 포터블 실행 → 5초 내 기동, Claude Code 검사·PDFium 렌더·폴백 폰트 편집 동작 확인
- 주의: 코드 서명 인증서 없음 → 첫 실행 시 SmartScreen "알 수 없는 게시자" 경고. "추가 정보 → 실행"으로 진행
- 문서에서 모델 언급 제거(사용자 요청)
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
