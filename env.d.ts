/**
 * The environment variables Pidom reads, and nothing else.
 *
 * Declared here rather than pulled in through `@types/node` deliberately.
 * Expo's tsconfig sets `customConditions: ["react-native"]`, which stops the
 * automatic `@types` inclusion, and forcing Node's globals into a React Native
 * app brings the wrong `setTimeout` return type and a DOM/Node surface that
 * does not exist on device.
 *
 * The payoff beyond types: this file is the list. Adding a variable to the app
 * means adding it here, so there is one place to look for what has to be set.
 * Keep it in step with `.env.example` and the Convex deployment.
 */

declare namespace NodeJS {
  interface ProcessEnv {
    /** Client. Convex deployment URL, from `npx convex dev`. */
    readonly EXPO_PUBLIC_CONVEX_URL?: string;
    /** Client. The Google *web* OAuth client ID, on both platforms. */
    readonly EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
    /** Client. The Google iOS OAuth client ID. Required on iOS only. */
    readonly EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string;

    /**
     * Convex deployment. The same web client ID as above, set with
     * `npx convex env set`. It is the audience `convex/auth.config.ts` pins,
     * and it must match the client value exactly.
     */
    readonly GOOGLE_WEB_CLIENT_ID?: string;

    /**
     * Convex deployment. Cloudflare R2, read by `@convex-dev/r2`.
     *
     * Deployment-side only, and deliberately not `EXPO_PUBLIC_*`: these are
     * real credentials against a bucket, and an `EXPO_PUBLIC_` prefix would
     * inline them into a shipped binary anyone can unpack. Set with
     * `npx convex env set` — see `docs/setup.md`.
     *
     * Without them, importing and reading still work. Only syncing a document
     * to other devices does not.
     */
    readonly R2_BUCKET?: string;
    readonly R2_ENDPOINT?: string;
    readonly R2_ACCESS_KEY_ID?: string;
    readonly R2_SECRET_ACCESS_KEY?: string;
    readonly R2_TOKEN?: string;
  }
}

declare const process: { readonly env: NodeJS.ProcessEnv };
