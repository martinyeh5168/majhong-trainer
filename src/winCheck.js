// 胡牌型態判斷:16張台灣麻將的基本結構為「5組面子 + 1對將眼」
// 面子(組)可以是刻子(3張同牌)或順子(同花色連續3張),字牌沒有順子
// 已經吃碰槓的面子會固定放在 melds,不需要再拆解;concealedTiles 只需拆出 (5 - melds.length) 組 + 1 對
//
// 拆組合的核心邏輯放在 handCounts.js,跟 shanten.js 共用同一套牌索引與鄰牌判斷。

import { toCounts, canCompleteHand, enumerateGroupDecompositions } from './handCounts.js';

/**
 * 列舉出所有能把 tiles 拆成 (groupsNeeded 組面子 + 1 對) 的方式。
 * 回傳陣列,每個元素為 { pair: code, groups: [{ type, tiles: [code,code,code] }] }
 */
export function enumerateDecompositions(tiles, groupsNeeded) {
  if (tiles.length !== groupsNeeded * 3 + 2) return [];
  return enumerateGroupDecompositions(toCounts(tiles), groupsNeeded);
}

/**
 * 只判斷「是否胡牌」,不列舉拆法——比 checkWin 快很多。
 * 只需要 true/false 的地方(例如判斷能不能胡、找聽牌)請用這個。
 */
export function isWinningHand(hand) {
  const melds = hand.melds ?? [];
  const groupsNeeded = 5 - melds.length;
  if (groupsNeeded < 0) return false;
  if (hand.concealedTiles.length !== groupsNeeded * 3 + 2) return false;
  return canCompleteHand(toCounts(hand.concealedTiles), groupsNeeded);
}

/**
 * 判斷一手牌是否胡牌(和牌)。
 * hand = { concealedTiles: Tile[], melds?: [{ type: 'chi'|'pon'|'ankan'|'minkan', tiles: Tile[] }] }
 * 回傳 { win: boolean, decompositions: [...] } — decompositions 已把 melds 併入 groups
 */
export function checkWin(hand) {
  const melds = hand.melds ?? [];
  const groupsNeeded = 5 - melds.length;
  if (groupsNeeded < 0) return { win: false, decompositions: [] };

  // 先用快速判斷擋掉不能胡的牌,不能胡就不必做完整列舉
  if (!isWinningHand(hand)) return { win: false, decompositions: [] };

  const raw = enumerateDecompositions(hand.concealedTiles, groupsNeeded);
  if (raw.length === 0) return { win: false, decompositions: [] };

  const meldGroups = melds.map((m) => ({
    type: m.type === 'chi' ? 'sequence' : 'triplet',
    tiles: m.tiles.map((t) => `${t.rank}${t.suit}`),
    fromMeld: m.type,
    concealed: m.type === 'ankan',
  }));

  const decompositions = raw.map((d) => ({
    pair: d.pair,
    groups: [
      ...meldGroups,
      ...d.groups.map((g) => ({ ...g, fromMeld: null, concealed: true })),
    ],
  }));

  return { win: true, decompositions };
}
