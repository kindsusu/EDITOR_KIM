// Microsoft Store용 패키지(.appx) 빌드. 실행: npm run dist:store  (Partner Center 값 없이 시험만: npm run dist:store -- --test)
//
// 왜 래퍼가 필요한가: electron-builder가 받아 두는 Windows SDK 도구(makeappx)를 캐시 경로
// (%LOCALAPPDATA%\electron-builder\Cache\win-codesign@1.1.0\...)에서 그대로 실행하면 Windows가 같은 폴더의
// AppxPackaging 구성 요소를 찾지 못해 "side-by-side configuration is incorrect"로 실행조차 안 된다(electron-builder에는 spawn UNKNOWN으로 보임).
// 같은 파일을 임시 폴더(%TEMP%) 아래로 복사하면 정상 실행된다. %LOCALAPPDATA% 바로 아래 등 다른 위치는 같은 오류(2026-10-02 실측, 이 PC 정책으로 추정)
// → %TEMP%에 복사해 두고(지워졌으면 다시 복사) ELECTRON_BUILDER_WINDOWS_KITS_PATH로 가리킨다.
//
// Store 식별값(identityName·publisher)은 Partner Center에서 앱 이름을 예약한 뒤 "제품 ID" 화면에 나오는 값을
// package.json의 build.appx에 넣는다. Store가 제출한 패키지를 다시 서명하므로 우리 쪽 인증서는 필요 없다.
// identityName은 Partner Center 값(옛 이름 기반)이라 바꾸지 않는다 — 바꾸면 Store 업로드가 거부된다.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getWindowsKitsBundle } = require('app-builder-lib/out/toolsets/windows');
const { Arch } = require('builder-util');

const root = path.join(__dirname, '..');
const test = process.argv.includes('--test');
const appx = require(path.join(root, 'package.json')).build.appx || {};

(async () => {
  const overrides = [];
  if (!appx.identityName || !appx.publisher) {
    if (!test) {
      console.error('package.json build.appx에 identityName과 publisher가 없습니다.\n'
        + 'Partner Center → 앱 → 제품 관리 → 제품 ID 화면의 "Package/Identity/Name"과 "Package/Identity/Publisher" 값을 넣으세요.\n'
        + '값 없이 빌드만 시험하려면: npm run dist:store -- --test');
      process.exit(1);
    }
    // 시험용 값 — Store에는 올릴 수 없다
    overrides.push('-c.appx.identityName=TEST.RetextPDF', '-c.appx.publisher=CN=00000000-0000-0000-0000-000000000000');
  }

  const bundle = await getWindowsKitsBundle({ winCodeSign: '1.1.0', arch: Arch.x64 }); // 없으면 받아 둔다(체크섬 검증)
  const kit = path.join(require('os').tmpdir(), 'retext-pdf-windows-kit');
  if (!fs.existsSync(path.join(kit, 'makeappx.exe'))) {
    fs.mkdirSync(kit, { recursive: true });
    fs.cpSync(bundle.kit, kit, { recursive: true });
    fs.cpSync(path.join(bundle.appxAssets, 'appxAssets'), path.join(kit, 'appxAssets'), { recursive: true });
    console.log('Windows SDK 도구를 복사했습니다:', kit);
  }

  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  const r = spawnSync(process.execPath, [cli, '--win', 'appx', ...overrides], {
    cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_WINDOWS_KITS_PATH: kit },
  });
  process.exit(r.status ?? 1);
})().catch((e) => { console.error(e); process.exit(1); });
