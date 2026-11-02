import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261102134147_kilocode_provider_accounts",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`credential_policy\` (
          \`integration_id\` text PRIMARY KEY,
          \`strategy\` text NOT NULL,
          \`failover\` integer NOT NULL,
          \`cooldown\` integer NOT NULL
        );
      `)
      yield* tx.run(`ALTER TABLE \`credential\` ADD \`enabled\` integer DEFAULT true NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`credential\` ADD \`priority\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`credential\` ADD \`locked_until\` integer;`)
      yield* tx.run(`ALTER TABLE \`credential\` ADD \`last_used\` integer;`)
      // kilocode_change start - keep the previously newest credential active and give every row a position
      yield* tx.run(`UPDATE \`credential\` SET \`active\` = 0 WHERE \`active\` IS NULL;`)
      yield* tx.run(`
        UPDATE \`credential\` SET \`active\` = 1
        WHERE \`id\` IN (
          SELECT \`id\` FROM (
            SELECT \`id\`, ROW_NUMBER() OVER (
              PARTITION BY \`integration_id\` ORDER BY \`time_created\` DESC
            ) AS \`position\`
            FROM \`credential\`
          ) WHERE \`position\` = 1
        );
      `)
      // kilocode_change end
    })
  },
} satisfies DatabaseMigration.Migration
