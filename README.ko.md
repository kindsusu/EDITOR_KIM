# EDITOR_KIM

![EDITOR_KIM](assets/hero.png)

PDF의 텍스트를 직접 고치고, 민감한 글자를 실제로 제거하는 Windows용 로컬 편집기입니다. Markdown 편집과 Claude Code·ChatGPT(Codex) 기반 문서 도우미도 제공합니다. AI API 키를 앱에 입력할 필요가 없습니다.

[English](README.md) · [변경 기록](CHANGELOG.md) · [계획](PLAN.md)

## 주요 기능

- PDFium으로 PDF 텍스트 객체를 직접 편집하고 저장
- 원본 임베드 폰트 유지, 없는 글리프는 맑은 고딕 서브셋으로 대체
- 선택한 문자를 제거한 뒤 재추출해 확인하는 마스킹
- 실행 취소·다시 실행, 여러 줄 편집, 정렬·이동·폭 맞춤
- Markdown 편집과 안전한 실시간 미리보기
- Claude Code 또는 ChatGPT(Codex) 모델 선택
- 문서마다 이어지는 AI 대화와 Markdown/PDF 선택 텍스트 수정

| 편집 전 | 편집 후 |
|---|---|
| ![편집 전](assets/edit-before.png) | ![편집 후](assets/edit-after.png) |

## 빠른 시작

Releases에서 portable 또는 setup 실행 파일을 받습니다. 현재 소스만 시험하려면 저장소를 내려받아 `run-editor-kim.bat`을 더블클릭합니다. 처음 한 번 Node.js 22 이상이 필요하며 의존성 설치가 자동으로 진행됩니다.

개발자는 다음과 같이 실행할 수 있습니다.

```bash
git clone https://github.com/kindsusu/EDITOR_KIM.git
cd EDITOR_KIM
npm install
npm start
```

브라우저 모드는 `npm run serve` 후 <http://localhost:4747>에서 열 수 있습니다. 파일 대화상자는 Electron 앱에서만 제공됩니다.

코드 서명이 없는 개발 빌드는 Windows SmartScreen에서 “알 수 없는 게시자”로 표시될 수 있습니다. 출처와 파일 해시를 확인한 경우에만 실행하세요. Windows Defender가 명령이나 설치를 차단하면 보안 예외 또는 실행 정책 우회를 권하지 않습니다.

## AI 설치와 로그인

오른쪽 위 **Select Model**에서 Claude 또는 ChatGPT(Codex)를 선택합니다. 준비되지 않은 공급자를 선택하면 앱 안에서 설치·로그인을 진행할 수 있습니다. Codex 인증 동작은 [OpenAI의 공식 인증 안내](https://learn.chatgpt.com/ko-KR/docs/auth)에서 확인할 수 있습니다.

1. **설치**: Windows 공식 패키지 관리자 WinGet이 `Anthropic.ClaudeCode` 또는 `OpenAI.Codex` 패키지를 사용자 범위에 설치합니다.
2. **로그인**: 앱이 해당 CLI의 브라우저 인증을 엽니다.
3. 브라우저에서 Claude 또는 ChatGPT 구독 계정으로 로그인합니다.
4. 앱이 로그인 완료를 감지하면 계정에서 사용할 수 있는 모델을 표시합니다.

PC 브라우저에서 ChatGPT에 이미 로그인되어 있더라도 Codex 최초 사용에는 이 브라우저 인증을 한 번 완료해야 합니다. 그 뒤에는 Codex가 캐시한 세션을 EDITOR_KIM이 재사용합니다. 앱은 인증 파일이나 토큰을 읽거나 저장소에 복사하지 않습니다.

수동 진단이 필요한 개발자만 아래 명령을 사용할 수 있습니다.

```bash
codex login
codex login status
claude auth login
claude auth status
```

헤드리스 환경의 Codex는 `codex login --device-auth`를 사용할 수 있습니다. 인증 파일(`auth.json` 등)은 절대 저장소에 올리지 마세요.

AI 질문을 보내면 현재 문서의 텍스트가 선택한 공급자(Anthropic 또는 OpenAI)로 전송됩니다. Claude는 Claude Code 구독, Codex는 ChatGPT/Codex 사용량 정책을 따릅니다. 앱 자체는 API 키를 요구하거나 저장하지 않습니다.

## AI 패널

- 상단 **💬 채팅**, 오른쪽 경계의 화살표 탭, 또는 `Ctrl+J`로 언제든 접고 펼칩니다.
- 모델을 선택하면 패널이 열리지만, 모델 선택과 패널 상태는 별개입니다.
- 패널의 `×` 또는 오른쪽 경계 탭으로 접을 수 있습니다.
- 모델이나 공급자를 바꾸면 새 대화가 시작됩니다.

## PDF 편집과 마스킹

![구조](assets/architecture.svg)

텍스트를 클릭해 내용을 바꾸고 Enter로 확정합니다. 원본 폰트에 새 글자가 없으면 원래 굵기에 맞는 맑은 고딕 서브셋을 넣습니다. 확대/축소 중 이전 렌더 결과는 폐기하므로 다른 문서의 페이지가 섞이지 않습니다.

![마스킹 절차](assets/redaction.svg)

텍스트 마스킹은 선택한 문자를 PDF 텍스트 객체에서 제거하고 사각형을 추가한 뒤, 페이지 텍스트를 다시 추출해 제거 여부를 확인합니다. 이미지로 된 스캔 문서는 사각형으로 덮을 수 있지만 OCR 원문 자체를 제거하는 기능은 아닙니다.

## 단축키

| 키 | 기능 |
|---|---|
| `Ctrl+S` | 저장 |
| `Ctrl+Shift+S` | 다른 이름으로 저장 |
| `Ctrl+Z` / `Ctrl+Y` | 실행 취소 / 다시 실행 |
| `Ctrl+J` | AI 패널 접기 / 펼치기 |
| `Ctrl` + 마우스 휠 | 커서 위치 기준 PDF 확대 / 축소 |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 확대 / 축소 / 페이지 폭 맞춤 |
| `Enter` / `Shift+Enter` | AI 질문 보내기 / 입력창 줄바꿈 |
| `Esc` (입력창에서) | 생성 중인 AI 응답 중지 |
| `F12` | 개발자 도구 |

## 개발과 검증

```bash
npm test
npm audit
```

테스트는 PDF 렌더·편집·폰트 폴백·마스킹·저장/재열기와 AI 공급자 파싱 및 UI 안전 조건을 확인합니다. Windows 빌드는 사용자가 최종 배포를 결정할 때 `npm run dist`로 생성합니다.

```text
app/                    UI, 로컬 서버, AI 어댑터, PDF 엔진, 테스트
assets/                 README 이미지와 구조도
tools/                  샘플·아이콘 재생성 도구
workspace/              가상 테스트 문서
```

## 한계

- Windows 10 이상을 주 대상으로 하며 Windows 11에서 검증했습니다.
- 스캔 이미지 안의 글자는 직접 편집하지 않습니다.
- 복잡한 CJK 합자·세로쓰기·특수 폰트는 폴백이 필요할 수 있습니다.
- PDF 전체를 외부 서비스로 업로드하지 않지만, AI에 보낸 문서 텍스트는 선택한 공급자로 전송됩니다.
- 상업·업무용 사용은 라이선스를 확인해야 합니다.

## 라이선스

개인·비상업 용도는 무료입니다. 회사·업무·상업적 사용은 저작권자의 사전 서면 승인이 필요합니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
