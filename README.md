# 대필 (DAEPIL)

PDF·Markdown 편집기. AI 기능은 API 키 대신 **Claude Code 로그인(Claude 구독)** 으로 호출합니다. 문서는 로컬에만 있고, AI 호출만 밖으로 나갑니다.

## 할 수 있는 것

- **PDF 직접 편집** — 글자 줄을 클릭해 고치고 저장. 원본 폰트를 유지하며, 원본 폰트에 없는 글자는 맑은 고딕으로 대체 (PDFium 엔진, [@embedpdf/pdfium](https://github.com/embedpdf/embed-pdf-viewer))
- **위치 이동** — 정렬 유지(왼쪽/가운데/오른쪽), 화살표 미세 이동, 드래그
- **마스킹** — 글자 범위를 골라 가리기. 검은 사각형만 얹는 게 아니라 텍스트를 실제로 제거하고, 가린 뒤 잔존 여부를 자동 검사. 스캔본은 사각형 도구로 덮기만 가능
- **Markdown** — 편집·미리보기, Claude에게 지시하면 수정안을 줄 단위 diff로 보여주고 적용/취소
- **Claude 패널** — 문서 질문(대화 이어짐), 선택한 줄 고쳐 달라고 지시. 기본 모델 Sonnet 5, Opus 5 선택
- 다른 이름으로 저장(Ctrl+Shift+S), 파일·폴더 열기, 최근 파일

## 필요한 것

- Windows 10 이상 (macOS·Linux는 미검증. 폴백 폰트 경로가 Windows 기준)
- [Claude Code](https://code.claude.com/docs/en/setup) 설치 + 로그인 (Pro·Max·Team 계정). 앱이 첫 실행 때 검사하고 없으면 설치 화면을 띄웁니다
- Node.js 22 이상

## 실행

```bash
npm install
npm start
```

브라우저로만 볼 때는 `npm run serve` 후 http://localhost:4747 (파일 열기 버튼 없음, `workspace/` 폴더만 표시).

Markdown → PDF 변환 도구: `npm run md2pdf -- in.md out.pdf`

## 구조

```
Electron 창 (app/index.html)
   ↕ HTTP/SSE
app/server.js   — 파일 I/O, PDF 엔드포인트, Claude 호출 (Node 내장 모듈)
   ↕
app/pdf-engine.js — PDFium(WASM) 래퍼: 렌더·객체·텍스트 교체·이동·마스킹·저장
   ↕ stdin/stdout
claude -p       — Claude Code CLI, 사용자 로그인 그대로
```

엔진 자체 검사: `node app/pdf-engine.test.js`

## 주의

- 앱은 토큰이나 키를 저장하지 않습니다. Claude Code를 자식 프로세스로 실행할 뿐입니다.
- 개인 사용 기준으로 만들었습니다. 타인에게 배포하는 것은 Anthropic 약관상 확인이 필요합니다.
- 저장은 원본을 덮어씁니다. 중요한 문서는 "다른 이름으로 저장"으로 사본에 작업하세요.
- 계획·진행 기록은 [PLAN.md](PLAN.md).
