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
// 這個函式會被切牌分析大量重複呼叫(每個候選棄牌都要掃過 34 種牌),效能很重要。
//
// 效能優化(相對舊版):
// 1. 原地變異 + 復原(backtracking)取代 counts.slice() 陣列複製——
//    舊版每個遞迴分支都要複製整個 34 格陣列,新版直接在同一個陣列上改、
//    遞迴完再改回來,省掉大量陣列配置與複製。
// 2. 記憶化的 key 改用「增量維護的兩個數字雜湊」取代「counts.join('')」字串序列化——
//    雜湊在每次改動 counts 時用 O(1) 增量更新(而不是每次呼叫都重新掃 34 格拼字串)。
//    (34 格拆成兩半分別用 5 進位雜湊,是因為 5^34 超出 JS 安全整數範圍,拆兩半後
//     每半最多 5^17 ≈ 7.6e11,遠低於 Number.MAX_SAFE_INTEGER。)

import { allTileTypes, tileCode } from './tiles.js';

const TILE_ORDER = allTileTypes().map(tileCode);
const CODE_TO_INDEX = new Map(TILE_ORDER.map((code, i) => [code, i]));
const HONOR_START = 27; // 0-8=萬, 9-17=筒, 18-26=條, 27-33=字牌

// 5 進位雜湊用的權重表:每張牌最多 4 張,用 5 進位(0-4)剛好夠、不會進位互相污染。
// 34 格拆成前 17 格(hashA)、後 17 格(hashB)兩半,避免單一雜湊超出安全整數範圍。
const HALF = 17;
const POW5 = new Array(HALF);
POW5[0] = 1;
for (let i = 1; i < HALF; i++) POW5[i] = POW5[i - 1] * 5;

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
  const counts = toCounts(concealedTiles);
  const seen = new Set();
  let best = Infinity;

  // 增量維護的雜湊(對應 counts 目前狀態),隨 applyDelta 同步更新。
  let hashA = 0;
  let hashB = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) continue;
    if (i < HALF) hashA += counts[i] * POW5[i];
    else hashB += counts[i] * POW5[i - HALF];
  }

  function applyDelta(index, delta) {
    counts[index] += delta;
    if (index < HALF) hashA += delta * POW5[index];
    else hashB += delta * POW5[index - HALF];
  }

  function shantenFromState(melds, partials, hasPair) {
    const effectivePartials = Math.min(partials, 5 - melds);
    return 9 - 2 * melds - effectivePartials + (hasPair ? 0 : 1);
  }

  function rec(melds, partials, hasPair) {
    const key = hashA + '_' + hashB + '_' + melds + '_' + partials + '_' + (hasPair ? 1 : 0);
    if (seen.has(key)) return;
    seen.add(key);

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
    const i2 = seqPlus1(index);
    const i3 = seqPlus2(index);

    if (count >= 3) {
      applyDelta(index, -3);
      rec(melds + 1, partials, hasPair);
      applyDelta(index, 3);
    }

    if (i3 !== -1 && counts[i2] >= 1 && counts[i3] >= 1) {
      applyDelta(index, -1);
      applyDelta(i2, -1);
      applyDelta(i3, -1);
      rec(melds + 1, partials, hasPair);
      applyDelta(index, 1);
      applyDelta(i2, 1);
      applyDelta(i3, 1);
    }

    if (count >= 2 && !hasPair) {
      applyDelta(index, -2);
      rec(melds, partials, true);
      applyDelta(index, 2);
    }

    if (canGrow) {
      if (count >= 2) {
        applyDelta(index, -2);
        rec(melds, partials + 1, hasPair);
        applyDelta(index, 2);
      }
      if (i2 !== -1 && counts[i2] >= 1) {
        applyDelta(index, -1);
        applyDelta(i2, -1);
        rec(melds, partials + 1, hasPair);
        applyDelta(index, 1);
        applyDelta(i2, 1);
      }
      if (i3 !== -1 && counts[i3] >= 1) {
        applyDelta(index, -1);
        applyDelta(i3, -1);
        rec(melds, partials + 1, hasPair);
        applyDelta(index, 1);
        applyDelta(i3, 1);
      }
    }

    applyDelta(index, -1);
    rec(melds, partials, hasPair);
    applyDelta(index, 1);
  }

  rec(fixedMelds, 0, false);
  return best;
}
