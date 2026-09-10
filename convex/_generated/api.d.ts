/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as collections from "../collections.js";
import type * as crons from "../crons.js";
import type * as groups from "../groups.js";
import type * as library from "../library.js";
import type * as maintenance from "../maintenance.js";
import type * as model_access from "../model/access.js";
import type * as model_annotations from "../model/annotations.js";
import type * as model_auth from "../model/auth.js";
import type * as model_collections from "../model/collections.js";
import type * as model_discovery from "../model/discovery.js";
import type * as model_groups from "../model/groups.js";
import type * as model_library from "../model/library.js";
import type * as model_limits from "../model/limits.js";
import type * as model_notifications from "../model/notifications.js";
import type * as model_processing from "../model/processing.js";
import type * as model_pushClient from "../model/pushClient.js";
import type * as model_rateLimits from "../model/rateLimits.js";
import type * as model_settings from "../model/settings.js";
import type * as model_sharing from "../model/sharing.js";
import type * as model_sync from "../model/sync.js";
import type * as model_users from "../model/users.js";
import type * as node_extract from "../node/extract.js";
import type * as notifications from "../notifications.js";
import type * as presence from "../presence.js";
import type * as push from "../push.js";
import type * as r2 from "../r2.js";
import type * as settings from "../settings.js";
import type * as sharing from "../sharing.js";
import type * as users from "../users.js";
import type * as workflows_document from "../workflows/document.js";
import type * as workflows_share from "../workflows/share.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  collections: typeof collections;
  crons: typeof crons;
  groups: typeof groups;
  library: typeof library;
  maintenance: typeof maintenance;
  "model/access": typeof model_access;
  "model/annotations": typeof model_annotations;
  "model/auth": typeof model_auth;
  "model/collections": typeof model_collections;
  "model/discovery": typeof model_discovery;
  "model/groups": typeof model_groups;
  "model/library": typeof model_library;
  "model/limits": typeof model_limits;
  "model/notifications": typeof model_notifications;
  "model/processing": typeof model_processing;
  "model/pushClient": typeof model_pushClient;
  "model/rateLimits": typeof model_rateLimits;
  "model/settings": typeof model_settings;
  "model/sharing": typeof model_sharing;
  "model/sync": typeof model_sync;
  "model/users": typeof model_users;
  "node/extract": typeof node_extract;
  notifications: typeof notifications;
  presence: typeof presence;
  push: typeof push;
  r2: typeof r2;
  settings: typeof settings;
  sharing: typeof sharing;
  users: typeof users;
  "workflows/document": typeof workflows_document;
  "workflows/share": typeof workflows_share;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  maintenance: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"maintenance">;
  receipts: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"receipts">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  pushNotifications: import("@convex-dev/expo-push-notifications/_generated/component.js").ComponentApi<"pushNotifications">;
};
