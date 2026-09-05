/**
 * roles.js —— 跨平台角色语义层（单一出口）。
 *
 * 背景（PLAN-credential-guard §1-L2）：cua-driver 元素投影的 role 按**平台原生命名**
 * （macOS = AX*，Windows = UIA 原生 Button/Edit/…，实验实证），此前 guard 的密码判定、
 * observe 的 isActionable 过滤各自隐式假设 AX 命名——Windows 上凭据硬保护因此静默失效。
 * 本模块把角色语义收敛为一个跨平台出口：密码三态判定 / 可交互过滤。
 */

/** 文本输入类角色（硬拒仅限此类——"显示密码"按钮等不在此列）。 */
const TEXT_ENTRY_ROLES = new Set([
  // macOS AX
  'AXTextField', 'AXTextArea', 'AXSecureTextField', 'AXPasswordField',
  // Windows UIA
  'Edit', 'SearchBox',
])

/** 结构性密码角色（macOS AX；Windows 投影无对应标志位，靠启发式，上游 is_password 补齐前）。 */
const PASSWORD_ROLE_SET = new Set(['AXSecureTextField', 'AXPasswordField'])

const PASSWORD_WORD = /密码|password|passcode|口令|passwd/i
const MASKED_VALUE = /^[●•∗*·■‧]{3,}$/

/**
 * 密码框三态判定。
 * @param {{role?:string, label?:string, value?:string}} e - 快照元素信息
 * @returns {'hard'|'note'|null} hard=文本输入类命中（type 硬拒）；note=非输入类命中（仅注记）；null=非密码
 */
export function isPasswordCandidate({ role, label, value } = {}) {
  const r = String(role || '')
  if (PASSWORD_ROLE_SET.has(r)) return 'hard'
  const masked = isMaskedValue(value)
  const wordHit = PASSWORD_WORD.test(`${label || ''}\n${value || ''}`)
  if (!masked && !wordHit) return null
  return TEXT_ENTRY_ROLES.has(r) ? 'hard' : 'note'
}

/** 掩码值判定：去空白后全为掩码字符且长度 ≥3（密码框的值形态，与 label 无关）。 */
export function isMaskedValue(value) {
  const s = String(value || '').replace(/\s+/g, '')
  return s.length >= 3 && MASKED_VALUE.test(s)
}

/** 可交互角色集合：AX 原集合 ∪ Windows UIA 原生命名（含结构化密码角色）。 */
const ACTIONABLE_ROLES = new Set([
  // macOS AX（原集合 + 结构化密码角色补齐）
  'AXButton', 'AXTextField', 'AXTextArea', 'AXCheckBox', 'AXRadioButton',
  'AXComboBox', 'AXMenuButton', 'AXMenuItem', 'AXLink', 'AXTab', 'AXSlider',
  'AXPopUpButton', 'AXCell', 'AXRow', 'AXScrollBar',
  'AXSecureTextField', 'AXPasswordField',
  // Windows UIA 原生（dsv4fv 实验 GT 实证命名）
  'Button', 'Edit', 'Document', 'ComboBox', 'CheckBox', 'RadioButton', 'Hyperlink',
  'TabItem', 'MenuItem', 'Slider', 'Spinner', 'TreeItem', 'ListItem', 'SplitButton',
  'ScrollBar', 'Header', 'AppBar',
])

/** 可交互角色判定（isActionable 过滤用；无标签的纯图标按钮由此恢复编号）。 */
export function isActionableRole(role) {
  return ACTIONABLE_ROLES.has(String(role || ''))
}
