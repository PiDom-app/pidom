/**
 * Google as an OIDC provider, verified by Convex directly.
 *
 * A Google ID token is already an OIDC JWT: `iss` is `https://accounts.google.com`
 * and Google publishes `/.well-known/openid-configuration`, so Convex can fetch
 * the JWKS and verify the signature with no auth server in between. The client
 * gets the token from the native Google sign-in sheet and hands it straight to
 * Convex.
 *
 * `applicationID` is the security boundary, not a formality. It is matched
 * against the token's `aud`. Without it, any Google ID token would verify here —
 * including one minted for an unrelated application by someone who collected it.
 * Pinning it to Pidom's own web client ID is what makes the flow safe.
 *
 * Set on the deployment with:
 *   npx convex env set GOOGLE_WEB_CLIENT_ID <client-id>.apps.googleusercontent.com
 *
 * It must be the *web* client ID, not the Android or iOS one: that is the
 * audience `@react-native-google-signin` requests when configured with
 * `webClientId`, on both platforms.
 *
 * https://docs.convex.dev/auth/advanced/custom-auth
 */
import type { AuthConfig } from 'convex/server';

const applicationID = process.env.GOOGLE_WEB_CLIENT_ID;

if (!applicationID) {
  throw new Error(
    'GOOGLE_WEB_CLIENT_ID is not set on this Convex deployment. Without it every ' +
      'Google ID token would be accepted regardless of which app it was issued to. ' +
      'Set it with: npx convex env set GOOGLE_WEB_CLIENT_ID <id>.apps.googleusercontent.com',
  );
}

/**
 * The desktop companion (`../desktop`) signs in through a Google *Desktop app*
 * OAuth client rather than the mobile web client, so its ID token carries a
 * different `aud`. Registering that client id as a second provider widens the
 * accepted audience to include it — the audience is still pinned, so a token
 * minted for any other application is still rejected.
 *
 * It is optional: a deployment that does not serve the desktop app simply leaves
 * `GOOGLE_DESKTOP_CLIENT_ID` unset and only the mobile audience is accepted.
 * Set it with:
 *   npx convex env set GOOGLE_DESKTOP_CLIENT_ID <id>.apps.googleusercontent.com
 */
const desktopApplicationID = process.env.GOOGLE_DESKTOP_CLIENT_ID;

export default {
  providers: [
    {
      domain: 'https://accounts.google.com',
      applicationID,
    },
    ...(desktopApplicationID
      ? [{ domain: 'https://accounts.google.com', applicationID: desktopApplicationID }]
      : []),
  ],
} satisfies AuthConfig;
