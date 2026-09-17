// 聽牌(進張)分析:手牌 16 張(扣掉已完成的面子後),找出再摸/吃到哪些牌可以胡牌

import { allTileTypes, makeTile, tileCode } from './tiles.js';
import { checkWin } from './winCheck.js';

/**
 * hand = { concealedTiles: Tile[], melds?: [...] }
 * 回傳等待中的牌組成的陣列,例如 [{ tile, code, decompositions }]
 */
export function getWaits(hand) {
  const waits = [];
  for (const tile of allTileTypes()) {
    const candidateHand = {
      concealedTiles: [...hand.concealedTiles, tile],
      melds: hand.melds,
    };
    const result = checkWin(candidateHand);
    if (result.win) {
      waits.push({ tile, code: tileCode(tile), decompositions: result.decompositions });
    }
  }
  return waits;
}

/**
 * 計算某張牌在場上還剩幾張沒出現。
 * visibleTiles 應包含:自己手牌、自己的花牌與面子、所有玩家的棄牌、所有玩家攤開的面子
 */
export function remainingCount(tile, visibleTiles) {
  const code = tileCode(tile);
  const used = visibleTiles.filter((t) => tileCode(t) === code).length;
  return Math.max(0, 4 - used);
}

export function getWaitsWithCounts(hand, visibleTiles) {
  return getWaits(hand).map((w) => ({
    ...w,
    remaining: remainingCount(w.tile, visibleTiles),
  }));
}

export function isTenpai(hand) {
  return getWaits(hand).length > 0;
}
