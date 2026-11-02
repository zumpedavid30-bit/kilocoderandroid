/**
 * Multi-account manager for API-key providers.
 *
 * Lists every stored account of one provider and exposes the full lifecycle:
 * add, remove, activate, enable/disable, and reorder. Rotation settings
 * (strategy, failover, cooldown) live in the same dialog.
 */

import { createSignal } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"

type Account = {
  type: "credential" | "env"
  id: string
  label: string
  active?: boolean
  enabled?: boolean
  priority?: number
  lockedUntil?: number
}

type Policy = {
  strategy: "manual" | "priority" | "round-robin"
  failover: boolean
  cooldown: number
}

const strategyLabel: Record<Policy["strategy"], string> = {
  manual: "Manual (pinned account, no automatic switching)",
  priority: "Priority (top of the list first)",
  "round-robin": "Round robin (least recently used first)",
}

const seconds = (cooldown: number) => Math.round(cooldown / 1000)

export function DialogAccounts(props: { providerID: string; providerName?: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const client = sdk.client.provider.accounts
  const [list, setList] = createSignal<Account[]>([])
  const [policy, setPolicy] = createSignal<Policy>({ strategy: "priority", failover: true, cooldown: 60_000 })
  const [error, setError] = createSignal<string>()

  function fail(message: string) {
    toast.show({ message, variant: "error" })
    dialog.clear()
  }

  async function reload() {
    const [listed, rotation] = await Promise.all([
      client.list({ providerID: props.providerID }),
      client.policy({ providerID: props.providerID }),
    ])
    if (listed.error) return fail("Could not load the accounts of this provider.")
    setList((listed.data ?? []) as Account[])
    if (rotation.data) setPolicy(rotation.data as Policy)
    show()
  }

  async function add() {
    const key = await DialogPrompt.show(dialog, "API key", { placeholder: "Paste the key of the new account" })
    if (key === null || key.trim().length === 0) return
    const label = await DialogPrompt.show(dialog, "Account label", { placeholder: key.trim().slice(-4) })
    if (label === null) return
    const result = await client.add({
      providerID: props.providerID,
      key: key.trim(),
      label: label.trim() || key.trim().slice(-4),
    })
    if (result.error) return fail("Could not store the account.")
    await sdk.client.instance.dispose()
    toast.show({ message: "Account added", variant: "success" })
    await reload()
  }

  function describe(account: Account) {
    if (account.type === "env") return "environment variable"
    const state = [
      account.active ? "active" : undefined,
      account.enabled === false ? "disabled" : undefined,
      account.lockedUntil && account.lockedUntil > Date.now() ? "cooling down" : undefined,
    ].filter(Boolean)
    return state.length > 0 ? state.join(" · ") : "standby"
  }

  function manage(account: Account) {
    const run = async (action: Promise<{ error?: unknown }>, message: string) => {
      const result = await action
      if (result.error) return fail("Could not update the account.")
      await sdk.client.instance.dispose()
      toast.show({ message, variant: "success" })
      await reload()
    }

    dialog.replace(() => (
      <DialogSelect
        title={`${account.label} · ${describe(account)}`}
        options={[
          {
            title: "Use this account",
            value: "activate",
            description: "Pin this account for the provider",
            onSelect: () => run(client.activate({ credentialID: account.id }), `${account.label} is now active`),
          },
          {
            title: account.enabled === false ? "Enable" : "Disable",
            value: "toggle",
            description:
              account.enabled === false
                ? "Put this account back into rotation"
                : "Keep the account but stop using it",
            onSelect: () =>
              run(
                client.enable({ credentialID: account.id, enabled: account.enabled === false }),
                account.enabled === false ? "Account enabled" : "Account disabled",
              ),
          },
          {
            title: "Move up",
            value: "up",
            description: "Higher priority",
            onSelect: () => run(client.move({ credentialID: account.id, delta: -1 }), "Account moved up"),
          },
          {
            title: "Move down",
            value: "down",
            description: "Lower priority",
            onSelect: () => run(client.move({ credentialID: account.id, delta: 1 }), "Account moved down"),
          },
          {
            title: "Remove",
            value: "remove",
            description: "Delete this key permanently",
            onSelect: () => run(client.remove({ credentialID: account.id }), "Account removed"),
          },
        ]}
      />
    ))
  }

  function configure() {
    const update = async (next: Policy) => {
      const result = await client.setPolicy({ providerID: props.providerID, ...next })
      if (result.error) return fail("Could not save the rotation settings.")
      setPolicy(next)
      toast.show({ message: "Rotation updated", variant: "success" })
      await reload()
    }
    dialog.replace(() => (
      <DialogSelect
        title="Account rotation"
        options={[
          ...(Object.keys(strategyLabel) as Policy["strategy"][]).map((strategy) => ({
            title: strategyLabel[strategy],
            value: strategy,
            description: policy().strategy === strategy ? "current" : undefined,
            onSelect: () => update({ ...policy(), strategy }),
          })),
          {
            title: policy().failover ? "Automatic failover: on" : "Automatic failover: off",
            value: "failover",
            description: "Retry a request with the next account when the active one is rejected or throttled",
            onSelect: () => update({ ...policy(), failover: !policy().failover }),
          },
          {
            title: `Cooldown: ${seconds(policy().cooldown)}s`,
            value: "cooldown",
            description: "How long a failed account is skipped",
            onSelect: () =>
              update({ ...policy(), cooldown: policy().cooldown >= 300_000 ? 30_000 : policy().cooldown + 30_000 }),
          },
        ]}
      />
    ))
  }

  function show() {
    dialog.replace(() => (
      <DialogSelect
        title={`${props.providerName ?? props.providerID} accounts`}
        options={[
          {
            title: "Add account",
            value: "add",
            description: "Store another API key for this provider",
            onSelect: add,
          },
          {
            title: "Rotation settings",
            value: "policy",
            description: `${policy().strategy} · failover ${policy().failover ? "on" : "off"} · ${seconds(policy().cooldown)}s cooldown`,
            onSelect: configure,
          },
          ...list()
            .filter((account) => account.type === "credential")
            .map((account) => ({
              title: account.label,
              value: account.id,
              description: describe(account),
              gutter: account.active ? () => <text fg={theme.success}>✓</text> : undefined,
              onSelect: () => manage(account),
            })),
        ]}
      />
    ))
  }

  void reload().catch(() => setError("Could not load the accounts of this provider."))

  return <DialogAlert title="Provider accounts" message={error() ?? "Reading stored accounts…"} />
}
