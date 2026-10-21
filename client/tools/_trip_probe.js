/* 一次性探针：跑完整一趟，看"贪"的曲线长什么样
   node _trip_probe.js           全部六只
   node _trip_probe.js 0         只看 0 号角色 */
const { boot } = require("./grove-env");
const { botStep } = require("./grove-bot");

const HERO = process.env.HERO === undefined ? null : +process.env.HERO;

function trip(hero) {
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  S.heroIdx = hero;
  P.beginRun(0);
  S.p.hp = 999; S.p.maxHp = 999;   // 机器人不会躲，血量放开只测"趟"的曲线
  const rows = [];
  for (let g = 0; g < P.LEVELS.length; g++) {
    const mem = {};
    let f = 0;
    while (S.phase === "play" && f < 60 * 240) { botStep(P, S, mem); P.tick(1 / 60); f++; }
    rows.push({
      g: g, ok: S.phase === "clear", t: +(f / 60).toFixed(1),
      belly: S.belly, multi: +S.trip.multi.toFixed(2), loot: S.trip.loot,
      food: S.food, made: S.stat.made, burst: S.stat.burst,
    });
    if (S.phase !== "clear") break;
    S.p.hp = 999;
    if (g < P.LEVELS.length - 1) P.nextLevel();
  }
  return { rows, S };
}

const heroes = HERO === null ? [0] : [HERO];
for (const h of heroes) {
  const { rows, S } = trip(h);
  console.log("\n角色 " + h + "   " + "关  过  用时    肚子  倍率  攒   本关收成  造球  崩");
  for (const r of rows) {
    console.log("        " + String(r.g + 1).padEnd(3) +
      (r.ok ? " ✓  " : " ✗  ") +
      String(r.t).padStart(5) + "s  " +
      String(r.belly).padStart(4) + "  " +
      String(r.multi).padStart(5) + "  " +
      String(r.loot).padStart(4) + "  " +
      String(r.food).padStart(6) + "  " +
      String(r.made).padStart(4) + "  " + String(r.burst).padStart(3));
  }
  const gain = Math.round(S.trip.loot * S.trip.multi);
  console.log("        收工可得 " + gain + "（攒 " + S.trip.loot + " × " + S.trip.multi.toFixed(2) + "）");
}
