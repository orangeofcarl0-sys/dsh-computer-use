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
import { defineTool } from '@deepseek-ai/dsh-tools'

import { screenObserve, screenZoom } from './lib/observe.js'
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
  /** screen_observe 最多返回多少编号元素。 */
  maxElements: z.number().default(500),
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
    description: '可选：本次动作强制前台投递（驱动短暂交换焦点后自动恢复原前台）。默认按 deliveryMode：background=不抢焦点 / auto=后台不可用时自动升级一次。',
  },
}

/** 统一的坐标/编号参数块（坐标 = 窗口本地截图像素）。 */
const TARGET_PARAMS = {
  element: {
    type: 'integer',
    description: 'screen_observe 输出的元素编号（如 5）。与 x/y 二选一，优先。',
  },
  x: {
    type: 'integer',
    description: '窗口本地截图像素 x（screen_observe 的截图坐标系，模型所见即所点）。与 element 二选一。',
  },
  y: {
    type: 'integer',
    description: '窗口本地截图像素 y。',
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
    description: '谓词数组 JSON（1-8 条，AND）。元素谓词：{"element":{"selector":{"role":"按钮","label_contains":"确定"},"exists":true,"enabled":true,"selected":null,"value_equals":null}}（exists 仅接受 true——absence 无法证明，缺失返回 unknown）；窗口谓词：{"window":{"exists":true,"bounds":{"x":0,"y":0,"width":100,"height":50,"tolerance_px":10}}}。',
  },
}

/** ── 观察组：screen_observe / screen_zoom ── */
function registerObserveTools(ctx, cfg, wrap) {
  ctx.tools.register(defineTool({
    name: 'screen_observe',
    description:
      '观察屏幕：对目标窗口生成"编号 + 控件 + 坐标"的界面树（AX 语义，零视觉 token 成本）。' +
      '操作电脑前必须先调用本工具取得快照；之后用 computer_click(element=[编号]) 或 computer_click(x=,y=) 操作（坐标为窗口本地截图像素）。' +
      'mode 选择：ax（默认，零成本树）/ vision（DeepSeek 视觉观察者结构化描述，免 ZHIPU key）/ native（截图直读，当前对话模型直接看图，需模型支持图片输入）。' +
      'AX 树无法解析（游戏/Canvas/Electron）时自动降级：native（若当前模型支持图片）→ vision → ax。' +
      '快照默认 60 秒过期，过期后需重新观察。',
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
        description: '可选：最多返回多少个编号元素（防上下文爆炸）。',
      },
    },
    output: { ...OUT({
      window: { type: 'object', additionalProperties: false, properties: {
        pid: { type: 'integer' }, windowId: { type: 'integer' },
        app: { type: 'string' }, title: { type: 'string' },
      } },
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
      screenshotFile: { oneOf: [{ type: 'string' }, { type: 'null' }] },
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
        description: '附驱动权限面（cua-driver check_permissions 只读探测；探测失败为 null）。',
      },
      ...IMAGE_FIELD,
    }), render: renderWithImage },
    execute: wrap('screen_observe', (args, cfg2, exec) => screenObserve(ctx, args, cfg2, exec)),
  }))

  ctx.tools.register(defineTool({
    name: 'screen_zoom',
    description:
      '区域截图直读：裁剪窗口某块区域（截图像素坐标）为 ≤500px JPEG 并以图片返回，当前对话模型直接看图。' +
      '两种用法：①"放大某块区域细看"（小字、图标、图表），图片 token 远小于整窗截图；' +
      '②定位原语（树空/像素目标推荐路径）：在本图内语义确认目标后，取"图内坐标 × crop.scale + crop.x/y"得到整窗截图像素坐标，再 computer_click(x=,y=)。' +
      '实证依据：主模型整窗裸定位误差大（median>300px）不可依赖，目标主导的小裁剪定位误差 13-80px——裁剪务必让目标占画面主导。',
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
    parameters: { ...TARGET_PARAMS, ...FOREGROUND_PARAM, count: { type: 'integer', description: '可选：点击次数，默认 1。' } },
    output: OUT(),
    execute: wrap('computer_click', (args, cfg2) => click(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_double_click',
    description: '双击：element 编号 或 x/y 坐标（后台投递，不抢焦点）。',
    parameters: { ...TARGET_PARAMS, ...FOREGROUND_PARAM },
    output: OUT(),
    execute: wrap('computer_double_click', (args, cfg2) => doubleClick(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_right_click',
    description: '右键点击：element 编号 或 x/y 坐标（后台投递，不抢焦点）。',
    parameters: { ...TARGET_PARAMS, ...FOREGROUND_PARAM },
    output: OUT(),
    execute: wrap('computer_right_click', (args, cfg2) => rightClick(args, cfg2)),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_type',
    description: '文本输入：向当前焦点（或指定元素）输入一段文本。指定 element 时走 UIA ValuePattern 后台写入（不抢焦点，XAML/WinUI 主机必需）；注意：不要在密码框使用——密码必须由用户本人输入（敏感输入保护）。',
    parameters: {
      text: { type: 'string', required: true, description: '要输入的文本。' },
      element: TARGET_PARAMS.element,
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
    description: '启动一个应用（后台启动，不抢焦点；可选 bring_to_front 前置到前台）。用于"打开应用"这一步。',
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

/** ── 运营组：确定性验证 / 轮询 / 剪贴板 / 菜单 / 悬停 / 强杀 ── */
function registerOpsTools(ctx, cfg, wrap, opsState) {
  ctx.tools.register(defineTool({
    name: 'computer_verify',
    description:
      '确定性验证：对目标窗口求值 1-8 条结构化谓词（AND），驱动走 UIA 树判定 satisfied / unsatisfied / unknown。' +
      'unknown（元素缺失/树不完整）永不视为成功——fail-closed。动作后用它断言状态变化（如"对话框已出现""按钮已选中""输入框值=…"），' +
      '代替"再截一张图自己猜"。每次验证是一次完整 UIA 走查（秒级）。',
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
  const cfg = {
    ttlMs: config.ttlMs,
    maxElements: config.maxElements,
    allowedApps: Array.isArray(config.allowedApps) ? config.allowedApps : [],
    cursorTheme: config.cursorTheme,
    nativeImage: config.nativeImage || 'auto',
    visionProvider: config.visionProvider || 'deepseek-official',
    visionModel: config.visionModel || 'deepseek-v4-flash-vision-exp',
    extremeRes: (Array.isArray(config.extremePatterns) ? config.extremePatterns : [])
      .map((p) => new RegExp(p)),
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

  ctx.logger?.info('dsh-computer-use: 19 个工具已注册（观察组 screen_observe/zoom · 动作组 computer_click/double/right/type/key/scroll/drag/wait + app_list/launch · 运营组 verify/wait_for/clipboard/menu/hover/stop/resume）')
}

export default { name, inject, Config, apply }
