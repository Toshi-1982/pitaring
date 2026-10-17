// ぴたリング：ゲームのロジック（描画・DOMに依存しない部分）
// node のテスト（tests/logic.test.mjs）からも読み込む。
// 用語（仕様書 v6）：モード＝Easy / Normal / Hard / Professional（プレイ前に選ぶ）。
// スピード段階（stage）＝ SPEED 1〜13（プレイ中に10秒ごとに上がる輪の速さ）。

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

  // モード（仕様書4.10.1）。並び順はタイトルのボタンの順
  MODE_ORDER: Object.freeze(['easy', 'normal', 'hard', 'pro']),
  MODES: Object.freeze({
    easy:   Object.freeze({ label: 'Easy',         startStage: 1, shapes: false, multi: false, note: 'SPEED 1から' }),
    normal: Object.freeze({ label: 'Normal',       startStage: 3, shapes: false, multi: false, note: 'SPEED 3から' }),
    hard:   Object.freeze({ label: 'Hard',         startStage: 6, shapes: true,  multi: false, note: 'SPEED 6から・形が変わる' }),
    pro:    Object.freeze({ label: 'Professional', startStage: 8, shapes: false, multi: true,  note: 'SPEED 8から・二重丸／三重丸' }),
  }),
  // Hard の形（仕様書4.10.3）
  SHAPES: Object.freeze(['circle', 'triangle', 'square']),

  // Professional の目標（仕様書4.10.4）。★目標の数・間隔は社長の確認待ち（9章#16）
  // 段階ごとの目標の数の候補（候補から等確率）。表に無い段階は [2]
  PRO_TARGETS_BY_STAGE: Object.freeze({
    8: Object.freeze([2]), 9: Object.freeze([2]), 10: Object.freeze([2, 3]),
    11: Object.freeze([2, 3]), 12: Object.freeze([3]), 13: Object.freeze([3]),
  }),
  PRO_GAP_MIN_SEC: 0.30,        // 目標の間の時間の間隔（一様乱数）
  PRO_GAP_MAX_SEC: 0.40,
  PRO_K1_MIN: 0.11,             // 一番内側の大きさ k₁ の範囲
  PRO_K1_MAX: 0.22,
  PRO_K_OUTER_MAX: 0.38,        // 一番外側の大きさの上限

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

  // 保存キー（仕様書7章）
  STORAGE_KEY: 'pitaring.v2',
  LEGACY_STORAGE_KEY: 'pitaring.v1',   // 移行元（読むだけ。消さない）
  SAVE_VALUE_MAX: 99999999,            // 保存値（bestScore・playCount）の上限。超えたら破損扱い
});

// 浮動小数点の誤差で境界値（例：d がちょうど0.05）が外れないための許容値
const EPS = 1e-9;

// ===== モード（仕様書4.10） =====
// 未知の modeId は easy として扱う
export function normalizeModeId(modeId) {
  return Object.prototype.hasOwnProperty.call(CONFIG.MODES, modeId) ? modeId : 'easy';
}

export function modeOf(modeId) {
  return CONFIG.MODES[normalizeModeId(modeId)];
}

// READY の下の1行（仕様書6.3）：開始時「Hard ・ SPEED 6 から」、再開時「Hard ・ SPEED 8」
export function readySubText(modeId, stage, resumed) {
  return `${modeOf(modeId).label} ・ SPEED ${stage}${resumed ? '' : ' から'}`;
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

// スピード段階 ＝ min(開始段階 + ステップ数, 13)。limitMs はテスト用（game.js からは省略して呼ぶ）
export function stageAt(modeId, elapsedMs, limitMs = timeLimitMs()) {
  return Math.min(modeOf(modeId).startStage + stepAtElapsed(elapsedMs, limitMs), CONFIG.SPEED_STAGES.length);
}

// 段階の行。範囲外（0以下・表の行数より上）は 1〜行数 に収める
function stageRow(stage) {
  const stages = CONFIG.SPEED_STAGES;
  const i = Math.min(Math.max(Math.floor(stage) || 1, 1), stages.length) - 1;
  return stages[i];
}

export function tForStage(stage) {
  return stageRow(stage).T;
}

// rand は 0以上1未満を返す関数（テストで差し替えられるように引数にする）。min = max なら乱数を使わない
export function waitSecFor(stage, rand = Math.random) {
  const { waitMinSec, waitMaxSec } = stageRow(stage);
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

// ===== Hard の形（仕様書4.10.3） =====
// 1ラウンド目（prev が null）は3種類から等確率、それ以降は直前と違う2種類から等確率
export function nextShape(prevShape, rand = Math.random) {
  const all = CONFIG.SHAPES;
  const pool = all.includes(prevShape) ? all.filter((s) => s !== prevShape) : all;
  const i = Math.min(Math.floor(rand() * pool.length), pool.length - 1);
  return pool[i];
}

// 三角・四角の頂点（中心から頂点まで r。Canvas の y は下向き）。円は null
// 三角：頂点が真上（−90°・30°・150°）。四角：辺が水平・垂直（45°・135°・225°・315°）
export function shapeVertices(shape, cx, cy, r) {
  let degs;
  if (shape === 'triangle') degs = [-90, 30, 150];
  else if (shape === 'square') degs = [45, 135, 225, 315];
  else return null;
  return degs.map((d) => {
    const a = (d * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

// ===== Professional の配置（仕様書4.10.4） =====
// 目標の数：その段階の候補から等確率（表に無い段階は2）
export function proTargetCount(stage, rand = Math.random) {
  const cands = CONFIG.PRO_TARGETS_BY_STAGE[stage] || [2];
  const i = Math.min(Math.floor(rand() * cands.length), cands.length - 1);
  return cands[i];
}

// ① 待ちの始まりに決める配置 { count, targetSec: [T₁…Tₙ], k: [k₁…kₙ] }
// Tᵢ ＝ T + (g₁ + … + gᵢ₋₁)（g は0.30〜0.40秒）、k₁ は 0.11〜min(0.22, 0.38 ÷ (Tₙ ÷ T))、kᵢ ＝ k₁ × Tᵢ ÷ T
// 乱数は「数 → 間隔（内側から）→ k₁」の順に使う
export function proLayout(stage, T, rand = Math.random) {
  const count = proTargetCount(stage, rand);
  const targetSec = [T];
  for (let i = 1; i < count; i++) {
    const gap = CONFIG.PRO_GAP_MIN_SEC + rand() * (CONFIG.PRO_GAP_MAX_SEC - CONFIG.PRO_GAP_MIN_SEC);
    targetSec.push(targetSec[i - 1] + gap);
  }
  const outerRatio = targetSec[count - 1] / T;
  const lo = CONFIG.PRO_K1_MIN;
  const hi = Math.min(CONFIG.PRO_K1_MAX, CONFIG.PRO_K_OUTER_MAX / outerRatio);
  const k1 = hi < lo ? lo : lo + rand() * (hi - lo); // 万一 上限 < 下限 なら下限（仕様書4.10.4）
  return { count, targetSec, k: targetSec.map((t) => (k1 * t) / T) };
}

// 目標（時刻 targetSec）の自動MISSの時刻（秒。輪が広がり始めてから）＝ targetSec + Dg × T
export function proAutoMissAtSec(targetSec, T) {
  return targetSec + judgeWindows(T).goodD * T;
}

// 同じ時刻（ms）＝ t0 + (targetSec + Dg × T)。1マイクロ秒単位に丸める
export function proAutoMissAtMs(t0Ms, targetSec, T) {
  return t0Ms + secToMsRounded(proAutoMissAtSec(targetSec, T));
}

// 輪の大きさの上限（R₁ を基準にした比率）。Easy・Normal・Hard は 1.5、
// Professional は最後の目標の自動MISSの時刻 ÷ T（仕様書4.10.6・修正点9回目）
export function ringMaxRatio(modeId, layout, T) {
  if (!modeOf(modeId).multi || !layout) return CONFIG.AUTO_MISS_FACTOR;
  return proAutoMissAtSec(layout.targetSec[layout.targetSec.length - 1], T) / T;
}

// ===== 判定 =====
// 判定幅の率：PERFECT は ±0.05T、GOOD は ±0.12T。ただし ±33ms・±80ms より狭くしない（仕様書4.4）
export function judgeWindows(T) {
  return {
    perfectD: Math.max(CONFIG.PERFECT_MAX_D, CONFIG.PERFECT_MIN_MS / 1000 / T),
    goodD: Math.max(CONFIG.GOOD_MAX_D, CONFIG.GOOD_MIN_MS / 1000 / T),
  };
}

// tTapSec：輪が広がり始めてからの秒数（入力遅延補正済み）。targetSec：目標に届く時刻（Easy・Normal・Hard は T）。
// T：そのラウンドの T（秒）。d = |tTapSec − targetSec| ÷ T
// 戻り値：{ result: 'PERFECT'|'GOOD'|'MISS', early: boolean }
export function judge(tTapSec, targetSec, T) {
  const d = Math.abs(tTapSec - targetSec) / T;
  const w = judgeWindows(T);
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
function secToMsRounded(sec) {
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
// stage：今のラウンドのスピード段階（①待ちの始まりに game.js が経過時間から決める。開始時はモードの開始段階）
export function newPlayState(modeId = 'easy') {
  const mode = normalizeModeId(modeId);
  return {
    mode, score: 0, lives: CONFIG.START_LIVES, combo: 0, perfects: 0, maxCombo: 0,
    stage: CONFIG.MODES[mode].startStage,
  };
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

// 「最高記録」の表示ルール（仕様書7章）。record はモード1つ分の { bestScore, playCount }
export function bestScoreText(record) {
  return record.playCount === 0 ? '---' : formatNumber(record.bestScore);
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
// ボタンの上端 ＝ H − 6%H − 248（ボタン4つの合計の高さ）
// D ＝ min(空きの高さ − 16, 200)。80未満なら 0（出さない）
export const TITLE_LAYOUT = Object.freeze({
  NAME_CENTER_RATIO: 0.12, NAME_HALF_PX: 22, DESC_GAP_PX: 8, DESC_LINE_PX: 24,
  BUTTONS_BOTTOM_RATIO: 0.06, BUTTONS_TOTAL_PX: 248, DEMO_MARGIN_PX: 16, DEMO_MAX_PX: 200, DEMO_MIN_PX: 80,
});
export function titleDemoLayout(H) {
  const L = TITLE_LAYOUT;
  const descBottom = H * L.NAME_CENTER_RATIO + L.NAME_HALF_PX + L.DESC_GAP_PX + L.DESC_LINE_PX;
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

// ===== 保存データ（仕様書7章：モードごと。キー pitaring.v2、v1 は Easy へ移行） =====
export function defaultRecord() {
  return { bestScore: 0, playCount: 0 };
}

export function defaultSave() {
  const modes = {};
  for (const id of CONFIG.MODE_ORDER) modes[id] = defaultRecord();
  return { modes, lastMode: 'easy' };
}

function cloneSave(data) {
  const modes = {};
  for (const id of CONFIG.MODE_ORDER) modes[id] = { ...data.modes[id] };
  return { modes, lastMode: data.lastMode };
}

// 保存値として正しい整数か（0以上・上限以下の安全な整数。1e308 などは破損扱い）
function isValidSaveInt(v) {
  return Number.isSafeInteger(v) && v >= 0 && v <= CONFIG.SAVE_VALUE_MAX;
}

// null でなく配列でないオブジェクトか
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// モード1つ分の記録（v1 全体もこの形）として正しいか
function isValidRecord(v) {
  return isPlainObject(v) && isValidSaveInt(v.bestScore) && isValidSaveInt(v.playCount);
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

// rawV2・rawV1：localStorage の文字列（無ければ null）
// 戻り値 { data, needsWrite, source }（仕様書7章）
//   data：4モードとも必ずそろった { modes: { easy, normal, hard, pro }, lastMode }
//   needsWrite：v2 として書き直す必要があるか。source：'v2' | 'v1' | 'default'
export function parseSave(rawV2, rawV1) {
  const v2 = safeJsonParse(rawV2);
  if (isPlainObject(v2) && isPlainObject(v2.modes)) {
    const data = defaultSave();
    let fixed = false;
    for (const id of CONFIG.MODE_ORDER) {
      const rec = v2.modes[id];
      if (isValidRecord(rec)) data.modes[id] = { bestScore: rec.bestScore, playCount: rec.playCount };
      else fixed = true; // そのモードだけ 0 に戻す
    }
    if (CONFIG.MODE_ORDER.includes(v2.lastMode)) data.lastMode = v2.lastMode;
    else fixed = true;
    return { data, needsWrite: fixed, source: 'v2' };
  }
  // v2 が無い・壊れている → v1（v5 までの形 {bestScore, playCount}）を Easy として移す
  const data = defaultSave();
  const v1 = safeJsonParse(rawV1);
  if (isValidRecord(v1)) {
    data.modes.easy = { bestScore: v1.bestScore, playCount: v1.playCount };
    return { data, needsWrite: true, source: 'v1' };
  }
  return { data, needsWrite: true, source: 'default' };
}

// getStorage：localStorage を返す関数（アクセス自体が例外を出す環境があるため関数で渡す）
// 保存できない環境では、記録はページを開いている間だけメモリ上で4モード分持つ
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

  return {
    load() {
      try {
        const storage = getStorage();
        const rawV2 = storage.getItem(CONFIG.STORAGE_KEY);
        // v2 が使えるときは v1 を読まない（Easy への移行は最初の1回だけ）
        const rawV1 = isUsableV2(rawV2) ? null : storage.getItem(CONFIG.LEGACY_STORAGE_KEY);
        const parsed = parseSave(rawV2, rawV1);
        data = parsed.data;
        if (parsed.needsWrite) write(); // v2 だけ書く（v1 は消さない・書かない）
      } catch {
        persistent = false;
        data = defaultSave();
      }
      return cloneSave(data);
    },
    // プレイが終わった瞬間（ライフ0・時間切れ）に呼ぶ。そのモードだけ更新し、同点は更新しない
    recordPlayEnd(modeId, score) {
      const id = normalizeModeId(modeId);
      const cur = data.modes[id];
      const isNewRecord = score > cur.bestScore;
      // 上限を超えた値を保存すると次回読み込みで破損扱いになるため、上限で止める
      data.modes[id] = {
        bestScore: Math.min(isNewRecord ? score : cur.bestScore, CONFIG.SAVE_VALUE_MAX),
        playCount: Math.min(cur.playCount + 1, CONFIG.SAVE_VALUE_MAX),
      };
      if (persistent) write();
      return { isNewRecord, record: { ...data.modes[id] } };
    },
    // モードのボタンを押した瞬間（ゲーム開始時）に呼ぶ
    setLastMode(modeId) {
      data.lastMode = normalizeModeId(modeId);
      if (persistent) write();
    },
    recordOf(modeId) {
      return { ...data.modes[normalizeModeId(modeId)] };
    },
    get data() {
      return cloneSave(data);
    },
    get persistent() {
      return persistent;
    },
  };
}
