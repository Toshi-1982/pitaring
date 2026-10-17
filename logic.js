// ぴたリング：ゲームのロジック（描画・DOMに依存しない部分）
// node のテスト（tests/logic.test.mjs）からも読み込む。
// 用語（仕様書 v7）：モード＝今日のチャレンジ / Easy / Normal / Hard / Professional（プレイ前に選ぶ）。
// スピード段階（stage）＝ SPEED 1〜100。Easy・Normal・Hard は SPEED 1〜13 の表で10秒ごとに上がる。
// Professional は選んだ Speed（10〜100）、今日のチャレンジは SPEED 30 で固定（仕様書4.11・4.12）。

const PRO_SHAPES = Object.freeze(['circle', 'triangle', 'square', 'diamond', 'star']);

// ===== 調整用の数値（仕様書 4.5「試作後に調整してよい数値」など）はここに集約 =====
export const CONFIG = Object.freeze({
  // 入力遅延補正（ミリ秒）。初期値0、調整範囲0〜60（仕様書4.7）
  INPUT_OFFSET_MS: 0,

  // 判定幅（ずれ率 d = |t_tap - 目標の時刻| / T）（仕様書4.4）
  PERFECT_MAX_D: 0.05,
  GOOD_MAX_D: 0.12,
  // 判定幅の下限（ミリ秒）。SPEED 7 以降で効く（仕様書4.4。社長の確認待ち 9章#14）
  PERFECT_MIN_MS: 33,
  GOOD_MIN_MS: 80,

  // 基本点
  PERFECT_POINTS: 100,
  GOOD_POINTS: 50,

  // コンボ倍率：1 + min(コンボ, COMBO_CAP) × 0.1
  COMBO_CAP: 10,

  // ライフ
  START_LIVES: 3,

  // 制限時間（仕様書4.9）
  // ★1プレイの制限時間（秒）。社長の判断待ち（仕様書9章#10：60のまま／30／90）。変えるときはここだけ
  TIME_LIMIT_SEC: 60,
  TIME_WARN_SEC: 10,            // 残りがこの秒数以下で数字とバーを赤にし、数字を弾ませる
  TIME_UP_MS: 800,              // 「TIME UP」を出す長さ
  TIMER_PULSE_MS: 200,          // 残り秒数の数字が弾む長さ

  // スピード段階が上がる経過時間（秒）（仕様書4.5.1）。1つ目は0、後ろほど大きい。
  // 段階 ＝ min(モードの開始段階 + ステップ数, SPEED_STAGES の行数)
  SPEED_STEP_FROM_SEC: Object.freeze([0, 10, 20, 30, 40, 50]),

  // スピード段階の表（仕様書4.5.1）。1行 = 1段階（上から SPEED 1, 2, … 13）
  // T：輪が目標に届くまでの秒数（Professional は一番内側の目標まで）。waitMinSec〜waitMaxSec：待ち時間 W（同じ値なら固定）
  // ★SPEED 1〜6 は9章#12、7〜13 は9章#14 で社長の確認待ち。変えるときはここだけ
  SPEED_STAGES: Object.freeze([
    Object.freeze({ T: 1.6,  waitMinSec: 0.5, waitMaxSec: 0.5 }),
    Object.freeze({ T: 1.4,  waitMinSec: 0.5, waitMaxSec: 0.5 }),
    Object.freeze({ T: 1.2,  waitMinSec: 0.5, waitMaxSec: 0.5 }),
    Object.freeze({ T: 1.0,  waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.85, waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.7,  waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.62, waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.55, waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.50, waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.45, waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.42, waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.38, waitMinSec: 0.3, waitMaxSec: 0.8 }),
    Object.freeze({ T: 0.35, waitMinSec: 0.3, waitMaxSec: 0.8 }),
  ]),

  // SPEED 14〜100（仕様書4.11.2・4.11.3）。T は 0.35秒 → 0.20秒を同じ比率で短くし、1ms に丸める。
  // 1つ目の目標の判定幅の下限を 33→45ms・80→100ms に比例して広げる。★9章#21 で社長の体感待ち
  SPEED_MAX: 100,
  T_AT_SPEED_MAX: 0.20,
  PERFECT_MIN_MS_AT_MAX: 45,
  GOOD_MIN_MS_AT_MAX: 100,

  // モード（仕様書4.10.1・4.11・4.12）。並び順はタイトルのボタンの順
  // shapes：毎ラウンド選ぶ形（1種なら常にその形）。multi：同心の多重目標（Professional のルール）。
  // waitMinSec・waitMaxSec：表より優先する待ち時間 W（Professional・今日のチャレンジは 0.4〜0.8秒。修正点13回目）。
  // falseStart：① 待ちのタップをお手つき MISS にする（修正点12回目）
  MODE_ORDER: Object.freeze(['daily', 'easy', 'normal', 'hard', 'pro']),
  MODES: Object.freeze({
    daily: Object.freeze({
      label: '今日のチャレンジ', hudLabel: 'チャレンジ', startStage: null, fixedSpeed: 30,
      shapes: PRO_SHAPES, multi: true, seeded: true, falseStart: true, waitMinSec: 0.4, waitMaxSec: 0.8,
    }),
    easy:   Object.freeze({ label: 'Easy',   startStage: 1, shapes: Object.freeze(['circle']), multi: false, note: 'SPEED 1から' }),
    normal: Object.freeze({ label: 'Normal', startStage: 3, shapes: Object.freeze(['circle']), multi: false, note: 'SPEED 3から' }),
    // ★Hard の形の追加は9章#23 で社長の判断待ち。決まるまで3種のまま
    hard:   Object.freeze({ label: 'Hard',   startStage: 6, shapes: Object.freeze(['circle', 'triangle', 'square']), multi: false, note: 'SPEED 6から・形が変わる' }),
    pro: Object.freeze({
      label: 'Professional', startStage: null, speedSelect: true,
      shapes: PRO_SHAPES, multi: true, falseStart: true, waitMinSec: 0.4, waitMaxSec: 0.8,
    }),
  }),

  // Professional の Speed 選択（仕様書4.11.1・6.2.1）
  PRO_SPEED_CHOICES: Object.freeze([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
  PRO_DEFAULT_SPEED: 10,
  PRO_SPEED_RAMP: false,        // ★true なら10秒ごとに+1（上限100）。Professional だけに効く（9章#19）

  // Professional・今日のチャレンジの目標（仕様書4.11.5）。u ＝ (Speed − 10) ÷ 90
  PRO_P3_MIN: 0.2,              // 三重になる確率 0.2 + 0.6u
  PRO_P3_MAX: 0.8,
  PRO_GAP_MIN_SEC: 0.30,        // 目標の間隔の下限 gMin ＝ 0.30 − 0.06u
  PRO_GAP_MIN_SEC_AT_MAX: 0.24,
  PRO_GAP_SPREAD_SEC: 0.10,     // gMax ＝ gMin + 0.10（全 Speed）
  PRO_LATER_PERFECT_MS: 33,     // 2つ目以降の目標の判定幅の下限（全 Speed。9章#30）
  PRO_LATER_GOOD_MS: 80,
  PRO_FALSE_START_GRACE_MS: 100, // ① の始まりからこの間のタップは無視、それ以降の ① のタップはお手つき MISS
  PRO_K1_MIN: 0.09,             // 一番内側の大きさ k₁ の範囲
  PRO_K1_MAX: 0.22,
  PRO_K_OUTER_MAX: 0.42,        // 一番外側の目標の大きさの上限
  PRO_RING_MAX_K: 0.47,         // 自動MISSまで広がった輪の大きさの上限
  PRO_EDGE_MIN: 0.04,           // 隣の目標の線どうしの距離の下限（c × ΔR）

  // 形（仕様書4.11.4）：内接円の半径 ÷ 外接円の半径（辺の係数 c）。星の内側の点は 0.5R
  SHAPE_EDGE_FACTOR: Object.freeze({ circle: 1, triangle: 0.5, square: 0.7071, diamond: 0.7071, pentagon: 0.809, star: 0.4426 }),
  STAR_INNER_RATIO: 0.5,

  // 目標円の大きさの比率 k（仕様書4.2）
  K_MIN: 0.18,
  K_MAX: 0.32,
  K_MIN_DIFF: 0.04,             // 直前ラウンドとの差がこれ未満なら引き直す

  // 自動MISS：t = AUTO_MISS_FACTOR × T（Easy・Normal・Hard）
  AUTO_MISS_FACTOR: 1.5,

  // 時間（ミリ秒）（仕様書4.3・4.5・4.8・6.5）
  READY_MS: 1000,
  RESULT_MS: 600,
  FLASH_MS: 200,
  LEVEL_BANNER_MS: 800,         // 「SPEED n」表示の長さ（名前は v5 のまま。仕様書4.5.3）
  RESULT_BUTTON_LOCK_MS: 500,
  RESIZE_THROTTLE_MS: 150,
  SHARE_NOTICE_MS: 1500,        // 「コピーしました」を出す長さ（仕様書4.13）

  // シェア文の最後に足す公開URL（仕様書4.13。空なら入れない。9章#3・#26）
  SHARE_URL: '',

  // 表示の上限
  SCORE_DISPLAY_MAX: 9999999,

  // ゲーム領域 S（仕様書6.1）
  S_SIDE_MARGIN_TOTAL: 32,
  S_VERTICAL_RESERVED: 140,
  S_MAX: 480,
  S_MIN: 240,

  // PC（マウス操作）で表示する縦長の枠（修正3回目）：幅 = 高さ × 9/16（320〜480px）
  PC_FRAME_RATIO: 9 / 16,
  PC_FRAME_MIN_W: 320,
  PC_FRAME_MAX_W: 480,

  // 保存キー（仕様書7章）。v2・v1 は移行元（読むだけ。消さない・書かない）
  STORAGE_KEY: 'pitaring.v3',
  V2_STORAGE_KEY: 'pitaring.v2',
  LEGACY_STORAGE_KEY: 'pitaring.v1',
  SAVE_VALUE_MAX: 99999999,            // 保存値（bestScore・playCount）の上限。超えたら破損扱い
  SAVE_DATE_MIN: 19700101,             // 今日のチャレンジの日付キー（YYYYMMDD）の範囲。0 は未プレイ
  SAVE_DATE_MAX: 99991231,
});

// 浮動小数点の誤差で境界値（例：d がちょうど0.05）が外れないための許容値
const EPS = 1e-9;

// ===== モード（仕様書4.10・4.11・4.12） =====
// 未知の modeId は easy として扱う
export function normalizeModeId(modeId) {
  return Object.prototype.hasOwnProperty.call(CONFIG.MODES, modeId) ? modeId : 'easy';
}

export function modeOf(modeId) {
  return CONFIG.MODES[normalizeModeId(modeId)];
}

// HUD 2段目右の短い名前（今日のチャレンジは「チャレンジ」。仕様書6.3）
export function hudLabelOf(modeId) {
  const m = modeOf(modeId);
  return m.hudLabel || m.label;
}

// Professional の Speed：PRO_SPEED_CHOICES のどれかでなければ PRO_DEFAULT_SPEED
export function normalizeProSpeed(speed) {
  return CONFIG.PRO_SPEED_CHOICES.includes(speed) ? speed : CONFIG.PRO_DEFAULT_SPEED;
}

// Speed が60秒間固定のモードか（今日のチャレンジは常に固定。Professional は PRO_SPEED_RAMP が false のとき）
export function isFixedSpeedMode(modeId, ramp = CONFIG.PRO_SPEED_RAMP) {
  const id = normalizeModeId(modeId);
  if (id === 'daily') return true;
  if (id === 'pro') return !ramp;
  return false;
}

// READY の下の1行（仕様書6.3）：開始時「Hard ・ SPEED 6 から」、再開時「Hard ・ SPEED 8」。
// 固定の速さ（Professional・今日のチャレンジ）は「から」を付けない
export function readySubText(modeId, stage, resumed, ramp = CONFIG.PRO_SPEED_RAMP) {
  const from = !resumed && !isFixedSpeedMode(modeId, ramp);
  return `${modeOf(modeId).label} ・ SPEED ${stage}${from ? ' から' : ''}`;
}

// ===== スピード段階・速度（仕様書4.5：経過時間とモードで決める） =====
// 経過時間（ms）＝ 4.9.2 の「数えている時間」。数えていないとき（READY中・一時停止中・ライフ0の判定後）は進まない
// = min(制限ms, playedMs + (数えているなら max(0, atMs − clockStart) : 0))
export function elapsedAt(clock, atMs, limitMs = timeLimitMs()) {
  const running = isClockRunning(clock) ? Math.max(0, atMs - clock.clockStart) : 0;
  return Math.min(limitMs, clock.playedMs + running);
}

// 経過時間 e（ms）のステップ数 ＝ 秒 × 1000 ≦ e を満たす要素のうち最後のものの位置（0始まり）。
// 境界ちょうど（例：10000ms）は新しいステップ。秒数が制限時間以上の要素は使わない（仕様書4.5.1）
export function stepAtElapsed(elapsedMs, limitMs = timeLimitMs(), steps = CONFIG.SPEED_STEP_FROM_SEC) {
  let step = 0;
  for (let i = 0; i < steps.length; i++) {
    const fromMs = steps[i] * 1000;
    if (fromMs >= limitMs) break;
    // 浮動小数点の誤差（例：10000 が 9999.999999999998 になる）で境界ちょうどが前のステップにならないよう EPS を足す
    if (fromMs <= elapsedMs + EPS) step = i;
  }
  return step;
}

// スピード段階（仕様書4.5.1・4.11.1・4.12.1）。limitMs・ramp はテスト用（game.js からは省略して呼ぶ）
// - Easy・Normal・Hard：min(開始段階 + ステップ数, 13)
// - Professional：選んだ Speed（startSpeed）。ramp が true なら min(startSpeed + ステップ数, 100)
// - 今日のチャレンジ：ramp に関係なく常に fixedSpeed
export function stageAt(modeId, elapsedMs, limitMs = timeLimitMs(), startSpeed, ramp = CONFIG.PRO_SPEED_RAMP) {
  const id = normalizeModeId(modeId);
  const mode = CONFIG.MODES[id];
  if (id === 'daily') return mode.fixedSpeed;
  if (id === 'pro') {
    const s = normalizeProSpeed(startSpeed);
    return ramp ? Math.min(s + stepAtElapsed(elapsedMs, limitMs), CONFIG.SPEED_MAX) : s;
  }
  return Math.min(mode.startStage + stepAtElapsed(elapsedMs, limitMs), CONFIG.SPEED_STAGES.length);
}

// 段階の番号を 1〜SPEED_MAX の整数に収める
function clampStage(stage) {
  return Math.min(Math.max(Math.floor(stage) || 1, 1), CONFIG.SPEED_MAX);
}

// 段階の行（SPEED 1〜13 の表）。14 以上は表の最後の行（W の既定値に使う）
function stageRow(stage) {
  const stages = CONFIG.SPEED_STAGES;
  return stages[Math.min(clampStage(stage), stages.length) - 1];
}

// T（秒）：SPEED 1〜13 は表、14〜100 は T(s) = round1ms(0.35 × (0.20 ÷ 0.35)^((s − 13) ÷ 87))。範囲外は 1〜100 に収める
export function tForStage(stage) {
  const s = clampStage(stage);
  const stages = CONFIG.SPEED_STAGES;
  if (s <= stages.length) return stages[s - 1].T;
  const tLast = stages[stages.length - 1].T;
  const t = tLast * Math.pow(CONFIG.T_AT_SPEED_MAX / tLast, (s - stages.length) / (CONFIG.SPEED_MAX - stages.length));
  return Math.round(t * 1000) / 1000;
}

// 待ち時間 W（秒）。rand は 0以上1未満を返す関数（テストで差し替えられるように引数にする）。
// modeId を渡すと、そのモードの waitMinSec〜waitMaxSec（Professional・今日のチャレンジは 0.4〜0.8秒）を表より優先する。
// min = max なら乱数を使わない
export function waitSecFor(stage, rand = Math.random, modeId) {
  const mode = modeId == null ? null : modeOf(modeId);
  const { waitMinSec, waitMaxSec } = mode && mode.waitMinSec != null ? mode : stageRow(stage);
  if (waitMinSec === waitMaxSec) return waitMinSec;
  return waitMinSec + rand() * (waitMaxSec - waitMinSec);
}

export function nextK(prevK, rand = Math.random) {
  const span = CONFIG.K_MAX - CONFIG.K_MIN;
  for (let i = 0; i < 100; i++) {
    const k = CONFIG.K_MIN + rand() * span;
    if (prevK == null || Math.abs(k - prevK) >= CONFIG.K_MIN_DIFF) return k;
  }
  // 乱数が偏り続けた場合の保険：直前値から十分離れた側の端を使う
  return prevK - CONFIG.K_MIN >= CONFIG.K_MAX - prevK ? CONFIG.K_MIN : CONFIG.K_MAX;
}

// ===== 形（仕様書4.10.3・4.11.4） =====
// shapes の中から、直前（prev）以外を等確率（1ラウンド目は全部から）。1種なら乱数を使わずにその形
export function nextShape(prevShape, rand = Math.random, shapes = CONFIG.MODES.hard.shapes) {
  if (shapes.length === 1) return shapes[0];
  const pool = shapes.includes(prevShape) ? shapes.filter((s) => s !== prevShape) : shapes;
  const i = Math.min(Math.floor(rand() * pool.length), pool.length - 1);
  return pool[i];
}

// 頂点の角度（度。中心から見た向き、Canvas の y は下向き）と、その点の中心からの距離の比
const SHAPE_POINTS = Object.freeze({
  triangle: [-90, 30, 150].map((deg) => ({ deg, ratio: 1 })),                  // 頂点が上
  square: [45, 135, 225, 315].map((deg) => ({ deg, ratio: 1 })),               // 辺が水平
  diamond: [-90, 0, 90, 180].map((deg) => ({ deg, ratio: 1 })),                // 頂点が上下左右
  pentagon: [0, 1, 2, 3, 4].map((j) => ({ deg: -90 + 72 * j, ratio: 1 })),     // 頂点が上（Hard の候補。9章#23）
  star: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => ({ deg: -90 + 36 * j, ratio: j % 2 === 0 ? 1 : CONFIG.STAR_INNER_RATIO })),
});

// 形の頂点（中心から一番外の点まで r）。円は null
export function shapeVertices(shape, cx, cy, r) {
  const points = SHAPE_POINTS[shape];
  if (!points) return null;
  return points.map(({ deg, ratio }) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + r * ratio * Math.cos(a), y: cy + r * ratio * Math.sin(a) };
  });
}

// ===== Professional・今日のチャレンジの配置（仕様書4.11.5） =====
// u ＝ (Speed − 10) ÷ 90（0〜1 に収める）
function proSpeedU(speed) {
  return Math.min(Math.max((speed - 10) / 90, 0), 1);
}

// 三重になる確率 p3 ＝ 0.2 + 0.6u（SPEED 10 で 0.2、100 で 0.8）
export function proTripleProb(speed) {
  return CONFIG.PRO_P3_MIN + (CONFIG.PRO_P3_MAX - CONFIG.PRO_P3_MIN) * proSpeedU(speed);
}

// 目標の間隔の範囲 { min, max }：min ＝ 0.30 − 0.06u、max ＝ min + 0.10
export function proGapRange(speed) {
  const min = CONFIG.PRO_GAP_MIN_SEC - (CONFIG.PRO_GAP_MIN_SEC - CONFIG.PRO_GAP_MIN_SEC_AT_MAX) * proSpeedU(speed);
  return { min, max: min + CONFIG.PRO_GAP_SPREAD_SEC };
}

// k₁ の範囲 { lo, hi }（仕様書4.11.5「大きさ」）。targetSec：[T₁…Tₙ]（実際に使う目標の時刻）
//   lo ＝ max(PRO_K1_MIN, PRO_EDGE_MIN ÷ (c × 実際に使う間隔の最短 ÷ T))
//   hi ＝ min(PRO_K1_MAX, PRO_K_OUTER_MAX × T ÷ Tₙ, PRO_RING_MAX_K ÷ (Tₙ ÷ T + Dg後))
export function proK1Range(speed, T, shape, targetSec) {
  const n = targetSec.length;
  let gapMin = Infinity;
  for (let i = 1; i < n; i++) gapMin = Math.min(gapMin, targetSec[i] - targetSec[i - 1]);
  const c = CONFIG.SHAPE_EDGE_FACTOR[shape] ?? 1;
  const outerRatio = targetSec[n - 1] / T;
  const dgLater = judgeWindows(T, speed, 1).goodD; // 一番外側は必ず2つ目以降
  const lo = Math.max(CONFIG.PRO_K1_MIN, CONFIG.PRO_EDGE_MIN / ((c * gapMin) / T));
  const hi = Math.min(CONFIG.PRO_K1_MAX, CONFIG.PRO_K_OUTER_MAX / outerRatio, CONFIG.PRO_RING_MAX_K / (outerRatio + dgLater));
  return { lo, hi };
}

// ① 待ちの始まりに決める配置 { count, targetSec: [T₁…Tₙ], k: [k₁…kₙ], shape }（仕様書4.11.5）
// 形は呼ぶ側が先に決めて渡す（lo が形で変わるため）。
// 乱数は「数 → 間隔1 → 間隔2 → k₁」の順に、二重でも必ず4回引く（今日のチャレンジで全員同じにするため。4.12.2）。
// 二重のとき間隔2は引くが使わない。万一 hi < lo なら k₁ ＝ hi（はみ出さないことを優先）
export function proLayout(speed, T, shape, rand = Math.random) {
  const rCount = rand();
  const rGap1 = rand();
  const rGap2 = rand();
  const rK1 = rand();
  const count = rCount < proTripleProb(speed) ? 3 : 2;
  const { min: gMin, max: gMax } = proGapRange(speed);
  const gaps = [gMin + rGap1 * (gMax - gMin), gMin + rGap2 * (gMax - gMin)];
  const targetSec = [T];
  for (let i = 1; i < count; i++) targetSec.push(targetSec[i - 1] + gaps[i - 1]);
  const { lo, hi } = proK1Range(speed, T, shape, targetSec);
  const k1 = hi < lo ? hi : lo + rK1 * (hi - lo);
  return { count, targetSec, k: targetSec.map((t) => (k1 * t) / T), shape };
}

// 目標 targetIndex（時刻 targetSec）の自動MISSの時刻（秒。輪が広がり始めてから）＝ targetSec + Dg × T。
// Dg はその目標の判定幅（1つ目は Speed で広がる。4.11.3）
export function proAutoMissAtSec(targetSec, T, stage, targetIndex = 0) {
  return targetSec + judgeWindows(T, stage, targetIndex).goodD * T;
}

// 同じ時刻（ms）＝ t0 + (targetSec + Dg × T)。1マイクロ秒単位に丸める
export function proAutoMissAtMs(t0Ms, targetSec, T, stage, targetIndex = 0) {
  return t0Ms + secToMsRounded(proAutoMissAtSec(targetSec, T, stage, targetIndex));
}

// MISS で途中で終わったラウンドの「最後の目標の判定幅の終わり」の時刻（ms）＝ t0 + (Tₙ + Dg後 × T)。
// 次の ① では、この時刻までのタップもお手つきにしない（仕様書4.11.5。修正点13回目）
export function proIgnoreUntilMs(t0Ms, layout, T, stage) {
  const last = layout.count - 1;
  return proAutoMissAtMs(t0Ms, layout.targetSec[last], T, stage, last);
}

// 輪の大きさの上限（R₁ を基準にした比率）。Easy・Normal・Hard は 1.5、
// Professional・今日のチャレンジは最後の目標の自動MISSの時刻 ÷ T（仕様書4.10.6・4.11.5）
export function ringMaxRatio(modeId, layout, T, stage) {
  if (!modeOf(modeId).multi || !layout) return CONFIG.AUTO_MISS_FACTOR;
  const last = layout.targetSec.length - 1;
  return proAutoMissAtSec(layout.targetSec[last], T, stage, Math.max(last, 1)) / T;
}

// ① 待ちのタップの扱い（仕様書4.11.5・4.11.9）：'ignore' | 'falseStart'
// Easy・Normal・Hard は常に 'ignore'。Professional・今日のチャレンジは
// tapMs < max(① の始まり + 0.1秒, ignoreUntilMs) なら 'ignore'、それ以降は 'falseStart'（お手つき MISS）
export function waitTapResult(modeId, tapMs, waitStartMs, ignoreUntilMs = null) {
  if (!modeOf(modeId).falseStart) return 'ignore';
  const until = Math.max(waitStartMs + CONFIG.PRO_FALSE_START_GRACE_MS, ignoreUntilMs ?? -Infinity);
  return tapMs < until ? 'ignore' : 'falseStart';
}

// ===== 今日のチャレンジ（仕様書4.12.2）：日付から全員同じ乱数 =====
// 32ビットの整数演算だけで作る乱数（どのブラウザでも同じ数列）。0以上1未満
export function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailySeed(dateKey) {
  return Math.imul(dateKey, 0x9E3779B1) >>> 0;
}

// ラウンドの番号（0始まり）ごとに別の乱数列。番号が同じなら全員同じ
export function roundRand(seed, roundIndex) {
  return mulberry32((seed ^ Math.imul(roundIndex + 1, 0x85EBCA6B)) >>> 0);
}

// 端末の今の日付（その土地の時刻）→ YYYYMMDD の整数
export function dateKeyOf(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// 日付キー → 「10/17」
export function dateLabel(dateKey) {
  return `${Math.floor(dateKey / 100) % 100}/${dateKey % 100}`;
}

// ===== 判定 =====
// 判定幅の率（仕様書4.4・4.11.3）：PERFECT は ±0.05T、GOOD は ±0.12T。ただし下限（ms）より狭くしない。
// 下限は SPEED 13 以下（または stage 省略）で ±33ms・±80ms。SPEED 14 以上は、
// 1つ目の目標（targetIndex 0）だけ Speed に比例して広げ（SPEED 100 で ±45ms・±100ms）、2つ目以降は ±33ms・±80ms
export function judgeWindows(T, stage, targetIndex = 0) {
  let perfectMs = CONFIG.PERFECT_MIN_MS;
  let goodMs = CONFIG.GOOD_MIN_MS;
  const lastTableStage = CONFIG.SPEED_STAGES.length;
  if (stage != null && stage > lastTableStage) {
    if (targetIndex === 0) {
      const u = (Math.min(stage, CONFIG.SPEED_MAX) - lastTableStage) / (CONFIG.SPEED_MAX - lastTableStage);
      perfectMs = CONFIG.PERFECT_MIN_MS + (CONFIG.PERFECT_MIN_MS_AT_MAX - CONFIG.PERFECT_MIN_MS) * u;
      goodMs = CONFIG.GOOD_MIN_MS + (CONFIG.GOOD_MIN_MS_AT_MAX - CONFIG.GOOD_MIN_MS) * u;
    } else {
      perfectMs = CONFIG.PRO_LATER_PERFECT_MS;
      goodMs = CONFIG.PRO_LATER_GOOD_MS;
    }
  }
  return {
    perfectD: Math.max(CONFIG.PERFECT_MAX_D, perfectMs / 1000 / T),
    goodD: Math.max(CONFIG.GOOD_MAX_D, goodMs / 1000 / T),
  };
}

// tTapSec：輪が広がり始めてからの秒数（入力遅延補正済み）。targetSec：目標に届く時刻（Easy・Normal・Hard は T）。
// T：そのラウンドの T（秒）。d = |tTapSec − targetSec| ÷ T。stage・targetIndex は judgeWindows と同じ（省略時は v6 と同じ結果）
// 戻り値：{ result: 'PERFECT'|'GOOD'|'MISS', early: boolean }
export function judge(tTapSec, targetSec, T, stage, targetIndex = 0) {
  const d = Math.abs(tTapSec - targetSec) / T;
  const w = judgeWindows(T, stage, targetIndex);
  const early = tTapSec < targetSec;
  if (d <= w.perfectD + EPS) return { result: 'PERFECT', early };
  if (d <= w.goodD + EPS) return { result: 'GOOD', early };
  return { result: 'MISS', early };
}

// pointerdown の timeStamp と輪の開始時刻 t0（どちらも ms）からタップ時刻（秒）を求める（仕様書4.7）
export function tapTimeSec(eventTimeStampMs, t0Ms, offsetMs = CONFIG.INPUT_OFFSET_MS) {
  return (eventTimeStampMs - t0Ms - offsetMs) / 1000;
}

// 秒 → ms を1マイクロ秒単位に丸める（1.5 × 1.6 × 1000 が 2400.0000000000005 になるため）
export function secToMsRounded(sec) {
  return Math.round(sec * 1e6) / 1000;
}

// 自動MISSまでの時間（ms）= 1.5T
function autoMissThresholdMs(T) {
  return secToMsRounded(CONFIG.AUTO_MISS_FACTOR * T);
}

export function isAutoMiss(elapsedMs, T) {
  return elapsedMs >= autoMissThresholdMs(T);
}

// 自動MISSの時刻（ms）= t0 + 1.5T
export function autoMissAtMs(t0Ms, T) {
  return t0Ms + autoMissThresholdMs(T);
}

// 1回の獲得点 = floor(基本点 × (1 + min(コンボ,10) × 0.1))。誤差を避けるため整数で計算する
export function pointsFor(result, comboBefore) {
  const base = result === 'PERFECT' ? CONFIG.PERFECT_POINTS : result === 'GOOD' ? CONFIG.GOOD_POINTS : 0;
  const c = Math.min(comboBefore, CONFIG.COMBO_CAP);
  return Math.floor((base * (10 + c)) / 10);
}

// ===== 1プレイの状態 =====
// stage：今のラウンドのスピード段階（①待ちの始まりに game.js が決める。開始時はモードの開始段階）。
// Professional・今日のチャレンジは開始の Speed（startSpeed）も持つ
export function newPlayState(modeId = 'easy', startSpeed) {
  const mode = normalizeModeId(modeId);
  const base = { mode, score: 0, lives: CONFIG.START_LIVES, combo: 0, perfects: 0, maxCombo: 0 };
  if (mode === 'pro' || mode === 'daily') {
    const speed = mode === 'daily' ? CONFIG.MODES.daily.fixedSpeed : normalizeProSpeed(startSpeed);
    return { ...base, stage: speed, startSpeed: speed };
  }
  return { ...base, stage: CONFIG.MODES[mode].startStage };
}

export function stageOf(state) {
  return state.stage;
}

// 判定結果を状態に反映する（state を書き換える）。段階は変えない（成功・MISSは段階に関係しない）
// 戻り値：{ points, gameOver }
export function applyJudgement(state, result) {
  let points = 0;
  if (result === 'PERFECT' || result === 'GOOD') {
    points = pointsFor(result, state.combo);
    state.score += points;
    state.combo += 1;
    if (result === 'PERFECT') state.perfects += 1;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  } else {
    state.combo = 0;
    state.lives = Math.max(0, state.lives - 1);
  }
  return { points, gameOver: state.lives === 0 };
}

// ===== 表示用 =====
export function formatNumber(n) {
  const v = Math.min(Math.max(0, Math.floor(n)), CONFIG.SCORE_DISPLAY_MAX);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 「最高記録」の表示ルール（仕様書7章）。record は { bestScore, playCount }
export function bestScoreText(record) {
  return record.playCount === 0 ? '---' : formatNumber(record.bestScore);
}

// 今日のチャレンジの「今日の最高」：today.date が今日でなければ（0 を含む）「---」
export function dailyTodayText(today, todayKey) {
  return today.date === todayKey && today.date !== 0 ? formatNumber(today.bestScore) : '---';
}

// 今日のチャレンジの「これまでの最高」：date ＝ 0 なら「---」、それ以外は「15,000（10/12）」
export function dailyAllTimeText(allTime) {
  return allTime.date === 0 ? '---' : `${formatNumber(allTime.bestScore)}（${dateLabel(allTime.date)}）`;
}

// タイトルの Professional のボタンの説明文（仕様書6.2）。Professional を一度も始めていなければ「（10〜100）」
export function proNoteText(proData) {
  const started = proData.lastSpeed !== CONFIG.PRO_DEFAULT_SPEED
    || Object.values(proData.speeds).some((r) => r.playCount > 0);
  return started ? `Speedを選ぶ・前回 SPEED ${proData.lastSpeed}` : 'Speedを選ぶ（10〜100）';
}

// タイトルの今日のチャレンジのボタンの説明文（仕様書6.2）
export function dailyNoteText(today, todayKey) {
  return `SPEED ${CONFIG.MODES.daily.fixedSpeed}・全員同じ盤・今日 ${dailyTodayText(today, todayKey)}`;
}

// シェアの文面（仕様書4.13）。p：{ modeId, speed, score, perfects, maxCombo, dateKey, today }
//   2行目は今のプレイの値。today は今日のチャレンジだけ（このプレイを保存した後の daily.today）
export function shareText(p) {
  const id = normalizeModeId(p.modeId);
  const playLine = `${formatNumber(p.score)}点（PERFECT ${p.perfects}回・最大コンボ ${p.maxCombo}）`;
  let lines;
  if (id === 'daily') {
    lines = [
      `ぴたリング ${CONFIG.MODES.daily.label} ${dateLabel(p.dateKey)}`,
      `SPEED ${p.speed} ・ ${playLine}`,
      `今日の最高 ${formatNumber(p.today.bestScore)}（挑戦 ${p.today.playCount}回）`,
    ];
  } else if (id === 'pro') {
    lines = [`ぴたリング ${CONFIG.MODES.pro.label} SPEED ${p.speed}`, playLine];
  } else {
    lines = [`ぴたリング ${CONFIG.MODES[id].label}`, playLine];
  }
  if (CONFIG.SHARE_URL) lines.push(CONFIG.SHARE_URL);
  return lines.join('\n');
}

// ===== 制限時間（仕様書4.9.2） =====
// 時計は { playedMs, clockStart } で持つ（どちらも ms、performance.now と同じ時計）。
// playedMs：これまでに数えた合計。clockStart：今数えている区間の始まり（数えていないときは null）。
// 関数は時計を書き換えず、新しい時計を返す。
export function timeLimitMs() {
  return CONFIG.TIME_LIMIT_SEC * 1000;
}

export function newClock() {
  return { playedMs: 0, clockStart: null };
}

export function isClockRunning(clock) {
  return clock.clockStart != null;
}

// 区間を始める（READY が終わった時刻 = READY の開始時刻 + 1000ms）
export function startClock(clock, atMs) {
  if (isClockRunning(clock)) return clock;
  return { playedMs: clock.playedMs, clockStart: atMs };
}

// 区間を終える：playedMs += 終わりの時刻 − clockStart（制限時間を超えては数えない）
export function stopClock(clock, endMs, limitMs = timeLimitMs()) {
  if (!isClockRunning(clock)) return clock;
  const played = clock.playedMs + Math.max(0, endMs - clock.clockStart);
  return { playedMs: Math.min(limitMs, played), clockStart: null };
}

// 締切時刻 deadline = clockStart + 制限ms − playedMs（数えていないときは null）
export function deadlineOf(clock, limitMs = timeLimitMs()) {
  return isClockRunning(clock) ? clock.clockStart + limitMs - clock.playedMs : null;
}

// 残りms：数えているとき max(0, deadline − 今)、数えていないとき max(0, 制限ms − playedMs)
export function remainingMs(clock, nowMs, limitMs = timeLimitMs()) {
  if (isClockRunning(clock)) return Math.max(0, deadlineOf(clock, limitMs) - nowMs);
  return Math.max(0, limitMs - clock.playedMs);
}

// 表示する残り秒数 = ceil(残りms ÷ 1000)（0未満は0）
export function displaySeconds(remMs) {
  return Math.max(0, Math.ceil(remMs / 1000));
}

// 残り10秒（TIME_WARN_SEC）以下で警告表示
export function isTimeWarning(remMs) {
  return remMs <= CONFIG.TIME_WARN_SEC * 1000;
}

// 残り時間バーの中身の割合（0〜1）
export function timerBarRatio(remMs, limitMs = timeLimitMs()) {
  if (limitMs <= 0) return 0;
  return Math.min(1, Math.max(0, remMs / limitMs));
}

// そのフレームで時間切れか（ts ≧ deadline）
export function isTimeUp(clock, ts, limitMs = timeLimitMs()) {
  return isClockRunning(clock) && ts >= deadlineOf(clock, limitMs);
}

// タップ（pointerdown / スペースキー）を判定してよいか：補正前の timeStamp が締切より前のときだけ
export function acceptsTapAt(clock, tapMs, limitMs = timeLimitMs()) {
  return isClockRunning(clock) && tapMs < deadlineOf(clock, limitMs);
}

// 一時停止したときの区間の終わり＝最後に処理した rAF の ts（区間の始まりより前にはしない）
export function pauseEndMs(clockStart, lastFrameTs) {
  if (lastFrameTs == null) return clockStart;
  return Math.max(clockStart, lastFrameTs);
}

// 判定でライフ0になったときに時計を止める時刻：タップならその timeStamp（補正前）、自動MISSなら t0 + 1.5T。
// Professional の自動MISSは autoMissAt（t0 + (Tᵢ + Dg × T)）を渡す
export function judgementEndMs(source, tapMs, t0Ms, T, autoMissAt = autoMissAtMs(t0Ms, T)) {
  return source === 'auto' ? autoMissAt : tapMs;
}

// 自動MISSと時間切れのどちらを先に処理するか。自動MISSが早いときだけ 'autoMiss'、同時刻は時間切れ優先
export function firstOfAutoMissAndDeadline(autoMissAt, deadline) {
  return autoMissAt < deadline ? 'autoMiss' : 'timeup';
}

// 広がり中のフレームで起きること：'autoMiss' | 'timeup' | null
// deadline が null（時計が止まっている）なら時間切れは起きない。
// autoMissAt：自動MISSの時刻（ms）。省略時は t0 + 1.5T（Professional は proAutoMissAtMs を渡す）
export function growFrameEvent(ts, t0Ms, T, deadline, autoMissAt) {
  const autoAt = autoMissAt ?? autoMissAtMs(t0Ms, T);
  const autoDue = autoMissAt == null ? isAutoMiss(ts - t0Ms, T) : ts >= autoMissAt;
  const timeUpDue = deadline != null && ts >= deadline;
  if (autoDue && timeUpDue) return firstOfAutoMissAndDeadline(autoAt, deadline);
  if (autoDue) return 'autoMiss';
  if (timeUpDue) return 'timeup';
  return null;
}

// 結果画面の見出しと終了理由の説明（仕様書6.5）。reason：'timeup' | 'lives'
export function endTexts(reason, lives, remMs) {
  if (reason === 'timeup') {
    return { heading: 'タイムアップ', detail: `${CONFIG.TIME_LIMIT_SEC}秒たちました（残りライフ ${lives}）` };
  }
  return { heading: 'ゲームオーバー', detail: `ライフがなくなりました（残り ${displaySeconds(remMs)}秒）` };
}

// ===== ゲーム領域 S（仕様書6.1） =====
// innerWidth, viewportHeight：CSS px。safe：{top,right,bottom,left}
export function computeS(innerWidth, viewportHeight, safe) {
  const H = viewportHeight - safe.top - safe.bottom;
  const Wd = innerWidth - safe.left - safe.right;
  const s = Math.floor(Math.min(Wd - CONFIG.S_SIDE_MARGIN_TOTAL, H - CONFIG.S_VERTICAL_RESERVED, CONFIG.S_MAX));
  return Math.max(CONFIG.S_MIN, s);
}

// タイトル画面の高さ H（CSS px）から、デモの一辺 D と中心の y を求める（仕様書6.2。style.css の配置と同じ数値）
// 説明の下端 ＝ 12%H（ゲーム名の中心）+ 22（ゲーム名の高さの半分）+ 8 + 24（説明の1行）
// ボタンの上端 ＝ H − 6%H − 312（ボタン5つの合計の高さ。v7）
// D ＝ min(空きの高さ − 16, 200)。80未満なら 0（出さない）
export const TITLE_LAYOUT = Object.freeze({
  NAME_CENTER_RATIO: 0.12, NAME_HALF_PX: 22, DESC_GAP_PX: 8, DESC_LINE_PX: 24,
  BUTTONS_BOTTOM_RATIO: 0.06, BUTTONS_TOTAL_PX: 312, DEMO_MARGIN_PX: 16, DEMO_MAX_PX: 200, DEMO_MIN_PX: 80,
});
// descBottomPx：説明文の実際の下端（タイトル画面の上端から。狭い幅で説明文が2行になったときのため）。
// 渡さない・0以下のときは説明文を1行として計算する
export function titleDemoLayout(H, descBottomPx = null) {
  const L = TITLE_LAYOUT;
  const oneLine = H * L.NAME_CENTER_RATIO + L.NAME_HALF_PX + L.DESC_GAP_PX + L.DESC_LINE_PX;
  const descBottom = descBottomPx > 0 ? descBottomPx : oneLine;
  const buttonsTop = H - H * L.BUTTONS_BOTTOM_RATIO - L.BUTTONS_TOTAL_PX;
  const gap = buttonsTop - descBottom;
  const d = Math.floor(Math.min(gap - L.DEMO_MARGIN_PX, L.DEMO_MAX_PX));
  return { D: d >= L.DEMO_MIN_PX ? d : 0, centerY: descBottom + gap / 2, gap };
}

// ===== 端末の種類・横向き・PC用の枠（修正3回目） =====
// タッチ主体の端末か：主な入力が指（pointer: coarse）で、ホバーできない（hover: none）
export function isTouchPrimary(pointerCoarse, hoverNone) {
  return !!(pointerCoarse && hoverNone);
}

// 「縦向きでお遊びください」を出すか：タッチ主体の端末で横長のときだけ。
// マウス操作のPCは画面を回せないので、横長でもブロックしない。
export function shouldBlockLandscape(innerWidth, innerHeight, touchPrimary) {
  return !!touchPrimary && innerWidth > innerHeight;
}

// ゲームを表示する枠の幅（CSS px）。
// タッチ主体の端末：画面の幅そのまま。
// PC：min(表示幅, max(320, 高さ×9/16), 480)。表示幅が320pxより狭いときも表示幅を超えない
export function frameWidth(innerWidth, viewportHeight, touchPrimary) {
  if (touchPrimary) return Math.floor(innerWidth);
  const w = Math.floor(viewportHeight * CONFIG.PC_FRAME_RATIO);
  const clamped = Math.min(Math.max(w, CONFIG.PC_FRAME_MIN_W), CONFIG.PC_FRAME_MAX_W);
  return Math.min(Math.floor(innerWidth), clamped);
}

// ===== 保存データ（仕様書7章） =====
// v3（pitaring.v3）：Easy・Normal・Hard はモードごと、Professional は Speed ごと、今日のチャレンジは今日の記録とこれまでの最高。
// v3 が無い・壊れている → v2（v6 の形）を v6 の決まりで読み、Easy・Normal・Hard と lastMode を引き継ぐ（v2 の pro は引き継がない）
const V2_MODE_ORDER = Object.freeze(['easy', 'normal', 'hard', 'pro']); // v6（pitaring.v2）のモード
const V3_RECORD_MODES = Object.freeze(['easy', 'normal', 'hard']);      // v3 の modes に入るモード

export function defaultRecord() {
  return { bestScore: 0, playCount: 0 };
}

function defaultDailyToday() {
  return { date: 0, bestScore: 0, playCount: 0 };
}

function defaultDailyAllTime() {
  return { date: 0, bestScore: 0 };
}

export function defaultSave() {
  const modes = {};
  for (const id of V3_RECORD_MODES) modes[id] = defaultRecord();
  const speeds = {};
  for (const s of CONFIG.PRO_SPEED_CHOICES) speeds[s] = defaultRecord();
  return {
    modes,
    pro: { lastSpeed: CONFIG.PRO_DEFAULT_SPEED, speeds },
    daily: { today: defaultDailyToday(), allTime: defaultDailyAllTime() },
    lastMode: 'easy',
  };
}

function cloneSave(data) {
  const modes = {};
  for (const id of V3_RECORD_MODES) modes[id] = { ...data.modes[id] };
  const speeds = {};
  for (const s of CONFIG.PRO_SPEED_CHOICES) speeds[s] = { ...data.pro.speeds[s] };
  return {
    modes,
    pro: { lastSpeed: data.pro.lastSpeed, speeds },
    daily: { today: { ...data.daily.today }, allTime: { ...data.daily.allTime } },
    lastMode: data.lastMode,
  };
}

// 保存値として正しい整数か（0以上・上限以下の安全な整数。1e308 などは破損扱い）
function isValidSaveInt(v) {
  return Number.isSafeInteger(v) && v >= 0 && v <= CONFIG.SAVE_VALUE_MAX;
}

// 日付キーとして正しいか（0 ＝ 未プレイ、または 19700101〜99991231 の整数。月日の正しさまでは見ない）
function isValidSaveDate(v) {
  return Number.isSafeInteger(v) && (v === 0 || (v >= CONFIG.SAVE_DATE_MIN && v <= CONFIG.SAVE_DATE_MAX));
}

// null でなく配列でないオブジェクトか
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 1つ分の記録（v1 全体もこの形）として正しいか
function isValidRecord(v) {
  return isPlainObject(v) && isValidSaveInt(v.bestScore) && isValidSaveInt(v.playCount);
}

// daily.today として正しいか。date ＝ 0（未プレイ）なら bestScore・playCount も 0
function isValidDailyToday(v) {
  if (!isValidRecord(v) || !isValidSaveDate(v.date)) return false;
  return v.date !== 0 || (v.bestScore === 0 && v.playCount === 0);
}

// daily.allTime として正しいか。date ＝ 0（未プレイ）なら bestScore も 0
function isValidDailyAllTime(v) {
  if (!isPlainObject(v) || !isValidSaveInt(v.bestScore) || !isValidSaveDate(v.date)) return false;
  return v.date !== 0 || v.bestScore === 0;
}

function safeJsonParse(raw) {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// v2 の文字列が「使える」か（JSONとして読めて、全体と modes が配列でないオブジェクト）
export function isUsableV2(rawV2) {
  const obj = safeJsonParse(rawV2);
  return isPlainObject(obj) && isPlainObject(obj.modes);
}

// v3 の文字列が「使える」か（v2 と同じ基準）
export function isUsableV3(rawV3) {
  return isUsableV2(rawV3);
}

// v6 の読み方（v2 → だめなら v1 を Easy へ）。v6 の parseSave をそのまま残したもの。
// 戻り値 { data: { modes: { easy, normal, hard, pro }, lastMode }, needsWrite, source: 'v2' | 'v1' | 'default' }
export function parseSaveV2(rawV2, rawV1) {
  const defaultV2 = () => {
    const modes = {};
    for (const id of V2_MODE_ORDER) modes[id] = defaultRecord();
    return { modes, lastMode: 'easy' };
  };
  const v2 = safeJsonParse(rawV2);
  if (isPlainObject(v2) && isPlainObject(v2.modes)) {
    const data = defaultV2();
    let fixed = false;
    for (const id of V2_MODE_ORDER) {
      const rec = v2.modes[id];
      if (isValidRecord(rec)) data.modes[id] = { bestScore: rec.bestScore, playCount: rec.playCount };
      else fixed = true; // そのモードだけ 0 に戻す
    }
    if (V2_MODE_ORDER.includes(v2.lastMode)) data.lastMode = v2.lastMode;
    else fixed = true;
    return { data, needsWrite: fixed, source: 'v2' };
  }
  // v2 が無い・壊れている → v1（v5 までの形 {bestScore, playCount}）を Easy として移す
  const data = defaultV2();
  const v1 = safeJsonParse(rawV1);
  if (isValidRecord(v1)) {
    data.modes.easy = { bestScore: v1.bestScore, playCount: v1.playCount };
    return { data, needsWrite: true, source: 'v1' };
  }
  return { data, needsWrite: true, source: 'default' };
}

// rawV3・rawV2・rawV1：localStorage の文字列（無ければ null）
// 戻り値 { data, needsWrite, source }（仕様書7章）
//   data：defaultSave() と同じ形（すべての項目がそろう）
//   needsWrite：v3 として書き直す必要があるか。source：'v3' | 'v2' | 'v1' | 'default'
export function parseSave(rawV3, rawV2, rawV1) {
  const v3 = safeJsonParse(rawV3);
  if (isPlainObject(v3) && isPlainObject(v3.modes)) {
    const data = defaultSave();
    let fixed = false;
    for (const id of V3_RECORD_MODES) {
      const rec = v3.modes[id];
      if (isValidRecord(rec)) data.modes[id] = { bestScore: rec.bestScore, playCount: rec.playCount };
      else fixed = true; // そのモードだけ 0 に戻す
    }
    const pro = isPlainObject(v3.pro) ? v3.pro : null;
    if (!pro) fixed = true;
    const speeds = pro && isPlainObject(pro.speeds) ? pro.speeds : null;
    for (const s of CONFIG.PRO_SPEED_CHOICES) {
      const rec = speeds ? speeds[s] : undefined;
      if (isValidRecord(rec)) data.pro.speeds[s] = { bestScore: rec.bestScore, playCount: rec.playCount };
      else fixed = true; // その Speed だけ 0 に戻す
    }
    if (pro && CONFIG.PRO_SPEED_CHOICES.includes(pro.lastSpeed)) data.pro.lastSpeed = pro.lastSpeed;
    else fixed = true;
    const daily = isPlainObject(v3.daily) ? v3.daily : null;
    if (daily && isValidDailyToday(daily.today)) {
      const t = daily.today;
      data.daily.today = { date: t.date, bestScore: t.bestScore, playCount: t.playCount };
    } else fixed = true;
    if (daily && isValidDailyAllTime(daily.allTime)) {
      const a = daily.allTime;
      data.daily.allTime = { date: a.date, bestScore: a.bestScore };
    } else fixed = true;
    if (CONFIG.MODE_ORDER.includes(v3.lastMode)) data.lastMode = v3.lastMode;
    else fixed = true;
    return { data, needsWrite: fixed, source: 'v3' };
  }
  // v3 が無い・壊れている → v2（だめなら v1）を v6 の決まりで読み、Easy・Normal・Hard と lastMode を引き継ぐ
  const old = parseSaveV2(rawV2, rawV1);
  const data = defaultSave();
  for (const id of V3_RECORD_MODES) data.modes[id] = { ...old.data.modes[id] };
  data.lastMode = old.data.lastMode;
  return { data, needsWrite: true, source: old.source };
}

// getStorage：localStorage を返す関数（アクセス自体が例外を出す環境があるため関数で渡す）
// 保存できない環境では、記録はページを開いている間だけメモリ上で持つ
export function createStore(getStorage) {
  let data = defaultSave();
  let persistent = true;

  function write() {
    try {
      getStorage().setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    } catch {
      persistent = false;
    }
  }

  // 上限を超えた値を保存すると次回読み込みで破損扱いになるため、上限で止める
  const cap = (v) => Math.min(v, CONFIG.SAVE_VALUE_MAX);

  function updateRecord(cur, score) {
    const isNewRecord = score > cur.bestScore;
    return {
      isNewRecord,
      next: { bestScore: cap(isNewRecord ? score : cur.bestScore), playCount: cap(cur.playCount + 1) },
    };
  }

  return {
    load() {
      try {
        const storage = getStorage();
        // v3 が使えるときは v2・v1 を読まない（移行は最初の1回だけ）。v2 が使えるときは v1 を読まない
        const rawV3 = storage.getItem(CONFIG.STORAGE_KEY);
        let rawV2 = null;
        let rawV1 = null;
        if (!isUsableV3(rawV3)) {
          rawV2 = storage.getItem(CONFIG.V2_STORAGE_KEY);
          if (!isUsableV2(rawV2)) rawV1 = storage.getItem(CONFIG.LEGACY_STORAGE_KEY);
        }
        const parsed = parseSave(rawV3, rawV2, rawV1);
        data = parsed.data;
        if (parsed.needsWrite) write(); // v3 だけ書く（v2・v1 は消さない・書かない）
      } catch {
        persistent = false;
        data = defaultSave();
      }
      return cloneSave(data);
    },
    // プレイが終わった瞬間（ライフ0・時間切れ）に呼ぶ。遊んだモード（Pro はその Speed、今日のチャレンジは today と allTime）
    // だけ更新し、同点は更新しない。opts：{ speed }（Pro）、{ dateKey }（今日のチャレンジ。プレイを始めた日）
    // 戻り値 { isNewRecord, isNewToday, record }
    recordPlayEnd(modeId, score, opts = {}) {
      const id = normalizeModeId(modeId);
      let result;
      if (id === 'pro') {
        const speed = normalizeProSpeed(opts.speed);
        const u = updateRecord(data.pro.speeds[speed], score);
        data.pro.speeds[speed] = u.next;
        result = { isNewRecord: u.isNewRecord, isNewToday: false, record: { ...u.next } };
      } else if (id === 'daily') {
        const dateKey = opts.dateKey;
        const { today, allTime } = data.daily;
        // 違う日なら、その日の新しい記録（playCount 1）で置き換える（前の日の分は消える。allTime は残る）
        const sameDay = today.date === dateKey;
        const isNewToday = sameDay ? score > today.bestScore : score > 0;
        data.daily.today = sameDay
          ? { date: dateKey, bestScore: cap(isNewToday ? score : today.bestScore), playCount: cap(today.playCount + 1) }
          : { date: dateKey, bestScore: cap(score), playCount: 1 };
        const isNewRecord = score > allTime.bestScore;
        if (isNewRecord || allTime.date === 0) data.daily.allTime = { date: dateKey, bestScore: cap(Math.max(score, allTime.bestScore)) };
        result = { isNewRecord, isNewToday, record: { today: { ...data.daily.today }, allTime: { ...data.daily.allTime } } };
      } else {
        const u = updateRecord(data.modes[id], score);
        data.modes[id] = u.next;
        result = { isNewRecord: u.isNewRecord, isNewToday: false, record: { ...u.next } };
      }
      if (persistent) write();
      return result;
    },
    // ゲーム開始の瞬間（Professional は画面1b のスタート）に呼ぶ。Professional は Speed も保存する
    setLastMode(modeId, speed) {
      const id = normalizeModeId(modeId);
      data.lastMode = id;
      if (id === 'pro') data.pro.lastSpeed = normalizeProSpeed(speed);
      if (persistent) write();
    },
    // Easy・Normal・Hard の記録
    recordOf(modeId) {
      const id = normalizeModeId(modeId);
      return { ...(V3_RECORD_MODES.includes(id) ? data.modes[id] : defaultRecord()) };
    },
    // Professional の Speed ごとの記録
    proRecordOf(speed) {
      return { ...data.pro.speeds[normalizeProSpeed(speed)] };
    },
    // 今日のチャレンジの記録。today は dateKey の日のものだけ（違う日なら未プレイ＝date 0）
    dailyOf(dateKey) {
      const t = data.daily.today;
      return {
        today: t.date === dateKey ? { ...t } : defaultDailyToday(),
        allTime: { ...data.daily.allTime },
      };
    },
    get data() {
      return cloneSave(data);
    },
    get persistent() {
      return persistent;
    },
  };
}
