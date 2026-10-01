// 向聽數(shanten)計算:手牌離聽牌還差幾步。
// 0 = 已經聽牌,-1 = 已經胡了,1 = 差一步到聽牌,以此類推。
//
// 台灣 16 張需要「5 組面子 + 1 對將眼」:
//   向聽數 = 10 - 2*melds - min(partials, 5 - melds) - (hasPair ? 1 : 0)
// melds:完成的面子數(含已吃碰槓);partials:搭子數(差一張成面子的兩張牌);
// 搭子最多只算到 (5 - melds) 組,因為面子只需要 5 組,多的搭子沒用。
//
// 演算法(分花色計算 + 快取):
// 萬、筒、條、字牌四門之間不可能互相組成面子或搭子,所以每一門可以「各自獨立」拆解。
// 1. 對每一門,列出所有可能的 (面子數, 搭子數, 是否用了對子) 組合,只保留不被其他組合完全壓過的。
// 2. 每一門的結果依「該門的牌型」快取起來——同樣的一門牌型之後再出現(切牌分析時非常頻繁)直接查表。
// 3. 最後把四門的組合交叉合併,套公式取最小值。
// 相較於整副 34 種牌一起遞迴搜尋,搜尋空間小非常多,而且快取在所有呼叫之間共用。

import { toCounts } from './handCounts.js';

// 快取:key = 該門牌型的 8 進位編碼(字牌另外一組,因為字牌不能組順子)
const suitCache = new Map();
const honorCache = new Map();
const CACHE_LIMIT = 300000; // 避免長時間使用後佔用太多記憶體

/**
 * 列出單一門的所有「不被壓過」的拆法 [melds, partials, pair]。
 * cells:該門每種牌的張數;allowSequence:數字牌 true、字牌 false
 */
function suitOptions(cells, allowSequence) {
  const n = cells.length;
  const found = new Map(); // key "m,p,pair" → [m,p,pair]
  const seenStates = new Set();

  function rec(start, m, p, pair) {
    let i = start;
    while (i < n && cells[i] === 0) i++;
    if (i === n) {
      const k = m * 100 + p * 2 + pair;
      if (!found.has(k)) found.set(k, [m, p, pair]);
      return;
    }
    const stateKey = cells.join('') + '|' + i + '|' + m + '|' + p + '|' + pair;
    if (seenStates.has(stateKey)) return;
    seenStates.add(stateKey);

    const c = cells[i];
    if (c >= 3) { cells[i] -= 3; rec(i, m + 1, p, pair); cells[i] += 3; }
    if (allowSequence && i + 2 < n && cells[i + 1] > 0 && cells[i + 2] > 0) {
      cells[i]--; cells[i + 1]--; cells[i + 2]--;
      rec(i, m + 1, p, pair);
      cells[i]++; cells[i + 1]++; cells[i + 2]++;
    }
    if (c >= 2) {
      cells[i] -= 2;
      if (!pair) rec(i, m, p, 1);
      rec(i, m, p + 1, pair);
      cells[i] += 2;
    }
    if (allowSequence && i + 1 < n && cells[i + 1] > 0) {
      cells[i]--; cells[i + 1]--; rec(i, m, p + 1, pair); cells[i]++; cells[i + 1]++;
    }
    if (allowSequence && i + 2 < n && cells[i + 2] > 0) {
      cells[i]--; cells[i + 2]--; rec(i, m, p + 1, pair); cells[i]++; cells[i + 2]++;
    }
    cells[i]--; rec(i, m, p, pair); cells[i]++; // 當孤張跳過
  }

  rec(0, 0, 0, 0);

  // 只保留不被壓過的組合:面子、搭子、對子都不比別人少的才有用
  const all = [...found.values()];
  return all.filter((a) => !all.some((b) =>
    b !== a && b[0] >= a[0] && b[1] >= a[1] && b[2] >= a[2] &&
    (b[0] > a[0] || b[1] > a[1] || b[2] > a[2])));
}

function cachedOptions(counts, start, len, allowSequence) {
  let key = 0;
  for (let i = 0; i < len; i++) key = key * 8 + counts[start + i]; // 8 進位:就算異常輸入同牌超過 4 張也不會撞 key
  const cache = allowSequence ? suitCache : honorCache;
  let opts = cache.get(key);
  if (!opts) {
    opts = suitOptions(counts.slice(start, start + len), allowSequence);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, opts);
  }
  return opts;
}

/**
 * concealedTiles:手牌(不含已經吃碰槓的部分)
 * fixedMelds:已經吃碰槓、算完成的面子數量(每組固定算 1 個 meld)
 * 回傳向聽數(數字越小越好,-1 表示已經胡牌)
 */
export function calculateShanten(concealedTiles, fixedMelds = 0) {
  const counts = toCounts(concealedTiles);
  const groups = [
    cachedOptions(counts, 0, 9, true),
    cachedOptions(counts, 9, 9, true),
    cachedOptions(counts, 18, 9, true),
    cachedOptions(counts, 27, 7, false),
  ];

  let best = Infinity;
  for (const a of groups[0]) {
    for (const b of groups[1]) {
      for (const c of groups[2]) {
        for (const d of groups[3]) {
          const m = fixedMelds + a[0] + b[0] + c[0] + d[0];
          const p = a[1] + b[1] + c[1] + d[1];
          const pair = a[2] | b[2] | c[2] | d[2];
          const s = 10 - 2 * m - Math.min(p, 5 - m) - pair;
          if (s < best) best = s;
        }
      }
    }
  }
  return Math.max(best, -1); // 胡牌就是 -1,異常的超量手牌也不會回傳更小的值
}
