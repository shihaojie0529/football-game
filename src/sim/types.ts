import type { Vec2 } from "./vec.ts";

export interface Player {
  pos: Vec2;
  /** 上一 tick 的位置，供渲染插值使用（D26） */
  prevPos: Vec2;
  vel: Vec2;
  /** 朝向，弧度。x 正方向为 0，顺时针为正（屏幕坐标 y 向下） */
  facing: number;
  prevFacing: number;
  radius: number;
  /** 在阵型里的位置索引（见 formation.ts）。0 号永远是门将 */
  slot: number;
  /** 0 = 玩家控制的队伍（朝 +x 进攻），1 = 对手 */
  team: 0 | 1;
  /** > 0 时不能行动：铲球落空的硬直（D12） */
  stun: number;
  /** > 0 时出脚判定窗口开着（抢断或铲球） */
  lunge: number;
  /** 这一脚是抢断还是铲球。两者射程、硬直、犯规判定都不同 */
  lungeKind: LungeKind;
  /** > 0 时不能再次发起铲球 */
  tackleCooldown: number;
  /** AI 持球计时：场上球员决策与对方门将自动发球使用 */
  holdTime: number;
  /** AI 防守时已经贴住持球人多久了。压满一段时间才敢出脚（先封堵、后择机） */
  pressTime: number;
  /** > 0 时门将正在鱼跃：伸手范围放大，扑完要趴一会儿。只有门将会用 */
  dive: number;
  /**
   * AI 本 tick 想去的点，世界坐标。
   * 存在 world 里而不是算完就扔，是为了让渲染层能画出来做调试 ——
   * "这个前锋为什么不插上"这种问题，看不见目标点就只能靠猜。
   */
  aim: Vec2;
}

export interface Ball {
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  /** 离地高度，米（D7/D8） */
  z: number;
  prevZ: number;
  vz: number;
  /** 旋转量，来源是出球瞬间的横向速度。只在空中产生弧线 */
  spin: number;
  /** 控球者在 world.players 中的索引；null = 自由球 */
  owner: number | null;
  /** 接球冷却；pickupBlockedPlayer 为 null 时限制全员，否则只限制该球员。 */
  stickyLock: number;
  /** 传球仅限制出球人回吸，队友和对手仍可接球。 */
  pickupBlockedPlayer: number | null;
}

/**
 * 输入是纯数据。sim 层不知道键盘存在（D25）。
 */
export interface InputState {
  /** -1..1 */
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** 射门键当前是否按住。松开的边缘检测在 sim 内部完成 */
  shoot: boolean;
  /** J — 短传 */
  passShort: boolean;
  /** L — 直塞 */
  passThrough: boolean;
  /** I — 长传/高球 */
  passLong: boolean;
  /** 输入设备提供的真实按下沿；省略时兼容旧模拟输入的逐帧边沿推导。 */
  actionPressed?: Record<ChargeKind, boolean>;
}

export const emptyInput = (): InputState => ({
  moveX: 0,
  moveY: 0,
  sprint: false,
  shoot: false,
  passShort: false,
  passThrough: false,
  passLong: false,
});

/**
 * 出脚的两种方式（参考 FC 的防守手感）：
 *   poke  抢断 —— 站立短促出脚，够得近、落空硬直短、几乎不犯规
 *   slide 铲球 —— 滑铲，够得远、但落空硬直长得多，也更容易铲到人
 */
export type LungeKind = "poke" | "slide" | null;

/** 会蓄力的动作。射门和三种传球是同一套机制 */
export type ChargeKind = "shot" | "short" | "through" | "long";

/** 死球重新开球的方式（DESIGN.md D3/D5） */
export type RestartKind = "kickoff" | "throwIn" | "corner" | "goalKick" | "freeKick";

export interface Restart {
  kind: RestartKind;
  /** 由哪一队开出 */
  team: 0 | 1;
  /** 开球点 */
  at: Vec2;
  /** 主罚的球员索引 */
  taker: number;
  /** 给 HUD 看的一句话，例如"越位"、"犯规 · 任意球" */
  label: string;
  /**
   * 死球的三个阶段。**全程没有任何瞬移** ——
   * 球停在它自己滚出去的地方，主罚球员跑过去捡，再带到开球点。
   *
   *   fetch — 主罚球员正跑向球
   *   carry — 已经捡到球，正带向开球点
   *   ready — 球已就位，交还控制权并等待主罚人实际出球后恢复比赛
   */
  stage: "fetch" | "carry" | "ready";
  /** 卡住兜底：捡球超时就直接把球放到开球点，免得比赛卡死 */
  fetchTimeout: number;
}

/**
 * 比赛阶段。
 *
 * "playing" 之外的一切都是死球：不检测出界、不判犯规、不能铲抢。
 * 少了这个状态机，一次出界会在同一帧被反复判罚。
 */
export type Phase = "playing" | "restart" | "fullTime";

/** 每支球队的进攻方向：0 队朝 +x，1 队朝 -x */
export const attackDirOf = (team: 0 | 1): 1 | -1 => (team === 0 ? 1 : -1);

export interface World {
  /** 按队伍记录的本场数据，只有完整重开才清零。 */
  matchStats: [TeamStats, TeamStats];
  players: Player[];
  /** 玩家控制的球员索引 */
  controlled: number;
  ball: Ball;
  /**
   * 当前正在蓄力的动作。射门和三种传球共用一套蓄力状态机：
   * 同一时刻只能蓄一个，先按下的那个键说了算，松开时出球。
   */
  charge: { kind: ChargeKind | null; time: number };
  /** 两队进球数，索引即 team */
  goals: [number, number];
  shots: number;
  tackles: number;
  tacklesWon: number;
  passes: number;
  /**
   * D16：传球出脚后先保持控制传球者一段时间，给"传完就跑"留出空间，
   * 之后再把控制权交给预测接球点最近的队友。> 0 表示还在这个窗口里。
   */
  passHold: number;
  /** 传球的预定接球人；控制权移交和接球跑位都看它 */
  receiver: number | null;
  /**
   * > 0 时不自动切人。手动切人和刚自动切过都会设它 ——
   * 没有这个迟滞，控制权会在两个距离相近的防守球员之间来回跳，玩家彻底失去方位感。
   */
  switchLock: number;
  /** 玩家松开移动键后的短暂保护，避免换方向时被抢走控制权。 */
  switchInputLock: number;
  /** 短时间连按 J 可继续轮换，单次按键优先选择最近的防守人。 */
  switchManualChain: number;
  /** 同一次无主球期间最多辅助切人一次，接球或重开后重置。 */
  switchLooseUsed: boolean;
  /** 四个动作键上一 tick 的状态，用于检测按下/松开这一帧 */
  actionWasHeld: Record<ChargeKind, boolean>;
  /** > 0 时显示进球提示 */
  goalFlash: number;
  /** 最近一个进球是哪队打进的，进球提示要用 */
  lastScorer: 0 | 1;

  /**
   * 是否吹罚。false = 练习模式：不判出界、不判越位、不判犯规。
   *
   * 存在的理由是测试台需要在【没有规则干扰】的条件下量物理：
   * 一个直线带球 10 秒的测试会跑出 80 米，真判出界就永远量不到带球手感。
   * 正式比赛恒为 true。
   */
  officiating: boolean;

  phase: Phase;
  restart: Restart | null;
  /** 球摆好后 AI 出球前的等待，秒；不替玩家自动开球 */
  restartTimer: number;
  /** 剩余比赛时间，秒 */
  clock: number;
  /**
   * 最后碰球的是哪一队。出界判给谁、角球还是球门球，全看它。
   * null = 开场还没人碰过球。
   */
  lastTouch: 0 | 1 | null;
  /**
   * 出球瞬间处于越位位置的己方球员。
   *
   * 越位不是在传球时判的，是在【接球时】判的 —— 出球瞬间记下谁越位，
   * 谁先碰到球就吹谁。所以这里存的是索引，不是布尔值。
   */
  offsideFlags: number[];
  /** 给 HUD 用的最近一次判罚说明 */
  eventLabel: string;
  eventTimer: number;
  /** 世界时间，秒 */
  time: number;
}

export interface TeamStats {
  shots: number;
  passes: number;
  tackles: number;
  possession: number;
}

export const emptyTeamStats = (): TeamStats => ({ shots: 0, passes: 0, tackles: 0, possession: 0 });
