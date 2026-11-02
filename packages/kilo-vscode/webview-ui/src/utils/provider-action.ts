import type {
  ActivateProviderAccountMessage,
  AddProviderAccountMessage,
  AuthorizeProviderOAuthMessage,
  CompleteProviderOAuthMessage,
  ConnectProviderMessage,
  DisconnectProviderMessage,
  EnableProviderAccountMessage,
  ExtensionMessage,
  ListProviderAccountsMessage,
  MoveProviderAccountMessage,
  ProviderAccountsMessage,
  ProviderActionErrorMessage,
  ProviderConnectedMessage,
  ProviderDisconnectedMessage,
  ProviderOAuthReadyMessage,
  RemoveProviderAccountMessage,
  SaveCustomProviderMessage,
  SetProviderAccountPolicyMessage,
  WebviewMessage,
} from "../types/messages"

type AccountRequest =
  | ListProviderAccountsMessage
  | AddProviderAccountMessage
  | ActivateProviderAccountMessage
  | EnableProviderAccountMessage
  | MoveProviderAccountMessage
  | RemoveProviderAccountMessage
  | SetProviderAccountPolicyMessage

type ProviderRequest =
  | ConnectProviderMessage
  | AuthorizeProviderOAuthMessage
  | CompleteProviderOAuthMessage
  | DisconnectProviderMessage
  | SaveCustomProviderMessage
  | AccountRequest

type Strip<T> = T extends unknown ? Omit<T, "requestId"> : never

export type ProviderRequestInput =
  | Strip<ConnectProviderMessage>
  | Strip<AuthorizeProviderOAuthMessage>
  | Strip<CompleteProviderOAuthMessage>
  | Strip<DisconnectProviderMessage>
  | Strip<SaveCustomProviderMessage>
  | Strip<AccountRequest>

type Transport = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

type Handlers = {
  onOAuthReady?: (message: ProviderOAuthReadyMessage) => void
  onConnected?: (message: ProviderConnectedMessage) => void
  onDisconnected?: (message: ProviderDisconnectedMessage) => void
  onAccounts?: (message: ProviderAccountsMessage) => void
  onError?: (message: ProviderActionErrorMessage) => void
}

export function createProviderAction(vscode: Transport) {
  const pending = new Map<string, Handlers>()
  const unsubscribe = vscode.onMessage((message) => {
    if (!("requestId" in message)) return

    const item = pending.get(message.requestId)
    if (!item) return
    pending.delete(message.requestId)

    if (message.type === "providerOAuthReady") {
      item.onOAuthReady?.(message)
      return
    }

    if (message.type === "providerConnected") {
      item.onConnected?.(message)
      return
    }

    if (message.type === "providerDisconnected") {
      item.onDisconnected?.(message)
      return
    }

    if (message.type === "providerAccounts") {
      item.onAccounts?.(message)
      return
    }

    if (message.type === "providerActionError") {
      item.onError?.(message)
    }
  })

  function send(message: ProviderRequestInput, handlers: Handlers = {}) {
    const requestId = crypto.randomUUID()
    pending.set(requestId, handlers)
    vscode.postMessage({ ...message, requestId } as ProviderRequest)
    return requestId
  }

  function clear(requestId?: string) {
    if (requestId) {
      pending.delete(requestId)
      return
    }
    pending.clear()
  }

  function dispose() {
    clear()
    unsubscribe()
  }

  return { clear, send, dispose }
}
