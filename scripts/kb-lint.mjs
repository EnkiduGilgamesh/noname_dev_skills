#!/usr/bin/env node
/**
 * kb-lint.mjs —— 知识库常规体检
 *
 * 存在理由：`put()` 只保证**写入**，不保证**自洽**。
 * 实测事故（2026-10-04）：kb-af509556 与 kb-baea5bbb 对同一问题给出
 * **相反**的实现建议，且两条都是 verified —— 未来检索到哪条全看排序。
 * 这类问题「写得进去、检索得到、指纹还都是 fresh」，靠人工发现纯属运气。
 * 本工具把这类体检固化成一条命令。
 *
 * ── 检查项 ────────────────────────────────────────────────
 * A. 结构      id/kind/title/body 齐备、id 不重复、kind/confidence 取值合法、
 *              时间戳可解析
 * B. 指纹      stale / missing 汇总（知识所依据的源码已变动或消失）
 * C. 引用      正文里引用的 kb-xxxx 是否存在；refs 指向的文件是否存在
 * D. 检索性    无关键字、关键字过多、title/body 过短、关键字高度雷同
 * E. 矛盾      ★核心★ 同主题条目中出现**对立断言**
 *               （A 条目教某写法，B 条目说该写法已证伪）
 * F. 过期措辞  正文含「待补充/TODO/暂时」等未完成标记
 *
 * ── 设计原则（与 verify-skill 一致）────────────────────────
 * **只报能确证的问题，不做可能误报的猜测。**
 * 矛盾检测用的是「一方指向另一方 id」+「对立词」双重条件，
 * 宁可漏报也不制造噪音 —— 一个爱喊狼来了的工具没人会跑。
 *
 * 用法：
 *   node kb-lint.mjs              # 常规体检
 *   node kb-lint.mjs --json       # JSON 输出
 *   node kb-lint.mjs --strict     # 有 error 时以非 0 退出（可用于提交前钩子）
 *   node kb-lint.mjs --verbose    # 附全部条目的指纹状态
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeBase } from "./knowledge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KB_PATH = join(HERE, "knowledge-base.json");
// 技能包根（scripts/ 的上一级）—— refs 可能相对它来写（如 scripts/README.md）
const SKILL_ROOT = resolve(HERE, "..");

// ── 项目根（与 skill-search / verify-skill 一致：动态向上解析）──
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
const ROOT = findProjectRoot(HERE);

// ── 参数 ───────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);

// ── 合法取值 ───────────────────────────────────────────────
const KINDS = new Set(["pattern", "pitfall", "fact", "recipe"]);
const CONFIDENCE = new Set(["verified", "observed", "speculative"]);

// ── 对立断言词表 ───────────────────────────────────────────
// 用于 E 项：当一条知识把另一条的做法判为失效时，通常会出现这些词。
const REFUTED_MARKERS = [
    "已证伪", "已被证伪", "被证伪", "已失效", "已废弃", "不再适用",
    "错误做法", "反面教材", "实测事故", "会导致失败", "实测失败",
    "不要再用", "已修订",
];

// 正文里对其他条目的引用：kb-xxxxxxxx（8 位 hex 或自定义短名）
const REF_RE_SRC = "kb-[a-z0-9][a-z0-9-]{2,}";
const REF_RE = new RegExp(REF_RE_SRC, "gi");

// 占位符（不是真的引用，别报）—— 例如正文在讲「用 kb-xxxx 表示引用」，
// 或工具名 kb-lint 本身。实测：写入 kb-kb-lint-tool 后立刻产生 3 条假警告。
const REF_PLACEHOLDERS = new Set([
    "kb-lint", "kb-xxx", "kb-xxxx", "kb-xxxxx", "kb-xxxxxxxx",
    "kb-id", "kb-abc", "kb-abcd", "kb-test",
]);
const isPlaceholderRef = (r) => {
    const s = String(r).toLowerCase();
    if (REF_PLACEHOLDERS.has(s)) return true;
    // 纯重复字符的占位符（kb-xxxx / kb-0000 等）
    const tail = s.slice(3);
    return tail.length >= 3 && /^(.)\1+$/.test(tail);
};

// 前置否定词（出现在 id 之前，即视为该 id 处于被否定语境）
const REFUTE_BEFORE = /(已证伪|已被证伪|被证伪|已失效|已废弃|不再适用|不要再用|不要用|错误做法|反面教材|实测事故|导致失败|实测失败|已修订|而非|而不是|别用|勿用|弃用)/;

// 矛盾检测结果（E 项填写，输出时引用）
const contradictions = [];

// ── 问题收集 ───────────────────────────────────────────────
const problems = [];
function add(level, id, kind, msg) {
    problems.push({ level, id, kind, msg });
}

if (!existsSync(KB_PATH)) {
    console.error(`知识库不存在: ${KB_PATH}`);
    process.exit(1);
}

const kb = new KnowledgeBase(KB_PATH, ROOT);
const entries = kb.entries;
const byId = new Map(entries.map(e => [e.id, e]));

// ═══ A. 结构 ═════════════════════════════════════════════
{
    const seen = new Map();
    for (const e of entries) {
        if (!e.id) { add("error", "(无 id)", "结构", "条目缺少 id"); continue; }
        seen.set(e.id, (seen.get(e.id) || 0) + 1);

        if (!e.kind) add("error", e.id, "结构", "缺少 kind");
        else if (!KINDS.has(e.kind)) {
            add("warn", e.id, "结构", `kind 取值异常: "${e.kind}"（应为 ${[...KINDS].join("/")}）`);
        }

        if (!e.confidence) add("warn", e.id, "结构", "缺少 confidence");
        else if (!CONFIDENCE.has(e.confidence)) {
            add("warn", e.id, "结构", `confidence 取值异常: "${e.confidence}"`);
        }

        if (!e.title || !String(e.title).trim()) add("error", e.id, "结构", "缺少 title");
        if (!e.body || !String(e.body).trim()) add("error", e.id, "结构", "缺少 body");

        for (const f of ["createdAt", "updatedAt"]) {
            if (!e[f]) { add("warn", e.id, "结构", `缺少 ${f}`); continue; }
            if (Number.isNaN(Date.parse(e[f]))) add("warn", e.id, "结构", `${f} 不是合法时间: ${e[f]}`);
        }
        if (e.createdAt && e.updatedAt && Date.parse(e.createdAt) > Date.parse(e.updatedAt)) {
            add("warn", e.id, "结构", "createdAt 晚于 updatedAt（时间戳可能被改坏）");
        }

        if (!Array.isArray(e.keywords)) add("warn", e.id, "结构", "keywords 不是数组");
        if (!Array.isArray(e.refs)) add("warn", e.id, "结构", "refs 不是数组");
        if (!Array.isArray(e.fingerprints)) add("warn", e.id, "结构", "fingerprints 不是数组");
    }
    for (const [id, n] of seen) {
        if (n > 1) add("error", id, "结构", `id 重复出现 ${n} 次`);
    }
}

// ═══ B. 指纹 ═════════════════════════════════════════════
// ⚠️ 必须走 kb.list()：「无指纹」的条目在 KB 内部 status 为 "fresh"
//    （#statusOf 对空 fingerprints 直接返回 fresh），而**只有** list()/get()
//    才附带 status 字段。直接读 kb.entries 会拿到未定义 status，
//    导致 stale 被静默计成 0 —— 实测漏掉了 4 条 stale。
const inspected = kb.list();
const fpStat = { fresh: 0, stale: 0, missing: 0, none: 0 };
{
    for (const e of inspected) {
        const withFp = (e.fingerprints || []).length > 0;
        if (!withFp) fpStat.none++;
        else if (e.status === "stale") fpStat.stale++;
        else if (e.status === "missing") fpStat.missing++;
        else fpStat.fresh++;

        const status = e.status;
        if (!withFp) continue;          // 无指纹条目本就不参与失效判定

        if (status === "stale") {
            add("warn", e.id, "指纹", `依据的源码已变动（stale），结论需复核：` +
                (e.fingerprints || []).map(f => `${f.file}:${f.start}-${f.end}`).join(", "));
        } else if (status === "missing") {
            add("warn", e.id, "指纹", `依据的源码文件已不存在（missing）：` +
                (e.fingerprints || []).map(f => f.file).join(", "));
        }
    }
}

// ═══ C. 引用完整性 ═══════════════════════════════════════
{
    for (const e of entries) {
        // 正文提到的 kb-xxxx 是否真实存在
        const bodyRefs = new Set((String(e.body).match(REF_RE) || []));
        for (const r of bodyRefs) {
            if (r.toLowerCase() === String(e.id).toLowerCase()) continue;
            if (isPlaceholderRef(r)) continue;      // 占位符不算引用
            if (!byId.has(r)) {
                add("warn", e.id, "引用", `正文引用了不存在的条目: ${r}`);
            }
        }
        // refs 里的文件路径是否存在
        // ⚠️ refs 可能是两种基准：
        //    · 相对**项目根**（apps/core/...）—— 绝大多数
        //    · 相对**技能包自身**（scripts/kb-lint.mjs 等）—— 工具类知识
        //    实测：只按项目根解析，会把 scripts/README.md 误报成"文件不存在"。
        //    故两个基准都试，任一命中即认为有效。
        for (const r of e.refs || []) {
            // refs 形如 "skill_id @ path:1-2" 或纯路径
            const m = /@\s*([^\s:]+(?:[\\/][^\s:]*)*)/.exec(r);
            const path = m ? m[1] : (/[\\/]|\.\w+$/.test(r) ? r : null);
            if (!path) continue;               // 纯技能 id，不作文件校验
            const clean = path.replace(/^[/\\]/, "");
            const candidates = [
                ROOT && join(ROOT, clean),
                join(SKILL_ROOT, clean),       // 技能包内（scripts/...）
            ].filter(Boolean);
            if (!candidates.some(p => existsSync(p))) {
                add("info", e.id, "引用",
                    `refs 指向的文件不存在（已按项目根与技能包两种基准查找）: ${path}`);
            }
        }
    }
}

// ═══ D. 检索性 ═══════════════════════════════════════════
{
    const kwIndex = new Map();   // 关键词 → 条目 id 列表
    for (const e of entries) {
        const kws = (e.keywords || []).filter(k => k && String(k).trim());

        if (!kws.length) {
            add("warn", e.id, "检索性", "没有关键字 —— 检索只能靠正文匹配，容易召回失败");
        } else if (kws.length > 12) {
            add("info", e.id, "检索性", `关键字过多（${kws.length} 个），会拉低检索精确度`);
        }

        const title = String(e.title || "").trim();
        if (title && title.length < 6) {
            add("info", e.id, "检索性", `标题过短（${title.length} 字），建议写清结论`);
        }
        const body = String(e.body || "").trim();
        if (body && body.length < 40) {
            add("info", e.id, "检索性", `正文过短（${body.length} 字），可能缺乏可操作细节`);
        }
        // 结论类条目应能一眼看出「该做什么 / 别做什么」
        if ((e.kind === "pattern" || e.kind === "pitfall") && body &&
            !/★|⚠|不要|应|必须|推荐|做法|结论/.test(body)) {
            add("info", e.id, "检索性", "结论类条目的正文缺少「★/⚠/做法/不要」等结论标记");
        }

        for (const k of kws) {
            if (!kwIndex.has(k)) kwIndex.set(k, []);
            kwIndex.get(k).push(e.id);
        }
    }

    // 关键字高度雷同（可能重复记录同一件事）
    // ⚠️ 共用关键字本身很正常（一个概念被多条知识引用），
    //    若每条都报会产生 37 条噪音、淹没真问题。
    //    只报「共用 ≥3 条 **且** 标题措辞也高度相似」的疑似重复。
    for (const [k, ids] of kwIndex) {
        if (ids.length < 3) continue;
        const titles = ids.map(i => String(byId.get(i)?.title || ""));
        const dupish = titles.some((t1, i) =>
            titles.some((t2, j) => i !== j && t1 && t2 && t1 === t2));
        if (!dupish) continue;
        add("info", ids[0], "检索性",
            `疑似重复：关键字「${k}」被 ${ids.length} 条共用且存在同名标题（${ids.join(", ")}）`);
    }
}

// ═══ E. 矛盾检测（核心）═══════════════════════════════════
// 判据（三重条件，宁漏勿误）：
//   ① 该条目正文出现「对立断言词」（已证伪 / 反面教材 / 实测事故 …），
//      说明它**确实在否定某个做法**；
//   ② 该条目正文引用了另一条的 id（说明二者在讨论同一件事）；
//   ③ ★关键★ 该 id 在正文中处于「否定语境」—— 即其**前面一小段文字**
//      含有对立断言词。仅凭「有引用 + 全文有对立词」会误报：
//      实测 kb-af509556 正文既否定了旧写法，又用「见 kb-91f08bc5」
//      **正向指路**到三条正确知识，若不加 ③ 会把这三条全判成被否定。
//
{
    for (const e of entries) {
        const body = String(e.body || "");
        if (!REFUTED_MARKERS.some(m => body.includes(m))) continue;

        // 逐处引用做「上下文」判定
        const re = new RegExp(REF_RE.source, "gi");
        let m;
        while ((m = re.exec(body)) !== null) {
            const refId = m[0];
            if (refId.toLowerCase() === String(e.id).toLowerCase()) continue;
            if (isPlaceholderRef(refId)) continue;
            if (!byId.has(refId)) continue;

            // 取引用点之前的一段作为语境（到上一个句读为止）
            const before = body.slice(Math.max(0, m.index - 40), m.index);
            const inNegativeContext = REFUTE_BEFORE.test(before);
            if (!inNegativeContext) continue;   // 正向指路（「见 kb-xxx」）不算矛盾

            contradictions.push({ refuter: e.id, refuted: refId });
        }
    }

    const seen = new Set();
    for (const c of contradictions) {
        const key = [c.refuter, c.refuted].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const a = byId.get(c.refuter);
        const b = byId.get(c.refuted);
        // 若被否定的一方自己也标注了失效/修订，说明已经处理过，降级为 info
        const targetFixed = REFUTED_MARKERS.some(m => String(b.body || "").includes(m));
        add(targetFixed ? "info" : "warn", c.refuted, "矛盾",
            `${c.refuter}（${a.title}）指出了它的做法失效` +
            (targetFixed ? "；被指条目已自行标注，疑已修订" : " —— 被指条目**未见**修订标注，建议核实"));
    }
}

// ═══ F. 过期措辞 ═════════════════════════════════════════
{
    const STALE_WORDS = ["待补充", "TODO", "FIXME", "暂时", "以后再", "尚未验证", "存疑"];
    for (const e of entries) {
        const body = String(e.body || "");
        const hit = STALE_WORDS.filter(w => body.includes(w));
        if (hit.length) {
            add("info", e.id, "未完成", `正文含未完成标记：${hit.join("、")}`);
        }
    }
}

// ═══ 输出 ═════════════════════════════════════════════════
if (has("--json")) {
    console.log(JSON.stringify({
        kb: KB_PATH,
        root: ROOT,
        total: entries.length,
        fingerprints: fpStat,
        problems,
    }, null, 2));
    process.exit(has("--strict") && problems.some(p => p.level === "error") ? 1 : 0);
}

const ICON = { error: "✗", warn: "⚠", info: "·" };
const LABEL = { error: "错误", warn: "警告", info: "提示" };

console.log(`\n═══ 知识库体检 ═══`);
console.log(`知识库: ${KB_PATH}`);
console.log(`条目数: ${entries.length}`);
console.log(`指纹  : fresh ${fpStat.fresh} / stale ${fpStat.stale} / missing ${fpStat.missing} / 无指纹 ${fpStat.none}`);

const byLevel = { error: [], warn: [], info: [] };
for (const p of problems) byLevel[p.level].push(p);

if (!problems.length) {
    console.log(`\n✅ 未发现问题`);
} else {
    for (const lv of ["error", "warn", "info"]) {
        const list = byLevel[lv];
        if (!list.length) continue;
        console.log(`\n─── ${LABEL[lv]}（${list.length}）───`);
        for (const p of list) {
            console.log(`  ${ICON[lv]} [${p.kind}] ${p.id}: ${p.msg}`);
        }
    }
}

// 分类统计（按检查维度）
const byKind = {};
for (const p of problems) {
    byKind[p.kind] = byKind[p.kind] || { error: 0, warn: 0, info: 0 };
    byKind[p.kind][p.level]++;
}
console.log(`\n─── 分布 ───`);
for (const [k, v] of Object.entries(byKind)) {
    console.log(`  ${k.padEnd(6)} 错误 ${v.error} / 警告 ${v.warn} / 提示 ${v.info}`);
}

const ok = fpStat.fresh + fpStat.none;
console.log(`\n─── 结论 ───`);
console.log(`  可用条目: ${ok}/${entries.length}（指纹 fresh 或无指纹）`);
if (byLevel.error.length) {
    console.log(`  ✗ 存在 ${byLevel.error.length} 个结构错误 —— 建议先修这些，它们会影响检索`);
} else {
    console.log(`  ✓ 无结构错误`);
}
if (byLevel.warn.length) {
    console.log(`  ⚠ ${byLevel.warn.length} 个警告需人工判断（多为源码变动后的复核提示）`);
}
console.log(`\n  ⚠ 本工具查不出「两条知识结论其实冲突但没互相引用」的情况 ——`);
console.log(`    那需要人工阅读。若发现，请在正文里显式引用对方 id 并标注结论，`);
console.log(`    下次体检即可自动捕获。`);

if (has("--verbose")) {
    console.log(`\n─── 全部条目指纹状态 ───`);
    for (const e of entries) {
        const n = (e.fingerprints || []).length;
        console.log(`  ${String(e.status).padEnd(8)} ${e.kind.padEnd(8)} ${e.id}  ${e.title}` +
            (n ? `  [${n} 处指纹]` : ""));
    }
}

if (has("--strict") && byLevel.error.length) process.exit(1);
