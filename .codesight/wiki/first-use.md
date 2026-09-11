# First use and learning the app

New accounts complete Personal Style before entering the authenticated tab area. After preferences are saved for the first time, onboarding opens `/tabs/getting-started` instead of an unexplained empty wardrobe. Returning users keep their normal sign-in destination.

`GettingStartedPage` explains the existing Add → Builder → Outfits → wear activity workflow. Its links open the actual screens. Progress comes from existing user-scoped `getItems()` and `getOutfits()` results, not local completion flags: active clothes, saved looks, and a saved outfit with a wear count. Failed loads leave progress unknown but keep the guide usable. Navigation and account changes invalidate late results.

The guide can always be reopened from **Getting Started & Help** in Settings and **Show Me How It Works** in the empty wardrobe. Expandable help covers editing and archiving garments, search and selection, AI processing, and changing style preferences.

This is an Ionic Angular UI workflow using existing authenticated API reads. It adds no API route, database schema, or onboarding tracking data.

## Reviewing Personal Style

The four Personal Style questions lead to a review before saving. Users can edit an individual answer and return directly to the review. Options use native radio controls, and reduced-motion preferences disable the slide transitions.

The form clears stale answers before loading the current user's preferences and validates answers against the available options. Saving prevents duplicate submissions and retains the answers when a request fails so users can retry. Expired sessions are refreshed before saving; a stalled request times out instead of leaving the form locked. The first successful setup opens Getting Started, while edits by existing users retain their return destination.

## Learning Builder

Both Builder modes show an Add Clothes action when the wardrobe is empty; AI controls stay hidden and direct generation calls return before consent or API requests. Loading feedback is shared by both modes.

With clothes present, a brief explanation distinguishes AI suggestions from selecting pieces manually. An advisory identifies missing pieces for a complete top/bottom/shoes or dress/one-piece/shoes look, using the same category rules as the current builder and the API's footwear alias. Partial looks remain allowed. Prompt examples use native buttons for keyboard access. A Help button links back to Getting Started.
