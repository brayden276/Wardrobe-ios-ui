# wardrobe-ai — AI Context Map

> **Stack:** swiftui | none | unknown | ruby

> 0 routes | 0 models | 0 components | 0 lib files | 12 env vars | 0 middleware | 8 events | 0% test coverage
> **Token savings:** this file is ~1,500 tokens. Without it, AI exploration would cost ~12,200 tokens. **Saves ~10,700 tokens per conversation.**
> **Last scanned:** 2026-09-10 23:22 — re-run after significant changes

---

# Config

## Environment Variables

- `APP_IDENTIFIER` (has default) — fastlane\.env.example
- `APPLE_TEAM_ID` (has default) — fastlane\.env.example
- `CI` **required** — karma.conf.js
- `IOS_CONFIGURATION` (has default) — fastlane\.env.example
- `IOS_SCHEME` (has default) — fastlane\.env.example
- `PROVISIONING_PROFILE_SPECIFIER` (has default) — fastlane\.env.example
- `UI_ALLOW_LOCALHOST_API` **required** — scripts\sync-environment.js
- `UI_API_BASE_URL` (has default) — fastlane\.env.example
- `UI_APP_ID` (has default) — .env
- `UI_APP_NAME` (has default) — .env
- `UI_ENVIRONMENT` (has default) — .env
- `UI_REQUIRE_PRODUCTION_API` **required** — scripts\sync-environment.js

## Config Files

- `fastlane\.env.example`
- `tsconfig.json`

---

# Dependency Graph

## Most Imported Files (change these carefully)

- `src\app\auth.service.ts` — imported by **14** files
- `src\app\wardrobe-api.service.ts` — imported by **10** files
- `src\app\models.ts` — imported by **10** files
- `src\app\device-image-cache.service.ts` — imported by **6** files
- `src\app\pages\page-helpers.ts` — imported by **5** files
- `src\app\api-url.ts` — imported by **4** files
- `src\app\offline-data.service.ts` — imported by **2** files
- `src\app\pages\analytics\analytics.page.ts` — imported by **2** files
- `src\app\pages\login\login.page.ts` — imported by **2** files
- `src\environments\environment.ts` — imported by **1** files
- `src\app\app-routing.module.ts` — imported by **1** files
- `src\app\app.component.ts` — imported by **1** files
- `src\app\lazy-image.directive.ts` — imported by **1** files
- `src\app\image-load-queue.service.ts` — imported by **1** files
- `src\app\pages\onboarding\onboarding.page.ts` — imported by **1** files
- `src\app\pages\tabs\tabs.page.ts` — imported by **1** files
- `src\app\pages\wardrobe\wardrobe.page.ts` — imported by **1** files
- `src\app\pages\add-item\add-item.page.ts` — imported by **1** files
- `src\app\pages\item-detail\item-detail.page.ts` — imported by **1** files
- `src\app\pages\builder\builder.page.ts` — imported by **1** files

## Import Map (who imports what)

- `src\app\auth.service.ts` ← `src\app\app-routing.module.ts`, `src\app\app.component.ts`, `src\app\auth.service.spec.ts`, `src\app\device-image-cache.service.spec.ts`, `src\app\device-image-cache.service.ts` +9 more
- `src\app\wardrobe-api.service.ts` ← `src\app\app.component.ts`, `src\app\pages\add-item\add-item.page.ts`, `src\app\pages\analytics\analytics.page.spec.ts`, `src\app\pages\analytics\analytics.page.ts`, `src\app\pages\builder\builder.page.ts` +5 more
- `src\app\models.ts` ← `src\app\auth.service.spec.ts`, `src\app\auth.service.ts`, `src\app\pages\analytics\analytics.page.spec.ts`, `src\app\pages\analytics\analytics.page.ts`, `src\app\pages\builder\builder.page.ts` +5 more
- `src\app\device-image-cache.service.ts` ← `src\app\auth.service.ts`, `src\app\device-image-cache.service.spec.ts`, `src\app\lazy-image.directive.ts`, `src\app\pages\settings\settings.page.ts`, `src\app\wardrobe-api.service.spec.ts` +1 more
- `src\app\pages\page-helpers.ts` ← `src\app\pages\analytics\analytics.page.ts`, `src\app\pages\login\login.page.ts`, `src\app\pages\onboarding\onboarding.page.ts`, `src\app\pages\outfits\outfits.page.ts`, `src\app\wardrobe-api.service.spec.ts`
- `src\app\api-url.ts` ← `src\app\auth.service.spec.ts`, `src\app\auth.service.ts`, `src\app\wardrobe-api.service.spec.ts`, `src\app\wardrobe-api.service.ts`
- `src\app\offline-data.service.ts` ← `src\app\auth.service.ts`, `src\app\wardrobe-api.service.ts`
- `src\app\pages\analytics\analytics.page.ts` ← `src\app\pages\analytics\analytics.page.spec.ts`, `src\app\pages.ts`
- `src\app\pages\login\login.page.ts` ← `src\app\pages\login\login.page.spec.ts`, `src\app\pages.ts`
- `src\environments\environment.ts` ← `src\app\api-url.ts`

---

# Events & Queues

- `normal` [event] — `ios/App/App/public/2075.0667d97a2cd7f511.js`
- `first` [event] — `ios/App/App/public/2560.11095f2fe2daf067.js`
- `last` [event] — `ios/App/App/public/2560.11095f2fe2daf067.js`
- `Request timed out` [event] — `ios/App/App/public/main.2f3009b84c412ca1.js`
- `manual` [event] — `ios/App/App/public/main.2f3009b84c412ca1.js`
- `forward` [event] — `ios/App/App/public/main.2f3009b84c412ca1.js`
- `back` [event] — `ios/App/App/public/main.2f3009b84c412ca1.js`
- `root` [event] — `ios/App/App/public/main.2f3009b84c412ca1.js`

---

# Test Coverage

> **0%** of routes and models are covered by tests
> 5 test files found

---

# CI/CD Pipelines

## GitHub Actions (2 workflows)

| Workflow | Triggers | Jobs | Deploy | Environments |
|---|---|---|---|---|
| UI CI | push, pull_request | 1 | — | — |
| iOS Release | workflow_dispatch, workflow_run | 1 | — | — |

### Secrets

- `APPSTORE_API_PRIVATE_KEY`
- `KEYCHAIN_PASSWORD`
- `MATCH_PASSWORD`

---
_Source: .github/workflows/ci.yml, .github/workflows/ios-release.yml_
_Generated by codesight-cicd-plugin_

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_