# Aura account onboarding and Google operator authorization

Status: SOURCE IMPLEMENTED in branch `feat/aura-account-oauth-handoff-20261107`. Real provider sign-in, browser attachment and account creation require testing on the operator's Windows PC. This is **not** evidence that external accounts have been created.

## Product contract

Aura is the sole primary agent. In **Full Autonomous**, explicit work instructions ("Marknadsför jacocode.com", "Skapa ett konto...") start a durable mission directly; questions stay in chat. The user can stop or steer the mission independently of chat inference.

For an external service, Aura may research the registration flow and perform permitted non-secret form interactions only when BOTH are true:

1. A signed JACO autonomy mandate already authorizes the action and the service origin.
2. The operator explicitly grants account setup in **Connections → Browser / CDP** for the exact HTTPS origin and the current mission, using the checkbox. The grant lasts 30 minutes, can be revoked, and does not automatically cover other sites.

The legacy Nova CDP bridge is not a bypass for registration. Google accounts, identity providers, password and OTP fields, MFA, CAPTCHA and payments remain under operator control. A site can refuse automated registration; Aura must report that as a blocker, not claim success.

## Connecting a Google identity to JACO Core (PC-first)

This local Google OAuth connection is for the **operator identity only**. It uses authorization code + PKCE (S256), state, nonce and Google-side token validation. It requests `openid email profile` and does not grant Gmail, Drive, Ads, YouTube or third-party website permissions.

1. Create or reuse a Google Cloud OAuth **Web application** client and configure the consent screen. Register **exactly** `http://127.0.0.1:3000/api/aura/google/callback` as an authorized redirect URI if JACO runs at port 3000.
2. Configure `JACO_GOOGLE_OAUTH_CLIENT_ID`, `JACO_GOOGLE_OAUTH_CLIENT_SECRET` and (only if using a different local port) `JACO_GOOGLE_OAUTH_REDIRECT_URI` in JACO's secure local runtime configuration. Never paste a client secret into Aura's chat or commit it.
3. Restart JACO Core. In **Connections → Browser / CDP → Google authorization**, select **Connect with Google**.
4. Complete Google sign-in and consent yourself. The callback redirects to the JACO GUI. Connection status reports **identity only**. Google tokens are not exposed to Aura and are not retained for API automation.

To sign in to a **third-party website** with *Continue with Google*, Aura may prepare and click the site's registration entry point after your site-specific grant. Google itself owns the sign-in/consent page; you complete that step in the browser and Aura re-observes the authorized target site. The JACO operator OAuth above does **not** supply a reusable Google SSO session for arbitrary sites.

## Failure behavior

If an operation is refused, times out or cannot be verified, Aura reports the actual attempted steps, observed error and recommended next action. Identity handoff is a **pause**, not a success receipt. A changed web page alone does not prove that an account was created.

## Verification commands

```sh
node --test tests/nova/aura-account-onboarding.test.mjs tests/nova/aura-google-operator-oauth.test.mjs tests/nova/aura-mission-intent.test.mjs
npm run lint --prefix runtime
npm run build:client --prefix runtime
npm run build:server --prefix runtime
```

Then verify on Windows with a real CDP session: ungranted signup denied; exact signed mandate + account grant accepted; password/Google/OTP still operator-only; successful post-registration site identity observed; stop/revoke works; both browser pathways respect the same separation.

Google references: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/identity/protocols/oauth2/resources/best-practices.
