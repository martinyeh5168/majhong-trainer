// 切牌效率分析:剛摸到第 17 張牌,該打哪張才能讓「聽牌的張數」最多(進張數最大)
//
// 效能優化(相對舊版):
// 1. 候選牌剪枝:只檢查「手上有的牌或同花色 ±2 內的牌」,其他牌加進來是孤張,不可能降低向聽數。
// 2. 向聽數改用 shanten.js 的「分花色計算 + 快取」演算法,切牌分析中大量重複的單門牌型直接查表。
// 3. 已聽牌(向聽 0)的情況,進張就是聽的牌,改用快速胡牌判斷,不跑向聽搜尋。
// 4. 場上可見牌的張數只統計一次,不再對每張牌重新掃 visibleTiles。

import { tileCode } from './tiles.js';
import { getWaitsWithCounts } from './tingCheck.js';
import { calculateShanten } from './shanten.js';
import { TILE_TYPES, TILE_CODES, toCounts, canCompleteHand, candidateIndices } from './handCounts.js';

/**
 * concealedTiles:17 張(還沒打牌前的手牌,含melds外的部分)
 * melds:已經吃碰槓固定的面子
 * visibleTiles:場上看得到的牌(自己手牌、花牌、面子、所有人的棄牌與面子),用來算剩餘張數
 *
 * 回傳每一種打法的分析,依「進張數」由高到低排序:
 * [{ discard, waits: [{tile, code, remaining}], ukeire, isTenpai }, ...]
 */
export function analyzeDiscards(concealedTiles, melds, visibleTiles) {
  const uniqueCodes = [...new Set(concealedTiles.map(tileCode))];

  const results = uniqueCodes.map((code) => {
    const idx = concealedTiles.findIndex((t) => tileCode(t) === code);
    const remainingHand = [...concealedTiles.slice(0, idx), ...concealedTiles.slice(idx + 1)];
    const waits = getWaitsWithCounts({ concealedTiles: remainingHand, melds }, visibleTiles);
    const ukeire = waits.reduce((sum, w) => sum + w.remaining, 0);
    return { discard: code, waits, ukeire, isTenpai: waits.length > 0 };
  });

  results.sort((a, b) => b.ukeire - a.ukeire);
  return results;
}

// 場上每種牌已出現幾張,只統計一次
function visibleCountsByCode(visibleTiles) {
  const map = new Map();
  for (const t of visibleTiles) {
    const c = tileCode(t);
    map.set(c, (map.get(c) ?? 0) + 1);
  }
  return map;
}

/**
 * 通用版切牌分析:不假設手牌已經接近聽牌,任何向聽數的 17 張牌都能分析。
 * 先比向聽數(越小越好),向聽數一樣的話再比「能讓向聽數再往下降的牌」有多少張(期望進張數)。
 *
 * usefulTiles 只列出「場上還有機會摸到」的牌(4 張都已經在手牌或棄牌堆裡看過的牌不列入,
 * 也不算進期望進張數,因為那種牌實際上已經不可能再摸到了)。
 *
 * 回傳依(向聽數由小到大、期望進張數由大到小)排序的分析:
 * [{ discard, shanten, usefulTiles: [{tile, code, remaining}], ukeire }, ...]
 */
export function analyzeDiscardsGeneral(concealedTiles, melds, visibleTiles) {
  const uniqueCodes = [...new Set(concealedTiles.map(tileCode))];
  const fixedMelds = melds.length;
  const groupsNeeded = 5 - fixedMelds;
  const seenCounts = visibleCountsByCode(visibleTiles);

  const results = uniqueCodes.map((code) => {
    const idx = concealedTiles.findIndex((t) => tileCode(t) === code);
    const remainingHand = [...concealedTiles.slice(0, idx), ...concealedTiles.slice(idx + 1)];
    const shanten = calculateShanten(remainingHand, fixedMelds);
    const counts = toCounts(remainingHand);

    const usefulTiles = [];
    for (const i of candidateIndices(counts)) {
      const remaining = Math.max(0, 4 - (seenCounts.get(TILE_CODES[i]) ?? 0));
      if (remaining === 0) continue; // 摸不到的牌不用算

      let improves;
      if (shanten === 0) {
        // 已聽牌:進張 = 能胡的牌,用快速胡牌判斷
        counts[i]++;
        improves = canCompleteHand(counts, groupsNeeded);
        counts[i]--;
      } else {
        const tile = TILE_TYPES[i];
        improves = calculateShanten([...remainingHand, tile], fixedMelds) < shanten;
      }
      if (improves) usefulTiles.push({ tile: TILE_TYPES[i], code: TILE_CODES[i], remaining });
    }
    const ukeire = usefulTiles.reduce((sum, u) => sum + u.remaining, 0);

    return { discard: code, shanten, usefulTiles, ukeire };
  });

  results.sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire);
  return results;
}
