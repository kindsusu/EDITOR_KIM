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
- [ ] Electron 셸: `app/main.js`가 server.js를 띄우고 창을 연다
- [ ] 폴더 열기(네이티브 대화상자) → 작업 폴더 전환, 최근 폴더 기억
- [ ] Ctrl+S 저장, 수정됨 표시, 닫을 때 미저장 경고
- [ ] Claude 대화 이어가기(`--resume` 세션 ID) — 문서당 1세션
- [ ] 모델 선택(Sonnet 기본 / Opus)
- [ ] 시작 시 Claude Code 검사 → 없으면 **설치 화면**: `claude --version`으로 설치 여부, `claude auth status`로 로그인 여부 확인. 미설치면 [설치] 버튼이 공식 설치기(`irm https://claude.ai/install.ps1 | iex`, 관리자 권한 불필요)를 별도 PowerShell 창에서 실행. 미로그인이면 [로그인] 버튼이 `claude`를 별도 창에서 띄워 브라우저 로그인 진행. [다시 확인]으로 재검사. Pro/Max/Team 계정 필요(무료 계정은 Claude Code 불가)
- [ ] `npm start`로 실행

### P2 — 문서 기능
- [ ] MD → PDF 내보내기 (Electron `printToPDF`, 한글 폰트 포함)
- [ ] PDF → MD 변환 (pdf.js 텍스트 추출 → Claude로 제목·표 구조 복원)
- [ ] PDF 하이라이트·메모 (pdf-lib 주석)
- [ ] 편집 모드: 선택 영역만 고치기(전체 문서 대신 블록 단위)
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
