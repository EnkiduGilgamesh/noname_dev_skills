---
name: noname-general-extension
description: 开发《无名杀》武将扩展、编写武将技能，或在已有技能中查找参考实现。当用户要求新增/修改武将、编写技能（触发技、锁定技、主动技、视为技、限定技、觉醒技、转换技）、创建扩展目录、定义 character/skill/translate、检索类似技能实现、沉淀开发结论、或调试"技能不触发/没效果"时使用。内含增量知识库（带源码指纹校验）、技能检索引擎（6700+ 个技能）、扩展骨架、11 类技能模板、API 速查与避坑清单。任务中还应持续维护本技能包（更新 SKILL.md、沉淀知识库、开发新工具、更新 README），本地 commit 后经用户确认再 push。
---

# 开发《无名杀》武将扩展

⚠️ **动手前必读**：本 skill 中的每条约定都来自源码实证。**不要凭三国杀桌游常识或旧版无名杀经验编写**——新版引擎已废弃多个旧写法（见"过时写法"）。

## 0. 项目定位

**工作目录 = 《无名杀》源码仓库根**（即包含 `apps/core/noname` 的目录，本 skill 所在仓库）。

> 脚本用 `process.cwd()` 自动向上查找仓库根，因此无需关心绝对路径。

- 源码核心：`apps/core/noname/`
- 扩展目录：`apps/core/extension/<扩展名>/`
- 武将包目录：`apps/core/character/<包名>/`
- 事件系统文档：`docs/YRD/`（自顶向下 19 篇：00~15 + 3 篇附录，含源码行号）
  > ℹ️ 该目录属于**《无名杀》仓库本体**，不由本技能包安装。
  > 若目标仓库缺 `docs/YRD/`，说明尚未补充这批文档，此时跳过文档步骤、
  > 改用 `docs/game-event/`、`docs/lib-skill-format.md`，或直接用检索工具找参考实现。
- **模板库：`docs/YRD/templates/`（位于《无名杀》仓库，非本技能包）**
  > ⚠️ 其中源码行号以 `apps/core` **1.11.4.1** 为准。在 1.11.7 上实测 183 处引用
  > **0 处行号越界**，仅少数位置轻微位移。跳转对不上时按**符号名搜索**即可。
- **技能检索工具：`scripts/`（在 6700+ 个已有技能中找参考实现）**

## 1. 标准工作流

> **核心原则：先查知识库，再检索参考实现，最后从模板改写。不要从零编写技能。**

1. **明确需求**：技能的语义是什么？（何时触发、做什么、有无代价）
2. **🔍 检索**（**必做第一步**）：

   ```bash
   cd .dsh/skills/noname-general-extension/scripts
   node skill-search.mjs search "<用功能语义描述，别用技能名>"
   ```

   检索会**自动先查知识库**（📘 区块，带指纹校验）再查技能索引（🔍 区块）：
   - 知识库命中 → 直接采用已沉淀的结论，**无需重复检索**
   - 知识库失效 → 显示警告并自动回退到索引检索
   - 从候选里挑 1-2 个最接近的，`node skill-search.mjs show <技能ID>` 查看实现
   - 不够贴合时：`node skill-search.mjs similar <技能ID>` 找结构类似的

3. **📘 沉淀结论**（开发完成后必做）：

   ```bash
   node skill-search.mjs learn \
     --title "简短标题" \
     --body "结论内容" \
     --kind pattern \
     --keywords "关键词1,关键词2" \
     --from <参考的技能ID>
   ```

   - `--from` 会记录**证据指纹**，源码变动时该知识自动标记失效，不会误导后续开发
   - **每次开发都应该沉淀至少 1 条**，让知识库持续增值

4. **查模板**：从 `docs/YRD/templates/templates/` 选最接近的模板（11 类）。
5. **查文档**：机制不清楚时读 `docs/YRD/` 对应篇章（带源码行号可跳转核对）。
6. **写代码**：结合「知识库/参考实现」与「模板」改写 `character/skill.js`，同步补 `translate.js`。
7. **🔧 注册扩展**（**写完必做，否则游戏里看不到**）：

   ```bash
   cd .dsh/skills/noname-general-extension/scripts
   node register-extension.mjs fix                  # 先修复被游戏内「制作扩展」覆盖的文件
   node register-extension.mjs guideall --enable    # 批量登记 + 启用
   ```

   把输出的脚本粘贴到**浏览器 Console**（F12），然后 F5 刷新。

8. **✅ 静态验证**（**写完必做**）：

   ```bash
   node verify-skill.mjs --pack <扩展名>     # 查悬空引用、缺描述、编码等问题
   ```

   详见下节「技能验证」。

9. **人工验证**：游戏内启用扩展 → 选将 → 实际发动技能。
   **静态验证通过 ≠ 技能能用**，触发时机/UI 流程只能实机确认。

### ★ 技能验证

验证分两层，**任何一层都不能替代另一层**。

#### 第一层：静态验证（可自动化，30 秒）

```bash
node verify-skill.mjs                      # 验证全部自建扩展
node verify-skill.mjs --pack 英雄杀RE       # 只验证一个扩展（推荐）
node verify-skill.mjs --skill yxsre_fenglang
node verify-skill.mjs --json               # 机器可读
```

**能查出**：

| 级别 | 检查项 | 说明 |
|------|--------|------|
| ✗ 错误 | 武将悬空引用 | 武将 `skills:[...]` 里写了不存在的技能 ID —— 选将能看到但技能无效 |
| ✗ 错误 | 源文件缺失 | 索引过期，需 `rebuild` |
| ⚠ 警告 | 技能缺描述 | 无 `<id>_info`（内部子技能、`_` 开头的不报） |
| ⚠ 警告 | 编码异常 | 文件非 UTF-8，游戏内会乱码 |
| · 提示 | 描述/实现不一致 | 描述里的数字在实现段中找不到，可能改了实现忘改描述 |
| · 提示 | 子技能未挂载 | 与父技能同文件、父技能确实用 `group` 挂载，但没列出它 |

**退出码**：有错误返回 1，可用于 CI/脚本串联。

**设计原则：只报能确证的问题。** 所有判据都经过真实代码验证 ——
例如「缺描述」会先排除被 `group` 引用的子技能、`_` 前缀的隐藏技能、
`<父技能ID>_<后缀>` 形式的派生技能，避免刷出一堆假警告。

#### 第二层：实机验证（**不可省略**）

静态验证**查不到**这些，必须人工在游戏里确认：

- 技能**是否真的触发**（时机名写错、`filter` 恒返回 false 都不会被静态检查发现）
- UI 询问流程能否正常弹出与结算
- AI 是否会使用该技能
- 数值平衡

启动游戏：

```bash
pnpm -F noname dev                                          # http://127.0.0.1:8081/
pnpm -F @noname/fs dev --debug --dirname=../../apps/core    # 8089
```

> ⚠️ 两个服务都要开。Vite/esbuild 需要创建子进程，若在受限沙箱中运行会报
> `spawn EPERM`，需放宽权限。

> ⚠️ **端口以 `apps/core/vite.config.ts` 为准**（该文件里是唯一的真相）。
> 实测 1.11.7：客户端 **8081**、文件服务 **8089**。
> 若与本处不符，说明仓库改过配置，按 config 文件为准。

**为什么不能无头测试？** 实测过：`apps/core/noname` 下 27 个 `.ts` 含尖括号类型断言
（Node 的 type-stripping 不支持），且依赖 `.vue` 单文件组件，脱离 Vite 无法加载核心。
详见知识库 `kb-headless-testing-limits`。

#### 改技能后的完整验证顺序

```bash
node verify-skill.mjs --pack <扩展名>   # 1. 静态验证
node skill-search.mjs rebuild           # 2. 重建索引（否则 locate 行号是旧的）
node verify-skill.mjs --pack <扩展名>   # 3. 重建后再验一次（行号已更新）
# 4. 游戏内实机确认
```

### ★ 修改已有技能（不同于新建）

用户说「改一下 XX」时，**不要凭印象找文件**。一条命令拿到全部定位信息：

```bash
node skill-search.mjs locate <技能ID或中文名>
```

输出包含改一个技能所需的全部坐标：

| 区块 | 用途 |
|------|------|
| ① 技能实现 | `文件:起始行-结束行` —— 改逻辑 |
| ② 技能描述 | 描述原文 + `文件:行号` —— 改文案（**在 translate.js 或 extension.js，不在 skill.js**） |
| ③ 所属武将 | 哪些武将引用此技能、各自体力、定义位置 —— 评估影响面 |
| ④ 结构特征 | 触发时机、关键 API、子技能 —— 判断改动风险 |
| ⑤ 同包技能 | 同包其余技能 —— 找参照写法 |

**三条硬性纪律**：

1. **改描述 ≠ 改实现**。描述文本在 `translate.js` 的 `<id>_info` 字段（本体）或
   `extension.js` 的同一位置（单文件扩展）。`locate` 会直接给出描述所在行号。
2. **中文名可能重名**。如「天妒」有 4 个（`tiandu` / `sbtiandu` / `nagisa_tiandu` / `yxsre_tiandu`）。
   `locate` 遇到重名会**列出全部候选让你选**，绝不替你猜 —— 猜错会改错文件。
3. **改完要重建索引**：`node skill-search.mjs rebuild`，否则下次 `locate` 的行号是旧的。

改完实现后，**同步检查描述是否需要更新**（描述与实现不一致是常见缺陷来源）。

### ⚠️ 两个必知的机制陷阱

**陷阱一：写了扩展目录 ≠ 游戏里能看到**

扩展必须被登记到配置的 `extensions` 数组才显示（`init/index.ts:635-661`）。而玩家配置存于 **浏览器 `localStorage["noname_0.9_config"]`**，服务端改不了。

解决办法（`register-extension.mjs guideall`）：
- 生成一段 Console 脚本，直接写 `localStorage`
- 脚本**顺带开启「自动导入扩展」**——之后新增扩展会被自动发现，**只需做一次**

**陷阱二：游戏内「制作扩展」会覆盖手写文件**

该功能（选项→扩展→制作扩展）会**无提示覆盖**同名扩展的 `extension.js`、`info.json`、`README.md`，生成空白模板。

| 症状 | 扩展能打开，但选将界面找不到武将包 |
| 原因 | 模板的 `precontent` 是空函数，不会 `import` 武将包 |
| 数据 | ✅ `character/` 目录**不会被删除**，武将数据仍完好 |
| 修复 | `node register-extension.mjs fix`（自动重建 extension.js） |

> **新建扩展请手动复制目录结构**（参考 `apps/core/extension/英雄杀/`），不要用游戏内的「制作扩展」。

### 检索与知识库示例

```bash
# 检索（自动先查知识库）
node skill-search.mjs search "摸牌阶段多摸一张牌"
node skill-search.mjs search "viewAs 将一张牌当杀使用"
node skill-search.mjs search "判定 红色黑色"        # 会命中已沉淀的判定写法

# ★ 修改已有技能：一站式定位
node skill-search.mjs locate 天妒                  # 也支持中文名（同名会列出候选）
node skill-search.mjs locate yxsre_fenglang

# 查看实现
node skill-search.mjs show drlt_jieying
node skill-search.mjs similar biyue

# 静态验证（写完技能后）
node verify-skill.mjs --pack <扩展名>    # 查悬空引用/缺描述/编码

# 沉淀结论（开发后）
node skill-search.mjs learn \
  --title "令角色放弃摸牌用 changeToZero" \
  --body "trigger.changeToZero() 令 num=0 且 numFixed=true" \
  --kind pattern --keywords "放弃摸牌,changeToZero" --from <技能ID>

# 知识库管理
node skill-search.mjs kb list      # 全部条目（含失效状态）
node skill-search.mjs kb check     # 只看失效的
node skill-search.mjs kb stats     # 统计
node skill-search.mjs kb forget <id>   # 移除

# 知识库体检（结构/指纹/引用/检索性/矛盾/未完成标记）
node kb-lint.mjs                   # 常规体检
node kb-lint.mjs --strict          # 有错误时退出码 1（可挂提交前）
node kb-lint.mjs --verbose         # 附全部条目指纹状态

# 扩展注册（写完扩展后必做）
node register-extension.mjs status       # 检查注册状态
node register-extension.mjs fix          # 修复被覆盖的 extension.js
node register-extension.mjs guideall --enable   # 批量登记 + 启用

# 迁移到其他机器（换电脑/换仓库时）
node migrate-skill.mjs pack               # 打包（约 120 KB，不含索引）
node migrate-skill.mjs check              # 迁移后自检
node build-index.mjs                      # 新机器上重建索引
```

> ⚠️ 索引需在源码变更后重建：`node skill-search.mjs rebuild`
> 详见 `scripts/README.md`。
>
> **迁移到其他机器**：只拷 6 个脚本 + `knowledge-base.json` + `SKILL.md`（约 120 KB），
> **不要拷 `skill-index.json`**（里面硬编码了原机器路径），到新机器后跑一次 `build-index.mjs` 即可。

### 启动开发环境

```bash
# 两个服务需同时运行
pnpm -F noname dev                                          # Vite 8081
pnpm -F @noname/fs dev --debug --dirname=../../apps/core    # 文件服务 8089
```

访问 `http://127.0.0.1:8081/`

> 首次安装依赖需联网：`pnpm install`。若 `@esbuild/win32-x64` 缺失导致启动失败，在 `apps/core` 下重新 `pnpm install`。
>
> **依赖链接残缺**（实测常见）：`pnpm install` 若在中途报
> `ERR_PNPM_SYMLINK_FAILED ... Maximum call stack size exceeded`（多发于 `apps/mobile`
> / `apps/electron`），**其余包的依赖链接也会跟着残缺**，表现为启动时报
> `Cannot find module 'avvio'`（packages/fs）或 `'rollup'` / `'esbuild'`（apps/core）。
> 修复：对报错的包单独强制重装 ——
>
> ```bash
> pnpm install --filter=@noname/fs --force
> pnpm install --filter=noname --force
> ```
>
> `apps/mobile`、`apps/electron` 仅打包用，浏览器开发模式不需要它们。

## 2. 扩展目录结构

```
apps/core/extension/我的扩展/
├── extension.js          ★ 必需：必须 export type 与 default
├── info.json             ★ 必需
├── main/
│   ├── precontent.js     ★ 必需：import 武将包
│   └── content.js        可选：rank/config 后处理
├── character/
│   ├── index.js          ★ game.import("character", fn)
│   ├── character.js      武将定义
│   ├── skill.js          技能定义
│   ├── translate.js      翻译（武将名/技能名/技能描述）
│   ├── intro.js          可选
│   ├── sort.js           可选：分组排序
│   ├── characterFilter.js 可选
│   ├── dynamicTranslate.js 可选
│   └── voices.js / pinyin.js  可选
├── image/character/<武将ID>.jpg     立绘
└── audio/skill/<技能ID>.mp3         配音
```

**完整模板见** `docs/YRD/templates/`（02~09 号文件可直接复制）。

## 3. 三个硬性约定

### ① extension.js 必须导出两个东西

```js
export let type = "extension";     // 引擎校验类型
export default extensionPackage;   // 扩展主体
```

依据：`apps/core/noname/init/import.ts:72-77`

### ② precontent 是引入武将包的唯一时机

```js
// main/precontent.js
import "../character/index.js";                       // 触发 game.import
export function precontent(config, pack) {
    lib.translate.我的扩展_character_config = "我的扩展";
}
```

### ③ 武将包入口格式

```js
game.import("character", function () {
    return {
        name: "mypack",        // ⚠️ 扩展内此值会被强制覆盖为扩展文件夹名
        character: { ... },
        skill: { ... },
        translate: { ... },
    };
});
```

⚠️ **`name` 覆盖陷阱**：`apps/core/noname/init/loading.ts:269` 会执行 `content.name = extension[0]`，所以扩展内武将包的 `name` **永远等于扩展文件夹名**，写什么都无效。因此 `characterSort` 的内层键应与扩展目录名一致。

> 独立武将包（`apps/core/character/` 下）不受影响。

## 4. 技能骨架（背下来）

```js
mypack_skillid: {
    // ① 何时触发（必须是对象，四个作用域：player/source/target/global）
    trigger: { player: "phaseJieshuBegin" },

    // ② 条件判定 —— 纯判定，禁止副作用，会被反复调用
    //    签名：filter(event, player, triggername, indexedData)
    filter(event, player) {
        return true;
    },

    // ③ 是否发动（可选）—— 必须写 event.result = await ....forResult()
    async cost(event, trigger, player) {
        event.result = await player.chooseTarget(/* ... */).forResult();
    },

    // ④ 效果
    async content(event, trigger, player) {
        await player.draw();
    },
},
```

### 三个形参的含义（**最易错**）

| 形参 | 实际是 |
|------|--------|
| `event` | 技能效果事件（`event.name` = 技能 ID） |
| `trigger` | **触发源事件**（如 `phaseJieshu` 事件） |
| `player` | 技能拥有者 |

⚠️ `trigger` 只在 `filter`/`cost`/`content` 内有效。**`await` 之后必须用形参 `trigger`**，不能依赖全局 `trigger`。

### filter vs cost

| | `filter(event, player, triggername, indexedData)` | `cost(event, trigger, player)` |
|---|---|---|
| 作用 | 纯判定，能不能发动 | 执行代价 + 写 `event.result` |
| 调用 | **反复调用**（可能几十次） | 仅一次 |
| 副作用 | **禁止** | 允许 |

依据：`apps/core/noname/library/index.js:11025`

## 5. 武将（Character）字段

权威定义：`apps/core/noname/library/element/character.js:2-182`

### 常用字段

```js
mypack_guanyu: {
    sex: "male",              // "male"|"female"|"double"|""
    group: "shu",             // 合法值：wei/shu/wu/qun/jin/shen
    hp: 4,                    // 也可字符串 "4/6" 或 "4/6/1"(hp/maxHp/hujia)
    maxHp: 4,                 // ⚠️ 对象格式下非 number 会回落到 hp（character.js:202-204）
    hujia: 0,
    skills: ["mypack_wusheng"],
    names: "关|羽",            // 「姓|名」竖排；"null|null" 表示不显示
    img: "extension/我的扩展/image/character/mypack_guanyu.jpg",
    isBoss: false,            // BOSS
    doubleGroup: ["shu", "wu"], // 多势力（国战）
},
```

### ⚠️ 不存在的字段（别写）

| 误写 | 实际 |
|------|------|
| `hiddenSkills` | 不是武将字段，是 **Player 实例属性**（`player.js:109`）。武将侧用 `hasHiddenSkill: true` |
| `growthHp` | **全仓库零命中**，无效字段 |
| `tags` | 不存在。标签走数组格式的 `trashBin`（`character.js:249-308`） |

### 立绘路径（两种布局并存）

- **自动推导**（`loading.ts:304`，仅在未写 `img` 时）：`extension/<扩展名>/<武将ID>.jpg` —— 指向**扩展根目录**
- **官方扩展实际用法**（`英雄杀/character.js:290`）：`extension/英雄杀/image/character/<武将ID>.jpg`

⚠️ 两者不一致。**建议显式写 `img` 或循环赋值**，不要依赖隐式约定。

### 翻译表

```js
mypack_guanyu: "关羽",                    // 武将名
mypack_wusheng: "武圣",                   // 技能名（⚠️ 不要带【】，引擎自动加）
mypack_wusheng_info: "将一张红色牌当【杀】使用。",  // 技能描述
```

描述可用：`<br>` 换行、`<li>` 列表、`${get.poptip("技能ID")}` 嵌入提示、`<span class='firetext'>` 着色。
⚠️ `#g/#r/#b/#p` 颜色前缀**只对武将称号生效**，技能描述里无效。

## 6. 11 类技能模板索引

**写技能第一步：从下表选模板，不要从零开始。**

| 需求 | 模板文件 |
|------|---------|
| 满足条件时触发 | `templates/01-被动触发技.js` |
| 强制发动不询问 | `templates/02-锁定技.js` |
| 发动需弃牌/选目标 | `templates/03-有代价的触发技.js` |
| 将 X 当 Y 使用 | `templates/04-视为技viewAs.js` |
| 出牌阶段主动发动 | `templates/05-主动技.js` |
| 一局仅一次 / 觉醒 | `templates/06-限定技与觉醒技.js` |
| 转换技、记录状态 | `templates/07-状态切换技.js` |
| 摸牌/伤害/回复 | `templates/08-直接效果技.js` |
| 选多个目标 | `templates/09-多目标技.js` |
| 技能由多部分协作 | `templates/10-附属技能.js` |
| 限时生效的子技能 | `templates/11-临时技能.js` |

路径前缀：`docs/YRD/templates/templates/`

## 7. API 速查

### 效果类（均可 await）

```js
await player.draw(n)                          // 摸牌
await player.draw({ nodelay: true })          // 摸牌跳过动画
await player.recover(n)                       // 回复体力
await player.loseHp(n)                        // 失去体力（不触发伤害事件）
await player.damage(n)                        // 造成伤害
await player.damage({ nature, source, card }) // 带属性伤害
await player.discard({ cards, discarder })    // 弃牌
await player.gain({ cards, animate })         // 获得牌
await player.gainPlayerCard(target, pos, bool)
await player.discardPlayerCard(target, pos, bool)
await player.gainMaxHp() / loseMaxHp()
player.awakenSkill(skillId)                   // 标记限定技已用
```

### 询问类（**必须 `.forResult()`**）

| API | 返回 |
|-----|------|
| `chooseToDiscard` / `chooseCard` | `{ bool, cards }` |
| `chooseTarget` | `{ bool, targets }` |
| `chooseBool` | `{ bool }` |
| `chooseToUse` | `{ bool, card, cards, targets }` |
| `chooseControl` | `{ bool, control }` |
| `chooseButton` | `{ bool, links }` |

### 状态与管理

```js
player.storage.<skillId>              // 内部状态（不显示）
player.markAuto(skill, [values])      // 可见标记
player.addTempSkill(id, expireTiming) // 临时技能
player.addSkills([...])               // 永久获得
player.removeSkill(id)
player.hasSkill(id)
```

## 8. 十一大避坑（按危害排序）

1. **`cost` 忘记 `event.result = ...`** → 技能永不发动，**且无任何报错**（最难查）
2. **忘记 `.forResult()`** → 拿到事件对象而非结果，`bool` 判定异常
3. **限定技忘记 `player.awakenSkill(event.name)`** → 可无限发动
4. **在 `filter` 里产生副作用** → 会被执行几十次，状态错乱
5. **临时技能 ID 未定义** → `addTempSkill` **静默失败**，无报错
6. **多目标时用 `event.target`** → 它是 `undefined`，必须用 `event.targets`
7. **AI 回调里直接用 `player` 变量** → 不可用，需 `get.player()` / `get.event().player`
8. **`subSkill` 子技能忘记 `charlotte: true`** → 显示在武将牌上
9. **`group` 引用的技能不存在** → 静默失效，无报错
10. **不 `await` 效果事件** → 后续逻辑提前执行，产生竞态
11. **写了不存在的武将字段**（`hiddenSkills`/`growthHp`/`tags`）→ 静默无效

## 9. 过时写法（**新代码不要用**）

| 过时 | 现应使用 | 说明 |
|------|---------|------|
| `direct: true` | `cost` | 老包仍在用（如 `sp/skill.js` 的 `olfeiyang`），新包已统一改 `cost` |
| `"step 0"; ... "step 1";` | `async content` + `await` | 旧式语法，仅 8 个未重构包残留 876 处 |
| 全局 `trigger` 变量 | `content(event, trigger, player)` 形参 | `await` 后全局变量已失效 |

### 新旧对比

```js
// ❌ 旧式
content() {
    "step 0";
    player.chooseToDiscard(2).set("ai", card => 1);
    "step 1";
    if (result.bool) { player.draw(); }
}

// ✅ 新式
async content(event, trigger, player) {
    const result = await player.chooseToDiscard(2)
        .set("ai", card => 1)
        .forResult();
    if (result.bool) {
        await player.draw();
    }
}
```

## 10. 调试方法

```
技能不触发？
├─ trigger 作用域是否写对（player/source/target/global）
├─ 时机名拼写（事件名 + 后缀）
├─ filter 是否返回 false
└─ lib.hookmap[时机名] 是否为 true

技能触发了但不发动？
├─ cost 是否写了 event.result
├─ chooseBool 玩家/AI 是否选了否
└─ check 函数是否正确

技能发动了但没效果？
├─ console.error 是否有报错（联机非 debug 时错误被吞！）
├─ content 是否真的执行（事件名 = 技能名）
└─ 是否 await 了异步操作
```

常用调试代码：

```js
_status.eventManager.eventStack.map(e => e.name)   // 当前事件栈
lib.hookmap["phaseJieshuBegin"]                    // 时机是否被注册
lib.hook["1_player_phaseJieshuBegin"]              // 谁注册了
player.tempSkills                                  // 临时技能
player.getStat("triggerSkill")                     // 发动次数
```

### 界面层排障（自定义 dialog / UI）

> 完整指南见 `docs/YRD/15-ui-development.md`。以下是最常踩的坑，写界面前先扫一眼。

界面「不显示 / 错位 / 文字挤成一列」几乎全部源于三处差异：
**① 视口被缩放（`vh` 不可靠，用 px）② 主题样式带 `!important`（内联会输）
③ `.content` 有 `font-size:0px`（嵌套元素塌陷）**。

```
元素「不显示」？
├─ 先看 children.length —— 正常就说明 DOM 已生成，问题在 CSS，别改 JS
├─ 逐层打 getBoundingClientRect + getComputedStyle（height/overflow/display）
└─ 高度为 0 且多个 top 相同 → 同时怀疑 position:absolute 与 font-size:0

文字挤成「一列一个字」？
├─ 查是否用了 flex（子项 min-width:auto 导致）
├─ 查是否被继承 writing-mode:vertical-rl
└─ 查主题 !important 是否压掉了内联样式（需用 !important 回敬）

列表项「变少了」？
└─ 查限高 ÷ 单项高度，多半是滚动藏起来了，不是数据问题
```

硬性规则：

- 多行可点选列表用 `ui.create.textbuttons(list, dialog, noclick)`
  —— 第三参数传 `true` 即可「点击只预览、由外部按钮提交」，**不必**事后 cloneNode
- `htmlString` 必须以 `<div` 开头；`link` 用数组下标（数字）
- `dialog.buttons` 是**数组**不是 DOM 节点；取容器用 `dialog.content.querySelector(".buttons")`
- 🚫 **不要伪造 dialog 宿主对象**骗 `textbuttons`（静默失效，列表完全不显示）
- 🚫 `lib.init.sheet` 只能插**单条**规则，整段 CSS 用 `createElement("style")`
- 🚫 搬移 dialog 节点后必须复位 `display/position/float/inset/transform/尺寸`，否则全部叠在一处
- 🚫 加了 `display:block!important` 后，显隐切换必须改用**类名**（内联 `display:none` 会失效）

## 11. 深入学习路径

| 需求 | 文档 |
|------|------|
| **检索参考实现** | `scripts/README.md`（工具详解与检索技巧） |
| 系统理解事件系统 | `docs/YRD/README.md`（自顶向下 19 篇） |
| 触发机制原理 | `docs/YRD/08-trigger-system.md` |
| 技能执行链路 | `docs/YRD/09-skill-execution.md` |
| **自定义界面 / UI 排障** | `docs/YRD/15-ui-development.md` |
| 易错点全清单 | `docs/YRD/appendix-c-pitfalls.md` |
| 源码行号地图 | `docs/YRD/appendix-a-source-map.md` |
| 术语速查 | `docs/YRD/appendix-b-glossary.md` |
| 武将字段/翻译规范 | `docs/YRD/templates/README.md` |

**参考实现**（真实生产代码，值得对照）：

- `apps/core/character/standard/skill.js` — 已重构的现代写法样板
- `apps/core/extension/英雄杀/` — 完整扩展范例（含 info.json/precontent/content）
- `apps/core/extension/3D精选/character/index.js` — 武将包入口范例

## 12. 维护本技能包（**任务中持续进行**）

> **本 skill 不是一次性工具，而是随开发持续增值的资产。**
> 每次任务结束前，检查是否有值得回流到技能包的内容；有则更新并提交。

### 仓库位置

**推荐布局：仓库本体即技能目录**（本仓库当前即为此布局）。

| 位置 | 角色 | 是否入库 |
|------|------|---------|
| `<无名杀项目>/.dsh/skills/noname-general-extension/` | **git 仓库根 + 技能运行时，同一目录** | ✅ 提交到这里 |

好处：改完立即生效，**无需复制/同步**；游戏项目与技能包在**同一工作目录**下，
一次操作两边都能维护，且无需跨目录授权。

> 该目录被《无名杀》项目的 `.gitignore`（`.dsh/` 规则）忽略，
> **不会污染游戏仓库的 git 状态**。在技能包目录内跑 `git` 只影响技能包仓库。

**先确认当前布局**：

```bash
cd <无名杀项目>/.dsh/skills/noname-general-extension
git rev-parse --show-toplevel     # 应指向本目录 → 仓库本体在此
git remote -v                     # 应指向技能包仓库（而非游戏仓库）
```

若 `--show-toplevel` 指向**游戏项目根**，说明是旧的双位置模式
（仓库在别处、此处仅为安装副本），此时才需要本节末尾的「回流」步骤。

> `install.mjs` 检测到"源即目标"时会自动跳过复制，不会自我覆盖。

#### 权限边界（受限环境实测）

仓库在工作区内时，**文件内容免授权、git 元数据需授权**：

| 操作 | 授权 |
|------|------|
| 改 `SKILL.md` / `README.md` / `scripts/*` / `knowledge-base.json` / 重建索引 | ✅ 免 |
| `git add` / `commit` / `push` | ❌ 需 |

原因是沙箱按**路径名前缀**保护 `.git*`，与文件权限无关
（同目录下 `.gitignore` 被拒、`normal.txt` 可写）。
**不要试图"修复 ACL"** —— 实测 `.git` 的权限完全正常，属沙箱固有约束。

> **实践：批量提交，减少授权次数。** 文件内容可以自由迭代，
> 攒够一批改动后一次性 `git add -A && git commit`。

### 四类更新

> 以下命令均在技能包仓库根执行：
> `cd <无名杀项目>/.dsh/skills/noname-general-extension`

#### ① Skill 本身（`SKILL.md`）

开发中发现**约定变了、写法过时、文档说错**时更新。典型触发：

- 实测某条约定与源码不符（如端口、字段名、API 签名）
- 发现新的引擎限制或行为变化
- 本仓库结构与 SKILL.md 描述不一致

> 纪律：**只写实测确认过的内容**。SKILL.md 开头就写着"每条约定都来自源码实证"，
> 不要凭印象往里加。

#### ② 知识库（`scripts/knowledge-base.json`）

**每次开发至少沉淀 1 条**（见 §1 第 3 步）：

```bash
cd .dsh/skills/noname-general-extension/scripts
node skill-search.mjs learn \
  --title "简短标题" --body "结论内容" \
  --kind pattern --keywords "关键词1,关键词2" --from <技能ID>
```

- `--from` 记录**证据指纹**，源码变动时自动标记失效，不会误导后续开发
- `keywords` 要精准，过于通用的词会导致误命中（知识库已沉淀过这条教训）
- 沉淀完**记得把 `knowledge-base.json` 同步回源仓库**

#### ③ 新工具开发

现有脚本不够用时（如需要批量审计、格式转换、新维度验证），在 `scripts/` 下新增。
要求：

- **零依赖** —— 只用 Node.js 内置模块（`migrate-skill.mjs check` 会校验这条）
- **自定位** —— 用 `process.cwd()` 向上查找含 `apps/core/noname` 的目录解析项目根，
  不要硬编码路径（照抄现有脚本的 `findRoot()`）
- **纯 fs API** —— 不要用 `execSync` / `spawnSync` 调外部命令：
  受限沙箱下会直接 `EPERM`，且破坏可移植性
- 新增后同步更新：`scripts/README.md`（工具详解）、
  `install.mjs` 的 `FILES` 列表、`package.json` 的 `files` 与 `bin`

> ⚠️ 最后这条最容易漏：`install.mjs` / `package.json` 都有各自的文件清单
> （本仓库曾因漏掉 `verify-skill.mjs` 导致打包缺文件）。新增工具时三处都要改。

#### ④ README（根 `README.md` 与 `scripts/README.md`）

数字类内容**必须实测后再写**，不要沿用旧值：

```bash
node skill-search.mjs stats      # 技能总数、含描述比例
```

易过时的项：技能数、索引体积、源码包体积、命令用法、目录结构、安装选项。
（本仓库曾长期标着 7300+ 技能，实际只有 6703。）

#### ⑤ 《无名杀》仓库文档（`docs/YRD/`）

> ⚠️ **这一类的文件不在技能包仓库内**，改的是《无名杀》项目本身，
> 因此**不受技能包 git 管理**，也**不需要**回流/提交到技能包。

当一批结论已经稳定、且规模足以独立成篇时，写进 `docs/YRD/`：

| 情形 | 做法 |
|------|------|
| 界面/UI 类结论成体系 | 见 `docs/YRD/15-ui-development.md`（章节 15） |
| 补充既有篇章的细节 | 直接改对应 `NN-*.md`，并更新 `docs/YRD/README.md` 索引 |
| 通用易错点 | 追加到 `appendix-c-pitfalls.md` |

纪律：

- **行号必须逐条核对**。该系列在 README 里承诺"全部行号已对照源码验证"，
  写进去的每个 `文件:行号` 都要实际读一遍确认（可用
  `Select-String` / `grep -n` 定位后读取该行）
- 新增篇章要同步更新 `docs/YRD/README.md` 的**三层索引**：
  ① 分层目录表 ② 快速导航 ③ 开发工具链/速查表
- 同时检查 `SKILL.md` 里对篇数的描述（"自顶向下 N 篇"）并同步

> 分批策略：**知识库先沉淀**（轻量、带指纹、自动失效），
> 攒够一个主题再**整理成文档**（重量、面向人读）。
> 两者不是二选一 —— 知识库是原料，文档是成品。

### 提交流程（**本地 commit → 等用户确认 → push**）

```bash
# 1. 自查：确保没有把安装副本的私有状态写进源仓库
cd <技能包仓库>
node scripts/migrate-skill.mjs check    # 可移植性自检，必须 0 问题

# 2. 本地提交（不要直接 push）
git add -A
git commit -m "<type>(<scope>): <说明>"

# 3. 报告给用户，等明确确认后再推送
git push origin main
```

**提交信息规范**（沿用本仓库惯例）：

| type | 用途 |
|------|------|
| `feat` | 新工具、新能力 |
| `fix` | 修正错误（错误的行号、失效的命令、漏掉的文件） |
| `docs` | 文档、README |
| `kb` | 知识库沉淀 |

> **push 必须等用户确认。** 本地 commit 是安全的，push 是对外发布。
> 提交后要**明确告诉用户：有几个提交待推送、分别是什么**，让用户判断。

### 改了 SKILL.md 或工具后：重建索引

索引含各技能的源码位置，改了 `SKILL.md`/脚本本身通常不影响索引，
但**改动过 `scripts/` 下的解析逻辑**后必须重建，否则 `locate`/`show` 给旧数据：

```bash
cd <无名杀项目>/.dsh/skills/noname-general-extension/scripts
node build-index.mjs
```

### （仅旧的双位置模式）回流到安装副本

若 `git rev-parse --show-toplevel` 指向游戏项目根（而非技能目录），
说明仓库在别处、此处只是副本，改完源仓库后需回流：

```bash
node <技能包仓库>/install.mjs --target <无名杀项目根> --force
```

- 不带 `--force` 时已存在的文件会被跳过（适合首次补齐缺失文件）
- `--force` 会覆盖同名文件，但**不会动** `PATHS-LOCAL.md`、`skill-index.json`
  这类不在 `install.mjs` FILES 列表内的文件

> 这就是为什么要推荐"仓库即技能目录"布局 —— 省掉这一步，也就没有"改错副本"的风险。

### 任务收尾自检清单

结束一个开发任务前，逐条确认：

- [ ] 本次有没有**新的实测结论**？→ 沉淀进知识库（§12 ②）
- [ ] 有没有发现 **SKILL.md 写错/过时**的地方？→ 修正（§12 ①）
- [ ] 现有工具够用吗？不够 → 新增并同步四处清单（§12 ③）
- [ ] README 里的**数字/命令**还对吗？→ 实测更新（§12 ④）
- [ ] `migrate-skill.mjs check` 是否 **0 问题**？
- [ ] 已**本地 commit**，并**向用户报告待推送内容**？

> 若无任何更新，也应在总结中**说明"本次无技能包更新"**，而不是默默跳过。

