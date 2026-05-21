# App Store Submission

## Required Before Submission

- Real App Store Connect app record for `ai.wardrobe.app`
- Working hosted API origin for `UI_API_BASE_URL`
- Live privacy policy, terms of use, and support endpoints for the `wardrobe.ai` links shown in Settings
- Apple signing assets for the real team and App Store provisioning profile
- TestFlight-verified account deletion from the Settings page

## Privacy And Review

- Verify `ios/App/App/PrivacyInfo.xcprivacy` is still accurate for the shipped SDK set.
- Verify `ios/App/App/Info.plist` camera and photo library usage strings still describe the app accurately.
- Confirm the first AI-powered upload and outfit generation flows still require OpenAI consent on-device.
- Prepare App Privacy answers that match the hosted backend and OpenAI processing path.

## Submission Notes

- The public app uses the hosted `Wardrobe-ios-api` backend only.
- Email/password auth is the v1 launch path; third-party sign-in should stay disabled unless the equivalent Apple-compliant path is added.
- Reviewer notes should mention that account deletion is available from Settings and that AI processing is used for wardrobe classification, image clean-up, and outfit suggestions.
