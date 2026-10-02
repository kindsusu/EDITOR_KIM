# Microsoft Store 제출서 문안 (Partner Center에 붙여 넣을 내용)

작성 2026-10-02 · 기준 버전 3.0.0 · 언어: 한국어(ko-KR), 영어(en-US)

## 기본 정보

| 항목 | 값 |
|---|---|
| 앱 이름(예약) | EDITOR_KIM |
| 가격 | 무료 |
| 범주 | 생산성(Productivity) |
| 개인정보 처리방침 URL | https://github.com/kindsusu/EDITOR_KIM/blob/main/PRIVACY.md |
| 웹 사이트 | https://github.com/kindsusu/EDITOR_KIM |
| 지원 연락처 | https://github.com/kindsusu/EDITOR_KIM/issues |
| 스크린샷 | `store/screenshot-1-pdf.png`, `-2-edit.png`, `-3-markdown.png` (1366×768, 가상 문서만 표시) |
| 앱 타일 아이콘 | 패키지에 포함(`build/appx/`). 목록용 300×300 로고가 따로 필요하면 `build/icon.png` 사용 |

## 제한된 기능(runFullTrust) 사용 사유

Partner Center가 묻는 "이 기능을 사용하는 이유"에 넣는다. 영어로 쓴다(심사자용).

> EDITOR_KIM is an Electron desktop app. runFullTrust is required to read and write the user's local PDF and Markdown files, to run its built-in local HTTP server bound to 127.0.0.1 that renders and edits PDFs, and, only when the user invokes AI features, to launch the Claude Code or Codex command-line tools the user has installed and signed in to separately.

## 연령 등급(IARC 설문) 권장 답

- 앱 유형: 유틸리티·생산성(게임 아님)
- 폭력·성적 내용·약물·도박·욕설: 없음
- 사용자 간 소통·콘텐츠 공유: 없음(앱 안에서 다른 사용자와 연결되지 않음)
- 위치 공유·개인정보 공유: 없음
- 디지털 상품 구매: 없음
- 무제한 인터넷 접근(웹 브라우저 기능): 없음. 링크는 기본 브라우저로 넘긴다
- 예상 등급: 전체 이용가(3+)

> AI 응답이 사용자 생성 콘텐츠로 분류되는지 묻는 문항이 나오면 "아니오 — AI는 사용자가 연 문서에 대해 그 사용자에게만 답하고 공유 기능이 없다"로 답한다.

## 추가 라이선스 조항

Partner Center → 속성 → "추가 라이선스 조항"에 넣는다. 저장소 `LICENSE`의 요지다.

**한국어**

> 개인이 비상업적 목적으로 사용하는 것은 무료입니다. 회사·기관·단체가 업무에 쓰거나 상업적으로 사용하려면 저작권자(kindsusu)의 사전 서면 승인이 필요합니다. 승인 문의: https://github.com/kindsusu/EDITOR_KIM/issues. 전체 조항: https://github.com/kindsusu/EDITOR_KIM/blob/main/LICENSE. 이 소프트웨어는 "있는 그대로" 제공되며, 중요한 문서는 사본으로 작업하고 결과를 직접 확인하십시오.

**English**

> Free for personal, non-commercial use. Use by companies, institutions or organizations for their work, or any commercial use, requires prior written approval from the copyright holder (kindsusu). Requests: https://github.com/kindsusu/EDITOR_KIM/issues. Full terms: https://github.com/kindsusu/EDITOR_KIM/blob/main/LICENSE. Provided "as is"; work on copies of important documents and verify results yourself.

---

## 한국어 목록(ko-KR)

### 짧은 설명

PDF 글자를 직접 고치고, 개인정보를 실제로 지워서 가리는 PC용 PDF·Markdown 편집기.

### 설명

EDITOR_KIM은 PDF를 그림처럼 덮어쓰는 대신 문서 안의 글자를 직접 고치는 PC용 편집기입니다.

글줄을 누르면 그 줄 전체가 편집 창에 들어옵니다. 고친 글자는 원래 글꼴로 다시 그립니다. 원래 글꼴에 없는 글자는 맑은 고딕으로 그리며 [폰트 맞추기]로 다른 글꼴을 지정할 수 있습니다. 줄이 넘치면 줄바꿈하거나 글자를 줄여 폭에 맞춥니다.

가리기는 글자를 검은 상자로 덮기만 하지 않습니다. PDF에서 글자를 실제로 지우고, 페이지 텍스트를 다시 읽어 지워졌는지 확인합니다. 주민등록번호나 연락처처럼 남으면 안 되는 정보를 다룰 때 쓰세요.

페이지 정리·회전·순서 바꾸기·분할·병합, 이미지로 내보내기, 이미지 삽입, 용량 줄이기를 한 화면에서 할 수 있습니다. 긴 작업은 진행 창에서 취소할 수 있고, 거의 모든 편집은 실행 취소할 수 있습니다.

Markdown 문서는 왼쪽에서 고치고 오른쪽에서 바로 결과를 봅니다.

문서는 PC 안에서만 처리합니다. 개발자는 어떤 데이터도 수집하지 않습니다.

AI 기능(선택): 문서에 대해 질문하거나 수정을 맡길 수 있습니다. 이 기능을 쓰려면 Claude Code(Anthropic) 또는 Codex(OpenAI)를 PC에 따로 설치하고 본인 계정으로 로그인해야 합니다. API 키는 필요 없습니다. AI 기능을 쓸 때만 현재 문서의 텍스트가 고른 공급자에게 전송됩니다. AI 없이도 모든 편집 기능을 쓸 수 있습니다.

개인의 비상업적 사용은 무료입니다. 회사·기관의 업무 사용은 사전 승인이 필요합니다(추가 라이선스 조항 참고).

### 주요 기능 (최대 20개, 각 200자)

1. PDF 글자를 줄 단위로 직접 고치기 — 원래 글꼴로 다시 그림
2. 실제로 지우는 가리기 — 글자를 PDF에서 제거하고 다시 추출해 확인
3. 줄이 넘치면 줄바꿈 또는 글자 크기 줄이기로 폭 맞춤
4. 폰트 맞추기 — 설치 글꼴이나 TTF 파일로 비슷한 글꼴 지정
5. 페이지 추출·삭제·회전·순서 바꾸기
6. PDF 분할과 여러 파일 병합
7. 페이지를 PNG·JPEG 이미지로 내보내기
8. 이미지 삽입, 드래그 이동, 크기 조절
9. 용량 줄이기 — 목표 용량 지정, 여러 파일 한 번에
10. 문서 안 검색과 강조
11. Markdown 편집과 실시간 미리보기
12. 긴 작업 진행 표시와 취소, 실행 취소·다시 실행
13. 문서는 PC 안에서만 처리, 데이터 수집 없음
14. 선택 사항: Claude Code·Codex로 문서 질문과 수정 맡기기(별도 설치·로그인 필요)

### 검색어 (최대 7개)

PDF 편집기, PDF 수정, PDF 가리기, 개인정보 가리기, PDF 병합, PDF 분할, 마크다운

---

## English listing (en-US)

### Short description

A desktop PDF and Markdown editor that edits the real text in PDFs and redacts by actually removing it.

### Description

EDITOR_KIM edits the text inside a PDF instead of painting over it.

Click a line and the whole line opens in the editor. Edited text is redrawn in the original font. Characters the original font lacks are drawn in Malgun Gothic, and Match Font lets you pick another font. Lines that grow too long are wrapped or shrunk to fit.

Redaction does more than draw a black box. It removes the characters from the PDF and re-extracts the page text to confirm they are gone. Use it for information that must not remain, such as ID numbers or phone numbers.

Extract, delete, rotate and reorder pages, split and merge PDFs, export pages as images, insert images and reduce file size, all in one window. Long operations show progress and can be cancelled, and almost every edit can be undone.

Markdown documents are edited on the left with a live preview on the right.

Documents are processed only on your PC. The developer collects no data.

AI features (optional): ask questions about a document or let AI make edits. These require Claude Code (Anthropic) or Codex (OpenAI) installed separately on your PC and signed in with your own account. No API key is needed. The current document's text is sent to the provider you chose only when you use an AI feature. Every editing feature works without AI.

Free for personal, non-commercial use. Work use by companies or institutions requires prior approval (see additional license terms).

### Product features (up to 20, 200 characters each)

1. Edit PDF text line by line, redrawn in the original font
2. True redaction: text is removed from the PDF and re-extracted to verify
3. Fit long lines by wrapping or shrinking the text
4. Match fonts using an installed font or a TTF file
5. Extract, delete, rotate and reorder pages
6. Split PDFs and merge multiple files
7. Export pages as PNG or JPEG images
8. Insert, move and resize images
9. Reduce file size to a target, for many files at once
10. Search within documents with highlights
11. Markdown editing with live preview
12. Progress and cancel for long operations, undo and redo
13. Documents stay on your PC; no data collection
14. Optional: ask Claude Code or Codex about a document or let it edit (separate install and sign-in required)

### Search terms (up to 7)

PDF editor, edit PDF text, PDF redaction, redact, merge PDF, split PDF, Markdown
