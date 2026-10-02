# EDITOR_KIM 개인정보 처리방침 / Privacy Policy

시행일 / Effective date: 2026-10-02

[한국어](#한국어) · [English](#english)

## 한국어

EDITOR_KIM(이하 "앱")은 PC에서 PDF와 Markdown 문서를 편집하는 데스크톱 앱입니다. 이 방침은 Microsoft Store 판과 GitHub 배포판에 똑같이 적용됩니다.

### 1. 개발자가 수집하는 정보

**없습니다.** 앱에는 사용 통계, 오류 보고, 광고, 추적 기능이 없습니다. 앱은 개발자의 서버로 어떤 데이터도 보내지 않습니다.

### 2. 문서 처리

- 문서는 사용자의 PC 안에서만 열고 고치고 저장합니다.
- 앱에 내장된 서버는 같은 PC(`127.0.0.1`)에서만 동작합니다. 다른 사이트에서 온 요청은 Host·Origin 검사로 거부합니다.
- Markdown 안의 원격 이미지는 자동으로 불러오지 않습니다. 링크는 사용자가 누를 때만 기본 브라우저로 엽니다.

### 3. PC에 저장하는 정보

다음 정보는 사용자의 PC에만 저장됩니다. 외부로 전송되지 않습니다.

- `~/.editor-kim.json` — 작업 폴더 경로
- 앱 저장소 — 최근에 연 파일 목록, 정렬·폭 맞춤·확대 설정, 고른 AI 공급자와 모델, 안내 표시 여부
- 열어 둔 파일 목록은 앱이 실행 중일 때만 유지되고 앱을 끄면 지워집니다

앱을 제거하거나 위 파일을 지우면 함께 삭제됩니다.

### 4. AI 기능

AI 기능(문서 질문, 수정 제안, 폰트 추천)은 **사용자가 직접 사용할 때만** 동작합니다.

- 앱은 사용자의 PC에 설치되어 있고 사용자가 직접 로그인한 Claude Code(Anthropic) 또는 Codex(OpenAI) 프로그램을 실행합니다. 앱은 API 키나 계정 정보를 받거나 저장하지 않습니다.
- 이때 현재 문서의 텍스트가 사용자가 고른 공급자에게 전송됩니다. 폰트 추천은 선택한 영역의 이미지가 전송됩니다.
- 전송된 데이터는 해당 공급자의 개인정보 처리방침과 약관을 따릅니다.
  - Anthropic: https://www.anthropic.com/legal/privacy
  - OpenAI: https://openai.com/policies/privacy-policy
- AI 기능을 쓰지 않으면 문서는 PC 밖으로 나가지 않습니다. 개인정보가 담긴 문서는 AI 기능에 보내기 전에 꼭 확인하세요.

### 5. 아동

앱은 아동을 대상으로 하지 않습니다. 또한 누구의 개인정보도 수집하지 않습니다.

### 6. 변경

이 방침을 바꾸면 이 문서를 고치고 위의 시행일을 갱신합니다. 변경 이력은 GitHub 저장소의 커밋 기록에서 볼 수 있습니다.

### 7. 문의

GitHub Issues: https://github.com/kindsusu/EDITOR_KIM/issues

## English

EDITOR_KIM (the "app") is a desktop app for editing PDF and Markdown documents on your PC. This policy applies equally to the Microsoft Store version and the GitHub releases.

### 1. Information the developer collects

**None.** The app has no usage analytics, crash reporting, advertising or tracking. It sends no data to any server operated by the developer.

### 2. Document processing

- Documents are opened, edited and saved only on your PC.
- The app's built-in server listens only on the same PC (`127.0.0.1`). Requests from other sites are rejected by Host and Origin checks.
- Remote images in Markdown are not loaded automatically. Links open in your default browser only when you click them.

### 3. Information stored on your PC

The following is stored only on your PC. None of it is transmitted.

- `~/.editor-kim.json` — the workspace folder path
- App storage — recently opened files, alignment, fit and zoom settings, the AI provider and model you chose, and whether hints were shown
- The list of open files is kept only while the app is running and is cleared when it quits

Uninstalling the app or deleting these files removes them.

### 4. AI features

AI features (questions about a document, edit suggestions, font recommendations) run **only when you use them**.

- The app runs Claude Code (Anthropic) or Codex (OpenAI) that you installed and signed in to yourself. The app never receives or stores API keys or account credentials.
- When you use an AI feature, the text of the current document is sent to the provider you selected. Font recommendations send an image of the area you selected.
- Data sent to a provider is governed by that provider's privacy policy and terms:
  - Anthropic: https://www.anthropic.com/legal/privacy
  - OpenAI: https://openai.com/policies/privacy-policy
- If you do not use AI features, your documents never leave your PC. Check any document containing personal information before sending it to an AI feature.

### 5. Children

The app is not directed at children. It does not collect personal information from anyone.

### 6. Changes

If this policy changes, this document is updated along with the effective date above. The change history is visible in the GitHub repository's commit log.

### 7. Contact

GitHub Issues: https://github.com/kindsusu/EDITOR_KIM/issues
