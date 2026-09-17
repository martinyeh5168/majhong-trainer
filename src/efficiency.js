// 切牌效率分析:剛摸到第 17 張牌,該打哪張才能讓「聽牌的張數」最多(進張數最大)

import { allTileTypes, tileCode } from './tiles.js';
import { getWaitsWithCounts, remainingCount } from './tingCheck.js';
import { calculateShanten } from './shanten.js';

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

/**
 * 通用版切牌分析:不假設手牌已經接近聽牌,任何向聽數的 17 張牌都能分析。
 * 先比向聽數(越小越好),向聽數一樣的話再比「能讓向聽數再往下降的牌」有多少張(期望進張數)。
 *
 * concealedTiles:17 張(還沒打牌前的手牌)
 * melds:已經吃碰槓固定的面子
 * visibleTiles:場上看得到的牌,用來算剩餘張數
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

  const results = uniqueCodes.map((code) => {
    const idx = concealedTiles.findIndex((t) => tileCode(t) === code);
    const remainingHand = [...concealedTiles.slice(0, idx), ...concealedTiles.slice(idx + 1)];
    const shanten = calculateShanten(remainingHand, fixedMelds);

    const usefulTiles = [];
    for (const tile of allTileTypes()) {
      const candidate = [...remainingHand, tile];
      if (calculateShanten(candidate, fixedMelds) < shanten) {
        const remaining = remainingCount(tile, visibleTiles);
        if (remaining > 0) usefulTiles.push({ tile, code: tileCode(tile), remaining });
      }
    }
    const ukeire = usefulTiles.reduce((sum, u) => sum + u.remaining, 0);

    return { discard: code, shanten, usefulTiles, ukeire };
  });

  results.sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire);
  return results;
}
