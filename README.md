# dsh-computer-use

> DeepSeek Harness 的 Computer Use 插件 —— 给 harness-desktop 增加"**虚拟鼠标真人操作**"能力：
> AI 生成独立光标，像人一样看屏幕、移动、点击、输入，替用户操作电脑。

跨平台（macOS / Windows / Linux），引擎基于 [cua-driver](https://github.com/trycua/cua)（MIT 开源，MCP 标准接口）。

## ✨ 能力

| 工具 | 功能 |
|------|------|
| `screen_observe` | 看屏幕：AX 编号树 + 坐标；支持三模：**native 原生直读**（截图直接进模型上下文）/ vision 视觉观察者 / ax 零成本树 |
| `screen_zoom` | 区域截图直读：裁剪窗口某区域为 ≤500px JPEG 直接给模型看图（细节放大、省 token） |
| `computer_click` / `computer_double_click` / `computer_right_click` | **真人操作**：独立光标滑行到目标 + 像素级真实点击（看得见过程） |
| `computer_type` | 文本输入（密码框自动拒绝） |
| `computer_key` | 按键 / 快捷键（return、cmd+c…；聊天窗口回车发送） |
| `computer_scroll` | 滚动 |
| `computer_drag` | 拖拽 |
| `computer_wait` | 等待 |
| `app_list` / `app_launch` | 列出 / 启动应用 |

**核心设计**：AX 树只用于"看"（定位元素），操作走**像素级虚拟光标**——光标滑行动画 + 真实点击，模拟真人操作。内置**彩虹渐变动态光标**主题（可自定义）。

### 👁 三种观察模式

`screen_observe` 的 `mode` 参数选择看屏幕的方式：

| mode | 原理 | 成本 | 适用 |
|------|------|------|------|
| `ax`（默认） | AX 界面树：编号 + 控件 + 坐标 | 零视觉 token | 绝大多数原生应用 |
| `native` | 截图经 attachments 持久化后以**图片块**返回，**当前对话模型直接看图** | 图片 token | 主模型是视觉模型（如 `deepseek-v4-flash-vision-exp`）；游戏/Canvas/Electron 等无 AX 树的界面 |
| `vision` | **DeepSeek 视觉观察者**（ctx.llm 调默认 `deepseek-v4-flash-vision-exp`）结构化描述截图，输出元素列表 | 一次额外模型调用 | 主模型非视觉模型但想看图；或无外部 key |

- **原生接入**：`native` 模式走 harness 的 attachments + 图片内容块链路（与 `read_image` 同一机制），**零外部 API、零额外 key、无限流**，理解质量 = 当前对话模型。
- **自动降级**：AX 树为空（游戏/Canvas/Electron 不可解析）时，自动按 `native → vision → ax` 降级，无需手动切换。
- `vision` 模式观察者不可用时自动回退 GLM 免费模型（需 `ZHIPU_API_KEY`，仅作最后兜底）。

### 🖱 坐标语义（v0.2.0 起，cua-driver 0.21+）

所有坐标一律为**窗口本地截图像素**（与 `get_window_state` 返回的截图同一空间，左上原点）。模型所见即所点：`screen_observe` 输出的 `@(x,y)`、视觉识别坐标、`computer_click(x=,y=)` 全部同一空间，不再做 ×2 或窗口偏移换算（旧版固定 2.0 系数的近似校准已移除）。

## 🛡 安全设计

1. **虚拟光标隔离**：操作走 cua-driver 的独立 Agent 光标，不抢真实鼠标
2. **观察快照 TTL**：快照约 15 秒过期，过期后动作被拒绝，必须重新观察（引擎侧 element_token 双重校验）
3. **区域限制**：可选 `allowedApps` 白名单，名单外的应用操作一律拒绝（fail closed）
4. **危险操作审批**：目标标签命中"删除/支付/转账/退出登录…"危险词时，经 dsh 审批服务征询用户，未批准不放行
5. **敏感输入保护**：密码框（AXSecureTextField）拒绝自动输入——密码/密钥永不让模型接触
6. **无快照拒绝**：任何动作必须先 `screen_observe`，杜绝盲操作

> ⚠️ **作用范围说明**：危险词审批与密码框保护基于观察到的**元素标签**，仅对 `element` 编号模式生效；`x/y` 坐标模式与无目标输入（`computer_type` / `computer_key` 落到前台应用）无法预知目标内容，由快照 TTL 与"操作可见"兜底。`computer_key` 不校验快捷键本身（如 cmd+q 等系统快捷键），请勿授予不可信模型。这是设计取舍：安全优先级 = 元素语义 > 坐标盲操作，但坐标模式保留了真人可视操作的自由度。

## 📦 安装

前提：
- harness-desktop（含 dsh rc 运行时）
- cua-driver 已安装（官方安装见 [trycua/cua](https://github.com/trycua/cua)）且权限已授权（macOS：Accessibility + Screen Recording；Windows：普通用户权限运行）
- 插件默认从 PATH 查找 `cua-driver`；若二进制不在 PATH，设 `CUA_DRIVER_BIN=/path/to/cua-driver`（Windows 常用）

```bash
# 一键安装（home 级用户 patch 层注入，不修改任何 profile 配置）
./install.sh            # 预演: ./install.sh --dry-run
# 卸载
./uninstall.sh
# 安装后重启 harness-desktop 生效
```

> **Windows / Linux**：`install.sh` 的默认 `DSH_HOME` 是 macOS 路径。Windows（Git Bash / WSL）与 Linux 用户请先 `export DSH_HOME=<你的 dsh home 目录>` 再运行脚本；或手动两步（见下），两步与平台无关。

脚本做的事（也可手动）：
1. `ln -sfn <插件目录> "$DSH_HOME/profiles/web/node_modules/dsh-computer-use"`
2. 在 `$DSH_HOME/cordis.patch.yml`（dsh 的机器级用户 patch 层）insert 插件注册

可选配置（`$DSH_HOME/cordis.patch.yml` 中覆盖）：

```yaml
- id: dsh-computer-use
  config:
    ttlMs: 30000        # 快照有效期（毫秒，多步 UI 操作建议 30-60s）
    maxElements: 500    # screen_observe 最大编号元素数
    allowedApps: []     # 区域限制白名单（空 = 不限制）
    cursorTheme: com.dsh.computeruse.rainbow  # 虚拟光标主题（空 = 引擎默认）
    nativeImage: auto   # 原生直读截图策略：auto（PNG 超限额自动降级 ≤500px JPEG）/ full / compact
    visionProvider: deepseek-official  # Mode D 观察者 provider 路由
    visionModel: deepseek-v4-flash-vision-exp  # Mode D 观察者模型（需声明 image 输入）
```

## 📸 原生视觉模型接入（v0.2.0）

`mode="native"` / `mode="vision"` 无需任何外部 key —— 使用 **DeepSeek 原生视觉模型**：

1. **把 `deepseek-v4-flash-vision-exp` 注册进 harness**（v0.2.0 起已内置在 `llm-deepseek` 默认目录：`input: [text, image]`，Web 模型选择器直接可见可切换）。老版本 harness 可在 `settings.yaml` 的 `llm-pi-ai:` 下用 `modelOverrides` 声明：

   ```yaml
   llm-pi-ai:
     providers:
       deepseek:
         apiKeyEnv: DEEPSEEK_API_KEY
         models:
           - id: deepseek-v4-flash
           - id: deepseek-v4-flash-vision-exp
             input: [text, image]
   ```

2. **Mode C 原生直读**：`screen_observe(mode="native")` → 截图以图片块进入对话，**当前对话模型直接看图**（把对话模型切到视觉模型即可，无需配置）。

3. **Mode D 观察者**：`screen_observe(mode="vision")` → 插件经 `ctx.llm` 调 `visionModel`（默认 `deepseek-v4-flash-vision-exp`）结构化描述截图；观察者不可用时自动回退 GLM。

> 截图经 harness `attachment-local` 持久化（默认单图 5MB/40M 像素；超限自动用引擎 `zoom` 降级为 ≤500px JPEG）。`screen_zoom` 工具提供区域截图直读（细节放大、省 token）。

## 🎨 光标主题（可选）

内置**彩虹渐变指针**主题（`com.dsh.computeruse.rainbow`，128×128，12 个动作动画，颜色流动），产物 `theme.lottie` 已随仓库附带。
- 插件启动自动应用（配置 `cursorTheme`，空 = 引擎默认；**未安装该主题时自动回退引擎默认光标**，不影响功能）
- 安装主题：需经 cua-driver 的 cursor-theme 编译器安装 `theme.lottie`（编译器随引擎提供，命令见 [trycua/cua](https://github.com/trycua/cua) 文档）
- 自定义：`python3 tools/make_theme.py --output theme.lottie`（改颜色/形状）→ 按上述方式安装

## ⚠️ 已知局限

- **Windows / Linux 待真机实测**（引擎官方支持，指南见 `WINDOWS_TEST.md`）
- **原生直读的图片 token 成本**：整窗截图（尤其 Retina）每次进上下文会消耗图片 token；需要高频轮询的场景建议 ax 模式 + `query` 过滤，或 `screen_zoom` 只看局部
- **AX 安全检测仅对 element 编号模式生效**：坐标模式与无目标输入（`computer_type` / `computer_key` 落前台）由快照 TTL 与"操作可见"兜底（见上"安全设计"）
- macOS 计算器等窗口显示屏不在 AX 树（用 `mode="native"` 直读即可）

## 🧪 开发与验证

项目采用"隔离 profile"开发（不动真实 GUI 配置）：

```bash
# 用隔离 DSH_HOME 起 headless 会话验证
DSH_HOME=$PWD/.dsh-p0 ELECTRON_RUN_AS_NODE=1 \
  /Applications/harness-desktop.app/Contents/MacOS/harness-desktop --expose-internals \
  /Applications/harness-desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile test "请调用 screen_observe 观察当前窗口并报告"
```

## 📄 License

MIT

---

## 🌐 相关链接

- GitHub：https://github.com/988hj7tczd-oss/dsh-computer-use
- Gitee 镜像（国内加速）：https://gitee.com/jerryweizhihao/dsh-computer-use
- npm：https://www.npmjs.com/package/dsh-computer-use
- AI House 独立站（AI 工具排行榜）：https://www.aibunkhouse.com/
- harness-desktop（DeepSeek Harness 桌面端）：https://github.com/988hj7tczd-oss/harness-desktop
- awesome-dsh-plugin（DeepSeek Harness 插件精选列表）：https://github.com/988hj7tczd-oss/awesome-dsh-plugin
