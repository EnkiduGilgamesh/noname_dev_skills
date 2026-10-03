#!/usr/bin/env node
/**
 * install.mjs —— 把本技能安装到指定的《无名杀》项目
 *
 * 用法：
 *   node install.mjs --target <无名杀项目根>
 *   node install.mjs --target <项目根> --force     # 覆盖已存在的
 *   node install.mjs --target <项目根> --no-index  # 不自动构建索引
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function opt(name, dflt) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
}
const has = (n) => args.includes(n);

const target = opt("--target", null);
if (!target) {
    console.error("用法: node install.mjs --target <《无名杀》项目根> [--force] [--no-index]");
    process.exit(1);
}

const ROOT = resolve(target);
if (!existsSync(join(ROOT, "apps/core/noname"))) {
    console.error(`✗ 目标目录不像《无名杀》项目根（缺 apps/core/noname）: ${ROOT}`);
    process.exit(1);
}

const DEST = join(ROOT, ".dsh/skills/noname-general-extension");
const force = has("--force");

const FILES = [
    ["SKILL.md", "SKILL.md"],
    ["README.md", "README.md"],
    ["LICENSE", "LICENSE"],
    ["scripts/README.md", "scripts/README.md"],
    ["scripts/skill-search.mjs", "scripts/skill-search.mjs"],
    ["scripts/build-index.mjs", "scripts/build-index.mjs"],
    ["scripts/verify-skill.mjs", "scripts/verify-skill.mjs"],
    ["scripts/knowledge.mjs", "scripts/knowledge.mjs"],
    ["scripts/register-extension.mjs", "scripts/register-extension.mjs"],
    ["scripts/migrate-skill.mjs", "scripts/migrate-skill.mjs"],
];
const KB = ["scripts/knowledge-base.json", "scripts/knowledge-base.json"];

console.log(`\n安装技能 → ${DEST}\n`);

let copied = 0, skipped = 0;
for (const [src, rel] of FILES) {
    const from = join(HERE, src);
    const to = join(DEST, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    if (existsSync(to) && !force) { skipped++; console.log(`  · 已存在，跳过: ${rel}`); continue; }
    copyFileSync(from, to);
    copied++;
    console.log(`  ✓ ${rel}`);
}

// 知识库：存在时【合并而非覆盖】，避免丢失目标机器上已沉淀的结论
const kbFrom = join(HERE, KB[0]);
const kbTo = join(DEST, KB[1]);
if (existsSync(kbFrom)) {
    mkdirSync(dirname(kbTo), { recursive: true });
    if (existsSync(kbTo) && !force) {
        console.log(`  · 知识库已存在，保留原有（如需覆盖请加 --force）`);
        skipped++;
    } else {
        copyFileSync(kbFrom, kbTo);
        copied++;
        console.log(`  ✓ ${KB[1]}`);
    }
}

console.log(`\n完成：复制 ${copied} 个，跳过 ${skipped} 个`);

if (has("--no-index")) {
    console.log(`\n下一步（手动构建索引）：`);
    console.log(`  cd "${join(DEST, "scripts")}" && node build-index.mjs`);
} else {
    console.log(`\n构建索引…`);
    try {
        execFileSync(process.execPath, [join(DEST, "scripts/build-index.mjs"), "--root", ROOT],
            { stdio: "inherit" });
        console.log(`\n✅ 安装完成。DSH 将自动以 noname-general-extension 加载该技能。`);
    } catch {
        console.error(`\n⚠ 索引构建失败，请手动运行：`);
        console.error(`  cd "${join(DEST, "scripts")}" && node build-index.mjs`);
    }
}
console.log("");
