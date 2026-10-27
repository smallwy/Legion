/* 逐屏清场：有跳虫的那些屏，无限血 + 机器人还能不能清完。
   这是"跳虫强度是否过猛"的唯一客观判据 —— 前 3 屏通了不算数，
   跳虫本来就不在那三屏。 */
const { boot } = require("./grove-env");
const { botStep: botDecide } = require("./grove-bot");

function seed(S, n) {
  let x = (n === undefined ? 20261020 : n) >>> 0;
  S.rng = () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const stages = process.argv.slice(2).map(Number);
const list = stages.length ? stages : [0, 1, 2, 3, 4, 5, 6, 7, 8];
const rows = [];

for (const stage of list) {
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, stage);
  S.p.hp = 999; S.p.maxHp = 999;

  /* 先数这一屏一共会放多少只跳虫（含后续波次）：
     在开打前把每一波都过一遍是做不到的（会污染 rng），
     所以只数开场这一波的。动态出现的靠最终结果说话。 */
  const jumpers0 = S.foes.filter((f) => f.jumper).length;

  const mem = {};
  let frames = 0;
  let jumpersSeen = jumpers0;
  while (frames < 60 * 180 && S.phase === "play") {
    botDecide(P, S, mem);
    P.tick(1 / 60);
    frames++;
    jumpersSeen = Math.max(jumpersSeen, S.foes.filter((f) => f.jumper).length);
  }

  rows.push({
    屏: P.curStage().id || stage,
    结果: S.phase,
    用时: +S.t.toFixed(0),
    剩: S.foes.length,
    开场跳虫: jumpers0,
    场上最多跳虫: jumpersSeen,
    清掉: S.stat && S.stat.cleared != null ? S.stat.cleared : "-",
  });
  console.log("第 " + (stage + 1) + " 屏 " + (P.curStage().id || "") +
    " → " + S.phase + " 用时 " + S.t.toFixed(0) + "s 剩 " + S.foes.length +
    " 只（开场跳虫 " + jumpers0 + "）");
  if (S.phase !== "clear") {
    for (const f of S.foes) {
      console.log("    剩: " + f.def.name + (f.jumper ? "J" : "") +
        "@" + f.x.toFixed(0) + "," + f.y.toFixed(0) + "c" + f.coat +
        (f.onGround ? "g" : "a"));
    }
  }
}
console.log("");
console.table(rows);
