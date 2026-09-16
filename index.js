/**
 * dsh-computer-use —— Computer Use 插件：给 harness-desktop 增加"虚拟鼠标真人操作"。
 *
 * 工具集（Hermes 风格，模型友好，共 19 个，按域分三组注册）：
 *   观察组：screen_observe / screen_zoom
 *   动作组：computer_click / double_click / right_click / type / key / scroll / drag / wait
 *           app_list / app_launch
 *   运营组：computer_verify / wait_for / clipboard / menu / hover / stop / resume
 *
 * 视觉能力（原生接入）：
 *   - mode="native"：截图经 attachments 持久化后以图片块返回，主对话模型
 *     （如 deepseek-v4-flash-vision-exp）直接看图 —— 零外部 API、零额外 key。
 *   - mode="vision"：DeepSeek 视觉观察者（ctx.llm）结构化描述截图（免 ZHIPU key），
 *     不可用时回退 GLM 免费模型。
 *   - ax：零成本 AX 树；AX 树为空时自动降级 native → vision → ax。
 *
 * 安全姿态（无感自治，0.4.0）：
 *   - 易用无感：动作零审批、零打断；观测/投递能力默认全开。
 *   - 自动提权：投递链自动升级（恢复原前台）、观测失败自动降级桌面级采集。
 *   - 极危敏感警告：extremePatterns 命中 → 注记警告，不阻断；凭据硬保护（密码框）是唯一硬拒绝。
 *   - 基本兜底：观察快照 TTL 过期拒绝（element_token 引擎侧双重校验）、
 *     动作一律要求先 screen_observe（无快照直接拒绝，杜绝盲操作）、
 *     computer_stop 强杀锁存（computer_resume 唯一解锁）。
 */
import z from '@deepseek-ai/schemastery'
import { defineTool as rawDefineTool } from '@deepseek-ai/dsh-tools'

/**
 * defineTool 薄包装：登记每个工具的合法参数名。
 *
 * 为什么需要：宿主把参数表编译成 `{type:'object', properties, required}`——**不含**
 * additionalProperties，于是模型传了拼错/外来的参数名时会被静默忽略，工具照常执行。
 * 2026-09-16 实测踩坑：给 screen_observe 传 `app:'Notepad'`（该工具只有 `window`），
 * 参数被丢弃 → 回退"z 序最前窗口" → 观察到了另一个应用的窗口，而不是目标窗口。
 * 桌面自动化里静默选错目标代价很高，因此在 wrap() 里对未知参数直接拒绝并列明可接受参数。
 */
const toolParamNames = new Map()
const defineTool = (options) => {
  toolParamNames.set(options.name, Object.keys(options.parameters || {}))
  return rawDefineTool(options)
}

import { screenObserve, screenZoom, dedupReset } from './lib/observe.js'
import { runComputerTask } from './lib/task.js'
import {
  click, doubleClick, rightClick, typeText, key, scroll, drag, wait, listApps, launchApp,
} from './lib/actions.js'
import { guard } from './lib/guard.js'
import { cuaCall, CUA_SESSION } from './lib/cua.js'
import {
  createOpsState, gate as opsGate, stop as opsStop, resume as opsResume,
  verifyOnce, waitFor, clipboard as opsClipboard, menu as opsMenu, hover as opsHover,
} from './lib/ops.js'

export const name = 'dsh-computer-use'

export const inject = ['tools']

/** 插件配置。 */
export const Config = z.object({
  /** 观察快照的有效期（毫秒）。 */
  ttlMs: z.number().default(60000),
  /** screen_observe 最多返回多少编号元素（实测常见任务 30-70 个；大树可显式调大）。 */
  maxElements: z.number().default(120),
  /** 重复观察降噪（同一未变窗口）：summary = 极简回执 + 上次元素摘要；brief = 只回一行；off = 每次都全量。 */
  observeDedup: z.union(['brief', 'summary', 'off']).default('summary'),
  /** 回执详略：false（默认）动作回执只回一行要点；true 附原始 JSON 明细（排障用）。 */
  verboseReceipts: z.boolean().default(false),
  /** computer_task 默认超时（分钟）；调用方可用 timeout_min 覆盖。 */
  taskTimeoutMin: z.number().default(10),
  /** 区域限制：允许操作的应用名白名单（空 = 不限制）。 */
  allowedApps: z.array(z.string()).default([]),
  /** 虚拟光标主题 id（空 = 不设置，用引擎默认）。 */
  cursorTheme: z.string().default('com.dsh.computeruse.rainbow'),
  /** 原生直读截图策略：auto（PNG 超限额时自动降级 zoom JPEG）/ full（始终原图 PNG）/ compact（始终 ≤500px JPEG）。 */
  nativeImage: z.union(['auto', 'full', 'compact']).default('auto'),
  /** Mode D 观察者 provider 路由。 */
  visionProvider: z.string().default('deepseek-official'),
  /** Mode D 观察者模型（需声明 image 输入）。 */
  visionModel: z.string().default('deepseek-v4-flash-vision-exp'),
  /**
   * 极危清单（注记警告，不阻断）：正则源字符串数组，命中元素标签时在结果附加
   * 极危警告注记。默认空 = 零差异；按需增补（如 '永久删除|格式化|清空回收站'）。
   * 凭据硬保护（密码框拒绝自动输入）独立于本清单，始终生效。
   */
  extremePatterns: z.array(z.string()).default([]),
  /**
   * 结构性密码扫描（Windows）：screen_observe 时经 UIA sidecar 读取元素 IsPassword/
   * ES_PASSWORD 结构位并标记快照——凭据硬保护的结构性依据（启发式的盲区补齐）。
   * auto 默认开启；off 关闭（零 spawn，凭据保护退回启发式）。macOS/Linux 不适用。
   */
  passwordScan: z.union(['auto', 'off']).default('auto'),
  /**
   * 快照新鲜度（PLAN-snapshot-freshness）：同快照连击的引用作废语义。
   *   note 默认：同一快照被动作消费后，后续动作附一致性注记（不阻断，"确认未变可继续"）；
   *   enforce：同快照第二次动作直接拒绝（[snapshot_consumed]），直至重新 screen_observe
   *            ——ZCode 式每动作一观察，代价 = 每动作约 +10s 观察成本；
   *   off：全关闭（零注记零拒绝）。不可验证动作的状态可疑注记同受此开关约束。
   */
  supersession: z.union(['off', 'note', 'enforce']).default('note'),
  /**
   * 输入投递策略（前后台）：
   *   auto 默认：后台优先；命中 background_unavailable 时自动以前台重试
   *              （驱动短暂交换焦点后恢复原前台）并标注结果——不会"被阻拦"，
   *              也不会"被忽视"（后台静默 no-op 的目标由驱动判定）。
   *   background 全程后台投递（UIA Invoke / PostMessage，不抢用户焦点）；
   *              后台不可用时返回结构化错误并给出 foreground=true 升级指引。
   *   foreground 始终前台投递（短暂焦点交换）。
   * 工具级 foreground=true 可对单次动作强制前台。
   */
  deliveryMode: z.union(['background', 'auto', 'foreground']).default('auto'),
})

/** 统一输出 schema：ok + result 文本。 */
const OUT = (extra = {}) => ({
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      result: { type: 'string', required: true },
      ...extra,
    },
  },
  render: (_args, value) => [{ type: 'text', text: value.result }],
})

/** 图片块输出 schema 段（native 直读工具共用）。 */
const IMAGE_FIELD = {
  image: {
    type: 'object',
    additionalProperties: false,
    properties: {
      attachmentId: { type: 'string', required: true },
      mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
      bytes: { type: 'integer', required: true },
      width: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
      height: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
      name: { type: 'string' },
    },
  },
}

/**
 * 坐标换算基准字段（2026-09-16 实测）：截图 = 窗口 bounds 的 1:1 物理像素裁剪
 * （同窗口 bounds 1906×1166 == screenshot 1906×1166）→ 屏幕原点即 bounds.x/y。
 * 观察类工具对外声明这两项，模型才能把"图内像素"换算成"屏幕物理像素"。
 */
const SCREEN_ORIGIN_FIELDS = {
  screenOrigin: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'integer' }, y: { type: 'integer' },
          width: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          height: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
      { type: 'null' },
    ],
    description: '窗口在屏幕上的物理像素原点（= list_windows bounds）；null = 未取到，坐标换算不可用。',
  },
  coordinateSpace: { type: 'string', description: '本次观察各坐标所处的空间（screen-physical-px = 屏幕物理像素）。' },
}

/**
 * 观测降级形态的公共字段：窗口级观测被拒时 desktopFallback() 返回这一组字段
 * （window/elementCount/mode/elements/visualOnly/driverAccess）。观察类工具的
 * output schema 必须同时声明它们——dsh 0.1.5 起对工具输出做严格校验
 * （additionalProperties:false），未声明的降级回执会被判为非法输出而让整次调用失败
 * （2026-09-16 实测：screen_zoom 降级路径直接报 invalid output）。
 */
const DESKTOP_FALLBACK_FIELDS = {
  window: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          pid: { type: 'integer' }, windowId: { type: 'integer' },
          app: { type: 'string' }, title: { type: 'string' },
        },
      },
      { type: 'null' },
    ],
  },
  elementCount: { type: 'integer' },
  mode: { type: 'string' },
  elements: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        index: { type: 'integer' }, role: { type: 'string' },
        label: { type: 'string' },
        x: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        y: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
      },
    },
  },
  visualOnly: { type: 'boolean', description: 'true = 无可用 AX 树或已桌面级降级，仅视觉信息（不可直接用于坐标动作）。' },
  driverAccess: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          elevated: { type: 'boolean' },
          integrityLevel: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          uia: { type: 'boolean' },
          postMessage: { type: 'boolean' },
        },
      },
      { type: 'null' },
    ],
  },
}

/**
 * S3a 视觉断言协议（模型侧验证器，PLAN-s3-model-verifier §4）。
 * 依据（A5 实证，2026-09-06）：可读 PNG 证据上数字转述噪声≈0（93 位零错误）；
 * zoom JPEG 对 ~13px 小字不可读（模型 2/2 诚实拒答）；同会话历史回声风险真实。
 */
const S3_ASSERT_PROTOCOL =
  '视觉断言协议：只以本次调用返回的截图为证据，跨轮读数不得复用。' +
  '文字断言用模糊子串匹配（容忍大小写/空白/标点；同义 UI 词按常见对照，如 返回=后退、确定=OK）。' +
  '数字断言逐字双向校验、不做编辑距离放宽——读不出或对不上时换裁剪或换通道重读一次，两次不一致按 unknown 上报；' +
  '证据不可读时如实报 unknown，不得编造。'

/** render：值含 image 时追加图片块（主模型原生直读）。 */
function renderWithImage(_args, value) {
  if (!value.image) return [{ type: 'text', text: value.result }]
  return [
    { type: 'text', text: value.result },
    {
      type: 'image',
      attachment: {
        attachmentId: value.image.attachmentId,
        mediaType: value.image.mediaType,
        bytes: value.image.bytes,
        width: value.image.width,
        height: value.image.height,
        ...value.image.name === undefined ? {} : { name: value.image.name },
      },
    },
  ]
}

/** 前后台投递的单次覆盖参数（点击/输入/按键/滚动/拖拽共用）。 */
const FOREGROUND_PARAM = {
  foreground: {
    type: 'boolean',
    description: '可选：强制前台投递（用后自动恢复原前台）；默认按 deliveryMode。',
  },
}

/** 统一的坐标/编号参数块（坐标 = 窗口本地截图像素）。 */
const TARGET_PARAMS = {
  element: {
    type: 'integer',
    description: '元素编号（screen_observe 输出）；与 x/y 二选一，优先。',
  },
  x: {
    type: 'integer',
    description: '截图物理像素 x（与 element 二选一）。',
  },
  y: {
    type: 'integer',
    description: '截图物理像素 y。',
  },
}

/** 显式证据基线（PLAN-snapshot-freshness §3.4）：动作声明它基于哪次观察。 */
const SNAPSHOT_ID_PARAM = {
  snapshot_id: {
    type: 'string',
    description: '可选：本动作基于的快照 id（observe 的 snapshotId）；不一致则拒（[snapshot_mismatch]）。',
  },
}

const VERIFY_RESULT = {
  status: { type: 'string', description: 'satisfied / unsatisfied / unknown（unknown = 无法证明，不是失败也不是成功）' },
  stable: { type: 'boolean' },
  results: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        index: { type: 'integer' },
        status: { type: 'string' },
        unknownReason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        expect: { type: 'string' },
        observed: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
  },
}

const VERIFY_PARAMS = {
  pid: { type: 'integer', description: '目标进程 pid（screen_observe 输出）。' },
  window_id: { type: 'integer', required: true, description: '目标窗口 id。' },
  expect: {
    type: 'string',
    required: true,
    description: '谓词数组 JSON（1-8 条，AND）。元素谓词：{"element":{"selector":{"role":"按钮","label_contains":"确定"},"exists":true}}（exists 仅接受 true；缺失返回 unknown）或 {"element":{"selector":{…},"enabled":true,"selected":null,"value_equals":null}}；窗口谓词：{"window":{"exists":true,"bounds":{"x":0,"y":0,"width":100,"height":50,"tolerance_px":10}}}。',
  },
}

/** ── 观察组：screen_observe / screen_zoom ── */
function registerObserveTools(ctx, cfg, wrap) {
  ctx.tools.register(defineTool({
    name: 'screen_observe',
    description:
      '观察屏幕：生成目标窗口的"编号 + 控件 + 坐标"界面树（AX，零视觉成本）。动作前需先取得快照；' +
      '坐标 = 窗口截图物理像素，与 computer_click 同空间，可直接传。' +
      '成本阶梯（左低右高）：ax（纯文本）< screen_zoom 小裁剪(~200 tok) < native 整窗 PNG(~3K tok)——' +
      '读文字用 native（无损），只判布局/找位置用 ax + screen_zoom，别为看布局付整窗 PNG 的钱。' +
      'mode：ax（默认）/ vision（视觉观察者结构化描述）/ native（截图直读，需模型支持图片输入）；' +
      'AX 树不可解析（游戏/Canvas/Electron）时自动降级 native→vision→ax。快照 60s 过期；' +
      '界面未变时本工具回极简回执（force=true 强制全量）。' + S3_ASSERT_PROTOCOL,
    parameters: {
      window: {
        type: 'string',
        description: '可选：目标窗口，传 pid 数字或标题子串（如 "访达"）。缺省选最前窗口。',
      },
      mode: {
        type: 'string',
        enum: ['ax', 'vision', 'native'],
        description: 'ax（默认）= 零成本的界面树；vision = 视觉观察者描述；native = 截图直读（模型直接看图）。',
      },
      query: {
        type: 'string',
        description: '可选：按控件标签过滤界面树（如 "提交"）。',
      },
      maxElements: {
        type: 'integer',
        description: '可选：最多返回多少个编号元素（默认 120，防上下文爆炸；大树可显式调大）。',
      },
      force: {
        type: 'boolean',
        description: '可选：强制返回完整界面树。同一窗口界面未变时本工具会回极简"状态未变"回执以省上下文——需要完整清单时传 force=true。',
      },
    },
    output: { ...OUT({
      ...DESKTOP_FALLBACK_FIELDS,
      screenshotFile: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      snapshotId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: '本次观察的快照 id（动作可携带 snapshot_id 声明证据基线）。' },
      ...SCREEN_ORIGIN_FIELDS,
      ...IMAGE_FIELD,
    }), render: renderWithImage },
    execute: wrap('screen_observe', (args, cfg2, exec) => screenObserve(ctx, args, cfg2, exec)),
  }))

  ctx.tools.register(defineTool({
    name: 'screen_zoom',
    description:
      '区域截图直读：把窗口某块区域裁成 ≤500px JPEG 交给模型看图（~200 tok，远低于整窗 PNG）。' +
      '用法：①放大细看（小字/图标/图表）；②定位：图内坐标 × crop.scale + crop.x/y + screenOrigin = 屏幕物理像素。' +
      '实证：整窗裸定位误差 median>300px 不可依赖，目标主导的小裁剪误差 13-80px——务必让目标占画面主导。' +
      '视觉断言通道提示：本工具是有损 JPEG，小字号数字常不可读（不可读即如实报 unknown）；读文字请用 screen_observe native（无损 PNG）。'
      + S3_ASSERT_PROTOCOL,
    parameters: {
      pid: { type: 'integer', description: '可选：目标窗口所属进程 pid（screen_observe 输出）；缺省按 window_id 解析。' },
      window_id: { type: 'integer', required: true, description: '目标窗口 id（screen_observe 或 app_list 输出）。' },
      x1: { type: 'integer', description: '可选：区域左边界（整窗截图像素），默认 0。' },
      y1: { type: 'integer', description: '可选：区域上边界，默认 0。' },
      x2: { type: 'integer', description: '可选：区域右边界，默认窗口截图宽。' },
      y2: { type: 'integer', description: '可选：区域下边界，默认窗口截图高。' },
    },
    output: { ...OUT({
      crop: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'integer' }, y: { type: 'integer' },
          w: { type: 'integer' }, h: { type: 'integer' },
          scale: { type: 'number', description: '整窗区域宽 / 返回图宽；图内坐标 × scale + crop.x/y = 整窗截图像素坐标' },
        },
        description: '本图对应的整窗区域与换算比例（定位原语）。',
      },
      ...SCREEN_ORIGIN_FIELDS,
      // 降级路径（窗口级观测被拒 → desktopFallback）会回本组字段，schema 必须容纳
      ...DESKTOP_FALLBACK_FIELDS,
      ...IMAGE_FIELD,
    }), render: renderWithImage },
    execute: wrap('screen_zoom', (args, cfg2, exec) => screenZoom(ctx, args, cfg2, exec)),
  }))
}

/** ── 动作组：computer_* + app_* ── */
function registerActionTools(ctx, cfg, wrap) {
  ctx.tools.register(defineTool({
    name: 'computer_click',
    description: '点击：传入 screen_observe 输出的元素编号（element），或窗口截图像素坐标（x,y）。点击的是 cua-driver 的虚拟光标，不抢真实鼠标。默认后台投递（后台/最小化/隐藏窗口也可点，不抢焦点）；后台不可用时按 deliveryMode（默认 auto）自动升级投递并恢复原前台。',
    parameters: { ...TARGET_PARAMS, ...SNAPSHOT_ID_PARAM, ...FOREGROUND_PARAM, count: { type: 'integer', description: '可选：点击次数，默认 1。' } },
    output: OUT(),
    execute: wrap('computer_click', (args, cfg2) => click(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_double_click',
    description: '双击：element 编号 或 x/y 坐标（后台投递，不抢焦点）。',
    parameters: { ...TARGET_PARAMS, ...SNAPSHOT_ID_PARAM, ...FOREGROUND_PARAM },
    output: OUT(),
    execute: wrap('computer_double_click', (args, cfg2) => doubleClick(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_right_click',
    description: '右键点击：element 编号 或 x/y 坐标（后台投递，不抢焦点）。',
    parameters: { ...TARGET_PARAMS, ...SNAPSHOT_ID_PARAM, ...FOREGROUND_PARAM },
    output: OUT(),
    execute: wrap('computer_right_click', (args, cfg2) => rightClick(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_type',
    description: '文本输入：向当前焦点（或指定元素）输入一段文本。指定 element 时走 UIA ValuePattern 后台写入（不抢焦点，XAML/WinUI 主机必需）；注意：不要在密码框使用——密码必须由用户本人输入（敏感输入保护）。',
    parameters: {
      text: { type: 'string', required: true, description: '要输入的文本。' },
      element: TARGET_PARAMS.element,
      ...SNAPSHOT_ID_PARAM,
      ...FOREGROUND_PARAM,
    },
    output: OUT(),
    execute: wrap('computer_type', (args, cfg2) => typeText(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_key',
    description: '按键 / 快捷键：如 return、tab、escape、cmd+c、shift+tab（默认后台 PostMessage 投递，目标窗口无需前台）。',
    parameters: {
      key: { type: 'string', required: true, description: '按键名或组合（示例: return / cmd+c / shift+tab / cmd+shift+p）。' },
      ...SNAPSHOT_ID_PARAM,
      ...FOREGROUND_PARAM,
    },
    output: OUT(),
    execute: wrap('computer_key', (args, cfg2) => key(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_scroll',
    description: '滚动：在目标窗口内向上/下/左/右滚动。',
    parameters: {
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: '滚动方向，默认 down。' },
      amount: { type: 'integer', description: '可选：滚动格数，默认 3。' },
      element: TARGET_PARAMS.element,
      ...SNAPSHOT_ID_PARAM,
      ...FOREGROUND_PARAM,
    },
    output: OUT(),
    execute: wrap('computer_scroll', (args, cfg2) => scroll(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_drag',
    description: '拖拽：在快照窗口内从 (from_x,from_y) 拖到 (to_x,to_y)，坐标为窗口本地截图像素。',
    parameters: {
      from_x: { type: 'integer', required: true, description: '起点 x（截图像素）。' },
      from_y: { type: 'integer', required: true, description: '起点 y。' },
      to_x: { type: 'integer', required: true, description: '终点 x。' },
      to_y: { type: 'integer', required: true, description: '终点 y。' },
      duration_ms: { type: 'integer', description: '可选：拖拽耗时毫秒，默认 500。' },
      ...SNAPSHOT_ID_PARAM,
      ...FOREGROUND_PARAM,
    },
    output: OUT(),
    execute: wrap('computer_drag', (args, cfg2) => drag(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_wait',
    description: '等待：暂停一段时间（如等待界面加载/动画完成），不调用引擎。',
    parameters: {
      ms: { type: 'integer', required: true, description: '等待毫秒数（1-60000）。' },
    },
    output: OUT(),
    execute: wrap('computer_wait', (args) => wait(args)),
  }))

  ctx.tools.register(defineTool({
    name: 'app_list',
    description: '列出当前正在运行的应用（名称 + pid），用于选择要操作的目标。',
    parameters: {},
    output: OUT({ apps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' }, pid: { type: 'integer' }, active: { type: 'boolean' },
        },
      },
    } }),
    execute: wrap('app_list', () => listApps()),
  }))

  ctx.tools.register(defineTool({
    name: 'app_launch',
    description: '启动一个应用（后台启动，不抢焦点；可选 bring_to_front 前置到前台）。用于"打开应用"这一步。'
      + '注意：驱动本体以管理员权限运行（其二进制清单即要求提权），因此本工具启动的应用会继承**提升后的权限（高完整性级别）**——'
      + '这类窗口在非提权客户端侧无法被关闭/终止（UIPI 拒绝 taskkill/Stop-Process/WM_CLOSE），可能残留并干扰后续观察。'
      + '优先直接操作已在运行的普通应用；确需新启动时，任务结束后请提示用户手动关闭。',
    parameters: {
      name: {
        type: 'string',
        description: '应用显示名（如 "备忘录"）。与 bundle_id 二选一。',
      },
      bundle_id: {
        type: 'string',
        description: '应用 bundle id（如 com.apple.Notes）。优先于 name。',
      },
      bring_to_front: {
        type: 'boolean',
        description: '可选：启动后是否前置到前台（默认 false，后台启动）。',
      },
      creates_new_instance: {
        type: 'boolean',
        description: '可选：强制启动新实例（open -n），用于并发多会话隔离。',
      },
    },
    output: OUT({ pid: { oneOf: [{ type: 'integer' }, { type: 'null' }] } }),
    execute: wrap('app_launch', (args) => launchApp(args)),
  }))
}

/** ── 委派组：computer_task（把一段桌面操作交给一次性子 agent，主上下文只吃一条结果） ── */
function registerTaskTool(ctx, cfg, wrap) {
  ctx.tools.register(defineTool({
    name: 'computer_task',
    description:
      '把一段桌面操作委派给一次性子 agent：主上下文只收到一条紧凑结果（≤300 字 + 证据列表），'
      + '中间的观察树/截图/回执都留在子上下文里随运行结束丢弃。适合"多步、过程噪声大"的操作'
      + '（如"打开记事本把三行文字存到 X 路径""在资源管理器里把 A 移到 B"）。\n'
      + '子 agent 被限定为只能用桌面工具（无命令行/文件直写），且必须以 JSON 收尾'
      + '（{ok, summary, evidence}），宿主按 schema 校验。默认继承当前模型与推理档，可用 model / model_effort 降档。\n'
      + '拿到结果后建议用 computer_verify 或 screen_observe 做一次廉价复核。'
      + '宿主未提供子 agent 能力时本工具会返回委派配方（不执行操作）。',
    parameters: {
      goal: { type: 'string', required: true, description: '要完成的操作目标（含具体路径/名称等要素）。' },
      success_criteria: { type: 'string', description: '可选：完成判据（子 agent 据此自评，并作为证据要求）。' },
      constraints: { type: 'string', description: '可选：附加约束（如"不要改动其它文件""保留原窗口"）。' },
      timeout_min: { type: 'integer', description: '可选：超时分钟数（默认 10，1-60）；到点取消子任务并返回失败。' },
      model: { type: 'string', description: '可选：子 agent 使用的模型 id（默认继承当前）。' },
      model_effort: { type: 'string', description: '可选：子 agent 推理档（如 low/medium/high；默认继承当前）。' },
    },
    output: OUT({
      structured: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean' },
              summary: { type: 'string' },
              evidence: { type: 'array', items: { type: 'string' } },
            },
          },
          { type: 'null' },
        ],
      },
    }),
    execute: wrap('computer_task', (args, cfg2, exec) => runComputerTask(ctx, args, cfg2, exec)),
  }))
}

/** ── 运营组：确定性验证 / 轮询 / 剪贴板 / 菜单 / 悬停 / 强杀 ── */
function registerOpsTools(ctx, cfg, wrap, opsState) {
  ctx.tools.register(defineTool({
    name: 'computer_verify',
    description:
      '确定性验证：对目标窗口求值 1-8 条结构化谓词（AND），驱动走 UIA 判定 satisfied/unsatisfied/unknown；unknown 永不算成功（fail-closed）。' +
      '动作后用它断言状态变化（对话框已出现/按钮已选中/值=…），代替再截图猜。canvas/自绘表面改用视觉断言（按 screen_observe 的视觉断言协议，unknown 永不视为成功）。',
    parameters: { ...VERIFY_PARAMS, include_screenshot: { type: 'boolean', description: '可选：附最终窗口截图作为视觉证据（不参与判定）。' } },
    output: { ...OUT({ ...VERIFY_RESULT, image: IMAGE_FIELD.image }), render: renderWithImage },
    execute: wrap('computer_verify', (args) => verifyOnce(ctx, args)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_wait_for',
    description:
      '谓词轮询等待：反复求值 computer_verify 同款谓词，全部满足即返回（含等待时长与验证次数），超时返回最后一次状态（结构化失败，不伪装成功）。' +
    '用于等待加载/弹窗/状态变化的确定性收敛，替代盲等 computer_wait。',
    parameters: {
      ...VERIFY_PARAMS,
      timeoutMs: { type: 'integer', description: '可选：总超时毫秒，默认 10000，上限 60000。' },
      pollMs: { type: 'integer', description: '可选：轮询间隔下限毫秒，默认 1000（每次验证本身秒级）。' },
    },
    output: { ...OUT({ ...VERIFY_RESULT, attempts: { type: 'integer' }, waitedMs: { type: 'integer' } }) },
    execute: wrap('computer_wait_for', (args) => waitFor(ctx, args)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_clipboard',
    description:
      '系统剪贴板读写。action="write" 写入文本（配合 computer_key ctrl+v 组成"粘贴流"——特殊字符/长文本最可靠的输入路径）；' +
      'action="read" 读取当前剪贴板文本（隐私敏感：结果为系统剪贴板真实内容，用后不要转述）。',
    parameters: {
      action: { type: 'string', enum: ['read', 'write'], required: true, description: 'read = 读取文本；write = 写入文本。' },
      text: { type: 'string', description: 'write 必填：要写入的文本。' },
    },
    output: OUT({ text: { oneOf: [{ type: 'string' }, { type: 'null' }] } }),
    execute: wrap('computer_clipboard', (args) => opsClipboard(args)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_menu',
    description:
      '菜单路径直调：按精确逐级菜单路径（如 ["文件","另存为"]）经无障碍 API 解析并调用最终项。' +
      '失败关闭：缺失/歧义/禁用/结构不匹配即报错，绝不回退像素——比逐级点击菜单更可靠。',
    parameters: {
      pid: { type: 'integer', description: '目标进程 pid。' },
      window_id: { type: 'integer', required: true, description: '目标窗口 id。' },
      path: { type: 'string', required: true, description: '菜单路径 JSON 字符串数组（逐级、精确、区分大小写），如 ["文件","另存为"]。' },
    },
    output: OUT(),
    execute: wrap('computer_menu', (args) => opsMenu(args)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_hover',
    description:
      '悬停（实验性）：移动虚拟光标到窗口本地截图像素 (x,y)。默认仅移动 agent 覆盖层；' +
      'real=true 移动真实 OS 指针（此时 x/y 为屏幕坐标）。能否触发目标应用的真实 hover 效果（工具提示/悬停菜单）取决于应用，未验证。',
    parameters: {
      pid: { type: 'integer', description: '目标进程 pid（默认覆盖层模式需要）。' },
      window_id: { type: 'integer', description: '目标窗口 id（默认覆盖层模式需要）。' },
      x: { type: 'integer', required: true, description: '横坐标（默认=窗口本地截图像素；real=true 时=屏幕坐标）。' },
      y: { type: 'integer', required: true, description: '纵坐标。' },
      real: { type: 'boolean', description: '可选：true = 移动真实 OS 指针（scope=desktop），默认 false 仅移动覆盖层。' },
    },
    output: OUT(),
    execute: wrap('computer_hover', (args) => opsHover(args)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_stop',
    description:
      '强杀开关：立即结束驱动会话（清理虚拟光标/录制）并锁存——之后所有桌面工具（观察/动作/应用）一律拒绝，直至调用 computer_resume。' +
      '用于"立即停止操作桌面"（任务收尾或用户叫停）。锁存期间观察快照清空，解锁后需重新观察。',
    parameters: {},
    output: OUT(),
    execute: wrap('computer_stop', () => opsStop(opsState)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_resume',
    description: '解锁 computer_stop 锁存并预热会话（唯一解锁路径）。解锁后观察快照为空，必须先 screen_observe 再操作。',
    parameters: {},
    output: OUT(),
    execute: wrap('computer_resume', () => opsResume(opsState)),
  }))
}

export function apply(ctx, config) {
  dedupReset()   // 每次 apply 视为全新会话状态（降噪缓存随会话走，避免陈旧哈希被复用）
  const cfg = {
    ttlMs: config.ttlMs,
    maxElements: config.maxElements,
    observeDedup: config.observeDedup || 'summary',
    verboseReceipts: config.verboseReceipts === true,
    taskTimeoutMin: config.taskTimeoutMin,
    supersession: config.supersession || 'note',
    allowedApps: Array.isArray(config.allowedApps) ? config.allowedApps : [],
    cursorTheme: config.cursorTheme,
    nativeImage: config.nativeImage || 'auto',
    visionProvider: config.visionProvider || 'deepseek-official',
    visionModel: config.visionModel || 'deepseek-v4-flash-vision-exp',
    extremeRes: (Array.isArray(config.extremePatterns) ? config.extremePatterns : [])
      .map((p) => new RegExp(p)),
    passwordScan: config.passwordScan || 'auto',
    deliveryMode: config.deliveryMode || 'auto',
  }

  // 初始化虚拟光标：声明统一会话 + 应用主题（异步，不阻塞插件加载）
  cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
  if (cfg.cursorTheme) {
    cuaCall('set_agent_cursor_theme', { session: CUA_SESSION, theme_id: cfg.cursorTheme })
      .catch(() => undefined)
  }

  /** 强杀锁存状态（PLAN-tools-v0.5 §6-D2=B）：stop 后全工具拒绝，resume 唯一解锁。 */
  const opsState = createOpsState()

  /** 统一包装：锁存闸门 → 守卫（注记不阻断）→ 执行实现（exec 透传给需要 route 的实现）。 */
  const wrap = (toolName, impl) => async (args, exec) => {
    try {
      const denied = opsGate(opsState, toolName)
      if (denied) return { ok: false, result: `✗ ${denied}` }
      // 未知参数拒发（宿主参数表不含 additionalProperties，写错的键会被静默忽略，
      // 进而可能回退到非目标窗口/默认值——在桌面自动化里这是不可接受的静默错目标）
      const allowed = toolParamNames.get(toolName) || []
      const unknown = Object.keys(args || {}).filter((k) => !allowed.includes(k) && !k.startsWith('_'))
      if (unknown.length) {
        return {
          ok: false,
          result: `✗ 未知参数 ${unknown.join(', ')}（本工具接受：${allowed.length ? allowed.join(', ') : '无参数'}）。`
            + '参数名不符的键会被静默丢弃并可能回退到默认目标，因此此处直接拒绝——请按上面列出的参数名重发。',
        }
      }
      const g = guard(cfg, toolName, args)
      if (!g.ok) return { ok: false, result: `✗ ${g.reason}` }
      const v = await impl(args, cfg, exec)
      return g.note && v && typeof v.result === 'string' ? { ...v, result: `${v.result}${g.note}` } : v
    } catch (err) {
      return { ok: false, result: `✗ ${err.message}` }
    }
  }

  registerObserveTools(ctx, cfg, wrap)
  registerActionTools(ctx, cfg, wrap)
  registerOpsTools(ctx, cfg, wrap, opsState)
  registerTaskTool(ctx, cfg, wrap)

  ctx.logger?.info('dsh-computer-use: 20 个工具已注册（观察组 screen_observe/zoom · 动作组 computer_click/double/right/type/key/scroll/drag/wait + app_list/launch · 运营组 verify/wait_for/clipboard/menu/hover/stop/resume · 委派组 computer_task）')
}

export default { name, inject, Config, apply }
