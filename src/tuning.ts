/**
 * 全部手感参数集中在这里（DESIGN.md D27 / §6）。
 * 这个对象在运行时被 lil-gui 直接改写，sim 层每 tick 读取它。
 *
 * 规则（DESIGN.md M1 验收标准 4）：
 * 把任一参数拖到极端值，必须能立刻说出它改变了什么。说不出来的参数就是无效参数，删掉。
 */
import type { FormationTuning } from "./sim/formation.ts";

/**
 * 单种传球的参数。三个键的差别全在这里 ——
 * 弹道（loft）、射程（maxRange）、以及【选人时看重什么】（四个权重）。
 */
export interface PassKindTuning {
  /** m — 超出这个距离的队友不进候选 */
  maxRange: number;
  /**
   * m — 蓄力条为 0（轻点）时想传的距离。
   * 蓄满时是 maxRange，中间线性插值 —— 这就是力度条对传球的含义。
   */
  minRange: number;
  /** 度 — 出球仰角。0 = 地滚球 */
  loft: number;
  /** m — 直塞瞄准点相对队友往前推多远。只有直塞非 0（D14） */
  lead: number;
  /**
   * m/s — 地滚球【到达接球人时】还剩多快。
   *
   * 出球速度由它反解，不是拍脑袋定的：球速按 e^(-rt) 衰减，
   * 滚过距离 D 后剩余速度恰好是 v0 − D·r，所以 v0 = D·r + arriveSpeed。
   * 第一版用的是 D·r·2.1 + 3.5 这种凑出来的式子，33 米的直塞算出 41 m/s，
   * 球能滚 72 米 —— 直接飞过接球人出了边线。
   */
  arriveSpeed: number;
  /** 评分权重：与输入方向的夹角（"我想传那边"） */
  wIntent: number;
  /** 评分权重：传球线路是否通畅 */
  wLane: number;
  /** 评分权重：接球人往对方球门推进了多少 */
  wAdvance: number;
  /** 评分权重：距离是否落在这种传球的合理区间 */
  wRange: number;
}

export interface Tuning {
  /** 持球 AI 的决策节奏；与移动物理解耦。 */
  attack: { decisionDelay: number; passDelay: number; shotRange: number };
  /** 移动 */
  move: {
    /** m/s — 不冲刺时的最高速 */
    maxSpeed: number;
    /** m/s² — 朝目标速度靠拢的加速度 */
    acceleration: number;
    /** m/s² — 松开方向键后的减速度 */
    deceleration: number;
    /** rad/s — 朝向转动速率，越小转身越"重" */
    turnRate: number;
    /** 冲刺时 maxSpeed 的倍数 */
    sprintMultiplier: number;
    /**
     * m/s² — 冲刺时的加速度。刻意【高于】常规加速度。
     *
     * 教科书做法是让冲刺"提速慢但极速高"，但那样冲刺转向反而比慢跑更平缓，
     * 球跟得更紧 —— 实测下来变成"冲刺时控球更稳"，跟直觉完全相反。
     * 所以这里反过来：冲刺推得更狠、转得更急，代价是【急转必丢球】。
     * 冲刺的成本落在控球上，不在提速上。
     */
    sprintAcceleration: number;
  };
  /** 粘球（D11：吸附 + 松动） */
  dribble: {
    /** m — 球停在脚前多远 */
    dribbleOffset: number;
    /** m — 自由球进入这个半径就被吸附 */
    stickyRadius: number;
    /** m — 带球偏离脚前目标的上限；超过后自动补脚收回，普通跑动不丢球。 */
    maxDetachDistance: number;
    /** 1/s — 位置偏差换算成修正速度的增益。越大，脚对小偏差反应越急 */
    reattachRate: number;
    /**
     * m/s — 修正速度的上限，即"脚最多能以多快的【相对】速度把球拨回来"。
     *
     * 球的目标速度 = 球员速度（前馈）+ 修正。前馈这一项是必须的：
     * 没有它，让球跟上冲刺就得靠巨大的位置偏差，
     * 而巨大的偏差会在脱手瞬间变成一脚二十米的大脚球。
     */
    maxCorrection: number;
    /**
     * m/s² — 脚每秒能给球施加的最大加速度。这是"球有没有惯性"的唯一开关。
     *
     * 没有它，粘球是纯位置追踪：球没有动量，转身时球会瞬间跟着甩过来，
     * 于是永远甩不掉 —— 这就是"黏死在脚上"。
     * 加上它之后，急转时球会带着原来的速度冲出去，脚只能有限地拉回来，
     * 偏差达到 maxDetachDistance 时自动补脚。
     *
     * 调低 → 惯性明显、补脚更频繁；调高 → 贴脚更紧、松动感减小。
     * 默认保留 40 的惯性手感，由控制范围保证球权稳定。
     */
    touchAccel: number;
    /** s — 射门后不能重新吸附的时间 */
    shotCooldown: number;
    /** s — 因急转而脱离后不能重新吸附的时间 */
    detachCooldown: number;
  };
  /** 球物理 */
  ball: {
    /** 1/s — 地面滚动的指数衰减 */
    groundFriction: number;
    /** 1/s — 空中飞行的指数衰减 */
    airDrag: number;
    /** m/s² — 重力（作用在 z 轴） */
    gravityZ: number;
    /** 0..1 — 落地反弹保留的竖直速度比例 */
    bounceRestitution: number;
    /** 0..1 — 落地时水平速度保留比例 */
    bounceFriction: number;
    /**
     * 弧线强度：spin 转成侧向加速度的系数（只在空中生效）。
     * 侧向加速度 ∝ spin × 球速 —— 必须带球速，否则球慢下来后曲率会爆炸，
     * 一脚射门能拐出几十米，那是回旋镖不是弧线。
     */
    curveFactor: number;
    /** 1/s — 旋转在空中的衰减 */
    spinDecayAir: number;
    /** 0..1 — 每次落地保留的旋转比例。落地后弧线应该迅速消失 */
    spinDecayBounce: number;
  };
  /** 射门（K 键蓄力） */
  shot: {
    /** s — 蓄满所需时间 */
    chargeTime: number;
    /** m/s — 轻点的出球速度 */
    minPower: number;
    /** m/s — 蓄满的出球速度 */
    maxPower: number;
    /** 度 — 出球仰角。角度越大越像吊射，越小越像贴地抽射 */
    loftAngle: number;
    /** 出球时继承球员速度的比例 */
    inheritVelocity: number;
  };
  /** 三种传球（D13/D14/D20/D21） */
  pass: {
    /**
     * 扇形半角（度）。方向键指哪，就在这个扇形里挑人。
     *
     * 这是个【宽松闸门】，不是精确瞄准器：真正决定传给谁的是各传球类型的
     * wIntent 权重。收窄到 55° 时实测短传有 23% 的按键【什么都不发生】——
     * 方向差一点就一个候选都没有，按键变成哑键，手感上就是"传球不准"。
     */
    fanAngle: number;
    /** m — 传球线路上有人离线段小于这个距离，就算被挡住 */
    laneRadius: number;
    /** s — 传球蓄满所需时间 */
    chargeTime: number;
    /**
     * 意图项的陡峭度。得分 = (1 − 角度/扇形半角) ^ 这个指数。
     *
     * 1 = 线性，越大越"只认你指的方向"。
     * 之前直接用 cos，在小角度附近太平坦 —— 偏 60° 的队友只比正对的低一点点，
     * 很容易被线路/推进项翻盘，于是就出现"我明明指着这边，球却给了另一个人"。
     */
    intentSharpness: number;
    /**
     * 0..1 — 传球飞行期间，【非指定接球人】的吸附半径要打多少折。
     *
     * 0 = 谁都能顺手把别人的球捞走；1 = 别人完全碰不到。
     * 实测长传有 31% 会被路过的队友半路接走 —— 玩家的感受就是
     * "我明明传给那个人，球却被另一个人拿到了"。
     */
    receiverPriority: number;
    /** s — D16：出脚后保持控制传球者多久，之后再移交给接球人 */
    controlHoldTime: number;
    /**
     * 0..1 — 传球提前量：按接球人当前速度预判多少。
     *
     * 0 = 瞄他此刻站的地方；1 = 完全按当前速度外推。
     *
     * 留出一部分迎球空间；力度按这个预判点反解，避免先瞄准再另算射程。
     */
    leadFactor: number;
    short: PassKindTuning;
    long: PassKindTuning;
    through: PassKindTuning;
  };

  /** 比赛规则与流程（D3/D4/D5） */
  rules: {
    /** s — 一场比赛多长 */
    matchLength: number;
    /** s — 死球到重新开球之间的等待。太短会让人来不及反应，太长会打断节奏 */
    restartDelay: number;
    /** m — 重新开球时对方必须退开的距离 */
    restartClearance: number;
    /**
     * 1/s — 死球期间球额外的减速。
     *
     * 球出界后滚得越远，去捡球的人就跑得越久，玩家干等的时间越长。
     * 现实里球会撞到广告板或被球童拦下，这里就是那个作用。
     */
    deadBallDamping: number;
    /** s — 捡球/摆球的超时兜底。超时就直接把球放到开球点，免得比赛卡死 */
    fetchTimeout: number;
    /** m — 主罚球员把球带到离开球点这么近，就算摆好了 */
    placeRadius: number;
    /** s — 判罚提示在屏幕上停留多久 */
    eventBannerTime: number;
    /** m — 出脚时离对手多近算撞到人（在此之上再叠球员半径） */
    foulContact: number;
    /**
     * m/s — 朝对手【撞过去】的速度超过这个值才算犯规。
     *
     * 少了这一条，任何落空的出脚只要挨着人就判犯规 ——
     * 实测一场 3 分钟判 29 次任意球（每 10 秒一次），死球吃掉全场 40% 的时间。
     * 有了它，站着伸脚够不到球只是白费一次出脚，
     * 而 11 m/s 冲进去的滑铲照样是犯规。判据是"你是撞上去的还是伸脚够的"。
     */
    foulSpeed: number;
  };

  /** 铲抢（D12） */
  tackle: {
    /** s — 出脚后的判定窗口 */
    windowTime: number;
    /** m — 窗口内球在这个半径内就算断下来 */
    range: number;
    /**
     * s — 落空后的硬直。**这是防守博弈的全部来源**：
     * 调到 0，玩家就会无脑连按抢断键，防守变成没有成本的行为。
     */
    recovery: number;
    /** m/s — 出脚瞬间往前扑的冲量 */
    lungeSpeed: number;
    /** m/s — 断球时球被捅出去的速度 */
    knock: number;
    /** s — 断球后球的无人可控时间 */
    knockLock: number;
    /**
     * 0..1 — 断球时球往哪儿飞：0 = 完全朝本方进攻方向（解围），1 = 完全朝出脚者的朝向。
     *
     * 防守时人是面朝自家球门的，取 1 就等于每断一次球都往自家底线捅。
     */
    knockFacing: number;
    /**
     * m — AI 防守球员在多近的距离自动出脚。
     *
     * 必须【大于】range，否则 AI 一出脚必中、永远不吃硬直 ——
     * 铲球对 AI 就是零成本，而对玩家不是。实测 ≤1.7 时 AI 成功率 100%，
     * 1.9 起才会铲空。这个数同时是"对手有多黏"的总闸。
     */
    aiTriggerRange: number;
  };

  /**
   * 铲球（滑铲）。和抢断是两套数：够得远得多，但落空的代价也大得多。
   * 这是"高风险高回报"的那一档 —— 铲到了直接把球捅走，铲空了躺在地上 1 秒多。
   */
  slide: {
    /** s — 滑铲的判定窗口，比抢断长（人在滑行） */
    windowTime: number;
    /** m — 滑铲的断球半径 */
    range: number;
    /** s — 落空硬直。必须明显长于抢断，否则铲球就是无脑更优解 */
    recovery: number;
    /** m/s — 滑出去的初速度 */
    speed: number;
    /** m — 铲到人的判定距离。比抢断大：滑铲本来就更容易伤人 */
    foulContact: number;
    /** m — AI 在多远开始考虑用铲球（应大于抢断的出脚距离） */
    aiTriggerRange: number;
  };

  /** 队友 AI（D18 阵型锚点 + D19 局部跑位） */
  ai: FormationTuning & {
    /** 有几名队友做"聪明跑位"，其余人纯站锚点。调到 0 → 全队站桩，直塞立刻失去意义 */
    activeRunners: number;
    /** 跑位候选点撒在锚点周围多远，米 */
    runnerRadius: number;
    /** 撒几个候选点。少了跑位很跳，多了只是白烧 CPU */
    runnerSamples: number;
    /** 评分权重：往对方球门推进 */
    wAdvance: number;
    /** 评分权重：离其他人远（别挤成一坨） */
    wSpace: number;
    /** 评分权重：和持球人保持在能传到的距离上 */
    wPassable: number;
    /** m — "最舒服的接球距离"，wPassable 就是围着它罚分的 */
    preferredPassDistance: number;
    /** m — 距目标点小于这个距离就开始减速，防止在锚点两侧来回抖 */
    arriveRadius: number;
    /** m — 防守时，盯人会把站位往对手身上拉多少 */
    markPull: number;
    /** m — 盯人时站在对手身前多远（朝自家球门一侧） */
    markGoalSide: number;
    /**
     * s — 逼抢球员贴住多久才敢出脚。
     *
     * 没有它，防守就是"冲到球边立刻捅"，玩家拿到球 0.4 秒就没了。
     * 有了它，你有大约这么久的时间出球或转身 —— 这是 FC 式"先封堵、后择机"的核心。
     */
    pressCommitDelay: number;
    /** m/s — 持球人拉开的速度超过这个值，被过掉的防守者才会用铲球做最后一搏 */
    slideEscapeSpeed: number;
    /**
     * m — 球离持球人多远算"触球散了"，散了就立刻出脚、不等 pressCommitDelay。
     *
     * 这一条把防守直接接到了 M1 的粘球模型上：干净带球时球在脚前 0.5 m 左右，
     * 急转或冲刺变向时会甩到 1.3 m —— 那一下就是防守该抓的窗口。
     */
    looseTouch: number;
    /**
     * m — 逼抢球员要贴到离球多近。
     *
     * 必须【小于】tackle.aiTriggerRange，否则他站定的位置永远够不到球，
     * 也就永远不会出脚。曾经和无球盯人共用 markGoalSide(2.2m)，
     * 结果 AI 防守 180 秒 0 次铲球、对手控球率 0% —— 防守完全是摆设。
     */
    pressGoalSide: number;
    /** m — 补位球员站在逼抢球员身后多远 */
    coverDepth: number;
    /**
     * s — 手动切人（J）之后，自动切人要让开多久。
     *
     * 必须明显长于 autoSwitchCooldown。第一版两者共用 0.45 秒，
     * 结果你刚手动挑了一个人，半秒后就被自动切人抢回去 ——
     * 手动切人形同虚设。你既然按了键，就该由你说了算。
     */
    manualSwitchLock: number;
    /** 辅助仅在无主球/空中球时切人；手动由玩家按 J 决定防守切人。 */
    switching: "assisted" | "manual";
    /** s — 移动输入停止后仍暂时保护控制权。 */
    switchInputGrace: number;
    /**
     * s — 防守时自动切人的最小间隔。
     *
     * 没有它，控制权会在两个距离相近的防守球员之间来回跳，玩家彻底失去方位感。
     */
    autoSwitchCooldown: number;
    /**
     * s — 另一名球员要比当前这个【早这么多】够到球，才值得切过去。
     *
     * 只在符合辅助切人条件时比较候选人，调太大就不会主动辅助切人。
     */
    autoSwitchMargin: number;
    /** m — 门将站在门线前多远。站出来能封角度，但被挑射的风险变大 */
    gkLineDepth: number;
    /**
     * m/s — 门将的移动速度。
     *
     * 必须明显低于场上球员的冲刺速度（8.78 m/s）。第一版直接复用了场上球员的速度，
     * 结果门将根本不用鱼跃、走过去就够到了 —— 180 脚射正扑出 178 脚，
     * 反应时间和鱼跃参数怎么调都毫无影响，因为它们根本没被用到。
     */
    gkSpeed: number;
    /**
     * s — 门将的反应时间：球飞向球门多久之后他才开始扑。
     *
     * 没有它，门将瞬间完美预判落点，实测 180 脚射正全部扑出 —— 成了不可逾越的墙。
     * 这是门将唯一能被打败的原因，也是"射门要打角度"这件事成立的前提。
     */
    gkReaction: number;
    /** m — 门将站着能够到球的范围（比场上球员大，他有手） */
    gkReach: number;
    /**
     * m — 鱼跃时能够到的范围。
     *
     * 只能比 gkReach 大一点点。第一版设成 1.9（站着 0.95 的两倍），
     * 结果"宣布鱼跃"这个动作本身就白送 +0.95 m 的半径 ——
     * 门将一反应就够到了球，180 脚射正全部扑出，反应时间调多久都没用。
     * **扑救范围应该来自身体真的飞出去那 gkDiveSpeed 米/秒，不是半径突变。**
     */
    gkDiveReach: number;
    /** m — 能接多高的球 */
    gkCatchHeight: number;
    /** m/s — 鱼跃扑出去的速度 */
    gkDiveSpeed: number;
    /** s — 鱼跃的判定窗口 */
    gkDiveWindow: number;
    /** s — 鱼跃之后趴在地上的时间。这是"扑错方向"的代价 */
    gkDiveRecovery: number;
    /**
     * m — 预判落点离门将超过这个距离，他就得鱼跃。
     *
     * 太小 → 门将动不动就飞出去，扑错了门户大开；太大 → 他永远只是走过去，等于摆设。
     */
    gkDiveTrigger: number;
    /** s — 对方门将拿到球后握多久再开出去。太短像抢着解围，太长像在拖时间 */
    gkClearDelay: number;
    /** 度 — 门将开球的仰角 */
    gkClearLoft: number;
    /** m/s — 门将开球的力度 */
    gkClearPower: number;
    /**
     * m — 逼抢半径：只有离持球人这么近的防守球员才会离开阵型去逼抢。
     *
     * 这是防守强度最重要的一个数：调大 → 对手全场紧逼、你几乎不可能舒服带球；
     * 调小 → 对手只守阵型不出来，你可以从容组织但很难打穿。
     */
    pressRadius: number;
  };

  /** 相机（D9） */
  camera: {
    /** 1/s — 越大跟得越紧、越"贴"；越小越飘 */
    lerp: number;
    /** s — 沿球速方向前瞻多少秒的位移 */
    lookahead: number;
    /** m — 前瞻的最大偏移量，防止长传时镜头甩飞 */
    maxLookahead: number;
  };
}

export function createTuning(): Tuning {
  return {
    attack: { decisionDelay: 0.65, passDelay: 1.1, shotRange: 23 },
    move: {
      maxSpeed: 6.5,
      acceleration: 20,
      deceleration: 26,
      turnRate: 9,
      sprintMultiplier: 1.35,
      sprintAcceleration: 26,
    },
    dribble: {
      dribbleOffset: 0.9,
      stickyRadius: 1.0,
      maxDetachDistance: 2.2,
      reattachRate: 20,
      maxCorrection: 4.5,
      touchAccel: 40,
      shotCooldown: 0.35,
      detachCooldown: 0.18,
    },
    ball: {
      groundFriction: 0.55,
      airDrag: 0.12,
      gravityZ: 9.8,
      bounceRestitution: 0.55,
      bounceFriction: 0.82,
      curveFactor: 0.8,
      spinDecayAir: 0.9,
      spinDecayBounce: 0.25,
    },
    shot: {
      chargeTime: 0.8,
      minPower: 14,
      maxPower: 33,
      loftAngle: 8,
      inheritVelocity: 0.15,
    },
    pass: {
      fanAngle: 90,
      chargeTime: 0.55,
      receiverPriority: 0.9,
      intentSharpness: 2.5,
      laneRadius: 2.5,
      controlHoldTime: 0.5,
      leadFactor: 0.7,
      // D21 的权重表。短传吸附最强（几乎只看你指哪 + 路通不通），
      // 长传刻意不帮玩家太多（更看方向和射程），
      // 直塞主要看"这脚球有没有把球往前推"。
      short: {
        maxRange: 25, minRange: 7, loft: 0, lead: 0, arriveSpeed: 11.5,
        wIntent: 1.0, wLane: 0.3, wAdvance: 0, wRange: 0.5,
      },
      long: {
        maxRange: 45, minRange: 16, loft: 22, lead: 0, arriveSpeed: 0,
        wIntent: 1.0, wLane: 0.1, wAdvance: 0, wRange: 0.6,
      },
      through: {
        // D21 原文是 推进 50% + 线路 30% + 不越位（硬性否决）20%。
        // 照抄下来实测直塞只有 70% 会选中你指着的那个人，最差偏离 75° ——
        // 玩家的感受就是"我传的方向明明是这个，球却被另一个人拿到了"。
        // 所以意图权重必须占主导，推进项降为陪衬。
        // M3 加对手后，越位改回硬性否决（不占权重）。
        maxRange: 30, minRange: 9, loft: 0, lead: 6, arriveSpeed: 13.5,
        wIntent: 0.9, wLane: 0.25, wAdvance: 0.35, wRange: 0.4,
      },
    },
    rules: {
      matchLength: 180,
      restartDelay: 0.5,
      restartClearance: 6,
      deadBallDamping: 7,
      fetchTimeout: 6,
      placeRadius: 1.2,
      eventBannerTime: 1.6,
      foulContact: 0.25,
      foulSpeed: 5.5,
    },
    tackle: {
      windowTime: 0.22,
      range: 1.5,
      recovery: 0.4,
      lungeSpeed: 3.5,
      knock: 4.5,
      knockLock: 0.1,
      knockFacing: 0.35,
      aiTriggerRange: 1.9,
    },
    slide: {
      windowTime: 0.42,
      range: 2.6,
      recovery: 1.1,
      speed: 11,
      foulContact: 0.55,
      aiTriggerRange: 3.2,
    },
    ai: {
      spreadGain: 0.28,
      followScale: 1,
      defensiveDrop: 9,
      activeRunners: 3,
      runnerRadius: 6,
      runnerSamples: 12,
      wAdvance: 0.5,
      wSpace: 1.4,
      wPassable: 0.8,
      preferredPassDistance: 14,
      arriveRadius: 3.5,
      markPull: 0.65,
      markGoalSide: 2.2,
      pressGoalSide: 1.15,
      pressCommitDelay: 0.85,
      looseTouch: 1.1,
      slideEscapeSpeed: 4.5,
      coverDepth: 7,
      autoSwitchCooldown: 1.2,
      switching: "assisted",
      switchInputGrace: 0.35,
      manualSwitchLock: 2,
      autoSwitchMargin: 0.35,
      pressRadius: 26,
      gkLineDepth: 1.6,
      gkSpeed: 3.8,
      gkReaction: 0.35,
      gkReach: 0.7,
      gkDiveReach: 1.25,
      gkCatchHeight: 2.6,
      gkDiveSpeed: 9,
      gkDiveWindow: 0.4,
      gkDiveRecovery: 0.8,
      gkDiveTrigger: 0.55,
      gkClearDelay: 0.7,
      gkClearLoft: 30,
      gkClearPower: 26,
    },
    camera: {
      lerp: 6,
      lookahead: 0.35,
      maxLookahead: 8,
    },
  };
}
