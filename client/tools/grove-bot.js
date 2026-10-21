/* ============================================================================
   grove-bot.js —— 自动试玩机器人（冒烟测试 / 诊断脚本共用）

   以前这套逻辑在 grove-smoke.js 和 grove-diag.js 里各有一份，结果两边漂移：
   诊断那份的地面结算点还写着断崖的 535 / 891，跑到双坑、高台就全是错的方向，
   于是"关卡数据不好看"有一半是机器人自己的锅。

   策略刻意做成"一个正常玩家会做的事"，不用最优解：
     · 场上有球先管球 —— 球会漏气，放着不管等于这一轮白打
     · 只在同一层打人，不同层先换层（喷是水平的）
     · 保持约 175px 距离喷，贴脸必吃碰撞
     · 裹到两层才冲撞
     · 往哪推**用游戏自己的预瞄线算**，不写死坐标
     · 被挡住就跳 —— 人被木桩/墙角卡住时按方向键是没用的，这一步必须补

   它跑不通就说明关卡本身有硬伤，而不是"AI 不够聪明"。
   ========================================================================== */

function layerExits(P, y) {
  const segs = P.PLATS.filter(q => q.kind !== "ground" && Math.abs(q.y - y) < 14)
    .sort((a, c) => a.x - c.x);
  if (!segs.length) return null;
  const outs = [];
  for (let i = 1; i < segs.length; i++) {
    outs.push((segs[i - 1].x + segs[i - 1].w + segs[i].x) / 2);
  }
  const first = segs[0], last = segs[segs.length - 1];
  // 端点要退到**真的掉下去**的位置：角色半宽 23，只退 4px 的话人还站在板上，
  // 走过去又走回来，永远掉不下去（高台实测：贴着 248 层的左边缘来回摆了 100 秒）。
  if (first.x > P.WALL_L + 6) outs.push(first.x - 34);
  if (last.x + last.w < P.WALL_R - 6) outs.push(last.x + last.w + 34);
  return outs.length ? outs : null;
}

function nearest(x, arr) {
  let best = arr[0], bd = 1e9;
  for (const v of arr) { const d = Math.abs(v - x); if (d < bd) { bd = d; best = v; } }
  return best;
}

/** 头顶上第一层能跳上去的平台（跳跃高度约 150，留 16px 余量） */
/**
 * 上一层该爬哪块平台。
 *
 * 只按 y 选是错的：双塔那关 462 层有两段（26..320 / 640..860），
 * 只按高度会选中左边那段，机器人就从右边平台的边缘走下去，摔回地面。
 * 实测：在 640..860 上来回掉了 100 秒，右塔顶那只从头到尾没碰到。
 *
 * 所以先看水平距离 —— 「脚下就有的那块」永远比「更近但要走过去的那块」优先。
 */
function layerAbove(P, y, x, tgtX) {
  let best = null, bestScore = 1e9;
  for (const q of P.PLATS) {
    if (q.kind === "ground") continue;
    const up = y - q.y;
    if (up < 24 || up > 150) continue;
    // 打分看"站上这块台面能不能更接近目标"，不是"这块台面离我有多近"。
    // 按离我近打分时，深井那关机器人会去爬右边那座塔（它离得近），
    // 而目标在左边的 350 层 —— 爬到顶发现过不去，掉回地面，再从右边爬一遍。
    // 实测就这么循环了 240 秒。
    const cx = Math.max(q.x + 30, Math.min(q.x + q.w - 30, tgtX === undefined ? x : tgtX));
    const gap = tgtX === undefined ? 0 : Math.abs(cx - tgtX);
    const score = gap + up * 0.4;
    if (score < bestScore) { bestScore = score; best = q; }
  }
  return best;
}

/**
 * 地面球该往哪推 —— 直接问游戏：两个方向各预测一次，挑结果更好的。
 *
 * 不写死坐标的原因见文件头。而且这样顺带把"预瞄线骗人"变成可测的：
 * 预测说进营地、实际烧了，机器人就会漏收成，冒烟测试立刻红。
 *
 * **打分必须跟着当前目标变**，否则 9 关巡回毫无意义：
 * 只会贪收成的话，落袋关和清场关会打出同一套操作，
 * 那就分不清"目标没做出差异"和"机器人不看目标"。
 *
 * 收成公式（grove.html 里写的）：火坑 = 装几只 ×2；营地 = 装几只 +1。
 * 所以装 2 只以上时火坑更值钱 —— 贪是合理的，除非这一关要的是落袋。
 */
function pickPushDir(P, S, b) {
  const st = P.curStage ? P.curStage() : null;
  const needBank = st && st.goal === "bank" && S.stat.bankHolds < st.bank;
  const needFood = st && st.goal === "collect";

  let bestDir = 1, bestScore = -1e9;
  for (const dir of [-1, 1]) {
    const pr = P.predictBall(b, dir);
    const h = b.holds || 0;
    let sc;
    if (pr.end === "camp") sc = h + 1 + (needBank ? 60 : 0);
    else if (pr.end === "fire") sc = h * 2 + (needBank ? -60 : 0);
    else if (pr.end === "stump") sc = 3;
    else if (pr.end === "wall") sc = 1;
    // 水塘：球沉底、人全回来、一分不给 —— 比停在原地差得多。
    // 不给负分的话，机器人会优先选"有个明确结局"的方向，
    // 泥沼那关它往左推了 113 次水（沉 113 颗球，240 秒清了 3 只）。
    else if (pr.end === "water") sc = -80;
    else sc = 4;                                   // stop / air：球留在场上等下一轮
    if (needFood && pr.end === "fire") sc += 20 + h * 6;
    sc -= pr.pts.length * 0.01;                    // 同分时选近的
    if (sc > bestScore) { bestScore = sc; bestDir = dir; }
  }
  return bestDir;
}

/**
 * @param P  window.GROVE
 * @param S  P.S
 * @param mem 跨帧记忆（fallDir / stuck），每关新建一份
 */
/** 脚下这块往哪一端走才能下到更低的一层。返回 x；不确定就返回 null。
 *
 *  坡是后加的，之前"目标在下面"只找 layerExits（平台的缺口）。
 *  站在坡上时根本没有缺口 —— 坡是一整条连续的斜面，
 *  于是机器人只会朝目标的 x 走，目标又在它正下方跟着走，
 *  两边一起原地摆（缓坡：BOSS 站在坡下，机器人 240 秒没动过 30px）。
 *
 *  坡必须往**低的那一端**走才是下坡。往高的那端走是上坡，
 *  走到底只会站到上一层平台上 —— 越走越远。
 */
function downExit(P, p) {
  const g = p.ground;
  if (!g) return null;
  if (g.kind === "ramp") {
    const r = (P.RAMPS || []).find(q => Math.abs(q.x - g.x) < 2 && Math.abs(q.w - g.w) < 2);
    if (!r) return null;
    return r.yR > r.yL ? g.x + g.w + 2 : g.x - 2;
  }
  const leftWall = g.x <= P.WALL_L + 1;
  const rightWall = g.x + g.w >= P.WALL_R - 1;
  if (leftWall && rightWall) return null;      // 两边都是墙，这一层没有出口
  if (leftWall) return g.x + g.w + 2;
  if (rightWall) return g.x - 2;
  return null;                                  // 两边都能掉：交给调用方按目标选
}

function botStep(P, S, mem) {
  mem = mem || {};
  const p = S.p;
  if (!p || p.dead) return;

  S.keys.left = false; S.keys.right = false;

  _decide(P, S, mem);

  // ---- 方向抖就按住 -----------------------------------------------------
  // 站在平台边上时，机器人会**一帧向左一帧向右**：这一帧判定"走到缺口掉下去"，
  // 下一帧人已经悬空，判定换成"朝目标走"，于是又踩回平台上。原来只在空中记
  // fallDir，管不住这种落地/离地的来回切换 —— 泥沼实测在 462 层右端以 6px 的
  // 幅度原地抖了 200 秒，350 层上那三只从头到尾没碰到。
  // 按"方向"本身记账：翻向之后至少按住 9 帧（9 × 6px ≈ 54px，够走下台面）。
  const dirNow = S.keys.left ? -1 : S.keys.right ? 1 : 0;
  if (dirNow) {
    if (mem.dir && dirNow !== mem.dir && mem.dirT < 9) {
      S.keys.left = mem.dir < 0; S.keys.right = mem.dir > 0;
      mem.dirT++;
    } else {
      if (dirNow !== mem.dir) mem.dirT = 0;
      mem.dir = dirNow;
      mem.dirT++;
    }
  } else {
    mem.dir = 0; mem.dirT = 0;
  }

  // ---- 卡住就跳 ---------------------------------------------------------
  // 人是会自己跳过去的，机器人原来不会：断崖地面在 x≈238 被木桩挡住，
  // 它顶着桩子按了 15 秒的"左"，球在上层漏气崩开 —— 9 颗球全死在这一条上。
  if (S.keys.left || S.keys.right) {
    if (Math.abs(p.x - (mem.lastX === undefined ? p.x : mem.lastX)) < 0.6) mem.stuck = (mem.stuck || 0) + 1;
    else mem.stuck = 0;
    if (mem.stuck > 14 && p.onGround) { S.press.jump = true; mem.stuck = 0; }
  } else {
    mem.stuck = 0;
  }
  mem.lastX = p.x;
}

function _decide(P, S, mem) {
  const p = S.p;

  // 落地就清掉"下落方向"。
  // 不清的话，只要有一次判定成"该往右掉下去"，之后再怎么重新决策都还带着那个
  // 右 —— 泥沼那关机器人贴着右墙按了 200 秒"右"，而目标在它左边的地面上
  // （实测 240 秒超时，剩 1 只打不掉）。fallDir 只在"走到边缘踩空"那几帧有意义。
  if (p.onGround && p.ground) mem.fallDir = 0;

  // 1) 场上有球就先管球。球是唯一的收益出口，而且会漏气。
  //    选球按"谁快漏光"排，不是按离得近 —— 人也是先救快炸的那颗。
  //    （按距离选的时候断崖 9 颗球全崩，因为机器人总在伺候刚造的那颗。）
  if (S.balls.length) {
    let nb = S.balls[0], best = 1e9;
    for (const b of S.balls) {
      const d = Math.abs(b.x - p.x) + Math.abs(b.y - p.y) * 0.8;
      const sc = b.air * 260 + d * 0.35;
      if (sc < best) { best = sc; nb = b; }
    }
    const dyB = nb.y - p.y;

    // 同层 + 停住 -> 站到"这一球该去的地方"那一侧去推
    if (Math.abs(nb.vx) < 100 && Math.abs(dyB) < 50) {
      let target;
      if (nb.y < P.PLATS[0].y - 20) {
        // 球还在高处：先把它送出这一层的缺口，否则一路推到墙上只是弹回来
        const outs = layerExits(P, nb.y);
        target = outs ? nearest(nb.x, outs) : null;
      }
      if (target == null) target = nb.x + pickPushDir(P, S, nb) * 240;

      const goRight = target > nb.x;
      const standX = nb.x + (goRight ? -48 : 48);
      if (p.x < standX - 14) S.keys.right = true;
      else if (p.x > standX + 14) S.keys.left = true;
      else if (goRight) S.keys.right = true;
      else S.keys.left = true;
      return;
    }

    // 不同层 -> 先换到球那一层
    if (Math.abs(dyB) >= 50) {
      if (dyB > 50) {
        // 球在下面：走到这块地面的下坡端 / 缺口端掉下去。
        // 站在坡上时"往近的那端"是错的 —— 近的那端可能是上坡。
        if (p.onGround && p.ground) {
          const g = p.ground;
          const de = downExit(P, p);
          const toL = p.x - g.x, toR = (g.x + g.w) - p.x;
          if (de != null && de > p.x + 4) S.keys.right = true;
          else if (de != null && de < p.x - 4) S.keys.left = true;
          else if (toL < toR) S.keys.left = true;
          else S.keys.right = true;
        } else if (nb.x > p.x + 10) S.keys.right = true;
        else if (nb.x < p.x - 10) S.keys.left = true;
      } else {
        // 球在上面：对准之后起跳。平台是单向的，从下面能穿上去 ——
        // 所以站在球的正下方跳是**对**的，别绕到边缘去。
        if (Math.abs(nb.x - p.x) > 12) {
          if (nb.x > p.x) S.keys.right = true; else S.keys.left = true;
        } else if (p.onGround) S.press.jump = true;
      }
      return;
    }

    // 同层但还在滚：朝球追（追不上就等它停，别硬顶）
    if (nb.x > p.x + 8) S.keys.right = true;
    else if (nb.x < p.x - 8) S.keys.left = true;
    return;
  }

  const alive = S.foes.filter(f => !f.dead);
  if (!alive.length) return;

  // 2) 同层优先
  const same = alive.filter(f => Math.abs(f.y - p.y) < 70);   // 70 而不是 56：飞行怪会卡在两层平台之间的夹缝里，
  // 差 62px 就对不上，机器人把它当"另一层"，永远打不到（高台实测剩一只乌鸦收尾）
  const pool = same.length ? same : alive;
  let tgt = pool[0], bd = 1e9;
  for (const f of pool) { const d = Math.abs(f.x - p.x); if (d < bd) { bd = d; tgt = f; } }

  // 目标锁定：不锁的话，"跳上去的落脚点"每帧在平台两端来回翻，
  // 机器人就在两层之间左右摆，一跳都不跳（高台实测：60 秒原地摆，
  // 顶层 3 只从头到尾没碰到）。锁 4 秒或者锁到目标死掉为止 ——
  // 注意这里**不能**要求目标和玩家同层：要修的就是"目标在上一层"的情况。
  mem.lockT = (mem.lockT || 0) - 1;
  if (mem.tgt && !mem.tgt.dead && mem.tgt.coat < 3 && mem.lockT > 0) {
    tgt = mem.tgt;
  } else {
    mem.tgt = tgt;
    mem.lockT = 240;
  }
  if (Math.abs(tgt.y - p.y) < 56) mem.lockT = Math.max(mem.lockT, 120);

  const dx = tgt.x - p.x;
  const dy = tgt.y - p.y;
  const dist = Math.abs(dx);

  // 3) 不同层：换层
  if (Math.abs(dy) > 56) {
    if (dy > 56) {
      // 目标在下面：走到这一层的出口掉下去。
      // 不能朝目标的 x 走 —— 目标在另一层，朝它走只会在缺口上方左右横跳。
      if (p.onGround && p.ground) {
        // 站在坡上时**不查 layerExits**：坡的 y 是个连续值，随便就会撞进
        // 某个平台层的 ±14 窗口里，然后机器人往那个层的缺口走 ——
        // 而那个缺口在坡的上方（缓坡实测：462 层离坡面只有 7px，
        // 机器人一路往左上坡、再折返下坡，在 470~503 之间摆了 200 秒）。
        const onRamp = p.ground.kind === "ramp";
        const outs = onRamp ? null : layerExits(P, p.y);
        const ex = outs ? nearest(p.x, outs) : downExit(P, p);
        if (ex != null) {
          if (ex > p.x + 6) { S.keys.right = true; mem.fallDir = 1; }
          else if (ex < p.x - 6) { S.keys.left = true; mem.fallDir = -1; }
          else if (ex > p.x) { S.keys.right = true; mem.fallDir = 1; }
          else { S.keys.left = true; mem.fallDir = -1; }
        } else if (dx > 10) S.keys.right = true;
        else if (dx < -10) S.keys.left = true;
      } else {
        // 已经在空中：保持下落前的方向。掉头会立刻踩回平台，
        // 于是"走一步 / 踩空 / 回头"，角色在缺口边缘一帧前进一帧后退。
        if (mem.fallDir > 0) S.keys.right = true;
        else if (mem.fallDir < 0) S.keys.left = true;
        else if (dx > 10) S.keys.right = true;
        else if (dx < -10) S.keys.left = true;
      }
      return;
    }

    let plat = null;
    for (const q of P.PLATS) {
      if (Math.abs(q.y - tgt.y) < 8 && tgt.x > q.x - 20 && tgt.x < q.x + q.w + 20) { plat = q; break; }
    }

    // 目标太高，一跳够不着（跳跃高度约 150）-> 一层一层往上爬。
    // 不补这条的话机器人永远站在低层朝高层跳，落回原地，
    // 高台顶部那两只从头到尾打不到（实测 240 秒清 5/7）。
    if (dy < -30 && tgt.y < p.y - 150) {
      // 爬层目标必须锁住。
      // 不锁的话：人在两层之间时 layerAbove 会在"左边那层"和"右边那层"之间
      // 逐帧翻，want 一帧 100 一帧 700，机器人就在中间那段地面上左右横走 ——
      // 深井实测卡了 200 秒，350 层那只从头到尾没碰到。
      mem.climbT = (mem.climbT || 0) - 1;
      if (mem.climbT <= 0 || mem.climbY === undefined || Math.abs(mem.climbY - p.y) > 130) {
        const layer = layerAbove(P, p.y, p.x, tgt.x);
        if (layer) {
          const lo = layer.x + 40, hi = layer.x + layer.w - 40;
          mem.climbX = Math.max(lo, Math.min(hi, tgt.x));
          mem.climbY = p.y;
          mem.climbT = 110;
        } else {
          mem.climbX = undefined;
        }
      }
      if (mem.climbX !== undefined && Math.abs(mem.climbY - p.y) <= 130) {
        const want = mem.climbX;
        if (p.x < want - 14) S.keys.right = true;
        else if (p.x > want + 14) S.keys.left = true;
        else if (p.onGround) S.press.jump = true;
        return;
      }
    }

    if (plat && dy < -30) {
      // 落点：平台内、离敌人至少 70px、离当前位置最近的那个点。
      //
      // 原来是"跳到平台离敌人最远的那一头"。在双塔那关它会从 782 一路走回 722，
      // 中途按跳，落在 248 层平台外面（那层只到 680），白白摔下去 —— 最后一关
      // 剩一只塔顶的虫，240 秒没打掉。安全的位置应该是"脚下稍微错开"，
      // 不是"整块平台的对角线"。
      const lo = plat.x + 34, hi = plat.x + plat.w - 34;
      let safeX = Math.max(lo, Math.min(hi, p.x));
      if (Math.abs(safeX - tgt.x) < 70) {
        safeX = Math.max(lo, Math.min(hi, tgt.x < p.x ? tgt.x + 90 : tgt.x - 90));
      }
      if (p.x < safeX - 14) S.keys.right = true;
      else if (p.x > safeX + 14) S.keys.left = true;
      if (p.onGround && Math.abs(p.x - safeX) < 40) S.press.jump = true;
    } else {
      if (dx > 10) S.keys.right = true;
      else if (dx < -10) S.keys.left = true;
      if (p.onGround) S.press.jump = true;
    }
    return;
  }

  // 4) 同层：保持距离喷；太近就撞开（撞的时候无敌）
  const IDEAL = 175;

  // 子弹会被木桩挡住 —— 站在桩子这侧一直喷是打不到另一侧的。
  // 不处理的话机器人会在木桩后面站满 100 秒，一枪都不中（实测）。
  let blocked = false;
  for (const st of S.stumps) {
    if (st.hp <= 0) continue;
    const lo = Math.min(p.x, tgt.x), hi = Math.max(p.x, tgt.x);
    if (st.x > lo && st.x < hi && Math.abs(st.y - p.y) < 110) blocked = true;
  }
  if (blocked) {
    if (dx > 0) S.keys.right = true; else S.keys.left = true;
    if (p.onGround) S.press.jump = true;    // 跳上桩子，从另一侧下来
    return;
  }

  if (dist > IDEAL + 55) {
    if (dx > 0) S.keys.right = true; else S.keys.left = true;
  } else if (dist < 100) {
    if (dx > 0) S.keys.left = true; else S.keys.right = true;
    if (p.dashCd <= 0) S.press.dash = true;
  } else {
    p.face = dx >= 0 ? 1 : -1;
  }

  if (dist < 300) S.press.atk = true;
  if (tgt.coat >= 2 && dist < 64 && p.dashCd <= 0) S.press.dash = true;
}

module.exports = { botStep, layerExits, nearest, pickPushDir };
