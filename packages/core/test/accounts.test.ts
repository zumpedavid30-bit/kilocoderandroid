// kilocode_change - new file
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function localLayer(directory: string) {
  return LayerNode.compile(Credential.node, [
    [Database.node, Database.layerFromPath(path.join(directory, "credential.db")).pipe(Layer.fresh)],
    [Global.node, Global.layerWith({ data: directory })],
  ]).pipe(Layer.fresh)
}

const key = (value: string) => Credential.Key.make({ type: "key", key: value })

describe("provider accounts", () => {
  it.live("stores several accounts per provider and keeps one active", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrationID = Integration.ID.make("openai")

          const first = yield* credentials.add({ integrationID, value: key("sk-first"), label: "First" })
          expect(first.active).toBe(true)

          const second = yield* credentials.add({ integrationID, value: key("sk-second"), label: "Second" })
          expect(second.active).toBe(false)
          expect((yield* credentials.list(integrationID)).map((item) => item.label)).toEqual(["First", "Second"])

          yield* credentials.activate(second.id)
          expect((yield* credentials.active(integrationID))?.id).toBe(second.id)
          expect((yield* credentials.get(first.id))?.active).toBe(false)

          yield* credentials.setEnabled(second.id, false)
          expect((yield* credentials.get(second.id))?.enabled).toBe(false)
          yield* credentials.setEnabled(second.id, true)

          yield* credentials.move(second.id, -1)
          expect((yield* credentials.list(integrationID)).at(0)?.id).toBe(second.id)

          yield* credentials.lock(second.id, Date.now() + 60_000)
          expect((yield* credentials.get(second.id))?.lockedUntil).toBeGreaterThan(Date.now())

          yield* credentials.setPolicy(integrationID, { strategy: "round-robin", failover: true, cooldown: 5_000 })
          expect(yield* credentials.policy(integrationID)).toEqual({
            strategy: "round-robin",
            failover: true,
            cooldown: 5_000,
          })

          yield* credentials.remove(second.id)
          expect((yield* credentials.list(integrationID)).map((item) => item.id)).toEqual([first.id])
          expect((yield* credentials.active(integrationID))?.id).toBe(first.id)
        }).pipe(Effect.provide(localLayer(tmp.path))),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("keeps the older account active when a replacement is stored as a new account", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrationID = Integration.ID.make("anthropic")
          const first = yield* credentials.create({ integrationID, value: key("sk-one") })
          const second = yield* credentials.create({ integrationID, value: key("sk-two") })
          expect((yield* credentials.list(integrationID)).map((item) => item.id)).toEqual([first.id, second.id])
          expect((yield* credentials.active(integrationID))?.id).toBe(second.id)
        }).pipe(Effect.provide(localLayer(tmp.path))),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
