# wardrobe-ai — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**wardrobe-ai** is an Ionic Angular application packaged for iOS with Capacitor.

## Scale

12 environment variables

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `src\app\auth.service.ts` — imported by **14** files
- `src\app\wardrobe-api.service.ts` — imported by **10** files
- `src\app\models.ts` — imported by **10** files
- `src\app\device-image-cache.service.ts` — imported by **6** files
- `src\app\pages\page-helpers.ts` — imported by **5** files
- `src\app\api-url.ts` — imported by **4** files

## Required Environment Variables

- `CI` — `karma.conf.js`
- `UI_ALLOW_LOCALHOST_API` — `scripts\sync-environment.js`
- `UI_REQUIRE_PRODUCTION_API` — `scripts\sync-environment.js`

---
_Back to [index.md](./index.md) · Generated 2026-09-10_
