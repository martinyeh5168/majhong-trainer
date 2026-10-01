// 手牌「計數陣列」共用工具:shanten.js、winCheck.js、tingCheck.js 共用同一套牌索引與拆組合基礎。
// 以前各檔案各自實作 toCounts / 順子鄰牌判斷 / 拆面子遞迴,改一邊容易漏改另一邊,現在統一放這裡。
//
// 索引:0-8=萬, 9-17=筒, 18-26=條, 27-33=字牌(字牌不能組順子)

import { allTileTypes, tileCode } from './tiles.js';

export const TILE_TYPES = allTileTypes();
export const TILE_CODES = TILE_TYPES.map(tileCode);
export const CODE_TO_INDEX = new Map(TILE_CODES.map((code, i) => [code, i]));
export const HONOR_START = 27;
export const NUM_TYPES = 34;

/** 往後一張(同花色 +1),不存在回傳 -1 */
export function seqPlus1(index) {
  if (index >= HONOR_START) return -1;
  return index % 9 === 8 ? -1 : index + 1;
}

/** 往後兩張(同花色 +2),不存在回傳 -1 */
export function seqPlus2(index) {
  if (index >= HONOR_START) return -1;
  return index % 9 >= 7 ? -1 : index + 2;
}

export function indexOfTile(tile) {
  return CODE_TO_INDEX.get(tileCode(tile));
}

export function toCounts(tiles) {
  const counts = new Array(NUM_TYPES).fill(0);
  for (const tile of tiles) counts[indexOfTile(tile)]++;
  return counts;
}

export function firstActiveIndex(counts, from = 0) {
  for (let i = from; i < NUM_TYPES; i++) {
    if (counts[i] > 0) return i;
  }
  return -1;
}

/**
 * 快速判斷:counts 能不能剛好拆成 groupsNeeded 組面子 + 1 對(只回傳 true/false,不列舉拆法)。
 * 原地變異 + 復原,不複製陣列;找到一種拆法就立刻返回。
 */
export function canCompleteHand(counts, groupsNeeded) {
  let total = 0;
  for (let i = 0; i < NUM_TYPES; i++) total += counts[i];
  if (total !== groupsNeeded * 3 + 2) return false;

  for (let p = 0; p < NUM_TYPES; p++) {
    if (counts[p] < 2) continue;
    counts[p] -= 2;
    const ok = canFormGroups(counts, 0);
    counts[p] += 2;
    if (ok) return true;
  }
  return false;
}

// 剩下的牌是否能全部拆成面子(刻子/順子)。最小索引那張牌只有兩種用法,所以不需要回溯很多。
function canFormGroups(counts, from) {
  const i = firstActiveIndex(counts, from);
  if (i === -1) return true;

  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = canFormGroups(counts, i);
    counts[i] += 3;
    if (ok) return true;
  }
  const i2 = seqPlus1(i);
  const i3 = seqPlus2(i);
  if (i3 !== -1 && counts[i2] > 0 && counts[i3] > 0) {
    counts[i]--; counts[i2]--; counts[i3]--;
    const ok = canFormGroups(counts, i);
    counts[i]++; counts[i2]++; counts[i3]++;
    if (ok) return true;
  }
  return false;
}

/**
 * 列舉所有「groupsNeeded 組面子 + 1 對」的拆法。
 * 回傳 [{ pair: code, groups: [{ type: 'triplet'|'sequence', tiles: [code,code,code] }] }]
 * 列舉順序與舊版 winCheck 相同(先試對子、再刻子、再順子),確保計番結果不變。
 */
export function enumerateGroupDecompositions(counts, groupsNeeded) {
  let total = 0;
  for (let i = 0; i < NUM_TYPES; i++) total += counts[i];
  if (total !== groupsNeeded * 3 + 2) return [];

  const results = [];
  const seen = new Set();
  const groups = [];
  let pairIndex = -1;

  function rec(groupsLeft) {
    const i = firstActiveIndex(counts);
    if (i === -1) {
      if (groupsLeft === 0 && pairIndex !== -1) {
        const key = pairIndex + '|' + groups.map((g) => g.type[0] + g.start).join(',');
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            pair: TILE_CODES[pairIndex],
            groups: groups.map((g) => ({ type: g.type, tiles: g.tiles.slice() })),
          });
        }
      }
      return;
    }

    if (pairIndex === -1 && counts[i] >= 2) {
      counts[i] -= 2;
      pairIndex = i;
      rec(groupsLeft);
      pairIndex = -1;
      counts[i] += 2;
    }

    if (groupsLeft > 0) {
      if (counts[i] >= 3) {
        counts[i] -= 3;
        const c = TILE_CODES[i];
        groups.push({ type: 'triplet', start: i, tiles: [c, c, c] });
        rec(groupsLeft - 1);
        groups.pop();
        counts[i] += 3;
      }
      const i2 = seqPlus1(i);
      const i3 = seqPlus2(i);
      if (i3 !== -1 && counts[i2] > 0 && counts[i3] > 0) {
        counts[i]--; counts[i2]--; counts[i3]--;
        groups.push({ type: 'sequence', start: i, tiles: [TILE_CODES[i], TILE_CODES[i2], TILE_CODES[i3]] });
        rec(groupsLeft - 1);
        groups.pop();
        counts[i]++; counts[i2]++; counts[i3]++;
      }
    }
  }

  rec(groupsNeeded);
  return results;
}

/**
 * 找出「加進手牌後可能有用」的牌索引:手上已有的牌,或同花色 ±1/±2 的牌(字牌只能是手上有的)。
 * 其他牌加進來一定是孤張,不可能讓手牌胡牌、也不可能降低向聽數,可以直接略過。
 */
export function candidateIndices(counts) {
  const mark = new Array(NUM_TYPES).fill(false);
  for (let i = 0; i < NUM_TYPES; i++) {
    if (counts[i] === 0) continue;
    mark[i] = true;
    if (i >= HONOR_START) continue;
    const pos = i % 9;
    for (let d = -2; d <= 2; d++) {
      const p = pos + d;
      if (p >= 0 && p <= 8) mark[i + d] = true;
    }
  }
  const result = [];
  for (let i = 0; i < NUM_TYPES; i++) if (mark[i]) result.push(i);
  return result;
}
