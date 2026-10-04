# 아기돼지 삼형제

요리 초보 부부가 쓰는 유아 요리 일정표 웹앱입니다. 서버 없이 GitHub Pages에서 정적 사이트로 동작합니다.

- 사이트: https://choiteacher.github.io/agi-mamma/
- 이 서비스는 의료·영양 상담을 대체하지 않습니다.

## 로컬 실행

PowerShell에서 실행합니다.

```powershell
npm install      # 의존성 설치 + pre-commit 훅 등록
npm run start    # 개발 서버 (http://localhost:3000/agi-mamma/)
npm run build    # 배포용 빌드 (dist/)
npm run preview  # 빌드 결과 미리보기
```

화면 주소는 HashRouter를 써서 `#/week`처럼 표시됩니다(GitHub Pages는 서버 라우팅이 없기 때문).

## 비밀번호 화면 (진짜 보안이 아닌 "문고리")

앱을 열면 비밀번호 화면만 먼저 나옵니다. **서버 없이 브라우저 안에서만 확인하므로 진짜 보안이 아닙니다.**
가족이 아닌 사람이 우연히 들어와 보는 것을 막는 정도의 장치로 생각하세요.

- 잠금을 풀기 전에는 실제 앱(레이아웃, 메뉴, 화면, 데이터)을 내려받지도 화면에 올리지도 않습니다.
  그래서 개발자 도구로 덮개를 지워도 뒤에는 아무것도 없습니다.
  다만 앱 파일 자체는 공개 서버에 있으므로, 파일 주소를 알면 누구나 받을 수 있습니다.
- 비밀번호는 어디에도 평문으로 저장하지 않습니다. `src/config/gate.json`에는 PBKDF2-SHA256 결과
  (`salt`, `iterations`, `hash`)만 들어갑니다. 반복 횟수 기본값은 600,000회(OWASP 권장값)입니다.
- **이 해시는 공개 저장소에 올라갑니다.** 누구나 내려받아 오프라인에서 비밀번호를 맞혀 볼 수 있으므로,
  길고 다른 곳에서 쓰지 않는 비밀번호를 쓰세요.
- 잠금을 풀면 그 기기에서 30일 동안 기억합니다(만료 시각만 저장, 비밀번호는 저장하지 않음).
  헤더의 "잠그기" 버튼으로 바로 잠글 수 있습니다.
- 틀릴 때마다 입력 대기 시간이 1, 2, 4, 8초 … 최대 60초로 늘어납니다. 브라우저 안에서만 적용되는
  불편 장치일 뿐 실제 방어는 아닙니다.
- https 주소나 localhost에서만 동작합니다(브라우저 WebCrypto 제한). 같은 와이파이의 휴대폰에서
  `http://192.168.x.x:3000` 처럼 접속하면 확인이 되지 않습니다.

### 비밀번호 설정/변경

```powershell
npm run set-password
```

입력한 글자는 `*`로 가려집니다. 같은 비밀번호를 두 번 입력하면 `src/config/gate.json`이 만들어집니다.
8자 미만이면 경고를 보여주지만 그대로 진행합니다. 비밀번호를 바꾸면 이미 열어 둔 기기도 다시 입력해야 합니다.
gate.json이 없으면 화면과 `npm run start`/`npm run build` 실행 때 설정 안내가 나옵니다.
비밀번호를 채팅, 문서, 커밋 메시지에 적지 마세요.

## 요리 후보 수집 (내 PC에서만)

요리명은 식품의약품안전처 어린이급식관리지원센터 누리집(dietary4u.mfds.go.kr)의 월간 유아 식단을 참고합니다.
작년 같은 달 식단(예: 2025년 10월)을 올해 같은 달(2026년 10월) 일정 제안의 기준으로 씁니다.
표준식단은 하루 세트로 먹어야 영양이 맞으므로 **요리를 낱개로 고르거나 섞지 않고 세트 그대로** 씁니다.
(세트 안에서 바꾸는 것은 매운 요리 → 안 매운 버전, 김치 → 씻어서 먹이기뿐입니다.)
센터 누리집에 공공누리 표시가 없어 요리명만 참고하고 조리법 문장은 모두 새로 씁니다.
원본 파일과 후보 목록은 git에서 제외된 `data/seed-input/`에만 둡니다.

```powershell
node scripts/fetch-kids-menus.mjs        # 센터 게시판 첨부 엑셀 내려받기
node scripts/build-day-sets.mjs         # data/seed-input/day-sets.json 하루 식단 세트 정리
```

NEIS 급식식단정보에는 유치원이 없어(전국 17개 교육청 확인) `scripts/fetch-neis-dishes.mjs`는 조사 기록용으로만 남겨 두었습니다.

## 레시피 영상 (내 PC에서만, 가끔)

비밀키 파일에 `YOUTUBE_API_KEY`와 `GEMINI_API_KEY_1`(~3)이 있어야 합니다.

```powershell
npm run month-pack                              # 앞으로 30일 레시피의 영상 후보 3개 + Gemini 요약
npm run month-pack -- --no-summary --auto-pick  # 요약 없이 후보만, 제목에 요리명이 든 1위 후보를 임시 선택
npm run curate                                  # 로컬 화면에서 레시피마다 영상 1개 고르기
```

- 옵션: `--dry-run`(저장 안 함), `--limit N`, `--rotate-keys`(Gemini 키 전환, 기본 꺼짐), `--reset-keys`
- 한도에 걸려 멈추면 같은 명령을 다시 실행하세요. 끝난 레시피는 건너뛰고, 빠진 요약만 채웁니다.
- 임시 선택(`pickedBy: "auto"`)은 curate에서 직접 고르면 바뀝니다. 고른 뒤 커밋·push하면 사이트에 반영됩니다.
- 영상 요약은 AI가 만든 것이라 틀릴 수 있습니다. 사이트에 "확인 필요"로 표시합니다.

## 테스트

```powershell
npm test
```

## 비밀키 관리

이 저장소는 **공개**입니다. 저장소와 웹 번들에는 어떤 비밀키도 넣지 않습니다.

- 로컬 스크립트용 비밀키는 저장소 밖 `%USERPROFILE%\.agi-pig-secrets\.env` 에만 둡니다.
  환경변수 `SECRETS_PATH`로 위치를 바꿀 수 있습니다.
- `.gitignore`가 `.env*`, `scripts/output/`, `data/seed-input/`을 제외합니다.
- `npm install` 때 `.githooks/pre-commit`이 git 훅으로 등록됩니다. 커밋할 때 다음을 검사해 막습니다.
  - Google API 키 형식(`AIza`로 시작하는 문자열)
  - `.env` 파일, `scripts/output/`, `data/seed-input/` 아래 파일
- 수동 전체 검사: `npm run check-secrets`
- 검사는 실수 방지용입니다. 다른 형식의 키까지 모두 찾아내지는 못합니다.

## 검색 노출 설정 (보안 아님)

`index.html`의 `noindex, nofollow` 메타 태그와 `public/robots.txt`의 `Disallow: /`는
**검색엔진에 덜 노출되게 하는 설정일 뿐, 접근을 막는 보안 기능이 아닙니다.**
주소를 아는 사람은 누구나 사이트에 접속할 수 있고, 공개 저장소의 코드도 누구나 볼 수 있습니다.

## 라이선스와 출처

화면 틀은 [Gradient Able Free React Admin Template](https://github.com/codedthemes/gradient-able-free-admin-template)
(CodedThemes, MIT 라이선스)을 바탕으로 했습니다. 라이선스 전문은 `LICENSE` 파일에 있습니다.
