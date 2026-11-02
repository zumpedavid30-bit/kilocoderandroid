import { Auth } from "@/auth"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { ProviderV2 } from "@opencode-ai/core/provider"
// kilocode_change start - multi-account management
import { Credential } from "@opencode-ai/schema/credential"
import { Connection } from "@opencode-ai/schema/connection"
// kilocode_change end

const AuthParams = Schema.Struct({
  providerID: ProviderV2.ID,
})

// kilocode_change start - multi-account management
const CredentialParams = Schema.Struct({
  credentialID: Credential.ID,
})
// kilocode_change end

const LogQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
})

export const LogInput = Schema.Struct({
  service: Schema.String.annotate({ description: "Service name for the log entry" }),
  level: Schema.Union([
    Schema.Literal("debug"),
    Schema.Literal("info"),
    Schema.Literal("error"),
    Schema.Literal("warn"),
  ]).annotate({ description: "Log level" }),
  message: Schema.String.annotate({ description: "Log message" }),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Additional metadata for the log entry",
  }),
})

export const ControlPaths = {
  auth: "/auth/:providerID",
  log: "/log",
  // kilocode_change start - multi-account management
  accounts: "/provider/:providerID/accounts",
  policy: "/provider/:providerID/accounts/policy",
  account: "/provider-account/:credentialID",
  accountActive: "/provider-account/:credentialID/active",
  accountEnabled: "/provider-account/:credentialID/enabled",
  accountMove: "/provider-account/:credentialID/move",
  // kilocode_change end
} as const

export const ControlApi = HttpApi.make("control").add(
  HttpApiGroup.make("control")
    .add(
      HttpApiEndpoint.put("authSet", ControlPaths.auth, {
        params: AuthParams,
        payload: Auth.Info,
        success: described(Schema.Boolean, "Successfully set authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.set",
          summary: "Set auth credentials",
          description: "Set authentication credentials",
        }),
      ),
      HttpApiEndpoint.delete("authRemove", ControlPaths.auth, {
        params: AuthParams,
        success: described(Schema.Boolean, "Successfully removed authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.remove",
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
        }),
      ),
      HttpApiEndpoint.post("log", ControlPaths.log, {
        query: LogQuery,
        payload: LogInput,
        success: described(Schema.Boolean, "Log entry written successfully"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "app.log",
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
        }),
      ),
      // kilocode_change start - multi-account management
      HttpApiEndpoint.get("providerAccountsList", ControlPaths.accounts, {
        params: AuthParams,
        success: described(Schema.Array(Connection.Info), "Stored accounts of one provider"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.list",
          summary: "List provider accounts",
          description: "List every stored account of one provider in priority order.",
        }),
      ),
      HttpApiEndpoint.post("providerAccountsAdd", ControlPaths.accounts, {
        params: AuthParams,
        payload: Schema.Struct({
          key: Schema.String.annotate({ description: "API key for the additional account" }),
          label: Schema.optional(Schema.String).annotate({ description: "User-facing account label" }),
        }),
        success: described(Schema.Boolean, "Account stored"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.add",
          summary: "Add provider account",
          description: "Store an additional API key and make it the active account.",
        }),
      ),
      HttpApiEndpoint.get("providerAccountsPolicy", ControlPaths.policy, {
        params: AuthParams,
        success: described(Credential.Policy, "Account rotation policy"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.policy",
          summary: "Get rotation policy",
          description: "Return how the provider rotates between its stored accounts.",
        }),
      ),
      HttpApiEndpoint.put("providerAccountsSetPolicy", ControlPaths.policy, {
        params: AuthParams,
        payload: Credential.Policy,
        success: described(Schema.Boolean, "Policy stored"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.setPolicy",
          summary: "Set rotation policy",
          description: "Choose the account rotation strategy, failover, and cooldown.",
        }),
      ),
      HttpApiEndpoint.put("providerAccountsActivate", ControlPaths.accountActive, {
        params: CredentialParams,
        success: described(Schema.Boolean, "Account activated"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.activate",
          summary: "Activate provider account",
          description: "Pin one stored account for the provider.",
        }),
      ),
      HttpApiEndpoint.put("providerAccountsEnable", ControlPaths.accountEnabled, {
        params: CredentialParams,
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: described(Schema.Boolean, "Account updated"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.enable",
          summary: "Enable or disable provider account",
          description: "Keep an account stored but out of rotation, or put it back in.",
        }),
      ),
      HttpApiEndpoint.post("providerAccountsMove", ControlPaths.accountMove, {
        params: CredentialParams,
        payload: Schema.Struct({ delta: Schema.Finite.annotate({ description: "-1 moves up, 1 moves down" }) }),
        success: described(Schema.Boolean, "Account reordered"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.move",
          summary: "Reorder provider account",
          description: "Move an account up or down in priority order.",
        }),
      ),
      HttpApiEndpoint.delete("providerAccountsRemove", ControlPaths.account, {
        params: CredentialParams,
        success: described(Schema.Boolean, "Account removed"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "provider.accounts.remove",
          summary: "Remove provider account",
          description: "Delete one stored account without touching the others.",
        }),
      ),
      // kilocode_change end
    )
    .annotateMerge(OpenApi.annotations({ title: "control", description: "Control plane routes." })),
)
