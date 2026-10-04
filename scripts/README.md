# 技能检索工具 + 增量知识库 + 扩展注册

> 在 6700+ 个已有技能中按语义查找参考实现，把**开发结论沉淀下来**，**验证技能是否写对**，并**解决"写了扩展却看不到"**的问题。
>
> 六个工具：
> - `skill-search.mjs` —— 检索 + 定位 + 知识库
> - `verify-skill.mjs` —— 技能静态验证
> - `kb-lint.mjs` —— 知识库体检（结构 / 指纹 / 引用 / 检索性 / 矛盾 / 未完成标记）
> - `register-extension.mjs` —— 扩展注册与修复
> - `build-index.mjs` —— 索引构建
> - `migrate-skill.mjs` —— 迁移打包与迁移自检

---

## 为什么需要它们

### 问题一：技能太多，找不到参考实现

《无名杀》本体 + 扩展共有 **7304 个技能**（6171 个含描述），分布在 12 MB 源码里。手工搜索在这个规模下不现实。

### 问题二：技能写了，但不知道写得对不对

语法没错 ≠ 技能能用。常见缺陷：武将引用了不存在的技能 ID、改了实现忘了改描述、
子技能没挂进父技能 `group`。这些**静态可查**，但不查就只能在游戏里撞见。

### 问题三：写了扩展，游戏里看不到

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
node skill-search.mjs locate 天妒                                            # 改技能：一次拿到全部坐标
node skill-search.mjs show drlt_jieying
node skill-search.mjs learn --title "..." --body "..." --from rin_baoqiu     # 沉淀结论

# ═══ 写完后：验证 ═══
node verify-skill.mjs --pack 英雄杀RE            # 静态验证
node kb-lint.mjs                                 # 知识库体检
node skill-search.mjs rebuild                    # 重建索引

# ═══ 再注册扩展 ═══
node register-extension.mjs fix                  # 修复被游戏内覆盖的文件
node register-extension.mjs guideall --enable    # 生成 Console 脚本
# → 把脚本粘贴到浏览器 F12 Console，然后 F5
```

---

## 知识库体检工具（kb-lint.mjs）

```bash
node kb-lint.mjs              # 常规体检
node kb-lint.mjs --json       # 机器可读
node kb-lint.mjs --strict     # 有错误时退出码 1（可挂到提交前）
node kb-lint.mjs --verbose    # 附全部条目的指纹状态
```

### 为什么需要它

`put()` 只保证**写入**，不保证**自洽**。实测事故（2026-10-04）：

`kb-af509556` 与 `kb-baea5bbb` 对**同一个问题**给出**相反**的实现建议，
两条都是 `verified`、指纹都是 `fresh`、检索都能命中 ——
未来谁被先检索到，就按谁做，有 50% 概率直接踩进已知的坑。
这类问题靠人工发现纯属运气，故固化成一条命令。

### 检查项

| 维度 | 查什么 | 级别 |
|------|--------|------|
| **结构** | id/title/body 缺失、id 重复、kind/confidence 非法取值、时间戳非法或倒挂 | ✗ / ⚠ |
| **指纹** | 知识依据的源码已变动（stale）或文件消失（missing） | ⚠ |
| **引用** | 正文引用了不存在的 `kb-xxxx`；`refs` 指向的文件不存在 | ⚠ / · |
| **检索性** | 无关键字、关键字过多、标题/正文过短、结论类条目缺结论标记 | ⚠ / · |
| **矛盾** | 一条知识的做法被另一条判定失效，且**被指方未作修订标注** | ⚠ |
| **未完成** | 正文残留「待补充 / TODO / 暂时 / 尚未验证」等标记 | · |

### 矛盾检测的判据（三重条件）

只有同时满足才报，宁可漏报也不制造噪音：

1. 正文出现**对立断言词**（`已证伪` / `反面教材` / `实测事故` / `已修订` …）
   —— 说明它确实在否定某个做法；
2. 正文引用了另一条的 `kb-xxxx` id —— 说明二者在讨论同一件事；
3. ★关键★ 该 id 处于**否定语境**：其**前面 40 字内**含对立断言词。

> ⚠️ 为什么必须有第 3 条：实测 `kb-af509556` 正文既否定了旧写法，
> 又用「见 kb-91f08bc5 / kb-a4994f68 / kb-xy-combo-row-twoline」
> **正向指路**到三条正确知识。若只看前两条，这三条会被全部误判成"被否定"
> （首次运行实测误报 3 条）。加上语境判定后，正向指路被正确忽略。

**降级规则**：若被指条目自己也带了失效/修订标注，说明已处理过，降为 `·` 提示。

### 查不出的情况

两条知识结论**实际冲突但没互相引用** —— 检索不到关联，只能人工阅读。
若发现，请在正文里显式引用对方 id 并标注结论，下次体检即可自动捕获。

### 实测数据（首次全量体检）

```
条目数: 69
指纹  : fresh 32 / stale 4 / missing 0 / 无指纹 33
警告 8 项（4 条 stale 待复核 + 4 条无关键字）
提示 12 项
```

4 条 stale 集中在 `apps/core/character/{key,diy,sp}/skill.js` —— 本体源码改动后，
这些结论需要重新对照。**这正是该工具的主要日常价值**：
把"源码变了、结论可能过期"从隐性风险变成一份可执行清单。

---

## 技能验证工具（verify-skill.mjs）

```bash
node verify-skill.mjs                      # 验证全部自建扩展
node verify-skill.mjs --pack 英雄杀RE       # 只验证一个扩展
node verify-skill.mjs --skill yxsre_fenglang
node verify-skill.mjs --all                # 含本体（噪音多，一般不用）
node verify-skill.mjs --json               # 机器可读
```

有错误时**退出码为 1**，可直接串联到脚本或 CI。

### 检查项

| 级别 | 检查 | 判据 |
|------|------|------|
| ✗ 错误 | **武将悬空引用** | 武将 `skills:[...]` 含不存在的技能 ID —— 游戏里选将可见但技能无效 |
| ✗ 错误 | 源文件缺失 | 索引过期，需 `rebuild` |
| ⚠ 警告 | **技能缺描述** | 无 `<id>_info`；内部子技能不报（见下） |
| ⚠ 警告 | 文件编码异常 | 非 UTF-8，游戏内乱码 |
| · 提示 | 描述/实现不一致 | 描述中的数字在实现段中找不到 |
| · 提示 | 子技能未挂载 | 同文件的父技能用 `group` 挂载，但未列出它 |

### 设计原则：只报能确证的问题

误报会让工具失去价值。因此每项检查都有**排除规则**，均经真实代码验证：

**「缺描述」不报以下情况**（它们本就不该有描述）：

| 情况 | 例 | 判据 |
|------|-----|------|
| 被 `group` 引用的子技能 | `yxsre_fenglang_watch` | 全库扫描 `group:[...]` 建表 |
| `_` 前缀的隐藏技能 | `_yxsrezhenwangpeiyin` | 无名杀惯例 |
| `<父技能ID>_<后缀>` 派生技能 | `yxsre_pushuo_toMale` | 父技能在索引中存在 |
| 数字后缀变体 | `yxsre_wushuang1` | `/[0-9]$/` |

**「子技能未挂载」只在同文件时提示** —— 实测 `yxsre_wushuang_modi` 与
`yxsre_wushuang` 只是命名相似（前者自己 group 了 `_sha`/`_juedou`），
跨文件比对本就多是巧合。

### 验证有效性（实测）

注入两个真实缺陷后运行，均被精确捕获：

```
✗ [悬空引用] 武将 yxsre_huoqubing (…/zishe.js:14) 引用了不存在的技能: yxsre_THIS_DOES_NOT_EXIST
⚠ [缺描述] yxsre_daiwei  …/zishe.js:378 无 <id>_info 描述
```

### 静态验证查不到什么

**必须实机确认**的部分（不要在报告里宣称"已验证通过"）：

- 技能是否真的触发（时机名写错、`filter` 恒 false —— 静态查不出）
- UI 询问流程能否正常结算
- AI 是否会使用
- 数值平衡

```bash
pnpm -F noname dev                                          # http://127.0.0.1:8080/
pnpm -F @noname/fs dev --debug --dirname=../../apps/core    # 8089
```

> 为什么不无头测试：`apps/core/noname` 有 27 个 `.ts` 含尖括号类型断言
> （Node type-stripping 不支持）且依赖 `.vue`，脱离 Vite 无法加载核心。
> 详见知识库 `kb-headless-testing-limits`。

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

### `locate` — 修改技能的一站式定位

```bash
node skill-search.mjs locate <技能ID或中文名>
```

**为「改某个技能」而设计**。一次性给出改这个技能所需的全部坐标，省去翻文件的时间。

| 区块 | 内容 | 用途 |
|------|------|------|
| ① 技能实现 | `文件:起-止行`（含行数） | 改逻辑 |
| ② 技能描述 | 描述原文 + 定义处的 `文件:行号` | 改文案 |
| ③ 所属武将 | 引用此技能的武将、体力、定义位置 | 评估影响面 |
| ④ 结构特征 | 触发时机、关键 API、子技能 | 判断风险 |
| ⑤ 同包技能 | 同包其余技能 | 找参照 |

例：

```
$ node skill-search.mjs locate tiandu

【① 技能实现】← 改逻辑
   apps/core/character/standard/skill.js:685-706   (22 行)

【② 技能描述】← 改文案
   "当你的判定牌生效后，你可以获得之。"
   apps/core/character/standard/translate.js:93   ← 描述定义处

【③ 所属武将】← 改数值/称号，评估影响面
   ps1059_guojia        3 体力   apps/core/character/offline/character.js:2107
   re_guojia            3 体力   apps/core/character/refresh/character.js:525
   xizhicai             3 体力   apps/core/character/sp/character.js:1297
   guojia               3 体力   apps/core/character/standard/character.js:64
   共 4 个武将引用此技能
```

**同名技能会列出全部候选让你选**，不替你猜：

```
$ node skill-search.mjs locate 天妒

「天妒」有 4 个同名技能，请指定完整 ID：

  nagisa_tiandu          [武将包/key]       apps/core/character/key/skill.js:8824
  sbtiandu               [武将包/sb]        apps/core/character/sb/skill.js:1455
  tiandu                 [武将包/standard]  apps/core/character/standard/skill.js:685
  yxsre_tiandu           [扩展/英雄杀RE]     apps/core/extension/英雄杀RE/extension.js:4213
```

> 改完技能后记得 `node skill-search.mjs rebuild`，否则行号是旧的。

### `show` — 查看实现

```bash
node skill-search.mjs show <技能ID>
```

输出：技能元信息 + **带行号的完整源码**。支持模糊匹配。

> 自动处理 GBK 编码的老扩展文件。

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
| `build-index.mjs` | 索引构建器：解析技能定义 + 关联描述 + 武将关系 |
| `skill-search.mjs` | 检索引擎与 CLI（search / locate / show / similar / learn / kb） |
| `verify-skill.mjs` | 技能静态验证 |
| `knowledge.mjs` | 知识库模块（指纹计算/校验） |
| `register-extension.mjs` | 扩展注册与修复 |
| `migrate-skill.mjs` | 迁移打包与自检 |
| `skill-index.json` | 索引产物（约 6.5 MB，**不入库**） |
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

一个实测样本（《无名杀》1.11.7）：**6703 个技能，5615 个含描述（83.8%）**。

> 技能数随目标仓库内容变化，以 `node skill-search.mjs stats` 实测为准。

### 依赖

零外部依赖，仅用 Node.js 内置模块。需要 Node ≥ 18。

---

## 新增工具的开发规范

要在 `scripts/` 下加新工具时，遵守以下约定（现有脚本都符合，可直接照抄结构）。

### 硬性要求

| 要求 | 原因 | 校验方式 |
|------|------|---------|
| **零依赖** | 可移植到任何仓库，无需 `npm install` | `migrate-skill.mjs check` |
| **自定位项目根** | 不硬编码路径，换机器可用 | 同上 |
| **不用 `execSync`/`spawnSync`** | 受限沙箱下直接 `EPERM`；且依赖外部命令 | 代码审查 |

项目根解析照抄现有写法：

```js
function findRoot(start) {
    let cur = resolve(start);
    while (true) {
        if (existsSync(join(cur, "apps/core/noname"))) return cur;
        const parent = dirname(cur);
        if (parent === cur) return null;
        cur = parent;
    }
}
const ROOT = findRoot(process.cwd()) || findRoot(HERE);
```

> ⚠️ **禁止调用外部命令**。需要遍历目录就用 `readdirSync` + `statSync` 自己走；
> 需要读文件就用 `readFileSync`。实测 `execSync("dir ...")` 在受限环境下会
> 直接抛 `spawnSync cmd.exe EPERM`。

### 新增后必须同步的四处清单

漏改任何一处都会造成不一致（本仓库曾因漏掉 `verify-skill.mjs`
导致 `npm pack` 产出的包缺文件）：

| # | 文件 | 改什么 |
|---|------|--------|
| 1 | `install.mjs` | 加入 `FILES` 数组 —— 否则安装副本拿不到该工具 |
| 2 | `package.json` | 加入 `files`（打包清单）与 `bin`（如需 CLI） |
| 3 | `scripts/README.md` | 「实现说明」表格 + 命令一览 + 用法小节 |
| 4 | `SKILL.md` | 若属日常流程，在 §1 工作流或 §12 维护章节提及 |

### 提交

保持与既有工具一致的 CLI 风格（`--help`、`--json`、`--root`、退出码语义），
然后按 `SKILL.md` §12 的流程：**本地 commit → 报告用户 → 等确认后 push**。
