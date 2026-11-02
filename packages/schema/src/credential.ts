export * as Credential from "./credential"

import { Schema } from "effect"
import { optional } from "./schema"
import { IntegrationMethodID } from "./integration-id"
import { ascending } from "./identifier"
import { NonNegativeInt, statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Credential.ID"),
  statics((schema) => ({ create: () => schema.make("cred_" + ascending()) })),
)
export type ID = typeof ID.Type

export interface OAuth extends Schema.Schema.Type<typeof OAuth> {}
export const OAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  methodID: IntegrationMethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.OAuth" })

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.Key" })

export const Value = Schema.Union([OAuth, Key])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Value" })
export type Value = Schema.Schema.Type<typeof Value>

// kilocode_change start - multiple stored accounts per integration
/** How a provider picks the account used for the next request. */
export const Strategy = Schema.Literals(["manual", "priority", "round-robin"]).annotate({
  identifier: "Credential.Strategy",
})
export type Strategy = Schema.Schema.Type<typeof Strategy>

/**
 * Per-integration account rotation settings.
 *
 * - `manual` keeps the pinned account until the user switches.
 * - `priority` prefers the lowest `priority` value first.
 * - `round-robin` prefers the least recently used enabled account.
 */
export const Policy = Schema.Struct({
  strategy: Strategy,
  /** Retry a request with the next account when the active one is rejected or throttled. */
  failover: Schema.Boolean,
  /** Milliseconds an account stays out of rotation after a failure. */
  cooldown: NonNegativeInt,
}).annotate({ identifier: "Credential.Policy" })
export type Policy = Schema.Schema.Type<typeof Policy>

// Pinning is the default so a freshly stored key takes effect immediately; rotation is opt-in.
export const defaultPolicy: Policy = { strategy: "manual", failover: true, cooldown: 60_000 }

/** Human label candidates for a stored secret; UIs offer the suffix as the default. */
export const suffix = (value: Value) => (value.type === "key" ? value.key.slice(-4) : "account")
// kilocode_change end
