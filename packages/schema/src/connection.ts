export * as Connection from "./connection"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema" // kilocode_change
import { Credential } from "./credential"

export interface CredentialInfo extends Schema.Schema.Type<typeof CredentialInfo> {}
export const CredentialInfo = Schema.Struct({
  type: Schema.Literal("credential"),
  id: Credential.ID,
  label: Schema.String,
  // kilocode_change start - multi-account state surfaced to clients
  /** Whether this account is the pinned account of its integration. */
  active: Schema.optional(Schema.Boolean),
  /** Disabled accounts stay stored but never rotate in automatically. */
  enabled: Schema.optional(Schema.Boolean),
  /** Lower values are preferred by the `priority` strategy. */
  priority: Schema.optional(NonNegativeInt),
  /** Epoch milliseconds until which the account is skipped after a failure. */
  lockedUntil: Schema.optional(NonNegativeInt),
  // kilocode_change end
}).annotate({ identifier: "Connection.CredentialInfo" })

export interface EnvInfo extends Schema.Schema.Type<typeof EnvInfo> {}
export const EnvInfo = Schema.Struct({
  type: Schema.Literal("env"),
  name: Schema.String,
}).annotate({ identifier: "Connection.EnvInfo" })

export const Info = Schema.Union([CredentialInfo, EnvInfo])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Connection.Info" })
export type Info = Schema.Schema.Type<typeof Info> // kilocode_change
