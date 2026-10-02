#!/usr/bin/env node
/**
 * 无名杀扩展注册工具
 *
 * 解决的问题：
 *   写了扩展目录，但游戏里看不到 —— 因为扩展必须被登记到配置的 extensions 数组里。
 *
 * 机制（源码依据）：
 *   · apps/core/noname/init/index.ts:635-661
 *       const extensions = config.get("extensions");   // 从配置读已登记列表
 *       if (autoImport) { ...发现磁盘新扩展并登记... }  // 需"自动导入"开关
 *       else if (searchParamsImportExtension) { ... }  // 或 URL 参数
 *   · apps/core/noname/library/index.js:30
 *       configprefix = "noname_0.9_"
 *   · 玩家配置实际存于浏览器 localStorage["noname_0.9_config"]，
 *     服务端无法直接写入 —— 因此本工具提供三种手段：
 *
 *   ① status  —— 检查扩展是否已登记（读 config.json 的默认值）
 *   ② patch   —— 把扩展写进 apps/core/game/config.json（对全新环境有效）
 *   ③ guide   —— 生成一段浏览器控制台脚本，一键登记 + 启用（最可靠）
 *
 * 用法：
 *   node register-extension.mjs status [扩展名...]
 *   node register-extension.mjs patch <扩展名> [--enable]
 *   node register-extension.mjs guide <扩展名> [--enable]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 定位项目根 ─────────────────────────────────────────────
function findRoot(start) {
    let cur = start;
    for (let i = 0; i < 8; i++) {
        if (existsSync(join(cur, "apps/core/noname"))) return cur;
        const up = dirname(cur);
        if (up === cur) break;
        cur = up;
    }
    return null;
}
const ROOT = findRoot(process.cwd()) || findRoot(HERE);
if (!ROOT) {
    console.error("✗ 无法定位项目根（需包含 apps/core/noname）");
    process.exit(1);
}

const CORE = join(ROOT, "apps/core");
const EXT_DIR = join(CORE, "extension");
const CONFIG_PATH = join(CORE, "game/config.json");
const CONFIG_PREFIX = "noname_0.9_";

const argv = process.argv.slice(2);
const cmd = argv[0] || "help";
const args = argv.slice(1).filter(a => !a.startsWith("--"));
const hasFlag = n => argv.includes(n);

// ── 工具函数 ───────────────────────────────────────────────

/** 列出磁盘上的扩展目录（判定标准：含 extension.js） */
function listExtensions() {
    if (!existsSync(EXT_DIR)) return [];
    return readdirSync(EXT_DIR)
        .filter(name => {
            const p = join(EXT_DIR, name);
            try {
                if (!statSync(p).isDirectory()) return false;
            } catch {
                return false;
            }
            return existsSync(join(p, "extension.js")) || existsSync(join(p, "extension.ts"));
        });
}

/** 读取 config.json 的默认配置 */
function readConfig() {
    if (!existsSync(CONFIG_PATH)) return null;
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch (e) {
        console.error(`✗ config.json 解析失败: ${e.message}`);
        return null;
    }
}

/** 检测扩展入口是否为"游戏内制作"生成的空白模板 */
function isBlankTemplate(extName) {
    const p = join(EXT_DIR, extName, "extension.js");
    if (!existsSync(p)) return false;
    const txt = readFileSync(p, "utf8");
    // 模板特征：export default function() 且 character 为空对象
    return /export default function\s*\(\s*\)/.test(txt) && /character:\s*\{\s*character:\s*\{\s*\}/.test(txt.replace(/\s+/g, " "));
}

/** 检查扩展是否有实际内容（武将包） */
function hasCharacterContent(extName) {
    const charDir = join(EXT_DIR, extName, "character");
    if (!existsSync(charDir)) return false;
    const idx = join(charDir, "index.js");
    if (!existsSync(idx)) return false;
    const txt = readFileSync(idx, "utf8");
    return /game\.import\s*\(\s*["']character["']/.test(txt);
}

// ── 命令：status ───────────────────────────────────────────

function cmdStatus() {
    const disk = listExtensions();
    const cfg = readConfig();
    const registered = Array.isArray(cfg?.extensions) ? cfg.extensions : [];

    console.log(`\n═══ 扩展注册状态 ═══`);
    console.log(`项目根:   ${ROOT}`);
    console.log(`扩展目录: ${EXT_DIR}`);
    console.log(`配置文件: ${CONFIG_PATH}`);
    console.log(`localStorage 前缀: ${CONFIG_PREFIX}`);
    console.log("");

    const targets = args.length ? args : disk;
    console.log(`磁盘扩展 (${disk.length} 个)，config.json 已登记 (${registered.length} 个)：\n`);

    for (const name of targets) {
        const onDisk = disk.includes(name);
        const inCfg = registered.includes(name);
        const blank = onDisk && isBlankTemplate(name);
        const hasChar = onDisk && hasCharacterContent(name);

        const marks = [];
        marks.push(onDisk ? "磁盘✓" : "磁盘✗");
        marks.push(inCfg ? "已登记✓" : "未登记✗");
        if (onDisk) {
            marks.push(hasChar ? "含武将✓" : "无武将");
            if (blank) marks.push("⚠空白模板");
        }

        console.log(`  ${name.padEnd(16)} ${marks.join("  ")}`);
    }

    console.log(`
说明：
  · 「已登记」指 config.json 的 extensions 数组含该扩展。
    但玩家实际配置存于浏览器 localStorage["${CONFIG_PREFIX}config"]，
    首次运行会用 config.json 作为默认值，之后以 localStorage 为准。
  · 若扩展「磁盘✓ 未登记✗」，游戏里就看不到它 —— 需要登记。
  · 「⚠空白模板」是游戏内「制作扩展」生成的，会覆盖你手写的 extension.js。

下一步：
  node register-extension.mjs patch <扩展名> --enable   # 写入 config.json 默认值
  node register-extension.mjs guide <扩展名> --enable   # 生成浏览器脚本（推荐）
`);
}

// ── 命令：patch ────────────────────────────────────────────

function cmdPatch() {
    const name = args[0];
    if (!name) {
        console.error("用法: node register-extension.mjs patch <扩展名> [--enable]");
        process.exit(1);
    }
    if (!listExtensions().includes(name)) {
        console.error(`✗ 磁盘上不存在扩展「${name}」（需含 extension.js）`);
        console.error(`  可用: ${listExtensions().join(", ")}`);
        process.exit(1);
    }

    const cfg = readConfig();
    if (!cfg) process.exit(1);

    if (!Array.isArray(cfg.extensions)) cfg.extensions = [];
    const added = !cfg.extensions.includes(name);
    if (added) cfg.extensions.push(name);

    const enableKey = `extension_${name}_enable`;
    const enableSet = hasFlag("--enable");
    if (enableSet) cfg[enableKey] = true;

    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, "\t"), "utf8");

    console.log(`\n✅ 已更新 config.json`);
    console.log(`   extensions: ${added ? "新增 " : "已存在 "}${name}`);
    if (enableSet) console.log(`   ${enableKey} = true`);
    console.log(`
⚠️ 注意：config.json 是【默认配置模板】。
   若浏览器已有 localStorage["${CONFIG_PREFIX}config"]，本次修改不会生效 —— 请改用 guide。
`);
}

// ── 命令：guide ────────────────────────────────────────────

/** 生成登记脚本（供 guide / guideall 共用） */
function buildGuideScript(names, enable, autoImport) {
    const list = JSON.stringify(names);
    return `(() => {
  const NAMES = ${list};
  const PREFIX = ${JSON.stringify(CONFIG_PREFIX)};
  const key = PREFIX + "config";
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(key)) || {}; } catch { cfg = {}; }
  if (!Array.isArray(cfg.extensions)) cfg.extensions = [];
  const added = [];
  for (const NAME of NAMES) {
    if (!cfg.extensions.includes(NAME)) { cfg.extensions.push(NAME); added.push(NAME); }
    ${enable ? `cfg["extension_" + NAME + "_enable"] = true;` : `if (cfg["extension_" + NAME + "_enable"] === undefined) cfg["extension_" + NAME + "_enable"] = true;`}
  }
  ${autoImport ? `cfg["extension_auto_import"] = true;` : ""}
  localStorage.setItem(key, JSON.stringify(cfg));
  localStorage.removeItem(PREFIX + "disable_extension");
  console.log("%c✓ 已登记 " + NAMES.length + " 个扩展", "color:#0a0;font-weight:bold");
  if (added.length) console.log("  新增:", added.join(", "));
  console.log("  extensions =", cfg.extensions);
  ${autoImport ? `console.log("  自动导入 = 已开启（以后新扩展会自动发现）");` : ""}
  console.log("%c请刷新页面（F5）使配置生效", "color:#a60");
})();`;
}

function cmdGuide() {
    const name = args[0];
    if (!name) {
        console.error("用法: node register-extension.mjs guide <扩展名> [--enable]");
        console.error("      node register-extension.mjs guideall [--enable]   # 登记全部含武将的扩展");
        process.exit(1);
    }
    if (!listExtensions().includes(name)) {
        console.error(`✗ 磁盘上不存在扩展「${name}」`);
        process.exit(1);
    }

    const enable = hasFlag("--enable");
    const autoImport = !hasFlag("--no-auto-import");
    const script = buildGuideScript([name], enable, autoImport);

    const outPath = join(HERE, `register-${name}.js`);
    writeFileSync(outPath, script, "utf8");

    console.log(`\n═══ 浏览器引导脚本已生成 ═══\n`);
    console.log(`文件: ${outPath}\n`);
    console.log("使用步骤：");
    console.log("  1. 浏览器打开 http://127.0.0.1:8080/");
    console.log("  2. 按 F12 打开开发者工具 → Console 标签");
    console.log("  3. 复制下面全部内容，粘贴到 Console 并回车：\n");
    console.log("─".repeat(70));
    console.log(script);
    console.log("─".repeat(70));
    console.log("  4. 刷新页面（F5）");
    console.log(`  5. 进入 选项 → 扩展，确认「${name}」已启用\n`);
}

/** 批量登记所有「含武将」的扩展（排除本体自带的官方扩展可选） */
function cmdGuideAll() {
    const disk = listExtensions();
    // 只登记含武将内容的扩展（无武将的官方扩展如 boss/coin 由本体处理）
    const targets = args.length ? args : disk.filter(n => hasCharacterContent(n));

    if (!targets.length) {
        console.log("\n没有需要登记的扩展\n");
        return;
    }

    const enable = hasFlag("--enable");
    const autoImport = !hasFlag("--no-auto-import");
    const script = buildGuideScript(targets, enable, autoImport);

    const outPath = join(HERE, "register-all.js");
    writeFileSync(outPath, script, "utf8");

    console.log(`\n═══ 批量登记脚本已生成（${targets.length} 个扩展）═══\n`);
    console.log(`将登记: ${targets.join(", ")}\n`);
    console.log(`文件: ${outPath}\n`);
    console.log("使用步骤：");
    console.log("  1. 浏览器打开 http://127.0.0.1:8080/");
    console.log("  2. F12 → Console 标签");
    console.log("  3. 粘贴以下内容并回车：\n");
    console.log("─".repeat(70));
    console.log(script);
    console.log("─".repeat(70));
    console.log("  4. 刷新页面（F5）\n");
}

// ── 命令：list ─────────────────────────────────────────────

function cmdList() {
    const disk = listExtensions();
    const cfg = readConfig();
    const registered = Array.isArray(cfg?.extensions) ? cfg.extensions : [];
    console.log(`\n磁盘上的扩展：`);
    for (const name of disk) {
        const flags = [];
        if (registered.includes(name)) flags.push("已登记");
        if (isBlankTemplate(name)) flags.push("⚠空白模板");
        if (hasCharacterContent(name)) flags.push("含武将");
        console.log(`  ${name.padEnd(16)} ${flags.join("  ")}`);
    }
    console.log("");
}

// ── 命令：fix ──────────────────────────────────────────────

/**
 * 修复被游戏内「制作扩展」覆盖的 extension.js
 *
 * 覆盖特征：extension.js 变成 `export default function(){...character:{character:{}}...}`
 * 但 character/ 目录下的文件不会被删除 —— 因此只需按标准结构重新生成 extension.js。
 */
function cmdFix() {
    const disk = listExtensions();
    const targets = args.length ? args : disk;
    const broken = targets.filter(n => isBlankTemplate(n));

    if (!broken.length) {
        console.log(`\n✅ 未发现被覆盖的扩展（检查了 ${targets.length} 个）\n`);
        return;
    }

    console.log(`\n发现 ${broken.length} 个被游戏内「制作扩展」覆盖的扩展：\n`);

    for (const name of broken) {
        const dir = join(EXT_DIR, name);
        const hasChar = existsSync(join(dir, "character/index.js"));
        const hasPre = existsSync(join(dir, "main/precontent.js"));
        const hasContent = existsSync(join(dir, "main/content.js"));

        console.log(`── ${name} ──`);
        console.log(`   character/index.js ${hasChar ? "✓ 存在" : "✗ 缺失"}`);
        console.log(`   main/precontent.js ${hasPre ? "✓ 存在" : "✗ 缺失"}`);
        console.log(`   main/content.js    ${hasContent ? "✓ 存在" : "✗ 缺失"}`);

        if (!hasChar) {
            console.log(`   ⚠️ 无法自动修复：缺少 character/index.js（武将数据可能已丢失）\n`);
            continue;
        }

        // 重建 extension.js
        const newExt = `import { lib } from "noname";
import { precontent } from "./main/precontent.js";
import { content } from "./main/content.js";

const extensionInfo = await lib.init.promises.json(\`\${lib.assetURL}extension/${name}/info.json\`);

const extensionPackage = {
	name: "${name}",
	config: {},
	help: {},
	package: {},
	precontent,
	content,
	files: {
		character: [],
		card: [],
		skill: [],
		audio: [],
	},
};

Object.keys(extensionInfo)
	.filter(key => key !== "name")
	.forEach(key => {
		extensionPackage.package[key] = extensionInfo[key];
	});

export let type = "extension";
export default extensionPackage;
`;
        writeFileSync(join(dir, "extension.js"), newExt, "utf8");
        console.log(`   ✓ 已重建 extension.js`);

        // 若 info.json 被重置（缺少 intro 等），也一并修复
        const infoPath = join(dir, "info.json");
        if (existsSync(infoPath)) {
            try {
                const info = JSON.parse(readFileSync(infoPath, "utf8"));
                if (!info.intro && info.author === "无名玩家") {
                    console.log(`   ⚠️ info.json 也是默认值（author="无名玩家"），建议手动补充`);
                }
            } catch { /* ignore */ }
        }
        console.log("");
    }

    console.log(`✅ 修复完成。请刷新浏览器页面（F5）使改动生效。`);
    console.log(`\n建议：以后不要用游戏内的「制作扩展」功能，改为手动复制目录结构。\n`);
}

// ── 命令：fixinfo ─────────────────────────────────────────

function cmdHelp() {
    console.log(`
无名杀扩展注册工具

  status [扩展名...]      检查扩展注册状态（默认检查全部）
  list                    列出磁盘扩展及其状态
  fix [扩展名...]         修复被游戏内「制作扩展」覆盖的 extension.js
  patch <名> [--enable]   写入 apps/core/game/config.json（默认配置模板）
  guide <名> [--enable]   生成浏览器控制台脚本（推荐，直接改 localStorage）
  guideall [--enable]     批量登记所有含武将的扩展（推荐，一劳永逸）

两个独立问题：

【问题一】写了扩展但游戏里看不到 —— 未登记
  扩展必须被登记到配置的 extensions 数组（apps/core/noname/init/index.ts:635-661）。
  登记方式：① 游戏内「自动导入扩展」开关  ② URL 参数  ③ 手动添加
  玩家配置存于 localStorage["${CONFIG_PREFIX}config"]，服务端无法直接写，
  故 guide / guideall 命令生成控制台脚本，粘贴执行即可完成登记。
  脚本会顺带开启「自动导入扩展」—— 之后新增的扩展都会被自动发现。

【问题二】游戏内「制作扩展」覆盖手写文件 —— 需修复
  该功能会重写 extension.js / info.json / README.md（同名即覆盖），
  生成空白模板（character:{} 空对象、precontent 为空函数）。
  表现：扩展能打开，但选将界面找不到武将包。
  character/ 目录下的文件不会被删除，故 fix 命令可自动重建 extension.js。

推荐流程：
  node register-extension.mjs fix                      # 先修复被覆盖的
  node register-extension.mjs guideall --enable        # 再批量登记 + 启用
  # 把输出的脚本粘贴到浏览器 Console，然后 F5

示例：
  node register-extension.mjs status
  node register-extension.mjs fix
  node register-extension.mjs guide 霍去病 --enable
`);
}

switch (cmd) {
    case "status": cmdStatus(); break;
    case "list": cmdList(); break;
    case "fix": cmdFix(); break;
    case "patch": cmdPatch(); break;
    case "guide": cmdGuide(); break;
    case "guideall": cmdGuideAll(); break;
    default: cmdHelp();
}
