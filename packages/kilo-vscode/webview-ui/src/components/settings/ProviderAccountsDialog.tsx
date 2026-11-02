import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Select } from "@kilocode/kilo-ui/select"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useVSCode } from "../../context/vscode"
import type { ProviderAccountInfo } from "../../types/messages"
import { createProviderAction, type ProviderRequestInput } from "../../utils/provider-action"

type Strategy = "manual" | "priority" | "round-robin"

const STRATEGIES: Array<{ value: Strategy; label: string }> = [
  { value: "manual", label: "Manual — pinned account" },
  { value: "priority", label: "Priority — top of the list first" },
  { value: "round-robin", label: "Round robin — least recently used" },
]

const seconds = (ms: number) => Math.round(ms / 1000)

function status(account: ProviderAccountInfo) {
  const state = [
    account.active ? "active" : undefined,
    account.enabled === false ? "disabled" : undefined,
    account.lockedUntil !== undefined && account.lockedUntil > Date.now() ? "cooling down" : undefined,
  ].filter(Boolean)
  return state.length > 0 ? state.join(" · ") : "standby"
}

const row: Record<string, string> = {
  display: "flex",
  "flex-wrap": "wrap",
  "align-items": "center",
  "justify-content": "space-between",
  gap: "12px",
  "min-height": "48px",
  padding: "8px 0",
  "border-bottom": "1px solid var(--border-weak-base)",
}

const input: Record<string, string> = {
  flex: "1",
  "min-width": "140px",
  background: "var(--vscode-input-background)",
  color: "var(--vscode-input-foreground)",
  border: "1px solid var(--vscode-input-border, var(--border-weak-base))",
  "border-radius": "4px",
  padding: "6px 8px",
  font: "inherit",
}

interface ProviderAccountsDialogProps {
  providerID: string
  providerName: string
}

/**
 * Manages the stored API-key accounts of one provider: add, remove, activate,
 * enable/disable, reorder, and the rotation policy (strategy, failover,
 * cooldown). Every response carries the full rotation set so the list cannot
 * drift from the backend.
 */
const ProviderAccountsDialog: Component<ProviderAccountsDialogProps> = (props) => {
  const vscode = useVSCode()
  const action = createProviderAction(vscode)
  const [accounts, setAccounts] = createSignal<ProviderAccountInfo[]>([])
  const [policy, setPolicy] = createStore<{ strategy: Strategy; failover: boolean; cooldown: number }>({
    strategy: "manual",
    failover: true,
    cooldown: 60_000,
  })
  const [draft, setDraft] = createStore({ key: "", label: "" })
  const [busy, setBusy] = createSignal(false)

  const strategy = createMemo(() => STRATEGIES.find((item) => item.value === policy.strategy))

  function run(message: ProviderRequestInput, notice?: string) {
    setBusy(true)
    action.send(message, {
      onAccounts: (reply) => {
        setAccounts(reply.accounts)
        setPolicy({ strategy: reply.strategy, failover: reply.failover, cooldown: reply.cooldown })
        setBusy(false)
        if (notice) showToast({ variant: "success", title: notice })
      },
      onError: (reply) => {
        setBusy(false)
        showToast({ variant: "error", title: "Account update failed", description: reply.message })
      },
    })
  }

  const reload = () => run({ type: "listProviderAccounts", providerID: props.providerID })

  function add() {
    const key = draft.key.trim()
    if (key.length === 0) return
    run(
      {
        type: "addProviderAccount",
        providerID: props.providerID,
        apiKey: key,
        label: draft.label.trim() || key.slice(-4),
      },
      "Account added",
    )
    setDraft({ key: "", label: "" })
  }

  function update(next: { strategy: Strategy; failover: boolean; cooldown: number }, notice: string) {
    run({ type: "setProviderAccountPolicy", providerID: props.providerID, ...next }, notice)
  }

  onMount(reload)
  onCleanup(() => action.dispose())

  return (
    <Dialog title={`${props.providerName} accounts`} fit>
      <div style={{ display: "flex", "flex-direction": "column", gap: "4px", width: "520px", "max-width": "100%" }}>
        <Show
          when={accounts().length > 0}
          fallback={
            <div
              style={{
                padding: "12px 0",
                "font-size": "var(--kilo-font-size-14)",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              No accounts stored for this provider yet.
            </div>
          }
        >
          <For each={accounts()}>
            {(account, index) => (
              <div style={row}>
                <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
                  <span
                    style={{
                      "font-size": "var(--kilo-font-size-14)",
                      "font-weight": "500",
                      color: "var(--vscode-foreground)",
                    }}
                  >
                    {account.label}
                  </span>
                  <span
                    style={{
                      "font-size": "var(--kilo-font-size-12)",
                      color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                    }}
                  >
                    {status(account)}
                  </span>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "2px" }}>
                  <Show when={!account.active}>
                    <Button
                      size="large"
                      variant="ghost"
                      disabled={busy()}
                      onClick={() =>
                        run(
                          { type: "activateProviderAccount", providerID: props.providerID, credentialID: account.id },
                          `${account.label} is now active`,
                        )
                      }
                    >
                      Use
                    </Button>
                  </Show>
                  <Button
                    size="large"
                    variant="ghost"
                    disabled={busy()}
                    onClick={() =>
                      run(
                        {
                          type: "enableProviderAccount",
                          providerID: props.providerID,
                          credentialID: account.id,
                          enabled: account.enabled === false,
                        },
                        account.enabled === false ? "Account enabled" : "Account disabled",
                      )
                    }
                  >
                    {account.enabled === false ? "Enable" : "Disable"}
                  </Button>
                  <Button
                    size="large"
                    variant="ghost"
                    disabled={busy() || index() === 0}
                    onClick={() =>
                      run(
                        {
                          type: "moveProviderAccount",
                          providerID: props.providerID,
                          credentialID: account.id,
                          delta: -1,
                        },
                        "Account moved up",
                      )
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    size="large"
                    variant="ghost"
                    disabled={busy() || index() === accounts().length - 1}
                    onClick={() =>
                      run(
                        {
                          type: "moveProviderAccount",
                          providerID: props.providerID,
                          credentialID: account.id,
                          delta: 1,
                        },
                        "Account moved down",
                      )
                    }
                  >
                    ↓
                  </Button>
                  <Button
                    size="large"
                    variant="ghost"
                    disabled={busy()}
                    onClick={() =>
                      run(
                        { type: "removeProviderAccount", providerID: props.providerID, credentialID: account.id },
                        "Account removed",
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </For>
        </Show>

        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "align-items": "center", padding: "12px 0" }}>
          <input
            type="password"
            autocomplete="off"
            placeholder="API key"
            value={draft.key}
            style={input}
            onInput={(event) => setDraft("key", event.currentTarget.value)}
          />
          <input
            type="text"
            autocomplete="off"
            placeholder="Label (optional)"
            value={draft.label}
            style={{ ...input, "max-width": "160px" }}
            onInput={(event) => setDraft("label", event.currentTarget.value)}
          />
          <Button size="large" variant="secondary" icon="plus-small" disabled={busy() || !draft.key.trim()} onClick={add}>
            Add account
          </Button>
        </div>

        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0 4px",
            "border-top": "1px solid var(--border-weak-base)",
          }}
        >
          <span
            style={{
              "font-size": "var(--kilo-font-size-12)",
              "font-weight": "500",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            }}
          >
            Rotation
          </span>
          <Select
            options={STRATEGIES}
            current={strategy()}
            value={(item) => item.value}
            label={(item) => item.label}
            onSelect={(item) =>
              update({ ...policy, strategy: item?.value ?? policy.strategy }, "Rotation strategy updated")
            }
            variant="secondary"
            triggerVariant="settings"
            placeholder="Strategy"
          />
          <Button
            size="large"
            variant="ghost"
            disabled={busy()}
            onClick={() => update({ ...policy, failover: !policy.failover }, "Failover updated")}
          >
            {policy.failover ? "Failover: on" : "Failover: off"}
          </Button>
          <Button
            size="large"
            variant="ghost"
            disabled={busy()}
            onClick={() =>
              update(
                { ...policy, cooldown: policy.cooldown >= 300_000 ? 30_000 : policy.cooldown + 30_000 },
                "Cooldown updated",
              )
            }
          >
            Cooldown: {seconds(policy.cooldown)}s
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export default ProviderAccountsDialog
