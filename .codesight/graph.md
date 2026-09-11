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
