// 胡牌型態判斷:16張台灣麻將的基本結構為「5組面子 + 1對將眼」
// 面子(組)可以是刻子(3張同牌)或順子(同花色連續3張),字牌沒有順子
// 已經吃碰槓的面子會固定放在 melds,不需要再拆解;concealedTiles 只需拆出 (5 - melds.length) 組 + 1 對

import { allTileTypes, tileCode, tileFromCode } from './tiles.js';

const TILE_ORDER = allTileTypes().map(tileCode);

function toCounts(tiles) {
  const counts = new Map();
  for (const code of TILE_ORDER) counts.set(code, 0);
  for (const tile of tiles) {
    const code = tileCode(tile);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

function firstActive(counts) {
  for (const code of TILE_ORDER) {
    if (counts.get(code) > 0) return code;
  }
  return null;
}

function canSequenceFrom(code) {
  const tile = tileFromCode(code);
  return tile.suit !== 'z' && tile.rank <= 7;
}

/**
 * 列舉出所有能把 tiles 拆成 (groupsNeeded 組面子 + 1 對) 的方式。
 * 回傳陣列,每個元素為 { pair: code, groups: [{ type, tiles: [code,code,code] }] }
 */
export function enumerateDecompositions(tiles, groupsNeeded) {
  const totalNeeded = groupsNeeded * 3 + 2;
  if (tiles.length !== totalNeeded) return [];

  const results = [];
  const seen = new Set();
  const startCounts = toCounts(tiles);

  function rec(counts, groupsLeft, pairCode, groups) {
    const code = firstActive(counts);

    if (code === null) {
      if (groupsLeft === 0 && pairCode !== null) {
        const key = JSON.stringify({ pairCode, groups });
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ pair: pairCode, groups: groups.map((g) => ({ ...g })) });
        }
      }
      return;
    }

    const count = counts.get(code);

    // 嘗試當對子(將眼),整副牌只能有一個對子
    if (pairCode === null && count >= 2) {
      const next = new Map(counts);
      next.set(code, count - 2);
      rec(next, groupsLeft, code, groups);
    }

    if (groupsLeft > 0) {
      // 嘗試當刻子
      if (count >= 3) {
        const next = new Map(counts);
        next.set(code, count - 3);
        groups.push({ type: 'triplet', tiles: [code, code, code] });
        rec(next, groupsLeft - 1, pairCode, groups);
        groups.pop();
      }

      // 嘗試當順子(字牌不能組順子)
      if (canSequenceFrom(code)) {
        const tile = tileFromCode(code);
        const c2 = tileCode({ suit: tile.suit, rank: tile.rank + 1 });
        const c3 = tileCode({ suit: tile.suit, rank: tile.rank + 2 });
        if ((counts.get(c2) ?? 0) >= 1 && (counts.get(c3) ?? 0) >= 1) {
          const next = new Map(counts);
          next.set(code, count - 1);
          next.set(c2, next.get(c2) - 1);
          next.set(c3, next.get(c3) - 1);
          groups.push({ type: 'sequence', tiles: [code, c2, c3] });
          rec(next, groupsLeft - 1, pairCode, groups);
          groups.pop();
        }
      }
    }
  }

  rec(startCounts, groupsNeeded, null, []);
  return results;
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

  const raw = enumerateDecompositions(hand.concealedTiles, groupsNeeded);
  if (raw.length === 0) return { win: false, decompositions: [] };

  const meldGroups = melds.map((m) => ({
    type: m.type === 'chi' ? 'sequence' : 'triplet',
    tiles: m.tiles.map(tileCode),
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
