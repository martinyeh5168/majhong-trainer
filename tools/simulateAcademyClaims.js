// 麻將學園技巧驗證:用現有對局引擎(src/game.js)跑大量模擬整局,
// 幫特定座位套用不同策略,統計勝率/放槍率/打點等指標,附 95% 信賴區間。
//
// 用法:node tools/simulateAcademyClaims.js [每組局數,預設 20000]
//
// 只驗證「不需要真的讀出對手手牌內容」就能機械化定義的技巧
// (第二章巡目防禦、第二章鳴牌門檻、第四章下家封鎖)。
// 第三章讀牌推測、第五章連莊多局、第六章誘敵打法需要更大的工程
// (對手行為模型、連莊局勢追蹤),先不在這支腳本的範圍內。

import {
  createGame,
  drawForCurrentPlayer,
  discard,
  computeCallOpportunities,
  chooseAiCallDecision,
  applyPon,
  applyChi,
  applyMinkan,
  skipCall,
  findRonOpportunity,
  applyRon,
  findAnkanOptions,
  findKakanOptions,
  applyAnkan,
  beginKakan,
  findChankanOpportunity,
  applyChankan,
  finalizeKakan,
  declareTsumo,
  chooseAiDiscard,
} from '../src/game.js';
import { tileCode } from '../src/tiles.js';
import { calculateShanten } from '../src/shanten.js';
import { analyzeDiscards } from '../src/efficiency.js';

export const FOCUS_SEAT = 1; // 固定用非莊家的 1 號座位當「套用技巧」的那家,方便跨實驗比較

// ---------- 共用小工具 ----------

function countCodes(tiles) {
  const m = new Map();
  for (const t of tiles) m.set(tileCode(t), (m.get(tileCode(t)) || 0) + 1);
  return m;
}

// 給定一手牌,這張 tile 能不能被碰(allowChi 時也檢查能不能被吃)
function canCallTile(hand, tile, { allowChi }) {
  const counts = countCodes(hand);
  if ((counts.get(tileCode(tile)) || 0) >= 2) return true;
  if (allowChi && tile.suit !== 'z') {
    const combos = [
      [1, 2],
      [-1, 1],
      [-2, -1],
    ];
    for (const [da, db] of combos) {
      const a = tile.rank + da;
      const b = tile.rank + db;
      if (a < 1 || a > 9 || b < 1 || b > 9) continue;
      const ca = tileCode({ suit: tile.suit, rank: a });
      const cb = tileCode({ suit: tile.suit, rank: b });
      if ((counts.get(ca) || 0) >= 1 && (counts.get(cb) || 0) >= 1) return true;
    }
  }
  return false;
}

// 跟 chooseAiDiscard 一樣的「向聽數最好、平手比進張」排序,回傳完整候選清單(不只第一名)
function bestDiscardCandidates(player) {
  const uniqueCodes = [...new Set(player.hand.map(tileCode))];
  const candidates = uniqueCodes.map((code) => {
    const idx = player.hand.findIndex((t) => tileCode(t) === code);
    const remainingHand = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
    return { code, tile: player.hand[idx], shanten: calculateShanten(remainingHand, player.melds.length) };
  });
  const bestShanten = Math.min(...candidates.map((c) => c.shanten));
  let best = candidates.filter((c) => c.shanten === bestShanten);
  if (bestShanten === 0 && best.length > 1) {
    const results = analyzeDiscards(player.hand, player.melds, player.hand);
    const byUkeire = new Map(results.map((r) => [r.discard, r.ukeire]));
    best = [...best].sort((a, b) => (byUkeire.get(b.code) ?? 0) - (byUkeire.get(a.code) ?? 0));
  }
  return { best, bestShanten };
}

// ---------- 技巧 1(第二章・巡目防禦標準):後盤無條件下車 ----------
// 沒聽牌且到了後盤(預設第 12 巡),優先打場上已經出現過的「現張」,而不是繼續照效率打。
function lateGameFoldDiscard(player, game, { turnThreshold = 12 } = {}) {
  const { best, bestShanten } = bestDiscardCandidates(player);
  if (player.drawCount >= turnThreshold && bestShanten > 0) {
    const seen = new Set();
    for (const p of game.players) for (const t of p.discards) seen.add(tileCode(t));
    const safe = player.hand.filter((t) => seen.has(tileCode(t)));
    if (safe.length > 0) return tileCode(safe[0]);
  }
  return best[0].code;
}

// ---------- 技巧 2(第二章・門清價值 vs 吃碰代價):鳴牌門檻 ----------
// 'never'    = 死守門清,絕不鳴牌
// 'greedy'   = 對照組,套用引擎原本「只要向聽數變好就叫」的邏輯
// 'tenpaiOnly' = 只有叫完立刻聽牌才叫(近似文件講的「一進聽且能確保聽好牌」門檻)
function makeCallPolicy(policy) {
  return function callPolicy(player, group, tile) {
    if (policy === 'never') return null;
    const decision = chooseAiCallDecision(player, group, tile);
    if (policy === 'greedy') return decision;
    if (decision && decision.afterShanten === 0) return decision;
    return null;
  };
}

// ---------- 技巧 3(第四章・下家完全封鎖):釘牌 ----------
// 在效率最佳的候選牌裡,優先選下家吃碰不到的那張(用模擬時才看得到的「上帝視角」下家手牌,
// 近似技巧本身假設的「已經讀出下家聽牌熱區」的理想情況)。
export function shieldShimochaDiscard(player, game) {
  const { best } = bestDiscardCandidates(player);
  const shimochaSeat = (player.seat + 1) % 4;
  const shimochaHand = game.players[shimochaSeat].hand;
  const safe = best.filter((c) => !canCallTile(shimochaHand, c.tile, { allowChi: true }));
  const pool = safe.length > 0 ? safe : best;
  return pool[0].code;
}

// ---------- 對局引擎:跑完整一局,座位可各自指定切牌/鳴牌策略 ----------
function runHand({ discardStrategies = {}, callStrategies = {}, onShimochaCall } = {}) {
  const players = [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, isHuman: false }));
  const game = createGame(players);

  function pickDiscard(seat) {
    const player = game.players[seat];
    const strat = discardStrategies[seat] || chooseAiDiscard;
    return strat(player, game);
  }

  function performKanIfPossible(player) {
    for (;;) {
      const ankanCode = findAnkanOptions(player)[0];
      if (ankanCode) {
        const { drewTile, canWin } = applyAnkan(game, player.seat, ankanCode);
        if (!drewTile) return true;
        if (canWin) {
          declareTsumo(game, { isRinshan: true });
          return true;
        }
        continue;
      }
      const kakanCode = findKakanOptions(player)[0];
      if (kakanCode) {
        const tile = beginKakan(game, player.seat, kakanCode);
        const robberSeat = findChankanOpportunity(game, player.seat, tile);
        if (robberSeat !== null) {
          applyChankan(game, robberSeat, player.seat, tile);
          return true;
        }
        const { drewTile, canWin } = finalizeKakan(game, player.seat, tile);
        if (!drewTile) return true;
        if (canWin) {
          declareTsumo(game, { isRinshan: true });
          return true;
        }
        continue;
      }
      return false;
    }
  }

  function processCallGroups(groups, index, discarderSeat, tile) {
    if (index >= groups.length) {
      skipCall(game, discarderSeat);
      return;
    }
    const group = groups[index];
    const player = game.players[group.seat];
    const decide = callStrategies[group.seat] || chooseAiCallDecision;
    const decision = decide(player, group, tile, game);
    if (decision) {
      if (
        onShimochaCall &&
        group.seat === (discarderSeat + 1) % 4 &&
        (decision.type === 'pon' || decision.type === 'chi')
      ) {
        onShimochaCall(discarderSeat, group.seat);
      }
      if (decision.type === 'pon') applyPon(game, group.seat, discarderSeat, tile);
      else if (decision.type === 'kan') {
        const { canWin } = applyMinkan(game, group.seat, discarderSeat, tile);
        if (canWin) declareTsumo(game, { isRinshan: true });
      } else applyChi(game, group.seat, discarderSeat, tile, decision.otherRanks);
      return;
    }
    processCallGroups(groups, index + 1, discarderSeat, tile);
  }

  function resolveDiscardAftermath(discarderSeat, tile) {
    const ronSeat = findRonOpportunity(game, discarderSeat, tile);
    if (ronSeat !== null) {
      applyRon(game, ronSeat, discarderSeat, tile);
      return;
    }
    const groups = computeCallOpportunities(game, discarderSeat, tile);
    processCallGroups(groups, 0, discarderSeat, tile);
  }

  let guard = 0;
  while (!game.finished) {
    if (++guard > 3000) throw new Error('模擬迴圈超過安全上限,可能卡住了');
    const seat = game.currentSeat;
    const player = game.players[seat];

    if (game.mustDiscard) {
      game.mustDiscard = false;
      const code = pickDiscard(seat);
      const tile = discard(game, code);
      resolveDiscardAftermath(seat, tile);
      continue;
    }

    const { canWin } = drawForCurrentPlayer(game);
    if (game.finished) break;
    if (canWin) {
      declareTsumo(game);
      break;
    }

    if (performKanIfPossible(player)) continue;

    const code = pickDiscard(seat);
    const tile = discard(game, code);
    resolveDiscardAftermath(seat, tile);
  }

  return game;
}

// ---------- 統計:比例用 Wilson score,平均值用常態近似,都算 95% 信賴區間 ----------

export function wilsonInterval(k, n, z = 1.96) {
  if (n === 0) return { p: 0, lo: 0, hi: 0, n };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (center - margin) / denom), hi: Math.min(1, (center + margin) / denom), n };
}

export function meanInterval(values, z = 1.96) {
  const n = values.length;
  if (n === 0) return { mean: 0, lo: 0, hi: 0, n };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const se = Math.sqrt(variance / n);
  return { mean, lo: mean - z * se, hi: mean + z * se, n };
}

export function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

// ---------- 實驗跑法:seat1 套用某個設定,其餘 3 家維持基準 AI,跑 N 局收集 seat1 的結果 ----------

export function runBatch(n, { discardStrategies = {}, callStrategies = {} } = {}) {
  const stats = {
    hands: 0,
    seat1Win: 0,
    seat1DealIn: 0,
    seat1TsumoOrRonScores: [],
    shimochaCalledOffSeat1: 0,
    draws: 0,
  };

  for (let i = 0; i < n; i++) {
    let shimochaCalledThisHand = false;
    const game = runHand({
      discardStrategies,
      callStrategies,
      onShimochaCall: (discarderSeat) => {
        if (discarderSeat === FOCUS_SEAT) shimochaCalledThisHand = true;
      },
    });
    if (shimochaCalledThisHand) stats.shimochaCalledOffSeat1 += 1;
    stats.hands += 1;

    const r = game.result;
    if (!r) continue;
    if (r.type === 'draw') stats.draws += 1;
    if (r.type === 'tsumo' && r.seat === FOCUS_SEAT) {
      stats.seat1Win += 1;
      stats.seat1TsumoOrRonScores.push(r.score.total);
    } else if (r.type === 'ron') {
      if (r.winnerSeat === FOCUS_SEAT) {
        stats.seat1Win += 1;
        stats.seat1TsumoOrRonScores.push(r.score.total);
      }
      if (r.discarderSeat === FOCUS_SEAT) {
        stats.seat1DealIn += 1;
      }
    }
  }

  return stats;
}

function printRow(cells, widths) {
  console.log(cells.map((c, i) => String(c).padEnd(widths[i])).join(' | '));
}

function report(title, rows, columns) {
  console.log(`\n=== ${title} ===`);
  const widths = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
  printRow(columns, widths);
  printRow(
    widths.map(() => ''),
    widths
  );
  for (const row of rows) printRow(row, widths);
}

function main() {
  const n = Number(process.argv[2]) || 20000;
  console.log(`每組模擬局數:${n}(座位 1 是套用技巧的那家,其餘 3 家維持引擎原本的效率 AI)`);

  // ---- 實驗一:第二章「後盤無條件下車」----
  const controlA = runBatch(n, {});
  const treatA = runBatch(n, { discardStrategies: { [FOCUS_SEAT]: lateGameFoldDiscard } });

  const dealInControlA = wilsonInterval(controlA.seat1DealIn, controlA.hands);
  const dealInTreatA = wilsonInterval(treatA.seat1DealIn, treatA.hands);
  const winControlA = wilsonInterval(controlA.seat1Win, controlA.hands);
  const winTreatA = wilsonInterval(treatA.seat1Win, treatA.hands);

  report(
    '實驗一:後盤(第12巡以後)未聽牌時打現張 vs 照常效率打(第二章)',
    [
      [
        '對照組(照常效率打)',
        pct(dealInControlA.p),
        `[${pct(dealInControlA.lo)}, ${pct(dealInControlA.hi)}]`,
        pct(winControlA.p),
        `[${pct(winControlA.lo)}, ${pct(winControlA.hi)}]`,
      ],
      [
        '實驗組(後盤打現張)',
        pct(dealInTreatA.p),
        `[${pct(dealInTreatA.lo)}, ${pct(dealInTreatA.hi)}]`,
        pct(winTreatA.p),
        `[${pct(winTreatA.lo)}, ${pct(winTreatA.hi)}]`,
      ],
    ],
    ['策略', '放槍率', '放槍率 95% CI', '勝率', '勝率 95% CI']
  );

  // ---- 實驗二:第二章「門清 vs 吃碰代價」的鳴牌門檻 ----
  const policies = ['never', 'greedy', 'tenpaiOnly'];
  const policyLabel = { never: '死守門清(never)', greedy: '有利就叫(baseline)', tenpaiOnly: '叫完直接聽牌才叫' };
  const rowsB = [];
  for (const policy of policies) {
    const stats = runBatch(n, { callStrategies: { [FOCUS_SEAT]: makeCallPolicy(policy) } });
    const win = wilsonInterval(stats.seat1Win, stats.hands);
    const dealIn = wilsonInterval(stats.seat1DealIn, stats.hands);
    const score = meanInterval(stats.seat1TsumoOrRonScores);
    rowsB.push([
      policyLabel[policy],
      pct(win.p),
      `[${pct(win.lo)}, ${pct(win.hi)}]`,
      pct(dealIn.p),
      `[${pct(dealIn.lo)}, ${pct(dealIn.hi)}]`,
      score.n > 0 ? score.mean.toFixed(2) : '—',
      score.n > 0 ? `[${score.lo.toFixed(2)}, ${score.hi.toFixed(2)}]` : '—',
    ]);
  }
  report('實驗二:三種鳴牌門檻(第二章)', rowsB, [
    '鳴牌策略',
    '勝率',
    '勝率 95% CI',
    '放槍率',
    '放槍率 95% CI',
    '胡牌平均台數',
    '平均台數 95% CI',
  ]);

  // ---- 實驗三:第四章「下家完全封鎖(釘牌)」----
  const controlC = runBatch(n, {});
  const treatC = runBatch(n, { discardStrategies: { [FOCUS_SEAT]: shieldShimochaDiscard } });
  const shimoControlC = wilsonInterval(controlC.shimochaCalledOffSeat1, controlC.hands);
  const shimoTreatC = wilsonInterval(treatC.shimochaCalledOffSeat1, treatC.hands);

  report(
    '實驗三:下家封鎖(釘牌)是否降低下家吃碰成功率(第四章)',
    [
      [
        '對照組(照常效率打)',
        pct(shimoControlC.p),
        `[${pct(shimoControlC.lo)}, ${pct(shimoControlC.hi)}]`,
      ],
      [
        '實驗組(優先躲下家)',
        pct(shimoTreatC.p),
        `[${pct(shimoTreatC.lo)}, ${pct(shimoTreatC.hi)}]`,
      ],
    ],
    ['策略', '每局下家至少吃/碰到一次的比率', '95% CI']
  );

  console.log(
    '\n註:胡牌打點取 score.total(台數),未換算成點數移轉;第三章讀牌推測、第五章連莊多局、第六章誘敵打法需要對手行為模型與跨局狀態追蹤,這支腳本先不驗證。'
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
