export * as Credential from "./credential"

import { asc, eq } from "drizzle-orm" // kilocode_change
// kilocode_change start
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
// kilocode_change end
import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { CredentialTable, PolicyTable } from "./credential/sql" // kilocode_change
// kilocode_change start
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { DataMigrationTable } from "./data-migration.sql"
import path from "path"
import { parse as parseKiloAccounts } from "./kilocode/credential-migration"
import { isBusy } from "./kilocode/sqlite-error"
import { NonNegativeInt } from "./schema"
// kilocode_change end

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const Value = Credential.Value
export type Value = Credential.Value

// kilocode_change start - multi-account rotation
export const Strategy = Credential.Strategy
export type Strategy = Credential.Strategy

export const Policy = Credential.Policy
export type Policy = Credential.Policy

export const defaultPolicy = Credential.defaultPolicy
/** Default label for a stored secret, derived from its suffix. */
export const suffix = Credential.suffix
// kilocode_change end

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
  // kilocode_change start - multi-account rotation state
  active: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
  priority: Schema.optional(NonNegativeInt),
  lockedUntil: Schema.optional(NonNegativeInt),
  lastUsed: Schema.optional(NonNegativeInt),
  // kilocode_change end
}) {}

// kilocode_change start - legacy JSON credential stores that predate the integration credential table
const LegacyOAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
})

const LegacyKey = Schema.Struct({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

// recognize config-bootstrap credentials without projecting them into model credentials
const LegacyWellKnown = Schema.Struct({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
})

const LegacyValue = Schema.Union([LegacyOAuth, LegacyKey])
const LegacyAuth = Schema.Union([LegacyOAuth, LegacyKey, LegacyWellKnown])

const legacyMethod = (integration: Integration.ID, type: "oauth" | "api") =>
  Integration.MethodID.make(
    type === "api" ? "api-key" : integration === Integration.ID.make("openai") ? "chatgpt-browser" : "oauth",
  )

const legacyValue = (integration: Integration.ID, credential: Schema.Schema.Type<typeof LegacyValue>): Value =>
  credential.type === "api"
    ? Key.make({ type: "key", key: credential.key, metadata: credential.metadata })
    : OAuth.make({
        type: "oauth",
        methodID: legacyMethod(integration, credential.type),
        refresh: credential.refresh,
        access: credential.access,
        expires: credential.expires,
        metadata: {
          ...(credential.accountId ? { accountID: credential.accountId } : {}),
          ...(credential.enterpriseUrl ? { enterpriseURL: credential.enterpriseUrl } : {}),
        },
      })
// kilocode_change end

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration, ordered by priority. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /**
   * Stores a credential and makes it the active account of its integration.
   *
   * Other accounts of the same integration are kept, so callers can build a
   * rotation set instead of replacing the previous credential.
   */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
  }) => Effect.Effect<Info>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
  // kilocode_change start - multi-account management
  /** Stores an additional account without touching the existing ones. */
  readonly add: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
    readonly priority?: number
  }) => Effect.Effect<Info>
  /** Returns the pinned account, or the first stored account. */
  readonly active: (integrationID: Integration.ID) => Effect.Effect<Info | undefined>
  /** Pins an account and clears its cooldown. */
  readonly activate: (id: ID) => Effect.Effect<void>
  /** Enables or disables an account without deleting it. */
  readonly setEnabled: (id: ID, enabled: boolean) => Effect.Effect<void>
  /** Moves an account up (`-1`) or down (`1`) in priority order. */
  readonly move: (id: ID, delta: number) => Effect.Effect<void>
  /** Keeps an account out of rotation until the given epoch millisecond. */
  readonly lock: (id: ID, until: number) => Effect.Effect<void>
  /** Records that an account served a request. */
  readonly touch: (id: ID) => Effect.Effect<void>
  /** Returns the rotation policy of an integration. */
  readonly policy: (integrationID: Integration.ID) => Effect.Effect<Policy>
  /** Replaces the rotation policy of an integration. */
  readonly setPolicy: (integrationID: Integration.ID, policy: Policy) => Effect.Effect<void>
  // kilocode_change end
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Credential") {}

// kilocode_change start - preserve Kilo's account JSON stores and reconcile auth.json on every startup
export const legacyImportLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    // v3 repairs the active-only v2 import while remaining safe for users who already ran it.
    const kiloName = "credential.kilo-account-json-v3"
    if (!(yield* db.select().from(DataMigrationTable).where(eq(DataMigrationTable.name, kiloName)).get())) {
      const current = yield* fs.readJson(path.join(global.data, "account.json")).pipe(Effect.option)
      const prior = yield* fs.readJson(path.join(global.data, "auth-v2.json")).pipe(Effect.option)
      const raw = Option.isSome(current) ? current.value : Option.getOrUndefined(prior)
      const values = parseKiloAccounts(raw).toSorted(
        (a, b) => a.connectorID.localeCompare(b.connectorID) || Number(a.active) - Number(b.active),
      )
      if (values.length > 0) {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const existing = yield* tx.select().from(CredentialTable).all()
            const used = new Set<ID>()
            const created = Date.now()
            for (const [index, item] of values.entries()) {
              const integration = Integration.ID.make(item.connectorID.replace(/\/+$/, ""))
              const value = legacyValue(integration, item.credential)
              const current = existing.find(
                (row) =>
                  !used.has(row.id) &&
                  row.integration_id === integration &&
                  row.label === item.label &&
                  JSON.stringify(row.value) === JSON.stringify(value),
              )
              const time = created + index
              if (current) {
                used.add(current.id)
                yield* tx
                  .update(CredentialTable)
                  .set({ time_created: time, time_updated: time, active: item.active })
                  .where(eq(CredentialTable.id, current.id))
                  .run()
                continue
              }
              yield* tx.insert(CredentialTable).values({
                id: ID.make(`cred_kilo_${Buffer.from(item.id).toString("base64url")}`),
                integration_id: integration,
                label: item.label,
                value,
                active: item.active,
                enabled: true,
                priority: index,
                time_created: time,
                time_updated: time,
              })
            }
            yield* tx.insert(DataMigrationTable).values({ name: kiloName, time_completed: Date.now() }).run()
          }),
        )
      }
    }
    const name = "credential.auth-json"
    const raw = yield* fs.readJson(path.join(global.data, "auth.json")).pipe(Effect.option)
    if (Option.isNone(raw) || typeof raw.value !== "object" || raw.value === null || Array.isArray(raw.value)) return
    const decode = Schema.decodeUnknownOption(LegacyValue)
    const values = Object.entries(raw.value).flatMap(([integrationID, value]) => {
      const decoded = decode(value)
      if (Option.isNone(decoded)) return []
      const integration = Integration.ID.make(integrationID.replace(/\/+$/, ""))
      return [{ integration, value: legacyValue(integration, decoded.value) }]
    })
    const migrated = yield* db.select().from(DataMigrationTable).where(eq(DataMigrationTable.name, name)).get()
    const existing = yield* db.select().from(CredentialTable).all()
    const same = (left: Value, right: Value) => JSON.stringify(left) === JSON.stringify(right)
    const active = (rows: typeof existing) => rows.find((row) => row.active === true) ?? rows.at(-1)
    if (
      migrated &&
      values.every((item) => {
        const current = active(existing.filter((row) => row.integration_id === item.integration))
        return current !== undefined && same(current.value, item.value)
      })
    )
      return
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        for (const item of values) {
          // reconcile on every startup so a released client can update auth.json after import.
          const rows = yield* tx
            .select()
            .from(CredentialTable)
            .where(eq(CredentialTable.integration_id, item.integration))
            .all()
          const current = active(rows)
          if (current) {
            if (!same(current.value, item.value))
              yield* tx
                .update(CredentialTable)
                .set({ value: item.value })
                .where(eq(CredentialTable.id, current.id))
                .run()
            continue
          }
          yield* tx.insert(CredentialTable).values({
            id: ID.create(),
            integration_id: item.integration,
            label: "Imported",
            value: item.value,
            active: true,
            enabled: true,
            priority: 0,
          })
        }
        yield* tx.insert(DataMigrationTable).values({ name, time_completed: Date.now() }).onConflictDoNothing().run()
      }),
    )
  }).pipe(
    Effect.retry({ while: isBusy, times: 2 }),
    Effect.catch((error) =>
      isBusy(error)
        ? Effect.logWarning("legacy credential reconciliation deferred because the database is busy")
        : Effect.fail(error),
    ),
    Effect.orDie,
  ),
)
// kilocode_change end

// kilocode_change - retained for Kilo migration and compatibility test layers
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = Option.getOrUndefined(yield* Effect.serviceOption(FSUtil.Service))
    const global = Option.getOrUndefined(yield* Effect.serviceOption(Global.Service))
    const decode = Schema.decodeUnknownSync(Value)
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      return new Info({
        id: row.id,
        integrationID: row.integration_id,
        label: row.label,
        value: decode(row.value),
        // kilocode_change start - rotation state
        active: row.active === true,
        enabled: row.enabled !== false,
        priority: row.priority ?? 0,
        ...(row.locked_until == null ? {} : { lockedUntil: row.locked_until }),
        ...(row.last_used == null ? {} : { lastUsed: row.last_used }),
        // kilocode_change end
      })
    }

    // kilocode_change start - process-local workspace credentials override host storage without being persisted
    const content = process.env.KILO_AUTH_CONTENT
    const injected = yield* content === undefined
      ? Effect.succeed(new Map<Integration.ID, Info>())
      : Effect.try({
          try: () => JSON.parse(content) as unknown,
          catch: (cause) => cause,
        }).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
              return Effect.succeed(new Map<Integration.ID, Info>())
            }
            const decode = Schema.decodeUnknownOption(LegacyAuth)
            return Effect.succeed(
              new Map(
                Object.entries(raw).flatMap(([name, raw]) => {
                  const decoded = decode(raw)
                  if (Option.isNone(decoded) || decoded.value.type === "wellknown") return []
                  const integration = Integration.ID.make(name.replace(/\/+$/, ""))
                  return [
                    [
                      integration,
                      new Info({
                        id: ID.make(`cred_env_${Buffer.from(integration).toString("base64url")}`),
                        integrationID: integration,
                        label: "Environment",
                        value: legacyValue(integration, decoded.value),
                        active: true,
                        enabled: true,
                        priority: 0,
                      }),
                    ] as const,
                  ]
                }),
              ),
            )
          }),
          Effect.catch((cause) =>
            Effect.logWarning("invalid KILO_AUTH_CONTENT; using no process-local credentials", { cause }).pipe(
              Effect.as(new Map<Integration.ID, Info>()),
            ),
          ),
        )
    const isolated = content !== undefined
    const local = new Map(injected)
    const find = (id: ID) => [...local.values()].find((credential) => credential.id === id)

    const lock = Semaphore.makeUnsafe(1)
    const writeLegacy = (integration: Integration.ID) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!fs || !global || isolated) return
          const file = path.join(global.data, "auth.json")
          const raw = yield* fs.readJson(file).pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed({})),
            Effect.catch((cause) =>
              Effect.logWarning("failed to read legacy auth.json; preserving existing file", { cause }).pipe(
                Effect.as(undefined),
              ),
            ),
          )
          if (raw === undefined) return
          const data: Record<string, unknown> =
            typeof raw === "object" && raw !== null && !Array.isArray(raw)
              ? { ...(raw as Record<string, unknown>) }
              : {}
          const saved = yield* db
            .select()
            .from(CredentialTable)
            .where(eq(CredentialTable.integration_id, integration))
            .all()
            .pipe(Effect.orDie)
          // kilocode_change - persist the active account so released clients read the pinned one
          const row = saved.find((row) => row.active === true) ?? saved.at(-1)
          delete data[integration + "/"]
          if (!row) delete data[integration]
          else {
            const value = decode(row.value)
            data[integration] =
              value.type === "key"
                ? { type: "api", key: value.key, metadata: value.metadata }
                : {
                    type: "oauth",
                    refresh: value.refresh,
                    access: value.access,
                    expires: value.expires,
                    accountId: value.metadata?.accountID,
                    enterpriseUrl: value.metadata?.enterpriseURL,
                  }
          }
          yield* fs.writeJson(file, data, 0o600).pipe(Effect.orDie)
        }),
      )
    // kilocode_change end

    // kilocode_change start - multi-account rotation helpers
    const rows = (integration: Integration.ID) =>
      db
        .select()
        .from(CredentialTable)
        .where(eq(CredentialTable.integration_id, integration))
        .orderBy(asc(CredentialTable.priority), asc(CredentialTable.time_created))
        .all()
        .pipe(Effect.orDie)

    const activate = Effect.fn("Credential.activate")(function* (id: ID) {
      if (isolated) return
      const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
      if (!row?.integration_id) return
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(CredentialTable)
              .set({ active: false })
              .where(eq(CredentialTable.integration_id, row.integration_id!))
              .run()
            yield* tx
              .update(CredentialTable)
              .set({ active: true, locked_until: null })
              .where(eq(CredentialTable.id, id))
              .run()
          }),
        )
        .pipe(Effect.orDie)
      yield* writeLegacy(row.integration_id)
    })

    const add = Effect.fn("Credential.add")(function* (input: {
      integrationID: Integration.ID
      value: Value
      label?: string
      priority?: number
    }) {
      if (isolated) {
        const credential = new Info({
          id: ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? suffix(input.value),
          value: input.value,
          active: true,
          enabled: true,
          priority: 0,
        })
        local.set(credential.integrationID, credential)
        return credential
      }
      const credential = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const existing = yield* tx
              .select()
              .from(CredentialTable)
              .where(eq(CredentialTable.integration_id, input.integrationID))
              .all()
            const active = !existing.some((row) => row.active === true)
            const next = existing.reduce((top, row) => Math.max(top, row.priority ?? 0), -1) + 1
            const credential = new Info({
              id: ID.create(),
              integrationID: input.integrationID,
              label: input.label ?? suffix(input.value),
              value: input.value,
              active,
              enabled: true,
              priority: input.priority ?? next,
            })
            yield* tx
              .insert(CredentialTable)
              .values({
                id: credential.id,
                integration_id: credential.integrationID,
                label: credential.label,
                value: credential.value,
                active,
                enabled: true,
                priority: credential.priority ?? next,
              })
              .run()
            return credential
          }),
        )
        .pipe(Effect.orDie)
      yield* writeLegacy(credential.integrationID)
      return credential
    })

    const create = Effect.fn("Credential.create")(function* (input: {
      integrationID: Integration.ID
      value: Value
      label?: string
    }) {
      const credential = yield* add(input)
      yield* activate(credential.id)
      return new Info({ ...credential, active: true })
    })
    // kilocode_change end

    const service: Interface = {
      all: Effect.fn("Credential.all")(function* () {
        if (isolated) return [...local.values()] // kilocode_change
        return (yield* db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      list: Effect.fn("Credential.list")(function* (integrationID) {
        // kilocode_change start
        if (isolated) {
          const credential = local.get(integrationID)
          return credential ? [credential] : []
        }
        // kilocode_change end
        return (yield* rows(integrationID)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      get: Effect.fn("Credential.get")(function* (id) {
        if (isolated) return find(id) // kilocode_change - injected workspace credentials are process-local
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      create,
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        // kilocode_change start - isolated updates never reach the host database
        if (isolated) {
          const credential = find(id)
          if (!credential) return
          local.set(
            credential.integrationID,
            new Info({
              ...credential,
              label: updates.label ?? credential.label,
              value: updates.value ?? credential.value,
            }),
          )
          return
        }
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        // kilocode_change end
        yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: updates.value })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
        if (row?.integration_id) yield* writeLegacy(row.integration_id) // kilocode_change
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        // kilocode_change start - isolated removals remain process-local
        if (isolated) {
          const credential = find(id)
          if (credential) local.delete(credential.integrationID)
          return
        }
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        // kilocode_change end
        yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id)).run().pipe(Effect.orDie)
        // kilocode_change start - keep one account active when the pinned one is removed
        if (row?.active && row.integration_id) {
          const next = (yield* rows(row.integration_id)).at(-1)
          if (next) yield* activate(next.id)
        }
        if (row?.integration_id) yield* writeLegacy(row.integration_id)
        // kilocode_change end
      }),
      // kilocode_change start - multi-account management
      add,
      active: Effect.fn("Credential.active")(function* (integrationID) {
        const saved = yield* service.list(integrationID)
        return saved.find((credential) => credential.active === true) ?? saved.at(0)
      }),
      activate,
      setEnabled: Effect.fn("Credential.setEnabled")(function* (id, enabled) {
        if (isolated) {
          const credential = find(id)
          if (credential) local.set(credential.integrationID, new Info({ ...credential, enabled }))
          return
        }
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        yield* db
          .update(CredentialTable)
          .set({ enabled, ...(enabled ? { locked_until: null } : {}) })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
        if (row?.integration_id) yield* writeLegacy(row.integration_id)
      }),
      move: Effect.fn("Credential.move")(function* (id, delta) {
        if (isolated || delta === 0) return
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        if (!row?.integration_id) return
        const list = yield* rows(row.integration_id)
        const index = list.findIndex((item) => item.id === id)
        if (index === -1) return
        const target = list.at(index + (delta > 0 ? 1 : -1))
        if (!target) return
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(CredentialTable)
                .set({ priority: row.priority ?? 0 })
                .where(eq(CredentialTable.id, target.id))
                .run()
              yield* tx
                .update(CredentialTable)
                .set({ priority: target.priority ?? 0 })
                .where(eq(CredentialTable.id, id))
                .run()
            }),
          )
          .pipe(Effect.orDie)
      }),
      lock: Effect.fn("Credential.lock")(function* (id, until) {
        if (isolated) return
        yield* db
          .update(CredentialTable)
          .set({ locked_until: until })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
      touch: Effect.fn("Credential.touch")(function* (id) {
        if (isolated) return
        yield* db
          .update(CredentialTable)
          .set({ last_used: Date.now() })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
      policy: Effect.fn("Credential.policy")(function* (integrationID) {
        if (isolated) return defaultPolicy
        const row = yield* db
          .select()
          .from(PolicyTable)
          .where(eq(PolicyTable.integration_id, integrationID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? { strategy: row.strategy, failover: row.failover, cooldown: row.cooldown }
          : defaultPolicy
      }),
      setPolicy: Effect.fn("Credential.setPolicy")(function* (integrationID, policy) {
        if (isolated) return
        yield* db
          .insert(PolicyTable)
          .values({ integration_id: integrationID, ...policy })
          .onConflictDoUpdate({ target: PolicyTable.integration_id, set: policy })
          .run()
          .pipe(Effect.orDie)
      }),
      // kilocode_change end
    }

    return Service.of(service)
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.provideMerge(legacyImportLayer)), // kilocode_change
  deps: [Database.node, FSUtil.node, Global.node], // kilocode_change
})
