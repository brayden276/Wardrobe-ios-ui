# Deployment

## iOS Fastlane

Fastlane is configured for the existing native iOS target and preserves the current manual signing values:

- Bundle ID: `com.braydendekoning.bidwinner.dev`
- Team ID: `454Z8R39M9`
- Provisioning profile: `Memory App Dev`
- Scheme: `App`

From a macOS machine with Xcode, Ruby, Bundler, Node.js, and the matching Apple certificate/profile installed:

```sh
bundle install
UI_API_BASE_URL=https://your-api-host.example.com bundle exec fastlane ios build_dev
```

The lane builds the Angular app, runs `npx cap sync ios`, then produces a manually signed development IPA under `build/ios`.

Use `bundle exec fastlane ios sync` when you only need to refresh the native iOS project after web changes.

## Production IPA

The production IPA must point to the hosted `Wardrobe-ios-api` Railway URL. Do not use the API under `api/WardrobeAi.Api` for production; it remains in this repository only as legacy/non-production source.

From a macOS machine with the production signing assets installed:

```sh
APP_IDENTIFIER=com.yourcompany.wardrobeai \
APPLE_TEAM_ID=YOURTEAMID \
PROVISIONING_PROFILE_SPECIFIER="Wardrobe AI App Store" \
UI_API_BASE_URL=https://your-api.up.railway.app \
bundle exec fastlane ios build_release
```

`build_release` fails if `UI_API_BASE_URL` is missing or points to localhost.

## API URL

The Ionic app uses `UI_API_BASE_URL` from `.env` or the process environment when `npm run build` runs. Use the API origin only, without a trailing `/api`.

For a device build, do not leave this as `localhost` unless the API is reachable from that device through a tunnel or LAN address.

## Distribution

This Fastlane setup intentionally stops at a development-signed IPA because the repository currently has a development profile. Add an App Store or Ad Hoc lane only after the matching bundle ID, distribution certificate, and provisioning profile are supplied.
