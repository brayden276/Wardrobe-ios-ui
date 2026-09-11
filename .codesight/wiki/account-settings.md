# Account settings

`src/app/pages/settings/` provides account actions alongside the existing personal-style, consent and device-storage controls.

## Change password

Accounts with a password credential can select **Change Password** in Settings. The form asks for the current password, an 8–128 character replacement, and confirmation. Password fields use the browser's password autofill attributes and are cleared after success, cancellation, or leaving the page.

The authenticated user contract exposes `hasPassword`, including for an external sign-in account with a linked password credential. Older API responses without this property fall back to `provider === 'password'`. External-only accounts do not show this action.

`AuthService.changePassword` refreshes an expired session before sending `PUT /api/auth/password` with `{ currentPassword, newPassword }`. A 401 from that endpoint can mean the current password is wrong, so it shows corrective feedback without clearing the session or retrying the password request. Temporary failures preserve the form for retry. Requests time out after 10 seconds and duplicate submissions are disabled.

On success the server revokes existing refresh sessions and invalidates existing access tokens using its existing session-version mechanism. The client clears local credentials and user caches, then returns to sign-in. This workflow requires no new persistence or migration.
