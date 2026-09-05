# ARCHITECTURE — dsh-computer-use

> 结构快照：v0.5.1（19 工具，依赖单向 DAG：`index.js → lib → cua-driver`，无环、无兼容层）。

## 1. 模块清单

| 文件 | 行数 | 职责 | 依赖 |
|---|---:|---|---|
| `index.js` | 548 | 配置 schema、三组注册工厂（观察组 2 / 动作组 10 / 运营组 7）、wrap 统一管线（锁存闸门→守卫→注记回填） | observe / actions / ops / guard / cua |
| `lib/observe.js` | 583 | `screenObserve`（模式决策+降级链）、`screenZoom`（定位原语）、桌面级兜底 | cua / snapshot / attach / vision |
| `lib/actions.js` | 309 | 10 个动作工具实现（click/type/key/scroll/drag/wait/app_*） | cua / human / snapshot |
| `lib/ops.js` | 180 | 确定性验证（verify/wait_for）、剪贴板、菜单直调、悬停、强杀锁存 | cua / snapshot / attach |
| `lib/cua.js` | 221 | 驱动定位（resolveBin）、会话管理、**三级投递链 cuaDeliver**、错误规范化 | node 内置 |
| `lib/guard.js` | ~80 | 凭据硬保护（密码框）、极危注记、allowedApps 白名单 | snapshot |
| `lib/human.js` | 120 | 虚拟光标轨迹/点击瞄准（windowLocalOf/screenPointOf） | cua / snapshot |
| `lib/vision.js` | ~230 | native 直读 / dsv4fv 观察者 / GLM 兜底（env-only key） | node 内置 |
| `lib/snapshot.js` | 77 | 单窗口快照 + TTL（引擎侧 element_token 双重校验） | — |
| `lib/attach.js` | 25 | 图片持久化统一出口（attachments.saveImage + 输出块装配） | — |
| `tests/*.smoke.mjs` | 343 | 离线 stub 冒烟：tools(15) / posture(14) / delivery-chain(3) | — |

## 2. 分层与依赖

```mermaid
graph LR
  subgraph HOST["dsh harness 宿主"]
    MODEL["对话模型 (agent)"]
    ATT["attachments 服务"]
    LLMSVC["llm 服务 (ctx.llm)"]
  end

  subgraph IDX["index.js — 注册与管线"]
    REG["三组注册工厂<br/>观察组 2 · 动作组 10 · 运营组 7"]
    WRAP["wrap 统一管线"]
    CFG["Config<br/>ttlMs / deliveryMode / extremePatterns…"]
  end

  subgraph LIB["lib/* 领域模块"]
    OBS["observe.js<br/>screenObserve / screenZoom"]
    ACT["actions.js + human.js<br/>10 个动作 · 光标瞄准"]
    OPS["ops.js<br/>verify / wait_for / clipboard<br/>menu / hover / stop-resume"]
    GUARD["guard.js<br/>凭据硬保护 · 极危注记"]
    SNAP["snapshot.js<br/>单窗口快照 + TTL"]
    VIS["vision.js<br/>native / 观察者 / GLM 兜底"]
    ATTACH["attach.js<br/>图片持久化"]
    CUA["cua.js<br/>resolveBin · 会话 · 三级投递链"]
  end

  DRIVER["cua-driver daemon<br/>named pipe · 0.23.2"]
  OS["Windows<br/>UIA · SendInput · PostMessage · 剪贴板"]

  MODEL -- "tool call" --> REG
  CFG --> REG
  REG --> WRAP
  WRAP -->|"锁存闸门 → 守卫 → impl"| OBS
  WRAP --> ACT
  WRAP --> OPS
  GUARD --> SNAP
  OBS --> SNAP & VIS & ATTACH & CUA
  ACT --> HUMAN2 & SNAP & CUA
  OPS --> SNAP & ATTACH & CUA
  VIS --> LLMSVC
  ATTACH --> ATT
  OBS -.-> LLMSVC
  CUA -->|"named pipe (JSON)"| DRIVER
  DRIVER --> OS

  HUMAN2["human.js<br/>轨迹/瞄准"]
```

## 3. 动作请求流水线（以 computer_click 为例：三级投递链）

```mermaid
sequenceDiagram
  autonumber
  participant M as 模型
  participant W as wrap 管线
  participant G as guard
  participant A as actions.click
  participant D as cuaDeliver
  participant V as cua-driver

  M->>W: computer_click(element=5)
  W->>W: 锁存闸门（stopped → 全拒，resume 除外）
  W->>G: 凭据硬保护 / 极危注记 / allowedApps
  G-->>W: 通过（可附注记）
  W->>A: click(args, cfg)
  A->>D: cuaDeliver("click", payload, deliveryMode)

  D->>V: L1 background（UIA pattern / PostMessage，不抢焦点）
  alt background_unavailable
    D->>V: L2 foreground（SendInput + 激活）
    alt foreground_unavailable（前台锁）
      D->>V: L3 bring_to_front（AttachThreadInput 绕锁）
      D->>V: click（foreground）
      D->>V: bring_to_front（恢复原前台窗口）
    end
  end

  D-->>A: value + note（升级/未验证注记）
  A-->>W: ok + result
  W-->>M: 结构化回执（投递过程全量注记）
```

## 4. 观测流水线（screen_observe：模式决策与降级链）

```mermaid
flowchart TD
  A["screen_observe(window?, mode?)"] --> B["list_windows → 选目标（参数 / z 序最前）"]
  B --> C["driverAccess 探测（check_permissions，只读）"]
  C --> D["get_window_state（AX 树 + 可选截图）"]
  D -->|失败| E["桌面级降级 get_desktop_state<br/>visualOnly · 坐标不可动作"]
  D -->|成功| F["isActionable 过滤 → 编号元素"]
  F --> G{"树空 / 降级？且模型可看图？"}
  G -->|是| H["补抓截图"]
  G -->|否| I["resolveObserveMode"]
  H --> I
  I -->|mode=ax| J["cacheSnapshot → 文本编号树"]
  I -->|mode=native| K["commitScreenshot → 图片块直读"]
  I -->|mode=vision| L["dsv4fv 观察者 → 失败回退 GLM"]
  J --> M["快照 TTL 60s · 返回（附 driverAccess / visualOnly）"]
  K --> M
  L --> M
```

## 5. 强杀锁存状态机（0.5.0）

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Running: 插件加载
  Running --> Running: 18 个工具正常服务
  Running --> Stopped: computer_stop<br/>（end_session + 清快照 + 落锁）
  Stopped --> Stopped: 其余工具一律拒绝（闸门在守卫之前）
  Stopped --> Running: computer_resume（唯一解锁 + 预热会话）
  Running --> [*]: 配置重载 / 进程退出
```

## 6. 设计不变量

1. **依赖单向**：`index.js → lib → cua-driver`，lib 内无环；`snapshot.js / attach.js / vision.js` 为零内部依赖叶子。
2. **闸门顺序恒定**：锁存 → 守卫 → 实现——任何新工具自动继承，无旁路。
3. **fail-closed**：验证 unknown ≠ 成功；投递失败结构化回执；菜单直调不回退像素。
4. **归因**：所有升级/降级/未验证/凭据邻近事件以注记进结果与会话日志。
