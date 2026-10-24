/**
 * Stages —— 关卡的分章几何：**产地的唯一真值**
 * ============================================================================
 *
 * 为什么单独一个文件
 * ------------------
 * 「一共几关」「第 10 关属于哪个产地」「这个产地第几屏」这三个问题，原本散在
 * `SaveData.LEVEL_COUNT`（写死 8）、`HomeRuntime` 的八处 `"苔原 x / 8"`、
 * 以及 `grove.html` 的 `FACTIONS` 里各写一份。改关卡数要动三个文件，还漏。
 *
 * 现在只有这里一份：
 *   · `grove.html` 的地图数据（27 屏）是**内容**，不是这个文件；
 *   · 这个文件只管**怎么读它**（分几章、每章几屏、当前在哪章）。
 *
 * ⚠️ `COUNT` 必须等于 `grove.html` 里 `LEVELS.length`。
 *    `client/tools/grove-runtime-check.js` 会断言 ≥ 24 屏 + 首尾 id，
 *    这里的数字靠 `verify-roster.js` 与它比对（见该脚本的 §4）。
 *
 * ⚠️ 本文件不 import `cc`：家园、战斗、离线验证器三方都要读它。
 */

/** 一整条路的屏数。3 产地 × 9 屏。 */
export const STAGE_COUNT = 27;

/** 每个产地的屏数。设计上三章等长 —— 不等长会让「挑一屏」面板的行宽不一致。 */
export const CHAPTER_SIZE = 9;

export interface ChapterDef {
    /** 与 grove.html 的 theme 前缀一致，只用于日志与调试 */
    id: string;
    /** 给玩家看的产地名 */
    name: string;
    /** 起始屏索引（0 基） */
    from: number;
    /** 这一章有几屏 */
    count: number;
}

/**
 * 三个产地。**顺序就是玩家实际走的顺序** —— 它同时是「挑一屏」面板的行序，
 * 所以这里的排序改了，面板的行序会跟着改（这是想要的行为）。
 */
export const CHAPTERS: ReadonlyArray<ChapterDef> = [
    { id: 'tundra', name: '苔原', from: 0, count: CHAPTER_SIZE },
    { id: 'wither', name: '枯木坡', from: 9, count: CHAPTER_SIZE },
    { id: 'marsh', name: '泥沼', from: 18, count: CHAPTER_SIZE },
];

/** 这一屏属于哪一章。越界时夹到首/尾，**不返回 undefined** ——
 *  调用方全是画 HUD 的地方，一个 undefined 会在启动瞬间白屏。 */
export function chapterOf(index: number): ChapterDef {
    const i = Number.isFinite(index) ? Math.floor(index) : 0;
    for (let k = CHAPTERS.length - 1; k >= 0; k--) {
        const c = CHAPTERS[k];
        if (i >= c.from) return c;
    }
    return CHAPTERS[0];
}

/** 屏在它所属产地里的序号，**1 基**（给玩家看的是「1 / 9」，不是「0 / 9」）。 */
export function stageInChapter(index: number): number {
    const c = chapterOf(index);
    return Math.max(1, Math.min(c.count, index - c.from + 1));
}

/**
 * 「枯木坡 · 1 / 9」。
 *
 * **不要写成「第 10 / 27 关」。** 27 是一个内部数字：玩家在枯木坡第 1 屏，
 * 告诉他"第 10 关"只会让他觉得前面还有 26 个一样的东西要打 ——
 * 而那正是"关卡无脑搞那么长"这个抱怨的来源。章的边界感必须由文案给出。
 */
export function stageLabel(index: number): string {
    const c = chapterOf(index);
    return `${c.name} · ${stageInChapter(index)} / ${c.count}`;
}

/** 主界面「苔原 x / 9」那种不带点的紧凑写法。 */
export function chapterProgressLabel(cleared: number): string {
    const i = Math.max(0, Math.min(STAGE_COUNT - 1, Math.floor(cleared)));
    const c = chapterOf(i);
    return `${c.name} ${stageInChapter(i)} / ${c.count}`;
}
