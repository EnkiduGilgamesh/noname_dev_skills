# 技能检索工具 + 增量知识库 + 扩展注册

> 在 7206 个已有技能中按语义查找参考实现，把**开发结论沉淀下来**，并**解决"写了扩展却看不到"**的问题。
>
> 四个工具：
> - `skill-search.mjs` —— 检索 + 知识库
> - `register-extension.mjs` —— 扩展注册与修复
> - `build-index.mjs` —— 索引构建
> - `migrate-skill.mjs` —— 迁移打包与迁移自检

---

## 为什么需要它们

### 问题一：技能太多，找不到参考实现

《无名杀》本体 + 扩展共有 **7206 个技能**（6109 个含描述），分布在 12.4 MB 源码里。手工搜索在这个规模下不现实。

### 问题二：写了扩展，游戏里看不到

扩展必须被**登记到配置的 `extensions` 数组**才显示（`apps/core/noname/init/index.ts:635-661`）。
而玩家配置存于**浏览器 `localStorage["noname_0.9_config"]`**，服务端改不了。

### 问题三：游戏内「制作扩展」会覆盖手写文件

该功能（选项→扩展→制作扩展）会无提示覆盖同名扩展的 `extension.js`、`info.json`、`README.md`,
生成空白模板（`character:{}` 空对象、`precontent` 空函数），导致**扩展能打开但选将里找不到武将**。

---

## 快速使用

```bash
cd .dsh/skills/noname-general-extension/scripts

# ═══ 开发时：检索参考实现 ═══
node skill-search.mjs search "摸牌阶段多摸一张牌"
node skill-search.mjs show drlt_jieying
node skill-search.mjs learn --title "..." --body "..." --from rin_baoqiu   # 沉淀结论

# ═══ 写完后：注册扩展 ═══
node register-extension.mjs fix                  # 修复被游戏内覆盖的文件
node register-extension.mjs guideall --enable    # 生成 Console 脚本
# → 把脚本粘贴到浏览器 F12 Console，然后 F5
```

---

## 扩展注册工具

### 两个独立的问题

| 问题 | 症状 | 命令 |
|------|------|------|
| **未登记** | 扩展目录存在，但游戏里完全不出现 | `guideall` / `guide` |
| **被覆盖** | 扩展能打开，但选将界面找不到武将包 | `fix` |

### 命令

```bash
node register-extension.mjs status [名...]    # 检查注册状态
node register-extension.mjs list              # 列出磁盘扩展及状态
node register-extension.mjs fix [名...]       # 修复被「制作扩展」覆盖的 extension.js
node register-extension.mjs guide <名>        # 生成单个扩展的 Console 脚本
node register-extension.mjs guideall          # 批量登记所有含武将的扩展
node register-extension.mjs patch <名>        # 写入 config.json（仅对全新环境有效）
```

`guide` / `guideall` 常用选项：
- `--enable` —— 默认启用（不传则保持关闭状态）
- `--no-auto-import` —— 不开启「自动导入扩展」

### 推荐流程（一次性解决）

```bash
node register-extension.mjs fix                 # 1. 先修复被覆盖的
node register-extension.mjs guideall --enable   # 2. 生成登记脚本
```

把输出的脚本粘贴到浏览器 Console → F5。

**脚本会顺带开启「自动导入扩展」** —— 之后新增的扩展会被自动发现，**这个操作只需做一次**。

### 为什么不能直接改文件

| 存储 | 位置 | 服务端能否修改 |
|------|------|---------------|
| 默认配置模板 | `apps/core/game/config.json` | ✅ 能（`patch` 命令） |
| **玩家实际配置** | 浏览器 `localStorage["noname_0.9_config"]` | ❌ **不能** |

`config.json` 只在**首次运行**时作为默认值，之后一律以 `localStorage` 为准。
所以 `guide` 走的是"生成脚本给你在浏览器执行"的路线。

---

## 技能检索工具

### `search` — 语义搜索

```bash
node skill-search.mjs search "<语义描述>" [选项]
```

输出分两段：

```
📘 知识库命中 N 条（指纹校验通过）     ← 已沉淀的结论
⚠️  知识库有 M 条已失效（跳过）        ← 需处理
🔍 技能索引命中 K 条                    ← 实际技能
```

| 选项 | 说明 |
|------|------|
| `--limit N` | 返回条数，默认 12 |
| `--source X` | `character` / `extension` / `core` / `all` |
| `--impl` | 仅返回**有实现**的技能 |
| `--no-kb` | 跳过知识库，只查索引 |
| `--json` | JSON 输出 |

**检索能力**：
- **中文语义**：支持长句、短句、关键词
- **英文/字段名**：`viewAs`、`cost`、`mod`、`forced`、`phaseDrawBegin` 等
- **自动同义词扩展**：搜"摸牌"也匹配 `draw`；搜"锁定技"也匹配 `forced`
- **特征参与匹配**：搜 `viewAs` 能命中所有视为技

### `show` — 查看实现

```bash
node skill-search.mjs show <技能ID>
```

输出：技能元信息 + **带行号的完整源码**。支持模糊匹配。

### `similar` — 找同类技能

基于**描述相似度 + 触发时机重合 + 结构特征重合**推荐。

### `learn` — 沉淀结论

```bash
node skill-search.mjs learn --title T --body B [选项]
```

| 选项 | 说明 |
|------|------|
| `--kind` | `pattern` / `pitfall` / `recipe` / `fact`（默认 `fact`） |
| `--keywords` | 逗号分隔的关键词 |
| `--from ID` | 技能 ID（可多次），生成**证据指纹** |

### `stats` / `rebuild`

```bash
node skill-search.mjs stats      # 索引统计
node skill-search.mjs rebuild    # 源码变更后重建索引
```

---

## 增量知识库

### 设计目标

让检索结论**可沉淀、可复用**，同时**不会因源码变动而误导**。

### 核心机制：证据指纹

每条知识记录其依据的源码位置与**内容哈希**。读取时重新计算：

| 状态 | 含义 | 行为 |
|------|------|------|
| `fresh` | 指纹一致 | 正常命中 |
| `stale` | 源码内容已变动 | **跳过并警告**，回退索引检索 |
| `missing` | 依据文件不存在 | 同上 |

**知识库只会加速，不会误导。**

### 知识类型

| 类型 | 用途 |
|------|------|
| `pattern` | 写法结论 |
| `pitfall` | 坑点 |
| `recipe` | 需求→推荐技能 |
| `fact` | 项目事实 |

---

## 检索策略建议

```
① 用「功能语义」搜，而不是「技能名」
② 先看 📘 知识库区块 —— 可能已有现成结论
③ 再看 🔍 索引结果，挑 1-2 个最接近的
   · 优先选「特征」字段齐全的
   · 优先选 moderned 包（standard / refresh / bingshi / clan）
④ show 查看实现，对照改写
⑤ 用 similar 找结构类似的
⑥ 【必做】learn 沉淀本次得到的结论
```

| 想找 | 搜索词 |
|------|--------|
| 视为技 | `viewAs` 或 "将一张牌当" |
| 主动技 | `enable` 或 "出牌阶段限一次" |
| 有代价的技能 | `cost` 或 "你可以弃置一张" |
| 锁定技 | `forced` 或 "锁定技" |
| 改数值的技能 | `mod` 或 "手牌上限" |
| 限定技 | `limited` 或 "限定技" |
| 特定时机 | 直接搜时机名 `phaseDrawBegin` / `damageEnd` |

---

## 迁移到其他机器

> **一句话**：拷 8 个文件（约 120 KB）过去，运行一次 `build-index.mjs`，完事。

### 哪些文件要带

| 类别 | 文件 | 大小 | 是否迁移 |
|------|------|------|---------|
| **核心技能** | `SKILL.md` | 17.6 KB | ✅ 必须 |
| **可执行工具** | `skill-search.mjs` | 28.4 KB | ✅ 必须 |
| | `build-index.mjs` | 11.8 KB | ✅ 必须 |
| | `knowledge.mjs` | 8.0 KB | ✅ 必须 |
| | `register-extension.mjs` | 17.5 KB | ✅ 必须 |
| | `migrate-skill.mjs` | 11.6 KB | ✅ 必须 |
| **知识沉淀** | `knowledge-base.json` | 17.1 KB | ✅ 必须 |
| **说明** | `scripts/README.md` | 7.9 KB | ✅ 推荐 |
| **索引产物** | `skill-index.json` | 5.9 MB | ❌ **不要带** |
| **生成物** | `register-*.js` | ~2 KB | ❌ 不要带 |

**合计迁移体积：约 120 KB**（不含索引）。

### 为什么索引不要带

`skill-index.json` 里硬编码了构建机器的绝对路径 `root` 字段。
带到新机器后，`show` 命令会去读**原机器的文件路径** —— 要么报错，要么（更糟）静默读到错误内容。

索引是**派生产物**，任何时候都能从源码重新生成，所以永远重新构建，不要拷贝。

> `skill-search.mjs` 已做防护：启动时用 `findProjectRoot()` 动态定位项目根
> （依次尝试 `cwd` → 脚本自身位置 → 索引里的 `root`），
> 当索引 `root` 与实际项目根不一致时会打印警告，避免静默读错文件。

### 迁移步骤

```bash
# ═══ 在【源机器】上：打包 ═══
node migrate-skill.mjs pack                 # 生成 skill-migration.zip
node migrate-skill.mjs pack --out D:\tmp\x.zip

# ═══ 传输 ═══
# 把 zip 拷到新机器（U 盘 / 网盘 / scp / git）

# ═══ 在【新机器】上：解压 + 构建 ═══
# 解压到 <新项目根>/.dsh/skills/noname-general-extension/
cd <新项目根>/.dsh/skills/noname-general-extension/scripts
node migrate-skill.mjs check                # 自检：路径、依赖、文件完整性
node build-index.mjs                        # 重建索引（约 10-30 秒）
```

**完成。** 之后 `search` / `show` / `learn` 全部可用。

### 从独立仓库一键安装

技能也发布为独立仓库（**非**《无名杀》本仓库）。克隆后用 `install.mjs` 一步装好：

```bash
git clone <独立仓库> nge
node nge/install.mjs --target <《无名杀》项目根>

# 可选参数
#   --force      覆盖已存在的文件
#   --no-index   只装文件，不自动构建索引
```

`install.mjs` 会：校验目标目录确实是《无名杀》项目根 → 复制 9 个文件 →
自动构建索引。**知识库默认保留目标机器上已有的**（不覆盖，避免丢失已沉淀结论），
需覆盖时显式加 `--force`。

### 独立仓库形态 vs 项目内形态

| | 项目内技能（`<项目>/.dsh/skills/`） | 独立仓库 |
|---|---|---|
| 定位项目根 | 从脚本位置向上自动找到 | **必须** `--root` 或从项目内运行 |
| 索引输出 | 脚本旁 | 脚本旁（跟随脚本，非跟随 ROOT） |
| 额外文件 | — | `install.mjs` / `package.json` / `LICENSE` / `.gitattributes` |
| 用途 | 随项目一起开发 | 分发给他人 |

两种形态共用同一套脚本 —— 脚本全部以**自身所在目录**定位，不含对 `ROOT` 的位置假设。

### 迁移自检

```bash
node migrate-skill.mjs check
```

检查项：

| 检查 | 说明 |
|------|------|
| **硬编码路径** | 扫描脚本里是否残留源机器的绝对路径 |
| **外部依赖** | 确认只用 Node.js 内置模块（`node:` 前缀） |
| **文件完整性** | 6 个核心文件是否齐全 |
| **项目根可达性** | 能否从当前位置定位到《无名杀》源码 |

输出 `0 issues` 即表示可安全迁移。

### 命令一览

```bash
node migrate-skill.mjs info     # 列出所有文件，按「迁移/生成/垃圾」分类
node migrate-skill.mjs check    # 迁移自检
node migrate-skill.mjs pack     # 打包成 zip（自动排除索引与生成物）
node migrate-skill.mjs export   # 导出到指定目录（不压缩）
```

### 迁移到「另一个项目」注意

如果新机器的《无名杀》源码**目录结构不同**（比如不是 `apps/core/...`），
需要改 `build-index.mjs` 里的扫描路径常量。用 `check` 命令会提示这一点。

### 用 git 迁移（推荐）

如果新机器上能克隆同一份仓库，**什么都不用做** —— 技能就在仓库里，`git clone` 即可。
只有**跨仓库**迁移（新机器上是另一个《无名杀》版本）才需要上面的打包流程。

---

## 实现说明

| 文件 | 作用 |
|------|------|
| `build-index.mjs` | 索引构建器：解析技能定义 + 关联描述 |
| `skill-search.mjs` | 检索引擎与 CLI |
| `knowledge.mjs` | 知识库模块（指纹计算/校验） |
| `register-extension.mjs` | 扩展注册与修复 |
| `migrate-skill.mjs` | 迁移打包与自检 |
| `skill-index.json` | 索引产物（约 6 MB，**不入库**） |
| `knowledge-base.json` | 知识库（**应入库**） |
| `register-*.js` | 生成的 Console 脚本（**不入库**） |

### 索引包含什么

| 字段 | 说明 |
|------|------|
| `id` / `name` | 技能 ID 与中文名 |
| `desc` | 纯文本描述 |
| `source` / `pack` / `file` / `line` / `endLine` | 来源与精确位置 |
| `triggers` | 触发时机列表 |
| `hasCost` / `hasViewAs` / `hasMod` / ... | 结构特征 |
| `forced` / `limited` / `juexingji` | 特殊标记 |
| `apis` | 关键 API 调用 |

### 解析可靠性

技能定义在源码中的形态**高度规整**：

```
顶层技能：1 个 Tab 缩进 + `name: {`
子技能：  2 个 Tab 缩进
```

解析器用**花括号配平**（跳过字符串与注释）定位块边界。

当前解析结果：**7206 个技能，6109 个含描述（84.8%）**。

### 依赖

零外部依赖，仅用 Node.js 内置模块。需要 Node ≥ 18。
