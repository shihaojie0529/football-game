import { tuningForTeam, type Tuning } from "../tuning.ts";
import { gainPossession } from "./possession.ts";
import { foul } from "./rules.ts";
import { attackDirOf, type LungeKind, type Player, type World } from "./types.ts";
import { fromAngle } from "./vec.ts";

/**
 * 抢断与铲球（DESIGN.md D12，防守手感参考 FC）。
 *
 * 两种出脚，同一套判定窗口机制，但数值刻意拉开：
 *
 * | | 抢断 poke | 铲球 slide |
 * |---|---|---|
 * | 够到多远 | 近（1.5 m） | 远（2.6 m） |
 * | 落空硬直 | 0.4 s | **1.1 s** |
 * | 铲到人 | 几乎不会 | 容易，判犯规 |
 *
 * 铲球的硬直必须明显长于抢断，否则"够得更远"就是无脑更优解，
 * 两个键退化成一个键 —— 这和三种传球必须真正不同是同一个道理。
 */

interface KindSpec {
  windowTime: number;
  range: number;
  recovery: number;
  speed: number;
  foulContact: number;
}

function spec(t: Tuning, kind: Exclude<LungeKind, null>): KindSpec {
  return kind === "slide"
    ? {
        windowTime: t.slide.windowTime,
        range: t.slide.range,
        recovery: t.slide.recovery,
        speed: t.slide.speed,
        foulContact: t.slide.foulContact,
      }
    : {
        windowTime: t.tackle.windowTime,
        range: t.tackle.range,
        recovery: t.tackle.recovery,
        speed: t.tackle.lungeSpeed,
        foulContact: t.rules.foulContact,
      };
}

export function updateTackleTimers(world: World, t: Tuning, dt: number): void {
  // 先结算再扣时间：本 tick 刚出脚的那一下也要立刻参与判定，
  // 否则按键要等到下一帧才生效，防守会慢半拍。
  //
  // 死球期间只跳过【结算】，计时器照常走 —— 早先整个函数被跳过，
  // 结果玩家在对方开球时按下的那一脚会卡住两秒多不结算，
  // 而且硬直也不会消化，比赛恢复的瞬间人还是僵的。
  if (world.phase === "playing") resolveTackles(world, t);
  for (const p of world.players) {
    const playerTuning = tuningForTeam(t, p.team);
    if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
    if (p.tackleCooldown > 0) p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
    if (p.lunge > 0) {
      p.lunge = Math.max(0, p.lunge - dt);
      if (p.lunge === 0) {
        // 窗口耗尽而球还没断下来 → 判定落空，吃硬直
        p.stun = spec(playerTuning, p.lungeKind ?? "poke").recovery;
        p.lungeKind = null;
      }
    }
  }
}

/** 发起一次出脚。返回是否真的出脚了（硬直中/冷却中会被拒绝） */
export function startTackle(
  world: World,
  index: number,
  t: Tuning,
  kind: Exclude<LungeKind, null> = "poke",
): boolean {
  const p = world.players[index];
  if (!p) return false;
  t = tuningForTeam(t, p.team);
  // 死球期间不能出脚：对方还在退规定距离，这时候能铲就没有"退开"可言了
  if (world.phase !== "playing") return false;
  if (p.stun > 0 || p.lunge > 0 || p.tackleCooldown > 0) return false;

  const s = spec(t, kind);
  p.lunge = s.windowTime;
  p.lungeKind = kind;
  p.tackleCooldown = s.windowTime + s.recovery;
  // 往前扑/滑出去，动作上要看得出是"出脚"而不是原地按键
  const d = fromAngle(p.facing);
  p.vel.x += d.x * s.speed;
  p.vel.y += d.y * s.speed;
  world.tackles += 1;
  return true;
}

/** 判定窗口内够到球就断下来；够不到球却撞到人就是犯规 */
function resolveTackles(world: World, tuning: Tuning): void {
  const b = world.ball;
  const carrier = b.owner !== null ? world.players[b.owner] : undefined;

  if (b.z <= 0.5 || carrier?.slot === 0) {
    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i]!;
      const t = tuningForTeam(tuning, p.team);
      if (p.lunge <= 0 || (carrier ? p.team === carrier.team : p.team === world.lastTouch)) continue;
      // 门将已经抱住的球不能从手中踢走。
      if (carrier?.slot === 0) continue;
      const s = spec(t, p.lungeKind ?? "poke");
      if (Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y) > s.range) continue;

      world.lastTouch = p.team;
      if (p.lungeKind !== "slide") {
        // 站立抢断是收球；铲球才把球解围出去，不能两者都捅回对方脚下。
        gainPossession(world, i);
        world.offsideFlags.length = 0;
      } else {
        const f = fromAngle(p.facing);
        const away = attackDirOf(p.team);
        const dx = f.x * t.tackle.knockFacing + away * (1 - t.tackle.knockFacing);
        const dy = f.y * t.tackle.knockFacing;
        const length = Math.hypot(dx, dy) || 1;
        b.owner = null;
        b.vel.x = dx / length * t.tackle.knock;
        b.vel.y = dy / length * t.tackle.knock;
        b.z = b.vz = b.spin = 0;
        b.stickyLock = t.tackle.knockLock;
        b.pickupBlockedPlayer = null;
        world.receiver = null;
        world.passHold = 0;
      }
      if (carrier) carrier.stun = Math.max(carrier.stun, 0.22);
      world.tacklesWon += 1;
      world.matchStats[p.team].tackles += 1;
      // 成功就不吃硬直（铲球成功仍然要站起来，见下面的 slide 处理）
      p.lunge = 0;
      if (p.lungeKind === "slide") p.stun = t.slide.recovery * 0.45;
      p.lungeKind = null;
      return;
    }
  }

  // 没够到球的那些人，检查有没有撞到人 → 犯规（D5）
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    const t = tuningForTeam(tuning, p.team);
    if (p.lunge <= 0) continue;
    const s = spec(t, p.lungeKind ?? "poke");
    for (const q of world.players) {
      if (q.team === p.team) continue;
      const dx = q.pos.x - p.pos.x;
      const dy = q.pos.y - p.pos.y;
      const dist = Math.hypot(dx, dy);
      const gap = dist - p.radius - q.radius;
      if (gap > s.foulContact) continue;
      // 还得是【撞】上去的：朝对手方向的速度分量不够就只是伸脚够了一下，不判犯规
      const closing = dist > 1e-6 ? (p.vel.x * dx + p.vel.y * dy) / dist : 0;
      if (closing < t.rules.foulSpeed) continue;
      // 出脚撞到人却没碰到球。硬直只惩罚"没铲到"，不惩罚"铲的是人" —— 这一条补上后者
      p.lunge = 0;
      p.stun = s.recovery;
      p.lungeKind = null;
      foul(world, t, i, { x: q.pos.x, y: q.pos.y });
      return;
    }
  }
}

/** 硬直中的球员完全不能动 —— 这才叫"代价" */
export function isFrozen(p: Player): boolean {
  return p.stun > 0;
}
