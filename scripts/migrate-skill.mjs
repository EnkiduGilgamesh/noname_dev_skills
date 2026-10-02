#!/usr/bin/env node
/**
 * Skill 迁移工具
 *
 * 把本 skill（规范 + 脚本 + 知识库 + 模板）打包或安装到另一台机器 / 另一个项目。
 *
 * 用法：
 *   node migrate-skill.mjs pack   [--out <zip路径>]      打包成 zip
 *   node migrate-skill.mjs export [--out <目录>]         复制为可移植目录
 *   node migrate-skill.mjs info                          查看当前 skill 概况
 *   node migrate-skill.mjs check                         检查可移植性（有无硬编码路径）
 *
 * 迁移后在【新机器】执行：
 *   unzip 到 <新项目根>/.dsh/skills/ ，然后运行：
 *   node .dsh/skills/noname-general-extension/scripts/build-index.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));           // .../scripts
const SKILL_DIR = resolve(HERE, "..");                          // .../noname-general-extension

const argv = process.argv.slice(2);
const cmd = argv[0] || "help";
function opt(name, dflt) {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
}

/** 定位项目根（含 apps/core/noname） */
function findProjectRoot(start) {
    let cur = resolve(start);
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(cur, "apps/core/noname"))) return cur;
        const up = dirname(cur);
        if (up === cur) break;
        cur = up;
    }
    return null;
}

/** 递归列出文件（相对 SKILL_DIR） */
function walk(dir, base = dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, base, out);
        else out.push(relative(base, p).replace(/\\/g, "/"));
    }
    return out;
}

/** 分类：哪些文件必须迁移，哪些是生成物 */
function classify(files) {
    const always = [];      // 必须迁移
    const generated = [];   // 生成物，可选（迁移后重建）
    const junk = [];        // 临时/无关，不迁移
    for (const f of files) {
        if (f.endsWith("skill-index.json")) generated.push(f);
        else if (/^scripts\/register-.*\.js$/.test(f)) junk.push(f);
        else always.push(f);
    }
    return { always, generated, junk };
}

// ═══ pack ═══
function cmdPack() {
    const out = opt("--out", join(process.cwd(), "noname-general-extension.zip"));
    const files = walk(SKILL_DIR);
    const { always, generated } = classify(files);

    console.log(`\n打包 skill: ${SKILL_DIR}`);
    console.log(`  必须文件: ${always.length} 个`);
    console.log(`  生成物:   ${generated.length} 个（索引，迁移后可重建）`);

    // 用 PowerShell 的 Compress-Archive（Windows 内置，无需依赖）
    const staging = join(process.env.TEMP || "/tmp", `skill-pack-${Date.now()}`);
    mkdirSync(staging, { recursive: true });
    const target = join(staging, "noname-general-extension");

    // 复制必须文件（不含索引，减小体积）
    for (const f of always) {
        const src = join(SKILL_DIR, f);
        const dst = join(target, f);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
    }

    try {
        execFileSync("powershell", [
            "-NoProfile", "-Command",
            `Compress-Archive -Path '${target}' -DestinationPath '${out}' -Force`,
        ], { stdio: "inherit" });
        console.log(`\n✅ 已打包: ${out}`);
        console.log(`   大小: ${(statSync(out).size / 1024).toFixed(1)} KB`);
    } catch (e) {
        console.error(`\n✗ 打包失败: ${e.message}`);
        console.error(`  可手动压缩目录: ${target}`);
        process.exit(1);
    }

    console.log(`
迁移步骤（在新机器上）：
  1. 解压到  <新项目根>/.dsh/skills/
  2. cd <新项目根>
  3. 重建索引（必须，因为索引含机器相关的路径）：
       node .dsh/skills/noname-general-extension/scripts/build-index.mjs
  4. 验证：
       node .dsh/skills/noname-general-extension/scripts/skill-search.mjs stats
`);
}

// ═══ export ═══
function cmdExport() {
    const out = opt("--out", join(process.cwd(), "noname-general-extension"));
    if (existsSync(out)) {
        console.error(`✗ 目标已存在: ${out}（请先删除或用 --out 指定其他路径）`);
        process.exit(1);
    }
    const files = walk(SKILL_DIR);
    const { always } = classify(files);

    for (const f of always) {
        const src = join(SKILL_DIR, f);
        const dst = join(out, f);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
    }

    console.log(`\n✅ 已导出 ${always.length} 个文件到:\n   ${out}`);
    console.log(`
迁移步骤（在新机器上）：
  1. 把该目录放到  <新项目根>/.dsh/skills/noname-general-extension/
  2. cd <新项目根>
  3. node .dsh/skills/noname-general-extension/scripts/build-index.mjs
`);
}

// ═══ info ═══
function cmdInfo() {
    const files = walk(SKILL_DIR);
    const { always, generated, junk } = classify(files);

    console.log(`\n═══ Skill 概况 ═══\n`);
    console.log(`位置: ${SKILL_DIR}`);

    const root = findProjectRoot(HERE);
    console.log(`所属项目: ${root || "(未识别)"}`);
    console.log(`\n文件: ${files.length} 个（必须 ${always.length}，生成物 ${generated.length}，临时 ${junk.length}）`);

    // 各文件大小
    console.log(`\n─── 必须迁移的文件 ───`);
    let total = 0;
    for (const f of always) {
        const size = statSync(join(SKILL_DIR, f)).size;
        total += size;
        console.log(`  ${(size / 1024).toFixed(1).padStart(8)} KB  ${f}`);
    }
    console.log(`  ${"─".repeat(10)}`);
    console.log(`  ${(total / 1024).toFixed(1).padStart(8)} KB  合计(${always.length} 文件)`);

    console.log(`\n─── 生成物（可不迁移，新机器重建）───`);
    for (const f of generated) {
        const size = statSync(join(SKILL_DIR, f)).size;
        console.log(`  ${(size / 1024).toFixed(1).padStart(8)} KB  ${f}`);
    }
    if (junk.length) {
        console.log(`\n─── 临时文件（不需迁移）───`);
        for (const f of junk) {
            console.log(`  ${f}`);
        }
    }

    // 知识库统计
    const kbPath = join(SKILL_DIR, "scripts/knowledge-base.json");
    if (existsSync(kbPath)) {
        const kb = JSON.parse(readFileSync(kbPath, "utf8"));
        console.log(`\n─── 知识库 ───`);
        console.log(`  条目: ${kb.entries.length}`);
        const byKind = {};
        kb.entries.forEach(e => byKind[e.kind] = (byKind[e.kind] || 0) + 1);
        console.log(`  类型: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    }

    // 前置依赖
    console.log(`\n─── 前置依赖 ───`);
    console.log(`  Node.js: ${process.version}`);
    console.log(`  外部包: 无（零依赖，仅用 Node 内置模块）`);
    console.log(`  游戏源码: ${root ? "已就位" : "未找到（需 apps/core/noname）"}`);
}

// ═══ check ═══
function cmdCheck() {
    console.log(`\n═══ 可移植性检查 ═══\n`);

    const files = walk(SKILL_DIR).filter(f => /\.(mjs|md|json)$/.test(f));
    let issues = 0;

    // 1. 检查硬编码的绝对路径（排除文档中的示例）
    console.log(`〔1〕硬编码绝对路径`);
    const absPathRe = /[A-Za-z]:\\{1,2}(?:Users|Projects|Dev)\\[^\s"'`)]+/g;
    for (const f of files) {
        if (f === "scripts/skill-index.json") continue;   // 生成物，含 root 属正常
        const text = readFileSync(join(SKILL_DIR, f), "utf8");
        const hits = text.match(absPathRe);
        if (hits) {
            const uniq = [...new Set(hits)];
            console.log(`  ⚠ ${f}: ${uniq.length} 处`);
            uniq.slice(0, 3).forEach(h => console.log(`      ${h}`));
            issues++;
        }
    }
    if (!issues) console.log(`  ✓ 未发现硬编码路径`);

    // 1b. 检查代码里把 skill 自身位置写死成 <ROOT>/.dsh/skills/...
    //     这类写法在「技能位于独立仓库、项目在别处」时会指向错误位置。
    console.log(`\n〔1b〕技能自身位置是否自定位`);
    let selfLocated = true;
    for (const f of files.filter(f => f.endsWith(".mjs"))) {
        const text = readFileSync(join(SKILL_DIR, f), "utf8")
            .replace(/`(?:[^`\\]|\\.)*`/gs, "``")      // 去模板串
            .replace(/\/\/[^\n]*/g, "");               // 去行注释
        const re = /(?:join|resolve)\(\s*(?:ROOT|INDEX\.root)\s*,\s*["'][^"']*\.dsh[^"']*["']/g;
        const hits = text.match(re);
        if (hits) {
            console.log(`  ⚠ ${f}: 把自身位置写死在 ROOT 下`);
            [...new Set(hits)].slice(0, 3).forEach(h => console.log(`      ${h}`));
            selfLocated = false;
            issues++;
        }
    }
    if (selfLocated) console.log(`  ✓ 脚本均以自身所在目录定位`);

    // 2. 检查外部依赖
    //    注意：需排除【模板字符串内】的伪 import（脚本可能生成含 import 的代码文本）
    console.log(`\n〔2〕外部依赖`);
    const externals = new Set();
    for (const f of files.filter(f => f.endsWith(".mjs"))) {
        const text = readFileSync(join(SKILL_DIR, f), "utf8");
        // 去掉模板字符串内容后再匹配，避免把生成代码当依赖
        const stripped = text.replace(/`(?:[^`\\]|\\.)*`/gs, "``");
        const importRe = /from\s+["']([^"']+)["']/g;
        let m;
        while ((m = importRe.exec(stripped)) !== null) {
            const mod = m[1];
            if (!mod.startsWith(".") && !mod.startsWith("node:")) externals.add(mod);
        }
    }
    if (externals.size) {
        console.log(`  ⚠ 发现外部依赖: ${[...externals].join(", ")}`);
        issues++;
    } else {
        console.log(`  ✓ 仅使用 Node 内置模块（零依赖）`);
    }

    // 3. 检查 root 解析是否动态
    console.log(`\n〔3〕项目根解析方式`);
    const searchSrc = readFileSync(join(SKILL_DIR, "scripts/skill-search.mjs"), "utf8");
    const hasDynamic = searchSrc.includes("findProjectRoot") && !searchSrc.includes("const ROOT = INDEX.root");
    console.log(hasDynamic ? `  ✓ skill-search 动态解析项目根` : `  ⚠ skill-search 可能依赖索引中的 root`);
    if (!hasDynamic) issues++;

    const buildSrc = readFileSync(join(SKILL_DIR, "scripts/build-index.mjs"), "utf8");
    // build-index 必须同时满足：动态找根 + 输出路径跟着脚本走
    const buildDynamic = /findRoot\(\s*(process\.cwd\(\)|HERE)/.test(buildSrc);
    console.log(buildDynamic ? `  ✓ build-index 动态解析项目根` : `  ⚠ build-index 可能硬编码项目根`);
    if (!buildDynamic) issues++;

    // 输出路径若写成 join(ROOT, ".dsh/skills/...")，技能放在项目外时索引会写错地方
    const outHardcoded = /join\(\s*ROOT\s*,\s*["']\.dsh/.test(buildSrc);
    if (outHardcoded) {
        console.log(`  ⚠ build-index 的索引输出路径写死在 ROOT 下（技能在项目外时会写错位置）`);
        issues++;
    } else {
        console.log(`  ✓ build-index 的索引输出跟随脚本位置`);
    }

    // 4. 检查必要条件
    console.log(`\n〔4〕运行前置条件`);
    const root = findProjectRoot(HERE) || findProjectRoot(process.cwd());
    if (root) {
        console.log(`  ✓ 找到项目根: ${root}`);
    } else {
        console.log(`  · 当前不在《无名杀》项目内（技能位于独立仓库时属正常）`);
        console.log(`    使用时请指定: node build-index.mjs --root <项目根>`);
    }

    console.log(`\n${"=".repeat(45)}`);
    if (issues === 0) {
        console.log(`✅ 可移植性检查通过（0 个问题）`);
        console.log(`\n迁移方式：`);
        console.log(`  node migrate-skill.mjs pack        # 打包 zip`);
        console.log(`  node migrate-skill.mjs export      # 导出目录`);
    } else {
        console.log(`⚠ 发现 ${issues} 个潜在问题，请检查上述输出`);
    }
    console.log("");
}

function cmdHelp() {
    console.log(`
Skill 迁移工具

  info     查看 skill 概况（文件清单、大小、知识库统计）
  check    检查可移植性（硬编码路径、外部依赖）
  pack     打包成 zip（供复制到其他机器）
  export   导出为可移植目录

选项：
  --out <路径>   pack/export 的输出位置

迁移流程：
  【源机器】
    node migrate-skill.mjs check          # 先确认可移植
    node migrate-skill.mjs pack           # 打包

  【目标机器】
    1. 解压到  <项目根>/.dsh/skills/
    2. cd <项目根>
    3. node .dsh/skills/noname-general-extension/scripts/build-index.mjs
    4. 验证: node .dsh/skills/noname-general-extension/scripts/skill-search.mjs stats

注意：
  · skill-index.json 是【机器相关】的生成物，迁移后【必须重建】
  · knowledge-base.json 是【人工沉淀】的资产，应当迁移
  · 脚本零外部依赖，只需 Node.js ≥ 18
`);
}

switch (cmd) {
    case "info": cmdInfo(); break;
    case "check": cmdCheck(); break;
    case "pack": cmdPack(); break;
    case "export": cmdExport(); break;
    default: cmdHelp();
}
