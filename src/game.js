// 完整對局引擎 v1.3:4 人、摸牌/打牌/吃碰槓/點炮胡牌/搶槓
// 吃碰的規則:碰(任何人都能碰)優先於吃(只有下家能吃);同時有人想碰,離打牌的人越近優先。
// 點炮(別人打出的牌剛好完成你的胡牌)優先於吃碰:一張牌打出去先看有沒有人可以胡,
// 沒有人胡才輪到吃碰。目前只支援單家胡(一張牌只會被最靠近打牌者的那個人胡走)。

import { allTileTypes, allFlowerTypes, isFlower, tileCode, tileFromCode } from './tiles.js';
import { checkWin } from './winCheck.js';
import { analyzeDiscards } from './efficiency.js';
import { calculateShanten } from './shanten.js';
import { computeScore } from './scoring.js';

// includeFlowers:要不要把梅蘭菊竹春夏秋冬 8 張花牌也放進牌牆(144 張),
// 不需要花牌的模式(練習/人機對局)保持預設 false,牌牆維持原本的 136 張,行為完全不變。
export function buildWall({ includeFlowers = false } = {}) {
  const wall = [];
  for (const tile of allTileTypes()) {
    for (let i = 0; i < 4; i++) wall.push(tile);
  }
  if (includeFlowers) {
    for (const tile of allFlowerTypes()) wall.push(tile);
  }
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// 從牌牆摸一張牌給 player:摸到花牌就攤開收進 player.flowers、繼續摸下一張,
// 直到摸到非花牌為止(牌牆沒有花牌的話,跟直接 wall.shift() 沒有差別)。
// 牌牆抽光回傳 null。
function drawSettingAsideFlowers(wall, player) {
  for (;;) {
    if (wall.length === 0) return null;
    const tile = wall.shift();
    if (isFlower(tile)) {
      player.flowers.push(tile);
      continue;
    }
    return tile;
  }
}

/**
 * players: [{ id, isHuman }], 第 0 位是莊家
 * options.includeFlowers:要不要用 144 張(含花牌)的牌牆
 * 回傳一個 game 物件,包含牌局狀態與操作方法
 */
export function createGame(playerConfigs, { includeFlowers = false } = {}) {
  const wall = buildWall({ includeFlowers });
  const players = playerConfigs.map((cfg, seat) => ({
    ...cfg,
    seat,
    hand: [],
    discards: [],
    melds: [],
    flowers: [],
  }));

  for (const player of players) {
    const dealCount = player.seat === 0 ? 17 : 16;
    const dealt = [];
    for (let i = 0; i < dealCount; i++) {
      const tile = drawSettingAsideFlowers(wall, player);
      if (tile) dealt.push(tile);
    }
    player.hand = dealt;
    player.drawCount = player.seat === 0 ? 1 : 0; // 莊家的起手 17 張本身就算「第一次摸牌」
  }

  return {
    wall,
    players,
    currentSeat: 0,
    dealerFirstTurnPending: true, // 莊家一開始已經有 17 張,第一輪不用再摸牌
    mustDiscard: false, // 剛吃/碰完,不用摸牌,直接打
    log: [],
    finished: false,
    result: null,
  };
}

function playerHasWinningHand(player) {
  // player.hand 在自己回合摸完牌後會有 17 張(扣掉吃碰的部分),直接檢查整手能不能胡
  return checkWin({ concealedTiles: player.hand, melds: player.melds }).win;
}

/**
 * 換下一位玩家摸牌。如果摸完就自摸胡牌,回合會停在這裡,不會自動打牌。
 * 回傳 { drewTile, canWin }
 */
export function drawForCurrentPlayer(game) {
  if (game.finished) throw new Error('這局已經結束了');

  const player = game.players[game.currentSeat];

  if (game.dealerFirstTurnPending && player.seat === 0) {
    // 莊家起手已經有 17 張,不用再摸牌,直接看能不能天胡
    game.dealerFirstTurnPending = false;
    return { drewTile: null, canWin: playerHasWinningHand(player) };
  }

  const drewTile = drawSettingAsideFlowers(game.wall, player);
  if (!drewTile) {
    game.finished = true;
    game.result = { type: 'draw' };
    return { drewTile: null, canWin: false };
  }

  player.hand.push(drewTile);
  player.drawCount += 1;

  const canWin = playerHasWinningHand(player);
  return { drewTile, canWin };
}

/**
 * AI(或代打)決定要打哪張。
 * 先用向聽數挑「打完之後離聽牌最近」的牌,如果好幾張打完向聽數一樣,
 * 已經聽牌的話再用進張數(切牌效率引擎)在裡面挑聽牌範圍最大的那張。
 */
export function chooseAiDiscard(player) {
  const uniqueCodes = [...new Set(player.hand.map(tileCode))];

  const candidates = uniqueCodes.map((code) => {
    const idx = player.hand.findIndex((t) => tileCode(t) === code);
    const remainingHand = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
    return { code, shanten: calculateShanten(remainingHand, player.melds.length) };
  });

  const bestShanten = Math.min(...candidates.map((c) => c.shanten));
  const bestCandidates = candidates.filter((c) => c.shanten === bestShanten);

  if (bestShanten === 0 && bestCandidates.length > 1) {
    const results = analyzeDiscards(player.hand, player.melds, player.hand);
    const byUkeire = new Map(results.map((r) => [r.discard, r.ukeire]));
    bestCandidates.sort((a, b) => (byUkeire.get(b.code) ?? 0) - (byUkeire.get(a.code) ?? 0));
  }

  return bestCandidates[0].code;
}

/**
 * 玩家(不論真人或 AI)打出一張牌。
 * 注意:這裡不會自動輪到下一位,因為打出去之後可能有人要吃碰 ——
 * 呼叫端要接著用 computeCallOpportunities 檢查,再用 applyPon/applyChi/skipCall 收尾。
 */
export function discard(game, discardCode) {
  const player = game.players[game.currentSeat];
  const idx = player.hand.findIndex((t) => tileCode(t) === discardCode);
  if (idx === -1) throw new Error(`手牌裡沒有這張牌:${discardCode}`);
  const [tile] = player.hand.splice(idx, 1);
  player.discards.push(tile);
  game.log.push({ type: 'discard', seat: player.seat, tile: discardCode });
  return tile;
}

function countByCode(tiles) {
  const map = new Map();
  for (const t of tiles) {
    const code = tileCode(t);
    map.set(code, (map.get(code) ?? 0) + 1);
  }
  return map;
}

// 一張牌可以用哪些「另外兩張牌的點數組合」吃成順子(同花色、字牌不能吃)
function chiOtherRanksOptions(rank) {
  const options = [];
  if (rank <= 7) options.push([rank + 1, rank + 2]);
  if (rank >= 2 && rank <= 8) options.push([rank - 1, rank + 1]);
  if (rank >= 3) options.push([rank - 2, rank - 1]);
  return options;
}

/**
 * 算出這張剛打出去的牌,誰可以碰、誰可以吃。
 * 回傳依優先順序排好的陣列:[{ seat, options: [{type:'pon'} | {type:'chi', otherRanks:[a,b]}, ...] }, ...]
 * 優先順序:離打牌的人最近的下一家先(不管碰或吃),吃只有正下家才有資格。
 */
export function computeCallOpportunities(game, discarderSeat, tile) {
  const n = game.players.length;
  const groups = [];

  for (let i = 1; i < n; i++) {
    const seat = (discarderSeat + i) % n;
    const player = game.players[seat];
    const counts = countByCode(player.hand);
    const options = [];

    if ((counts.get(tileCode(tile)) ?? 0) >= 2) {
      options.push({ type: 'pon' });
    }

    if ((counts.get(tileCode(tile)) ?? 0) >= 3) {
      options.push({ type: 'kan' });
    }

    if (seat === (discarderSeat + 1) % n && tile.suit !== 'z') {
      for (const [rA, rB] of chiOtherRanksOptions(tile.rank)) {
        const codeA = tileCode({ suit: tile.suit, rank: rA });
        const codeB = tileCode({ suit: tile.suit, rank: rB });
        if ((counts.get(codeA) ?? 0) >= 1 && (counts.get(codeB) ?? 0) >= 1) {
          options.push({ type: 'chi', otherRanks: [rA, rB] });
        }
      }
    }

    if (options.length > 0) groups.push({ seat, options });
  }

  return groups;
}

/**
 * AI 決定要不要吃碰:只有在「叫了之後向聽數會變好」才叫,否則放棄。
 * group 是 computeCallOpportunities 回傳陣列裡屬於這位玩家的那一組。
 * 回傳選中的 option(可能是 {type:'pon'} 或 {type:'chi', otherRanks}),不叫就回傳 null。
 */
export function chooseAiCallDecision(player, group, discardedTile) {
  const beforeShanten = calculateShanten(player.hand, player.melds.length);
  let best = null;

  for (const option of group.options) {
    let remainingHand;
    if (option.type === 'pon') {
      const code = tileCode(discardedTile);
      let removed = 0;
      remainingHand = player.hand.filter((t) => {
        if (removed < 2 && tileCode(t) === code) {
          removed++;
          return false;
        }
        return true;
      });
    } else if (option.type === 'kan') {
      const code = tileCode(discardedTile);
      let removed = 0;
      remainingHand = player.hand.filter((t) => {
        if (removed < 3 && tileCode(t) === code) {
          removed++;
          return false;
        }
        return true;
      });
    } else {
      remainingHand = [...player.hand];
      for (const rank of option.otherRanks) {
        const code = tileCode({ suit: discardedTile.suit, rank });
        const idx = remainingHand.findIndex((t) => tileCode(t) === code);
        remainingHand.splice(idx, 1);
      }
    }

    const afterShanten = calculateShanten(remainingHand, player.melds.length + 1);
    // 向聽數打平的話優先選槓:多一台、還能多補一張牌,划算
    const better =
      !best || afterShanten < best.afterShanten || (afterShanten === best.afterShanten && option.type === 'kan');
    if (afterShanten < beforeShanten && better) {
      best = { ...option, afterShanten };
    }
  }

  return best;
}

/**
 * 執行碰:呼叫端要先確認這位玩家手上真的有 2 張一樣的牌。
 */
export function applyPon(game, callerSeat, discarderSeat, discardedTile) {
  game.players[discarderSeat].discards.pop(); // 這張牌被碰走,從棄牌堆移除

  const caller = game.players[callerSeat];
  const code = tileCode(discardedTile);
  let removed = 0;
  caller.hand = caller.hand.filter((t) => {
    if (removed < 2 && tileCode(t) === code) {
      removed++;
      return false;
    }
    return true;
  });
  caller.melds.push({ type: 'pon', tiles: [discardedTile, discardedTile, discardedTile] });

  game.log.push({ type: 'pon', seat: callerSeat, tile: code });
  game.currentSeat = callerSeat;
  game.mustDiscard = true;
}

/**
 * 執行吃:otherRanks 是 computeCallOpportunities 給的那組點數。
 */
export function applyChi(game, callerSeat, discarderSeat, discardedTile, otherRanks) {
  game.players[discarderSeat].discards.pop();

  const caller = game.players[callerSeat];
  for (const rank of otherRanks) {
    const code = tileCode({ suit: discardedTile.suit, rank });
    const idx = caller.hand.findIndex((t) => tileCode(t) === code);
    caller.hand.splice(idx, 1);
  }
  const runTiles = [discardedTile, ...otherRanks.map((rank) => ({ suit: discardedTile.suit, rank }))].sort(
    (a, b) => a.rank - b.rank
  );
  caller.melds.push({ type: 'chi', tiles: runTiles });

  game.log.push({ type: 'chi', seat: callerSeat, tile: tileCode(discardedTile) });
  game.currentSeat = callerSeat;
  game.mustDiscard = true;
}

// 槓後從牌牆補一張(槓後補牌,摸到花牌一樣自動攤開再補摸);牌牆空了回傳 null,呼叫端要把牌局收成流局。
function drawReplacementTile(game, player) {
  return drawSettingAsideFlowers(game.wall, player);
}

/**
 * 執行明槓(叫牌):別人打出的牌,自己手上正好有 3 張一樣。
 * 跟碰的差別是吃掉 3 張、補一張新牌,而且要接著看補到的牌能不能自摸(槓上開花)。
 */
export function applyMinkan(game, callerSeat, discarderSeat, discardedTile) {
  game.players[discarderSeat].discards.pop();

  const caller = game.players[callerSeat];
  const code = tileCode(discardedTile);
  let removed = 0;
  caller.hand = caller.hand.filter((t) => {
    if (removed < 3 && tileCode(t) === code) {
      removed++;
      return false;
    }
    return true;
  });
  caller.melds.push({ type: 'minkan', tiles: [discardedTile, discardedTile, discardedTile, discardedTile] });

  game.log.push({ type: 'minkan', seat: callerSeat, tile: code });
  game.currentSeat = callerSeat;

  const drewTile = drawReplacementTile(game, caller);
  if (!drewTile) {
    game.finished = true;
    game.result = { type: 'draw' };
    return { drewTile: null, canWin: false };
  }
  caller.hand.push(drewTile);
  const canWin = playerHasWinningHand(caller);
  game.mustDiscard = !canWin;
  return { drewTile, canWin };
}

/**
 * 手牌裡有哪些牌可以暗槓(剛好湊滿 4 張一樣),回傳牌 code 陣列。
 */
export function findAnkanOptions(player) {
  const counts = countByCode(player.hand);
  return [...counts.entries()].filter(([, n]) => n >= 4).map(([code]) => code);
}

/**
 * 手牌裡有哪些牌可以加槓(已經碰過的牌,手上又摸到第 4 張),回傳牌 code 陣列。
 */
export function findKakanOptions(player) {
  const counts = countByCode(player.hand);
  const ponCodes = new Set(player.melds.filter((m) => m.type === 'pon').map((m) => tileCode(m.tiles[0])));
  return [...counts.entries()].filter(([code, n]) => n >= 1 && ponCodes.has(code)).map(([code]) => code);
}

/**
 * 執行暗槓:呼叫端要先用 findAnkanOptions 確認手上真的有 4 張。
 * 暗槓不會被搶槓,直接吃掉 4 張、補一張新牌。
 */
export function applyAnkan(game, seat, code) {
  const player = game.players[seat];
  let tileTemplate = null;
  let removed = 0;
  player.hand = player.hand.filter((t) => {
    if (removed < 4 && tileCode(t) === code) {
      if (!tileTemplate) tileTemplate = t;
      removed++;
      return false;
    }
    return true;
  });
  player.melds.push({ type: 'ankan', tiles: [tileTemplate, tileTemplate, tileTemplate, tileTemplate] });
  game.log.push({ type: 'ankan', seat, tile: code });

  const drewTile = drawReplacementTile(game, player);
  if (!drewTile) {
    game.finished = true;
    game.result = { type: 'draw' };
    return { drewTile: null, canWin: false };
  }
  player.hand.push(drewTile);
  const canWin = playerHasWinningHand(player);
  game.mustDiscard = !canWin;
  return { drewTile, canWin };
}

/**
 * 加槓分兩步驟,因為中間有「搶槓」的空檔(這張牌剛好也完成別人的胡牌,別人可以搶先胡走):
 * 1. beginKakan:先把牌從手牌拿出來(還沒升級成 minkan meld),呼叫端接著用
 *    findChankanOpportunity 檢查有沒有人可以搶。
 * 2a. 沒人搶 → finalizeKakan:meld 正式升級成 minkan,從牌牆補一張。
 * 2b. 有人搶 → applyChankan:遊戲結束,搶槓的人胡牌,加槓取消。
 */
export function beginKakan(game, seat, code) {
  const player = game.players[seat];
  const idx = player.hand.findIndex((t) => tileCode(t) === code);
  const [tile] = player.hand.splice(idx, 1);
  return tile;
}

/**
 * 加槓中的那張牌,看看有沒有人可以搶槓(胡走)。回傳能搶的座位,沒有回傳 null。
 * 規則上只有加槓能被搶,暗槓不行。
 */
export function findChankanOpportunity(game, kanSeat, tile) {
  const n = game.players.length;
  for (let i = 1; i < n; i++) {
    const seat = (kanSeat + i) % n;
    const player = game.players[seat];
    const candidateHand = [...player.hand, tile];
    if (checkWin({ concealedTiles: candidateHand, melds: player.melds }).win) {
      return seat;
    }
  }
  return null;
}

/**
 * 執行搶槓:winnerSeat 用 kanSeat 正在加槓的那張牌胡牌,加槓取消、牌局結束。
 */
export function applyChankan(game, winnerSeat, kanSeat, tile) {
  const winner = game.players[winnerSeat];
  const score = computeScore(
    { concealedTiles: winner.hand, melds: winner.melds },
    tile,
    { selfDrawn: false, isDealer: winner.seat === 0, seat: winner.seat, isFirstTurn: false, isChankan: true, flowers: winner.flowers }
  );
  game.finished = true;
  game.result = { type: 'ron', winnerSeat, discarderSeat: kanSeat, tile, score, chankan: true };
  return score;
}

/**
 * 沒人搶槓,真的完成加槓:對應的碰面子升級成 minkan,從牌牆補一張新牌。
 */
export function finalizeKakan(game, seat, tile) {
  const player = game.players[seat];
  const code = tileCode(tile);
  const meldIdx = player.melds.findIndex((m) => m.type === 'pon' && tileCode(m.tiles[0]) === code);
  player.melds[meldIdx] = { type: 'minkan', tiles: [...player.melds[meldIdx].tiles, tile] };
  game.log.push({ type: 'kakan', seat, tile: code });

  const drewTile = drawReplacementTile(game, player);
  if (!drewTile) {
    game.finished = true;
    game.result = { type: 'draw' };
    return { drewTile: null, canWin: false };
  }
  player.hand.push(drewTile);
  const canWin = playerHasWinningHand(player);
  game.mustDiscard = !canWin;
  return { drewTile, canWin };
}

/**
 * 沒有人吃碰,照正常順序輪到下一家。
 */
export function skipCall(game, discarderSeat) {
  game.currentSeat = (discarderSeat + 1) % game.players.length;
  game.mustDiscard = false;
}

/**
 * 看這張剛打出去的牌能不能被別人點炮胡走。
 * 回傳第一個(離打牌的人最近的)能胡的座位,沒有人能胡就回傳 null。
 * 目前只支援單家胡:一張牌只會被最優先的那一家胡走。
 */
export function findRonOpportunity(game, discarderSeat, tile) {
  const n = game.players.length;
  for (let i = 1; i < n; i++) {
    const seat = (discarderSeat + i) % n;
    const player = game.players[seat];
    const candidateHand = [...player.hand, tile];
    if (checkWin({ concealedTiles: candidateHand, melds: player.melds }).win) {
      return seat;
    }
  }
  return null;
}

/**
 * 執行點炮胡牌:winnerSeat 用 discarderSeat 打出的 tile 胡牌。
 */
export function applyRon(game, winnerSeat, discarderSeat, tile) {
  const winner = game.players[winnerSeat];
  game.players[discarderSeat].discards.pop(); // 胡牌的那張牌不留在棄牌堆裡

  const score = computeScore(
    { concealedTiles: winner.hand, melds: winner.melds },
    tile,
    { selfDrawn: false, isDealer: winner.seat === 0, seat: winner.seat, isFirstTurn: false, flowers: winner.flowers }
  );
  game.finished = true;
  game.result = { type: 'ron', winnerSeat, discarderSeat, tile, score };
  return score;
}

/**
 * 宣告自摸胡牌(呼叫前請先確認 drawForCurrentPlayer/applyAnkan/finalizeKakan/applyMinkan
 * 回傳的 canWin 是 true)。context.isRinshan 用來標記這是槓後補牌自摸(槓上開花)。
 */
export function declareTsumo(game, context = {}) {
  const player = game.players[game.currentSeat];
  const winningTile = player.hand[player.hand.length - 1];
  const concealedTiles = player.hand.slice(0, -1);
  const isFirstTurn = player.drawCount === 1;
  const score = computeScore(
    { concealedTiles, melds: player.melds },
    winningTile,
    {
      selfDrawn: true,
      isDealer: player.seat === 0,
      seat: player.seat,
      isFirstTurn,
      isRinshan: !!context.isRinshan,
      flowers: player.flowers,
    }
  );
  game.finished = true;
  game.result = { type: 'tsumo', seat: player.seat, score };
  return score;
}
