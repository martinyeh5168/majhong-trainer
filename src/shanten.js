// 向聽數(shanten)計算:手牌離聽牌還差幾步。
// 0 = 已經聽牌,-1 = 已經胡了,1 = 差一步到聽牌,以此類推。
//
// 台灣 16 張需要「5 組面子 + 1 對將眼」,概念上跟标准 13 张麻将的
// 「4 組 + 1 對」向聽公式一樣,只是把「4」換成「5」:
//   向聽數 = (5*2 -1) - 2*melds - effectivePartials + (hasPair ? 0 : 1)
// melds:已經完成的面子數;partials:還差一張就能完成的搭子(順子差一張/刻子差一張);
// effectivePartials 最多只能算到 (5 - melds) 組,因為面子只需要 5 組,多的搭子沒用。
//
// 內部用長度 34 的純數字陣列(而不是 Map<string,number>)記牌,
// 純數字陣列的複製(slice)跟比對(join 當 key)比 Map 快很多,
// 這個函式會被切牌分析大量重複呼叫(每個候選棄牌都要掃過 34 種牌),效能很重要。

import { allTileTypes, tileCode } from './tiles.js';

const TILE_ORDER = allTileTypes().map(tileCode);
const CODE_TO_INDEX = new Map(TILE_ORDER.map((code, i) => [code, i]));
const HONOR_START = 27; // 0-8=萬, 9-17=筒, 18-26=條, 27-33=字牌

function seqPlus1(index) {
  if (index >= HONOR_START) return -1;
  return index % 9 === 8 ? -1 : index + 1;
}

function seqPlus2(index) {
  if (index >= HONOR_START) return -1;
  return index % 9 >= 7 ? -1 : index + 2;
}

function toCounts(tiles) {
  const counts = new Array(34).fill(0);
  for (const tile of tiles) {
    counts[CODE_TO_INDEX.get(tileCode(tile))]++;
  }
  return counts;
}

function firstActiveIndex(counts) {
  for (let i = 0; i < 34; i++) {
    if (counts[i] > 0) return i;
  }
  return -1;
}

/**
 * concealedTiles:手牌(不含已經吃碰槓的部分)
 * fixedMelds:已經吃碰槓、算完成的面子數量(每組固定算 1 個 meld)
 * 回傳向聽數(數字越小越好,-1 表示已經胡牌)
 */
export function calculateShanten(concealedTiles, fixedMelds = 0) {
  const startCounts = toCounts(concealedTiles);
  const seen = new Set();
  let best = Infinity;

  function shantenFromState(melds, partials, hasPair) {
    const effectivePartials = Math.min(partials, 5 - melds);
    return 9 - 2 * melds - effectivePartials + (hasPair ? 0 : 1);
  }

  function rec(counts, melds, partials, hasPair) {
    // 同樣的狀態(不管怎麼繞路過來)算出來的向聽數都一樣,算過就不用再算一次
    const key = counts.join('') + '|' + melds + '|' + partials + '|' + (hasPair ? 1 : 0);
    if (seen.has(key)) return;
    seen.add(key);

    // 5 組面子的名額已經滿了、對子也有了,剩下的牌再怎麼組都不會讓向聽數更好,不用再往下算
    if (melds + partials >= 5 && hasPair) {
      const s = shantenFromState(melds, partials, hasPair);
      if (s < best) best = s;
      return;
    }

    const index = firstActiveIndex(counts);
    if (index === -1) {
      const s = shantenFromState(melds, partials, hasPair);
      if (s < best) best = s;
      return;
    }

    const count = counts[index];
    const canGrow = melds + partials < 5;

    if (count >= 3) {
      const next = counts.slice();
      next[index] -= 3;
      rec(next, melds + 1, partials, hasPair);
    }

    const i2 = seqPlus1(index);
    const i3 = seqPlus2(index);

    if (i3 !== -1 && counts[i2] >= 1 && counts[i3] >= 1) {
      const next = counts.slice();
      next[index]--;
      next[i2]--;
      next[i3]--;
      rec(next, melds + 1, partials, hasPair);
    }

    if (count >= 2 && !hasPair) {
      const next = counts.slice();
      next[index] -= 2;
      rec(next, melds, partials, true);
    }

    if (canGrow) {
      if (count >= 2) {
        const next = counts.slice();
        next[index] -= 2;
        rec(next, melds, partials + 1, hasPair);
      }
      if (i2 !== -1 && counts[i2] >= 1) {
        const next = counts.slice();
        next[index]--;
        next[i2]--;
        rec(next, melds, partials + 1, hasPair);
      }
      if (i3 !== -1 && counts[i3] >= 1) {
        const next = counts.slice();
        next[index]--;
        next[i3]--;
        rec(next, melds, partials + 1, hasPair);
      }
    }

    // 這張牌當孤張跳過,不參與任何組合
    const next = counts.slice();
    next[index]--;
    rec(next, melds, partials, hasPair);
  }

  rec(startCounts, fixedMelds, 0, false);
  return best;
}
