# Saved outfit workflows

The Outfits screen is an Ionic Angular page (`src/app/pages/outfits/`), backed by `WardrobeApiService` and the authenticated ASP.NET API.

## Edit saved details

Open an outfit and select **Edit**, or choose **Edit Outfit** from its action menu. The editor changes the name and notes, supports cancelling, and retains a draft after a failed or offline save. Saving disables duplicate submissions and sheet dismissal.

`PUT /api/outfits/{id}` accepts the existing `UpdateOutfitRequest` contract and returns `{ outfit }`. The screen sends only `name` and `explanation`; an empty explanation clears notes. Names must contain 1–256 characters, and notes may contain up to 2000 characters. Successful saves refresh the card and sheet and invalidate the outfit list cache.

The API checks ownership. Metadata edits preserve garment membership, image, prompt and wear history, including when a garment has since been archived. Composition changes through the API still validate active, owned garments and queue a replacement image.

This workflow uses existing outfit persistence and requires no schema change.

## Favourites across devices

Outfit hearts and the Favourites filter use the signed-in user's server favourites. The screen fetches them on load/refresh with `GET /api/wardrobe/favourites`; a heart sends `PUT /api/wardrobe/favourites/outfit/{id}` with `{ isFavourite }`. The server checks ownership, and repeated additions/removals are idempotent.

Existing `wb_favorite_outfits_{userId}` local favourites are imported once after a successful outfit load. The `_synced` marker is written only after every applicable legacy favourite has uploaded. Failures retain the local list and allow retry. Subsequent loads honour server removals instead of reimporting old local data.

Local favourites remain readable offline. Changes require a connection; pending updates are deduplicated and failed requests preserve the current heart state. Responses from a previous account cannot import or replace the current user's favourites.

The API uses the existing `wardrobe_favourites` table from the `User Auth Flags` migration; no new migration is required.
