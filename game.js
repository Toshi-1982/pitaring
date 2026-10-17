// ぴたリング：画面遷移・入力・描画（ルールの計算は logic.js）
import {
  CONFIG, modeOf, normalizeModeId, readySubText, tForStage, waitSecFor, elapsedAt, stageAt, nextK, nextShape,
  shapeVertices, proLayout, proAutoMissAtSec, proAutoMissAtMs, ringMaxRatio, judge, tapTimeSec, newPlayState, stageOf, applyJudgement, formatNumber, bestScoreText,
  computeS, titleDemoLayout, createStore, isTouchPrimary, shouldBlockLandscape, frameWidth,
  newClock, isClockRunning, startClock, stopClock, deadlineOf, remainingMs, displaySeconds, isTimeWarning,
  timerBarRatio, isTimeUp, acceptsTapAt, pauseEndMs, judgementEndMs, growFrameEvent, endTexts,
} from './logic.js';

const COLOR = {
  white: '#FFFFFF',
  ring: '#4DD0B5',
  perfect: '#FFD54A',
  good: '#4FC3F7',
  miss: '#FF5252',
  sub: '#B0B6C8',
  done: '#555B6E',   // Professional の判定済みの目標
};
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const DEMO_T = 1.6;          // タイトルのデモ（仕様書6.2）
const DEMO_R_RATIO = 0.4;    // デモの目標円の半径 = 0.4D
const HISTORY_STATE = { app: 'pitaring' };

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  screens: { title: $('screen-title'), game: $('screen-game'), result: $('screen-result') },
  modeButtons: $('mode-buttons'),
  demoCanvas: $('demo-canvas'),
  gameCanvas: $('game-canvas'),
  hud: $('hud'),
  hudScore: $('hud-score'),
  hudTime: $('hud-time'),
  hudTimeNum: $('hud-time-num'),
  hudTimebarFill: $('hud-timebar-fill'),
  hudSpeed: $('hud-speed'),
  hudCombo: $('hud-combo'),
  hudMode: $('hud-mode'),
  hudLives: $('hud-lives'),
  btnPause: $('btn-pause'),
  pause: $('screen-pause'),
  pauseMode: $('pause-mode'),
  pauseStatus: $('pause-status'),
  btnResume: $('btn-resume'),
  btnQuit: $('btn-quit'),
  resultMode: $('result-mode'),
  resultHeading: $('result-heading'),
  resultReason: $('result-reason'),
  resultNew: $('result-new'),
  resultScore: $('result-score'),
  resultBestMode: $('result-best-mode'),
  resultBest: $('result-best'),
  resultUnsaved: $('result-unsaved'),
  resultDetail: $('result-detail'),
  btnRetry: $('btn-retry'),
  btnToTitle: $('btn-to-title'),
  missFlash: $('miss-flash'),
  rotate: $('rotate-overlay'),
  safeProbe: $('safe-probe'),
};
const gctx = el.gameCanvas.getContext('2d');
const dctx = el.demoCanvas.getContext('2d');

// ===== 保存データ =====
const store = createStore(() => window.localStorage);
store.load();

// ===== 状態 =====
let screen = 'title';     // 'title' | 'game' | 'result'
let paused = false;
let S = CONFIG.S_MIN;     // ゲーム領域の一辺（CSS px）
let demoSize = 0;         // タイトルのデモの一辺 D（0なら出さない）
let dpr = 1;

let play = null;          // 1プレイの成績（logic.js の newPlayState）。play.mode がモード
// round：{ k, W, shape, keepK, layout, layoutStage, ringMax, next, results, roundPoints, successCount }
//   keepK=true なら再開後に同じ k・W・形（Professional は同じ配置）を使う
//   layout：Professional の配置（logic.js proLayout）。ほかのモードは null
//   next：次に判定する目標の番号（内側から0始まり）。results[i]：{ result, at }（判定した目標）
let round = null;
let phase = null;         // 'ready' | 'wait' | 'grow' | 'result' | 'timeup' | null（一時停止中）
let phaseStart = 0;       // その段階が始まった時刻（ms、performance.now と同じ時計）
let readyResumed = false; // 今の READY が一時停止からの再開か（READY の下の1行を変える）
let t0 = null;            // 輪を初めて描いた rAF の時刻
let T = tForStage(1);
let judged = null;        // { result, early, points, rRatio }（③ 結果表示で使う最後の判定）
let endReason = null;     // null（プレイ中）| 'lives'（ライフ0の判定後）| 'timeup'（時間切れ）。終了後は一時停止を受け付けない
let speedBanner = null;   // { stage, start }
let lastRecord = null;    // recordPlayEnd の戻り値
let clock = newClock();   // 制限時間の時計（logic.js。仕様書4.9.2）
let lastFrameTs = null;   // 最後に処理した rAF の ts（一時停止した区間の終わりに使う）
let shownSec = null;      // HUD に出している残り秒数（数字が変わったときだけ弾ませる）
let rafId = null;
let missTimer = null;

// ===== 画面切替 =====
function showScreen(name) {
  screen = name;
  for (const [key, node] of Object.entries(el.screens)) node.classList.toggle('active', key === name);
}

// ===== タイトルのモードボタン（仕様書6.2） =====
const modeButtonParts = {}; // modeId → { button, best }
function buildModeButtons() {
  el.modeButtons.innerHTML = '';
  for (const id of CONFIG.MODE_ORDER) {
    const mode = CONFIG.MODES[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode-btn';
    button.dataset.mode = id;
    const row1 = document.createElement('span');
    row1.className = 'mode-row1';
    const label = document.createElement('span');
    label.className = 'mode-label';
    label.textContent = mode.label;
    const best = document.createElement('span');
    best.className = 'mode-best';
    row1.append(label, best);
    const note = document.createElement('span');
    note.className = 'mode-note';
    note.textContent = mode.note;
    button.append(row1, note);
    button.addEventListener('click', () => startGame(id));
    el.modeButtons.appendChild(button);
    modeButtonParts[id] = { button, best };
  }
}

function refreshTitle() {
  const data = store.data;
  for (const id of CONFIG.MODE_ORDER) {
    const parts = modeButtonParts[id];
    parts.best.textContent = `最高 ${bestScoreText(data.modes[id])}`;
    parts.button.classList.toggle('last', id === data.lastMode);
  }
}

// ===== レイアウト（仕様書6.1） =====
function readSafeArea() {
  const cs = getComputedStyle(el.safeProbe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

function sizeCanvas(canvas, size) {
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
}

// タッチ主体の端末か（スマホ・タブレット）。マウス操作のPCは false（修正3回目）
const mqCoarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
const mqHoverNone = window.matchMedia ? window.matchMedia('(hover: none)') : null;
function touchPrimary() {
  return isTouchPrimary(mqCoarse && mqCoarse.matches, mqHoverNone && mqHoverNone.matches);
}

// 実際に見えている幅（CSS px）。埋め込み表示などで innerWidth が見えている幅より大きく報告される
// 環境があるため、取れる値のうち最も小さいものを使う（枠が表示幅からはみ出さないように）
function visibleWidth() {
  const candidates = [window.innerWidth, document.documentElement.clientWidth];
  if (window.visualViewport) candidates.push(window.visualViewport.width);
  const valid = candidates.filter((w) => typeof w === 'number' && w > 0);
  return valid.length ? Math.min(...valid) : window.innerWidth;
}

function recomputeLayout() {
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  dpr = window.devicePixelRatio || 1;
  // PC では縦長の枠（幅＝高さ×9/16、最大480px）を中央に置き、S はその枠を基準に計算する
  const touch = touchPrimary();
  const fw = frameWidth(visibleWidth(), vh, touch);
  document.documentElement.classList.toggle('pc-frame', !touch);
  document.documentElement.style.setProperty('--frame-w', `${fw}px`);
  S = computeS(fw, vh, readSafeArea());
  sizeCanvas(el.gameCanvas, S);
  // タイトルのデモ：説明とモードのボタンの間の空きの中央（仕様書6.2）
  const demo = titleDemoLayout(el.app.clientHeight || vh);
  demoSize = demo.D;
  el.demoCanvas.hidden = demoSize === 0;
  el.demoCanvas.style.top = `${demo.centerY}px`;
  sizeCanvas(el.demoCanvas, Math.max(demoSize, 1));
  if (screen === 'game') drawGame(performance.now());
}

// 横向きでブロックするのはタッチ主体の端末だけ（PCは画面を回せないため対象外）
function isLandscape() {
  return shouldBlockLandscape(window.innerWidth, window.innerHeight, touchPrimary());
}

function checkOrientation() {
  const land = isLandscape();
  el.rotate.hidden = !land;
  if (land && screen === 'game') pauseGame();
}

let resizeTimer = null;
function onResize() {
  checkOrientation();
  if (resizeTimer) return;
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    recomputeLayout();
  }, CONFIG.RESIZE_THROTTLE_MS);
}

// ===== HUD =====
const HEART_PATH = 'M12 21s-7.5-4.6-9.6-9.2C1 8.6 2.9 4.5 6.8 4.5c2.2 0 3.6 1.2 5.2 3.1 1.6-1.9 3-3.1 5.2-3.1 3.9 0 5.8 4.1 4.4 7.3C19.5 16.4 12 21 12 21z';
function buildHearts() {
  el.hudLives.innerHTML = '';
  for (let i = 0; i < CONFIG.START_LIVES; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', HEART_PATH);
    svg.appendChild(path);
    el.hudLives.appendChild(svg);
  }
}

function updateHud() {
  el.hudScore.textContent = formatNumber(play.score);
  el.hudSpeed.textContent = `SPEED ${stageOf(play)}`;
  el.hudCombo.textContent = play.combo >= 2 ? `${play.combo} COMBO` : '';
  el.hudMode.textContent = modeOf(play.mode).label;
  const hearts = el.hudLives.querySelectorAll('path');
  hearts.forEach((p, i) => p.setAttribute('class', i < play.lives ? 'heart-on' : 'heart-off'));
}

// 残り秒数とバー（仕様書4.9.1）。READY中・一時停止中は時計が止まっているので値も止まる
function updateTimerHud(now) {
  const rem = remainingMs(clock, now);
  const sec = displaySeconds(rem);
  const warn = isTimeWarning(rem);
  el.hud.classList.toggle('time-warn', warn);
  el.hudTimebarFill.style.width = `${timerBarRatio(rem) * 100}%`;
  if (sec === shownSec) return;
  const changed = shownSec !== null;
  shownSec = sec;
  el.hudTimeNum.textContent = String(sec);
  // 残り10秒から、数字が変わるたび（10, 9, …, 1）に弾ませる（reduced-motion では CSS で止める）
  if (changed && warn && sec >= 1) {
    el.hudTime.classList.remove('pulse');
    void el.hudTime.offsetWidth; // アニメーションをやり直すため
    el.hudTime.classList.add('pulse');
  }
}

// ===== ゲームの進行（仕様書4.3） =====
// modeId：タイトルで押したモード。「もう一度」は同じモード（仕様書6.5）
function startGame(modeId) {
  const mode = normalizeModeId(modeId);
  store.setLastMode(mode); // モードのボタンを押した瞬間に保存（仕様書7章）
  play = newPlayState(mode);
  round = {
    k: null, W: null, shape: null, keepK: false, layout: null, layoutStage: null,
    ringMax: CONFIG.AUTO_MISS_FACTOR, next: 0, results: [], roundPoints: 0, successCount: 0,
  };
  paused = false;
  endReason = null;
  judged = null;
  speedBanner = null;
  lastRecord = null;
  t0 = null;
  clock = newClock(); // 残り時間は制限時間に戻る
  lastFrameTs = null;
  shownSec = null;
  el.hudTime.classList.remove('pulse');
  clearMissEffects();
  el.pause.hidden = true;
  el.btnPause.disabled = false;
  showScreen('game');
  ensureHistoryEntry();
  recomputeLayout();
  updateHud();
  const now = performance.now();
  updateTimerHud(now);
  startReady(now, false);
  requestLoop();
}

function startReady(now, resumed) {
  phase = 'ready';
  phaseStart = now;
  readyResumed = resumed;
  t0 = null;
  judged = null;
}

// ① 待ち：段階の開始と同時に、この時刻の経過時間とモードでスピード段階・T・W と新しい k（Hard は形、
// Professional は配置）を決める（仕様書4.3・4.5.2・4.10）。
// 一時停止からのやり直し（keepK）は k・W・形・配置は前の値、段階と T はここで決め直す。
// ただし Professional で段階が上がっていたら、新しい配置にして W も引き直す（仕様書4.6）
function startWait(now) {
  const stage = stageAt(play.mode, elapsedAt(clock, now));
  if (stage > stageOf(play)) {
    play.stage = stage;
    speedBanner = { stage, start: now }; // 新しい速さの輪の直前に「SPEED n」（仕様書4.5.3）
    updateHud();
  }
  T = tForStage(stageOf(play));
  const mode = modeOf(play.mode);
  let fresh = !round.keepK || round.k == null;
  if (mode.multi && !fresh && round.layoutStage !== stageOf(play)) fresh = true;
  if (fresh) {
    if (mode.multi) {
      round.layout = proLayout(stageOf(play), T);
      round.layoutStage = stageOf(play);
      round.k = round.layout.k[0]; // 一番内側（輪の速さの基準）
    } else {
      round.k = nextK(round.k);
    }
    round.W = waitSecFor(stageOf(play));
    // Hard：直前と違う形（1ラウンド目は3種類から）。ほかのモードは円
    round.shape = mode.shapes ? nextShape(round.shape) : 'circle';
  }
  round.keepK = false;
  round.ringMax = ringMaxRatio(play.mode, round.layout, T);
  round.next = 0;
  round.results = [];
  round.roundPoints = 0;
  round.successCount = 0;
  phase = 'wait';
  phaseStart = now;
  t0 = null;
  judged = null;
}

function update(ts) {
  if (phase === 'timeup') {
    if (ts - phaseStart >= CONFIG.TIME_UP_MS) showResult();
    return;
  }
  if (phase === 'ready' && ts - phaseStart >= CONFIG.READY_MS) {
    const readyEnd = phaseStart + CONFIG.READY_MS;
    clock = startClock(clock, readyEnd); // READY が終わった時刻から残り時間を減らす
    startWait(readyEnd);
  }
  // 広がり中：自動MISSと時間切れが重なったら時刻の早いほう（同時刻は時間切れ）を先に処理する（仕様書4.9.3）。
  // 自動MISSの時刻：Easy・Normal・Hard は t0 + 1.5T、Professional は次の目標の t0 + (Tᵢ + Dg × T)（仕様書4.10.4）
  if (phase === 'grow') {
    const autoAt = round.layout ? proAutoMissAtMs(t0, round.layout.targetSec[round.next], T) : undefined;
    if (growFrameEvent(ts, t0, T, deadlineOf(clock), autoAt) === 'autoMiss') {
      // 止める輪の大きさ：Easy 等は上限（1.5）、Professional は その目標の自動MISSの時刻 ÷ T
      const rRatio = round.layout ? proAutoMissAtSec(round.layout.targetSec[round.next], T) / T : round.ringMax;
      doJudge({ result: 'MISS', early: false }, ts, rRatio, judgementEndMs('auto', null, t0, T, autoAt));
    }
  }
  // 時間切れ（ライフ0の判定後は時計が止まっているので起きない）
  if (isTimeUp(clock, ts)) {
    startTimeUp(ts);
    return;
  }
  if (phase === 'wait' && ts - phaseStart >= round.W * 1000) {
    phase = 'grow';
    phaseStart = ts;
    t0 = ts; // この rAF で輪を初めて描く（仕様書4.7）
  }
  if (phase === 'result' && ts - phaseStart >= CONFIG.RESULT_MS) {
    if (endReason === 'lives') {
      showResult();
      return;
    }
    startWait(phaseStart + CONFIG.RESULT_MS);
  }
}

// Professional の途中の目標の成功：点・コンボを付け、灰色にして次の目標へ。輪は止めない（仕様書4.10.4）
function judgeMidTarget(j, atMs) {
  const r = applyJudgement(play, j.result);
  round.results[round.next] = { result: j.result, at: atMs };
  round.roundPoints += r.points;
  round.successCount += 1;
  round.next += 1;
  updateHud();
}

// ラウンドの最後の判定（MISS、または最後の目標）→ ③ 結果表示へ。
// endMs：ライフ0になった場合に時計を止める時刻（タップの timeStamp、または自動MISSの時刻）
function doJudge(j, atMs, rRatio, endMs) {
  const r = applyJudgement(play, j.result);
  if (round.layout) {
    round.results[round.next] = { result: j.result, at: atMs };
    if (j.result !== 'MISS') {
      round.roundPoints += r.points;
      round.successCount += 1;
    }
  }
  judged = { result: j.result, early: j.early, points: r.points, rRatio };
  phase = 'result';
  phaseStart = atMs;
  if (j.result === 'MISS') triggerMissEffects();
  updateHud();
  if (r.gameOver) {
    endReason = 'lives';
    clock = stopClock(clock, endMs); // 残り時間をライフ0の時刻で止める
    el.btnPause.disabled = true;
    lastRecord = store.recordPlayEnd(play.mode, play.score); // ライフ0の瞬間に保存（仕様書7章）
  }
}

// 時間切れ（仕様書4.9.3）：どの段階でも打ち切る。広がり中の輪は判定しない（MISSにしない）
function startTimeUp(ts) {
  clock = stopClock(clock, deadlineOf(clock));
  endReason = 'timeup';
  phase = 'timeup';
  phaseStart = ts;
  t0 = null;
  judged = null;
  speedBanner = null;
  clearMissEffects();
  el.btnPause.disabled = true;
  lastRecord = store.recordPlayEnd(play.mode, play.score); // 時間切れの瞬間に保存（演出の前）
}

// event.timeStamp が古い形式（1970年起点）の環境では performance.now() を使う
function eventTime(e) {
  const ts = e.timeStamp;
  const now = performance.now();
  return typeof ts === 'number' && ts > 0 && Math.abs(now - ts) < 60000 ? ts : now;
}

function canTap() {
  return screen === 'game' && !paused && endReason === null && phase === 'grow' && t0 != null;
}

// timeMs：補正前の event.timeStamp。締切時刻以上なら判定しない（仕様書4.7）
function tapAt(timeMs) {
  if (!acceptsTapAt(clock, timeMs)) return;
  const tTap = tapTimeSec(timeMs, t0);
  // Professional は「次の目標」の時刻と比べる（内側から順に1つずつ）。ほかのモードは T
  const layout = round.layout;
  const targetSec = layout ? layout.targetSec[round.next] : T;
  const j = judge(tTap, targetSec, T);
  if (layout && j.result !== 'MISS' && round.next < layout.count - 1) {
    judgeMidTarget(j, timeMs);
    return;
  }
  const rRatio = Math.min(Math.max(tTap, 0) / T, round.ringMax);
  doJudge(j, timeMs, rRatio, judgementEndMs('tap', timeMs, t0, T));
}

function onGamePointerDown(e) {
  if (e.target.closest('#btn-pause')) return; // 一時停止ボタンは判定に数えない
  if (e.pointerType === 'mouse' && e.button !== 0) return; // マウスは左ボタンだけ
  if (!canTap()) return;
  tapAt(eventTime(e));
}

// PC用：ゲーム画面（一時停止中を除く）ではスペースキーもタップ扱い（修正3回目）
function isSpace(e) {
  return e.code === 'Space' || e.key === ' ';
}

function onKeyDown(e) {
  if (!isSpace(e) || screen !== 'game' || paused) return;
  // フォーカスの残ったボタン（一時停止など）がスペースで押されないようにする
  e.preventDefault();
  if (e.repeat || !canTap()) return; // 押しっぱなしは数えない
  tapAt(eventTime(e));
}

function onKeyUp(e) {
  if (isSpace(e) && screen === 'game' && !paused) e.preventDefault();
}

// ===== 一時停止・再開（仕様書4.6） =====
function pauseGame() {
  if (screen !== 'game' || paused || endReason !== null) return; // ライフ0の後・TIME UP 中は一時停止しない
  paused = true;
  // 残り時間を止める。区間の終わりは最後に処理した rAF の ts（裏に回っていた時間を引かないため）
  if (isClockRunning(clock)) clock = stopClock(clock, pauseEndMs(clock.clockStart, lastFrameTs));
  if (phase === 'wait' || phase === 'grow') {
    // 同じ k（Hard は同じ形、Professional は同じ配置）で①から。
    // ただし Professional で1つ以上判定済みなら、残りは判定なしで打ち切って次のラウンドへ（点の二重取りを防ぐ）
    round.keepK = !(round.layout && round.next > 0);
  } else if (phase === 'result') {
    round.keepK = false;                                              // 次のラウンドへ
  }
  // READY 中は keepK をそのまま（もう一度 READY から）
  phase = null;
  t0 = null;
  judged = null;
  speedBanner = null; // 再表示しない
  clearMissEffects();
  const now = performance.now();
  const remSec = displaySeconds(remainingMs(clock, now));
  el.pauseMode.textContent = modeOf(play.mode).label;
  el.pauseStatus.textContent =
    `スコア ${formatNumber(play.score)} ／ SPEED ${stageOf(play)} ／ 残り ${remSec}秒`;
  el.pause.hidden = false;
  updateTimerHud(now);
  drawGame(now);
}

function resumeGame() {
  if (!paused || isLandscape()) return;
  paused = false;
  el.pause.hidden = true;
  startReady(performance.now(), true); // 時刻の基準を取り直す（時計は READY が終わってから再開）
  requestLoop();
}

function quitGame() {
  // 確認なしでタイトルへ。記録は保存しない
  paused = false;
  phase = null;
  el.pause.hidden = true;
  clearMissEffects();
  showScreen('title');
  releaseHistoryEntry();
  refreshTitle();
  requestLoop();
}

// ===== 結果画面（仕様書6.5） =====
function showResult() {
  phase = null;
  showScreen('result');
  releaseHistoryEntry();
  const label = modeOf(play.mode).label;
  const texts = endTexts(endReason, play.lives, remainingMs(clock, performance.now()));
  el.resultMode.textContent = label;
  el.resultHeading.textContent = texts.heading;
  el.resultReason.textContent = texts.detail;
  el.resultNew.hidden = !(lastRecord && lastRecord.isNewRecord);
  el.resultScore.textContent = formatNumber(play.score);
  el.resultBestMode.textContent = label;
  el.resultBest.textContent = bestScoreText(store.recordOf(play.mode));
  el.resultUnsaved.hidden = store.persistent;
  // 到達スピード＝このプレイで最後に遊んだラウンドのスピード段階（仕様書6.5）
  el.resultDetail.textContent =
    `到達スピード ${stageOf(play)} ／ PERFECT ${play.perfects}回 ／ 最大コンボ ${play.maxCombo}`;
  el.btnRetry.disabled = true;
  el.btnToTitle.disabled = true;
  setTimeout(() => {
    el.btnRetry.disabled = false;
    el.btnToTitle.disabled = false;
  }, CONFIG.RESULT_BUTTON_LOCK_MS);
}

// ===== 戻る操作（仕様書6.6） =====
// 自分で history.back() した直後の popstate を無視するためのフラグ
let ignoreNextPop = false;

function isOwnHistoryEntry() {
  return !!(history.state && history.state.app === HISTORY_STATE.app);
}

function ensureHistoryEntry() {
  if (ignoreNextPop) return; // 片付け中：popstate を受けた時点で積み直す（onPopState）
  if (!isOwnHistoryEntry()) history.pushState(HISTORY_STATE, '');
}

// 画面2を出るとき（結果へ・やめる）に、積んだ1件を片付ける。
// これで画面1・画面4では1回の戻る操作でページを離れられる（仕様書6.6）
function releaseHistoryEntry() {
  if (ignoreNextPop || !isOwnHistoryEntry()) return;
  ignoreNextPop = true;
  history.back();
}

function onPopState() {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    // 片付けの途中で次のプレイが始まっていたら、ここで積み直す
    if (screen === 'game') history.pushState(HISTORY_STATE, '');
    return;
  }
  if (screen !== 'game') return; // 画面1・画面4：何もしない
  pauseGame(); // ライフ0の後・TIME UP 中は pauseGame 内で無視される
  history.pushState(HISTORY_STATE, '');
}

// ===== MISS の演出（仕様書4.8） =====
function triggerMissEffects() {
  el.missFlash.classList.add('on');
  clearTimeout(missTimer);
  missTimer = setTimeout(() => el.missFlash.classList.remove('on'), CONFIG.FLASH_MS);
  el.gameCanvas.classList.remove('shake');
  void el.gameCanvas.offsetWidth; // アニメーションをやり直すため
  el.gameCanvas.classList.add('shake');
}

function clearMissEffects() {
  clearTimeout(missTimer);
  el.missFlash.classList.remove('on');
  el.gameCanvas.classList.remove('shake');
}

// ===== 描画 =====
// shape：'circle' | 'triangle' | 'square'。r は中心から頂点まで（円は半径）。角は丸める（仕様書4.10.3）
function strokeShape(ctx, shape, cx, cy, r, color, width, glow) {
  if (r <= 0) return;
  ctx.save();
  ctx.beginPath();
  const vertices = shapeVertices(shape, cx, cy, r);
  if (vertices) {
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
  }
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx, text, x, y, size, color, alpha = 1, baseline = 'middle', bold = true) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Professional の目標（同心の円 2〜3個）：未判定は白、成功した目標は0.2秒光ってから灰色（仕様書4.10.4）。
// MISS で打ち切ったときの未判定の目標（と MISS した目標）は白のまま
function drawProTargets(ctx, cx, cy, ts) {
  const { k } = round.layout;
  for (let i = 0; i < k.length; i++) {
    const res = round.results[i];
    let color = COLOR.white;
    let glow = false;
    if (res && res.result !== 'MISS') {
      if (ts - res.at < CONFIG.FLASH_MS) {
        color = res.result === 'PERFECT' ? COLOR.perfect : COLOR.good;
        glow = true;
      } else {
        color = COLOR.done;
      }
    }
    strokeShape(ctx, 'circle', cx, cy, k[i] * S, color, 3, glow);
  }
}

function drawGame(ts) {
  const ctx = gctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);
  if (!round) return;
  const cx = S / 2;
  const cy = S / 2;
  if (phase === 'timeup') {
    // 目標・輪・文字・SPEED表示は消して「TIME UP」だけ（動きなし）
    drawText(ctx, 'TIME UP', cx, cy, 40, COLOR.white);
    return;
  }
  // Professional：止めている間に段階の境界を越えていたら、再開の ① で新しい配置になるので古い配置は出さない
  const staleLayout = !!round.layout && round.layoutStage !== stageAt(play.mode, elapsedAt(clock, ts));
  const keptK = round.keepK && round.k != null && !staleLayout;
  const showTarget = phase === 'wait' || phase === 'grow' || phase === 'result' || ((phase === 'ready' || paused) && keptK);
  const R = (round.k || 0) * S;
  const shape = round.shape || 'circle';
  const flashing = phase === 'result' && ts - phaseStart < CONFIG.FLASH_MS ? judged.result : null;

  if (showTarget && round.layout) {
    drawProTargets(ctx, cx, cy, ts);
  } else if (showTarget) {
    const perfect = flashing === 'PERFECT';
    strokeShape(ctx, shape, cx, cy, R, perfect ? COLOR.perfect : COLOR.white, 3, perfect);
  }

  if (phase === 'grow') {
    // 輪の半径 ＝ R（Professional は一番内側の R₁）× min(t ÷ T, 上限)。上限は ringMaxRatio（仕様書4.10.6）
    const t = Math.max(0, (ts - t0) / 1000);
    strokeShape(ctx, shape, cx, cy, R * Math.min(t / T, round.ringMax), COLOR.ring, 6, false);
  } else if (phase === 'result') {
    const color = flashing === 'PERFECT' ? COLOR.perfect : flashing === 'GOOD' ? COLOR.good : COLOR.ring;
    strokeShape(ctx, shape, cx, cy, R * judged.rRatio, color, 6, flashing === 'PERFECT' || flashing === 'GOOD');
    const p = Math.min(1, Math.max(0, (ts - phaseStart) / CONFIG.RESULT_MS));
    let text;
    let textColor;
    if (judged.result === 'MISS') {
      text = judged.early ? '早い！' : '遅い！';
      textColor = COLOR.miss;
    } else {
      text = `${judged.result} +${formatNumber(judged.points)}`;
      textColor = judged.result === 'PERFECT' ? COLOR.perfect : COLOR.good;
    }
    drawText(ctx, text, cx, cy - 20 * p, 24, textColor, 1 - p);
    // Professional：目標が2つ以上成功したラウンドは、その28px下に「合計 +○」（16px・白）
    if (round.layout && round.successCount >= 2) {
      drawText(ctx, `合計 +${formatNumber(round.roundPoints)}`, cx, cy + 28 - 20 * p, 16, COLOR.white, 1 - p, 'middle', false);
    }
  } else if (phase === 'ready') {
    drawText(ctx, 'READY', cx, cy, 32, COLOR.white);
    // その28px下（中心どうしの間隔）にモード名と開始段階（再開時は今の段階）（仕様書6.3）
    drawText(ctx, readySubText(play.mode, stageOf(play), readyResumed), cx, cy + 28, 16, COLOR.sub, 1, 'middle', false);
  }

  if (speedBanner && phase !== null) {
    if (ts - speedBanner.start < CONFIG.LEVEL_BANNER_MS) {
      drawText(ctx, `SPEED ${speedBanner.stage}`, cx, 20, 24, COLOR.white, 1, 'top');
    } else {
      speedBanner = null;
    }
  }
}

// タイトルのデモ：待ち0.5秒 → 広がり1.6秒 → ぴったりで光って0.6秒 を繰り返す（操作不可・円のみ）
function drawDemo(ts) {
  if (demoSize === 0) return;
  const ctx = dctx;
  const size = demoSize;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const R = DEMO_R_RATIO * size;
  const waitMs = CONFIG.SPEED_STAGES[0].waitMinSec * 1000;
  const growMs = DEMO_T * 1000;
  const cycle = waitMs + growMs + CONFIG.RESULT_MS;
  const t = ts % cycle;
  let ringR = 0;
  let flash = false;
  if (t >= waitMs && t < waitMs + growMs) {
    ringR = (R * (t - waitMs)) / growMs;
  } else if (t >= waitMs + growMs) {
    ringR = R;
    flash = t - waitMs - growMs < CONFIG.FLASH_MS;
  }
  strokeShape(ctx, 'circle', c, c, R, flash ? COLOR.perfect : COLOR.white, 3, flash);
  strokeShape(ctx, 'circle', c, c, ringR, flash ? COLOR.perfect : COLOR.ring, 6, flash);
}

// ===== ループ =====
function requestLoop() {
  if (rafId == null) rafId = requestAnimationFrame(frame);
}

function frame(ts) {
  rafId = null;
  if (screen === 'title') {
    drawDemo(ts);
    requestLoop();
  } else if (screen === 'game' && !paused) {
    lastFrameTs = ts;
    update(ts);
    if (screen === 'game') {
      updateTimerHud(ts);
      drawGame(ts);
      requestLoop();
    }
  }
}

// ===== イベント =====
el.btnPause.addEventListener('click', pauseGame);
el.btnResume.addEventListener('click', resumeGame);
el.btnQuit.addEventListener('click', quitGame);
el.btnRetry.addEventListener('click', () => startGame(play.mode)); // 同じモードでもう一度
el.btnToTitle.addEventListener('click', () => {
  showScreen('title');
  refreshTitle();
  requestLoop();
});
el.screens.game.addEventListener('pointerdown', onGamePointerDown);
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
el.gameCanvas.addEventListener('animationend', () => el.gameCanvas.classList.remove('shake'));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});
window.addEventListener('popstate', onPopState);
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
// マウス⇔タッチの切り替え（タブレットモード等）でも判定し直す
for (const mq of [mqCoarse, mqHoverNone]) {
  if (mq && mq.addEventListener) mq.addEventListener('change', onResize);
}

// ===== 起動 =====
document.documentElement.style.setProperty('--timer-pulse-ms', `${CONFIG.TIMER_PULSE_MS}ms`);
buildHearts();
buildModeButtons();
recomputeLayout();
checkOrientation();
refreshTitle();
requestLoop();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
