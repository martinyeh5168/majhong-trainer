// 聽牌(進張)分析:手牌 16 張(扣掉已完成的面子後),找出再摸/吃到哪些牌可以胡牌
//
// 效能優化(相對舊版):
// 舊版對 34 種牌每一種都呼叫完整的 checkWin(含列舉所有拆法)。新版:
// 1. 候選牌剪枝:能讓手牌胡的牌,一定是手上已有的牌、或同花色 ±1/±2 的牌(字牌只能是手上有的),
//    其他牌加進來一定是孤張、不可能胡,直接略過。
// 2. 先用只回傳 true/false 的 canCompleteHand 快速判斷,確定會胡才做完整列舉(需要 decompositions 時)。

import { tileCode } from './tiles.js';
import { checkWin } from './winCheck.js';
import { TILE_TYPES, toCounts, canCompleteHand, candidateIndices } from './handCounts.js';

function findWaitIndices(hand) {
  const melds = hand.melds ?? [];
  const groupsNeeded = 5 - melds.length;
  if (groupsNeeded < 0) return [];
  if (hand.concealedTiles.length + 1 !== groupsNeeded * 3 + 2) return [];

  const counts = toCounts(hand.concealedTiles);
  const waits = [];
  for (const i of candidateIndices(counts)) {
    counts[i]++;
    if (canCompleteHand(counts, groupsNeeded)) waits.push(i);
    counts[i]--;
  }
  return waits;
}

/**
 * hand = { concealedTiles: Tile[], melds?: [...] }
 * 回傳等待中的牌組成的陣列,例如 [{ tile, code, decompositions }]
 */
export function getWaits(hand) {
  return findWaitIndices(hand).map((i) => {
    const tile = TILE_TYPES[i];
    const result = checkWin({ concealedTiles: [...hand.concealedTiles, tile], melds: hand.melds });
    return { tile, code: tileCode(tile), decompositions: result.decompositions };
  });
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

/** 只需要聽哪些牌 + 剩餘張數時用這個,不做拆法列舉(切牌分析用) */
export function getWaitsWithCounts(hand, visibleTiles) {
  return findWaitIndices(hand).map((i) => {
    const tile = TILE_TYPES[i];
    return { tile, code: tileCode(tile), remaining: remainingCount(tile, visibleTiles) };
  });
}

export function isTenpai(hand) {
  return findWaitIndices(hand).length > 0;
}
