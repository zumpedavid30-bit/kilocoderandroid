function board(name: string) {
  return /(?:^|_)kilocode_board(?:_reset)?$/.test(name)
}

// kilocode_change start - Kilo-owned schema and migrations
function kilo(name: string) {
  return board(name) || name.includes("kilocode")
}

// Statements that only exist because of the multi-account credential work.
const accounts = /credential_policy|integer DEFAULT true NOT NULL/
// kilocode_change end

export function file(name: string, value: string) {
  return kilo(name) ? `// kilocode_change - new file\n${value}` : value
}

export function block(name: string | undefined, source: string, value: string) {
  return (name !== undefined && kilo(name)) ||
    accounts.test(source) ||
    /kilo_board(?:_message)?|part_session_step_finish_idx|recall_(?:part_search|message_role)_idx/.test(source)
    ? `// kilocode_change start\n${value}\n// kilocode_change end`
    : value
}

export function line(name: string, value: string) {
  return kilo(name) || name.endsWith("_kilocode_model_usage_index") ? `${value} // kilocode_change` : value
}
