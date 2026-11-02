import { Auth } from "@/auth"
// kilocode_change start
import {
  invalidateAfterProviderAuthChange,
  invalidatePresence,
} from "@/kilocode/server/provider-auth-lifecycle"
// kilocode_change end
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { remove as removeAuth } from "@/kilocode/auth/remove" // kilocode_change
// kilocode_change start - multi-account management
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
// kilocode_change end

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const credentials = yield* Credential.Service // kilocode_change - multi-account management

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      // kilocode_change start - drop old presence socket before instance disposal on Kilo auth changes
      if (ctx.params.providerID === "kilo") yield* invalidatePresence()
      yield* invalidateAfterProviderAuthChange(ctx.params.providerID)
      // kilocode_change end
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      // kilocode_change start
      yield* removeAuth(ctx.params.providerID)
      if (ctx.params.providerID === "kilo") yield* invalidatePresence()
      yield* invalidateAfterProviderAuthChange(ctx.params.providerID)
      // kilocode_change end
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    // kilocode_change start - multi-account management
    return handlers
      .handle("authSet", authSet)
      .handle("authRemove", authRemove)
      .handle("log", log)
      .handle(
        "providerAccountsList",
        Effect.fn("ControlHttpApi.providerAccountsList")(function* (ctx: { params: { providerID: ProviderV2.ID } }) {
          const integrationID = Integration.ID.make(ctx.params.providerID)
          const stored = yield* credentials.list(integrationID)
          return stored.map((credential) => ({
            type: "credential" as const,
            id: credential.id,
            label: credential.label,
            active: credential.active === true,
            enabled: credential.enabled !== false,
            priority: credential.priority ?? 0,
            ...(credential.lockedUntil === undefined ? {} : { lockedUntil: credential.lockedUntil }),
          }))
        }),
      )
      .handle(
        "providerAccountsAdd",
        Effect.fn("ControlHttpApi.providerAccountsAdd")(function* (ctx: {
          params: { providerID: ProviderV2.ID }
          payload: { key: string; label?: string }
        }) {
          yield* credentials.create({
            integrationID: Integration.ID.make(ctx.params.providerID),
            value: Credential.Key.make({ type: "key", key: ctx.payload.key }),
            label: ctx.payload.label ?? ctx.payload.key.slice(-4),
          })
          yield* invalidateAfterProviderAuthChange(ctx.params.providerID)
          return true
        }),
      )
      .handle(
        "providerAccountsPolicy",
        Effect.fn("ControlHttpApi.providerAccountsPolicy")(function* (ctx: { params: { providerID: ProviderV2.ID } }) {
          return yield* credentials.policy(Integration.ID.make(ctx.params.providerID))
        }),
      )
      .handle(
        "providerAccountsSetPolicy",
        Effect.fn("ControlHttpApi.providerAccountsSetPolicy")(function* (ctx: {
          params: { providerID: ProviderV2.ID }
          payload: Credential.Policy
        }) {
          yield* credentials.setPolicy(Integration.ID.make(ctx.params.providerID), ctx.payload)
          yield* invalidateAfterProviderAuthChange(ctx.params.providerID)
          return true
        }),
      )
      .handle(
        "providerAccountsActivate",
        Effect.fn("ControlHttpApi.providerAccountsActivate")(function* (ctx: {
          params: { credentialID: Credential.ID }
        }) {
          const credential = yield* credentials.get(ctx.params.credentialID)
          yield* credentials.activate(ctx.params.credentialID)
          if (credential) yield* invalidateAfterProviderAuthChange(credential.integrationID)
          return true
        }),
      )
      .handle(
        "providerAccountsEnable",
        Effect.fn("ControlHttpApi.providerAccountsEnable")(function* (ctx: {
          params: { credentialID: Credential.ID }
          payload: { enabled: boolean }
        }) {
          const credential = yield* credentials.get(ctx.params.credentialID)
          yield* credentials.setEnabled(ctx.params.credentialID, ctx.payload.enabled)
          if (credential) yield* invalidateAfterProviderAuthChange(credential.integrationID)
          return true
        }),
      )
      .handle(
        "providerAccountsMove",
        Effect.fn("ControlHttpApi.providerAccountsMove")(function* (ctx: {
          params: { credentialID: Credential.ID }
          payload: { delta: number }
        }) {
          const credential = yield* credentials.get(ctx.params.credentialID)
          yield* credentials.move(ctx.params.credentialID, ctx.payload.delta)
          if (credential) yield* invalidateAfterProviderAuthChange(credential.integrationID)
          return true
        }),
      )
      .handle(
        "providerAccountsRemove",
        Effect.fn("ControlHttpApi.providerAccountsRemove")(function* (ctx: {
          params: { credentialID: Credential.ID }
        }) {
          const credential = yield* credentials.get(ctx.params.credentialID)
          yield* credentials.remove(ctx.params.credentialID)
          if (credential) yield* invalidateAfterProviderAuthChange(credential.integrationID)
          return true
        }),
      )
    // kilocode_change end
  }),
)
