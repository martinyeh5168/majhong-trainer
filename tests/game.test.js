import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  buildWall,
  drawForCurrentPlayer,
  chooseAiDiscard,
  discard,
  declareTsumo,
  computeCallOpportunities,
  chooseAiCallDecision,
  applyPon,
  applyChi,
  skipCall,
  findRonOpportunity,
  applyRon,
  findAnkanOptions,
  applyAnkan,
  findKakanOptions,
  beginKakan,
  findChankanOpportunity,
  applyChankan,
  finalizeKakan,
  applyMinkan,
} from '../src/game.js';
import { parseHand } from '../src/handNotation.js';
import { tileCode } from '../src/tiles.js';

function fourPlayers() {
  return [
    { id: 'you', isHuman: true },
    { id: 'ai1', isHuman: false },
    { id: 'ai2', isHuman: false },
    { id: 'ai3', isHuman: false },
  ];
}

// 跟 play.js 用的是同一套邏輯:摸牌 -> 打牌 -> 先看有沒有人點炮胡 -> 沒有才檢查吃碰槓 -> 沒有就輪下一家
function resolveCalls(game, discarderSeat, tile) {
  const ronSeat = findRonOpportunity(game, discarderSeat, tile);
  if (ronSeat !== null) {
    applyRon(game, ronSeat, discarderSeat, tile);
    return;
  }

  const groups = computeCallOpportunities(game, discarderSeat, tile);
  for (const group of groups) {
    const player = game.players[group.seat];
    const decision = chooseAiCallDecision(player, group, tile);
    if (decision) {
      if (decision.type === 'pon') applyPon(game, group.seat, discarderSeat, tile);
      else if (decision.type === 'kan') {
        const { canWin } = applyMinkan(game, group.seat, discarderSeat, tile);
        if (canWin) declareTsumo(game, { isRinshan: true }); // 叫槓補牌剛好自摸(槓上開花)
      } else applyChi(game, group.seat, discarderSeat, tile, decision.otherRanks);
      return;
    }
  }
  skipCall(game, discarderSeat);
}

// 摸完牌後貪心宣告暗槓/加槓(能槓就槓):加槓要先看有沒有人搶槓,搶槓的話牌局直接結束;
// 槓上補到的牌能自摸就直接自摸(槓上開花)。回傳這回合是否已經處理完(結束或已經換成要打牌狀態)。
function tryAiKan(game) {
  let didSomething = false;
  while (!game.finished) {
    const player = game.players[game.currentSeat];
    const ankanCode = findAnkanOptions(player)[0];
    if (ankanCode) {
      const { drewTile, canWin } = applyAnkan(game, player.seat, ankanCode);
      didSomething = true;
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
      didSomething = true;
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
    break;
  }
  return didSomething;
}

function runFullGame(game) {
  let safetyCounter = 0;
  while (!game.finished && safetyCounter < 2000) {
    safetyCounter++;
    if (!game.mustDiscard) {
      const { canWin } = drawForCurrentPlayer(game);
      if (game.finished) break;
      if (canWin) {
        declareTsumo(game);
        break;
      }
      if (tryAiKan(game)) {
        if (game.finished) break;
        continue; // 槓完 mustDiscard 已經設好,回到迴圈頂端直接走打牌分支
      }
    }
    game.mustDiscard = false;
    const player = game.players[game.currentSeat];
    const discardCode = chooseAiDiscard(player, game);
    const discarderSeat = game.currentSeat;
    const tile = discard(game, discardCode);
    resolveCalls(game, discarderSeat, tile);
  }
}

test('createGame 發牌:莊家 17 張,其他人 16 張,牌牆總數正確', () => {
  const game = createGame(fourPlayers());
  assert.equal(game.players[0].hand.length, 17);
  assert.equal(game.players[1].hand.length, 16);
  assert.equal(game.players[2].hand.length, 16);
  assert.equal(game.players[3].hand.length, 16);
  // 136 張牌(34 種 x4),扣掉發出去的 17+16+16+16=65 張
  assert.equal(game.wall.length, 136 - 65);
});

test('莊家第一輪不用摸牌,直接用起手 17 張判斷天胡', () => {
  const game = createGame(fourPlayers());
  const wallSizeBefore = game.wall.length;
  const { drewTile } = drawForCurrentPlayer(game);
  assert.equal(drewTile, null);
  assert.equal(game.wall.length, wallSizeBefore); // 沒有動到牌牆
  assert.equal(game.players[0].hand.length, 17); // 手牌張數不變
});

test('discard 不會自動輪到下一家,要另外呼叫 skipCall 才會換人', () => {
  const game = createGame(fourPlayers());
  drawForCurrentPlayer(game);
  const player = game.players[0];
  const discardCode = chooseAiDiscard(player, game);
  discard(game, discardCode);
  assert.equal(game.currentSeat, 0); // 還沒換人

  skipCall(game, 0);
  assert.equal(game.currentSeat, 1); // 這時候才換到下一家
});

test('computeCallOpportunities:手上有兩張一樣的牌,可以碰', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('55m123p456p789s11z');
  const tile = { suit: 'm', rank: 5 };
  const groups = computeCallOpportunities(game, 0, tile);
  const group = groups.find((g) => g.seat === 1);
  assert.ok(group.options.some((o) => o.type === 'pon'));
});

test('computeCallOpportunities:只有正下家能吃,對面跟上家不行', () => {
  const game = createGame(fourPlayers());
  // 座位 1(正下家)、2(對面)、3(上家)手上都放一樣可以吃的牌型
  game.players[1].hand = parseHand('46m123p456p789s11z');
  game.players[2].hand = parseHand('46m123p456p789s11z');
  game.players[3].hand = parseHand('46m123p456p789s11z');
  const tile = { suit: 'm', rank: 5 }; // 5m,搭配 4m6m 可以吃成 456m
  const groups = computeCallOpportunities(game, 0, tile);

  const seat1Group = groups.find((g) => g.seat === 1);
  assert.ok(seat1Group.options.some((o) => o.type === 'chi'));

  const seat2Group = groups.find((g) => g.seat === 2);
  assert.equal(seat2Group, undefined); // 對面手上雖然有 4m6m,但沒有資格吃

  const seat3Group = groups.find((g) => g.seat === 3);
  assert.equal(seat3Group, undefined); // 上家也沒有資格吃
});

test('applyPon:碰完之後手牌減少 2 張、多一組面子,棄牌堆少一張,輪到碰牌的人打牌', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('55m123p456p789s112z');
  const discarderSeat = 0;
  const tile = { suit: 'm', rank: 5 };
  game.players[discarderSeat].discards.push(tile);

  const handBefore = game.players[1].hand.length;
  applyPon(game, 1, discarderSeat, tile);

  assert.equal(game.players[1].hand.length, handBefore - 2);
  assert.equal(game.players[1].melds.length, 1);
  assert.equal(game.players[1].melds[0].type, 'pon');
  assert.equal(game.players[discarderSeat].discards.length, 0); // 被碰走的牌從棄牌堆移除
  assert.equal(game.currentSeat, 1);
  assert.equal(game.mustDiscard, true);
});

test('applyChi:吃完之後手牌減少 2 張、多一組順子面子', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('46m123p456p789s112z');
  const discarderSeat = 0;
  const tile = { suit: 'm', rank: 5 };
  game.players[discarderSeat].discards.push(tile);

  applyChi(game, 1, discarderSeat, tile, [4, 6]);

  assert.equal(game.players[1].melds.length, 1);
  assert.equal(game.players[1].melds[0].type, 'chi');
  const chiCodes = game.players[1].melds[0].tiles.map(tileCode);
  assert.deepEqual(chiCodes, ['4m', '5m', '6m']);
  assert.equal(game.currentSeat, 1);
  assert.equal(game.mustDiscard, true);
});

test('applyChi:吃進來的牌固定放正中間,不是照數字排序(手上1、2吃進3,顯示1、3、2)', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('12456m123p789s112z');
  const discarderSeat = 0;
  const tile = { suit: 'm', rank: 3 };
  game.players[discarderSeat].discards.push(tile);

  applyChi(game, 1, discarderSeat, tile, [1, 2]);

  const chiCodes = game.players[1].melds[0].tiles.map(tileCode);
  assert.deepEqual(chiCodes, ['1m', '3m', '2m']);
});

test('chooseAiCallDecision:碰了會讓向聽數變好,就決定要碰', () => {
  const game = createGame(fourPlayers());
  // 4 組面子已經完成、還多一組對子孤張,碰了對子之後改聽單吊,向聽數從 1 進步到 0
  game.players[1].hand = parseHand('123456789m123p44s12z');
  const decision = chooseAiCallDecision(game.players[1], { seat: 1, options: [{ type: 'pon' }] }, {
    suit: 's',
    rank: 4,
  });
  assert.ok(decision);
  assert.equal(decision.type, 'pon');
});

test('chooseAiCallDecision:已經聽牌了,碰掉自己聽牌用的對子沒有幫助,不該碰', () => {
  const game = createGame(fourPlayers());
  // 123456789m123p45p99s 已經是聽 3p/6p 的牌,99s 正是聽牌用的將眼,碰掉它不會更好
  game.players[1].hand = parseHand('123456789m123p45p99s');
  const decision = chooseAiCallDecision(game.players[1], { seat: 1, options: [{ type: 'pon' }] }, {
    suit: 's',
    rank: 9,
  });
  assert.equal(decision, null);
});

test('findRonOpportunity:別人打出的牌剛好完成手牌,可以點炮胡', () => {
  const game = createGame(fourPlayers());
  // 聽 3p/6p 的牌,只差一張
  game.players[1].hand = parseHand('123456789m123p45p55s');
  const tile = { suit: 'p', rank: 6 };
  assert.equal(findRonOpportunity(game, 0, tile), 1);
});

test('findRonOpportunity:沒有人聽這張牌,回傳 null', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('147m147p147s1234567z');
  const tile = { suit: 'p', rank: 6 };
  assert.equal(findRonOpportunity(game, 0, tile), null);
});

test('applyRon:點炮胡牌會正確算分、把那張牌從棄牌堆移除、結束遊戲', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('123456789m123p45p55s');
  const discarderSeat = 0;
  const tile = { suit: 'p', rank: 6 };
  game.players[discarderSeat].discards.push(tile);

  const score = applyRon(game, 1, discarderSeat, tile);

  assert.ok(score.total >= 1);
  assert.equal(game.players[discarderSeat].discards.length, 0);
  assert.equal(game.finished, true);
  assert.equal(game.result.type, 'ron');
  assert.equal(game.result.winnerSeat, 1);
  assert.equal(game.result.discarderSeat, 0);
});

test('findAnkanOptions:手上剛好 4 張一樣才算暗槓機會', () => {
  const game = createGame(fourPlayers());
  game.players[0].hand = parseHand('11115m123p456p789s55z');
  assert.deepEqual(findAnkanOptions(game.players[0]), ['1m']);
});

test('applyAnkan:吃掉 4 張、加一組暗槓 meld、從牌牆補一張、不影響門清', () => {
  const game = createGame(fourPlayers());
  game.players[0].hand = parseHand('11115m123p456p789s55z');
  const handBefore = game.players[0].hand.length;
  const wallBefore = game.wall.length;

  const result = applyAnkan(game, 0, '1m');

  assert.equal(game.players[0].hand.length, handBefore - 4 + 1);
  assert.equal(game.players[0].melds.length, 1);
  assert.equal(game.players[0].melds[0].type, 'ankan');
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.equal(game.wall.length, wallBefore - 1);
  assert.equal(result.drewTile !== null, true);
  assert.equal(game.mustDiscard, !result.canWin);
});

test('findKakanOptions:已經碰過的牌,手上又摸到第 4 張才算加槓機會', () => {
  const game = createGame(fourPlayers());
  const player = game.players[0];
  player.melds = [{ type: 'pon', tiles: parseHand('555m') }];
  player.hand = parseHand('5m123p456p789s77z');
  assert.deepEqual(findKakanOptions(player), ['5m']);
});

test('beginKakan + finalizeKakan:沒人搶槓的話,碰 meld 正式升級成 minkan、補一張新牌', () => {
  const game = createGame(fourPlayers());
  const player = game.players[0];
  player.melds = [{ type: 'pon', tiles: parseHand('555m') }];
  player.hand = parseHand('5m123p456p789s77z');
  const wallBefore = game.wall.length;

  const tile = beginKakan(game, 0, '5m');
  assert.equal(findChankanOpportunity(game, 0, tile), null);

  const result = finalizeKakan(game, 0, tile);
  assert.equal(player.melds[0].type, 'minkan');
  assert.equal(player.melds[0].tiles.length, 4);
  assert.equal(game.wall.length, wallBefore - 1);
  assert.equal(result.drewTile !== null, true);
});

test('findChankanOpportunity + applyChankan:加槓的牌剛好完成別人的胡牌,可以搶槓', () => {
  const game = createGame(fourPlayers());
  const player = game.players[0];
  player.melds = [{ type: 'pon', tiles: parseHand('555m') }];
  player.hand = parseHand('5m123p456p789s77z');
  // seat 1 單吊聽 5m
  game.players[1].hand = parseHand('123456789p123456s5m');

  const tile = beginKakan(game, 0, '5m');
  const robberSeat = findChankanOpportunity(game, 0, tile);
  assert.equal(robberSeat, 1);

  const score = applyChankan(game, robberSeat, 0, tile);
  assert.ok(score.total >= 1);
  assert.ok(score.items.some((it) => it.key === 'qiangGang'));
  assert.equal(game.finished, true);
  assert.equal(game.result.type, 'ron');
  assert.equal(game.result.chankan, true);
  assert.equal(game.result.winnerSeat, 1);
  assert.equal(game.result.discarderSeat, 0);
});

test('computeCallOpportunities:手上有 3 張一樣的牌,別人打出第 4 張時可以明槓', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('555m123p456p789s77z');
  const tile = { suit: 'm', rank: 5 };
  const groups = computeCallOpportunities(game, 0, tile);
  const group = groups.find((g) => g.seat === 1);
  assert.ok(group.options.some((o) => o.type === 'kan'));
  assert.ok(group.options.some((o) => o.type === 'pon')); // 3 張也一定滿足碰的條件(>=2),兩個選項並存
});

test('applyMinkan:明槓後吃掉 3 張、棄牌堆移除那張牌、從牌牆補一張、輪到叫槓的人打牌', () => {
  const game = createGame(fourPlayers());
  game.players[1].hand = parseHand('555m123p456p789s77z');
  const discarderSeat = 0;
  const tile = { suit: 'm', rank: 5 };
  game.players[discarderSeat].discards.push(tile);
  const handBefore = game.players[1].hand.length;
  const wallBefore = game.wall.length;

  const result = applyMinkan(game, 1, discarderSeat, tile);

  assert.equal(game.players[1].hand.length, handBefore - 3 + 1);
  assert.equal(game.players[1].melds[0].type, 'minkan');
  assert.equal(game.players[1].melds[0].tiles.length, 4);
  assert.equal(game.players[discarderSeat].discards.length, 0);
  assert.equal(game.wall.length, wallBefore - 1);
  assert.equal(game.currentSeat, 1);
  assert.equal(result.drewTile !== null, true);
  assert.equal(game.mustDiscard, !result.canWin);
});

test('完整跑一整局(含吃碰、點炮),直到自摸、點炮或流局,中途不會噴錯', () => {
  const game = createGame(fourPlayers());
  runFullGame(game);
  assert.equal(game.finished, true);
  assert.ok(['tsumo', 'ron', 'draw'].includes(game.result.type));
  if (game.result.type === 'tsumo' || game.result.type === 'ron') {
    assert.ok(game.result.score.total >= 1);
  }
});

test('buildWall() 預設(不含花牌)還是原本的 136 張,不會有 f 花色', () => {
  const wall = buildWall();
  assert.equal(wall.length, 136);
  assert.equal(wall.every((t) => t.suit !== 'f'), true);
});

test('buildWall({ includeFlowers: true }) 是 144 張,剛好多了梅蘭菊竹春夏秋冬 8 張花牌', () => {
  const wall = buildWall({ includeFlowers: true });
  assert.equal(wall.length, 144);
  const flowerCount = wall.filter((t) => t.suit === 'f').length;
  assert.equal(flowerCount, 8);
  const flowerRanks = wall.filter((t) => t.suit === 'f').map((t) => t.rank).sort((a, b) => a - b);
  assert.deepEqual(flowerRanks, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('createGame({ includeFlowers: true }):發牌時摸到花牌會自動收進 player.flowers,牌總數(手牌+牌牆+花牌)恆等於 144', () => {
  let sawAnyFlowerDealt = false;
  for (let trial = 0; trial < 30; trial++) {
    const game = createGame(fourPlayers(), { includeFlowers: true });
    for (const p of game.players) {
      assert.equal(p.hand.every((t) => t.suit !== 'f'), true); // 手牌裡絕對不會有花牌
      if (p.flowers.length > 0) sawAnyFlowerDealt = true;
    }
    const total =
      game.players.reduce((sum, p) => sum + p.hand.length + p.flowers.length, 0) + game.wall.length;
    assert.equal(total, 144);
  }
  assert.equal(sawAnyFlowerDealt, true); // 30 局裡至少要遇過一次發牌摸到花牌,不然這個機制根本沒被測到
});

test('createGame() 預設不開花牌:總牌數還是 136,player.flowers 一定是空陣列', () => {
  const game = createGame(fourPlayers());
  const total = game.players.reduce((sum, p) => sum + p.hand.length, 0) + game.wall.length;
  assert.equal(total, 136);
  assert.equal(game.players.every((p) => p.flowers.length === 0), true);
});

test('drawForCurrentPlayer 摸到花牌會自動收進 flowers 並補摸下一張,回傳的 drewTile 一定不是花牌', () => {
  let sawFlowerDuringDraw = false;
  for (let trial = 0; trial < 30; trial++) {
    const game = createGame(fourPlayers(), { includeFlowers: true });
    for (let i = 0; i < 20 && !game.finished; i++) {
      const before = game.players[game.currentSeat].flowers.length;
      const { drewTile } = drawForCurrentPlayer(game);
      if (drewTile) {
        assert.equal(drewTile.suit !== 'f', true);
        if (game.players[game.currentSeat].flowers.length > before) sawFlowerDuringDraw = true;
      }
      if (!game.mustDiscard && drewTile) {
        discard(game, tileCode(drewTile));
      }
    }
  }
  assert.equal(sawFlowerDuringDraw, true);
});
