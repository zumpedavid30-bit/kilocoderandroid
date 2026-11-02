import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { Credential } from "../credential"

export const CredentialTable = sqliteTable("credential", {
  id: text().$type<Credential.ID>().primaryKey(),
  integration_id: text().$type<Credential.Info["integrationID"]>(),
  label: text().notNull(),
  value: text({ mode: "json" }).$type<Credential.Value>().notNull(),
  connector_id: text(),
  method_id: text(),
  active: integer({ mode: "boolean" }),
  // kilocode_change start - multi-account rotation state
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  priority: integer().notNull().default(0),
  locked_until: integer(),
  last_used: integer(),
  // kilocode_change end
  ...Timestamps,
})

// kilocode_change start - per-integration account rotation settings
export const PolicyTable = sqliteTable("credential_policy", {
  integration_id: text().$type<Credential.Info["integrationID"]>().primaryKey(),
  strategy: text().$type<Credential.Strategy>().notNull(),
  failover: integer({ mode: "boolean" }).notNull(),
  cooldown: integer().notNull(),
})
// kilocode_change end
