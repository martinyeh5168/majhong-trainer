// 標準麻將記牌法解析,例如 "123456789m1z1z1z55p" 或 "123m 456p 55z"
// 規則:一串數字後面接一個花色字母(m/p/s/z),前面的每個數字都套用該花色

import { makeTile, tileCode, tileDisplayName, sortTiles } from './tiles.js';

export function parseHand(notation) {
  const cleaned = notation.replace(/\s+/g, '');
  const tiles = [];
  let digits = '';

  for (const ch of cleaned) {
    if (/[0-9]/.test(ch)) {
      digits += ch;
      continue;
    }
    const suit = ch.toLowerCase();
    if (!['m', 'p', 's', 'z'].includes(suit)) {
      throw new Error(`無法辨識的花色字母:${ch}`);
    }
    if (digits === '') {
      throw new Error(`花色 ${ch} 前面沒有數字`);
    }
    for (const d of digits) {
      const rank = Number(d);
      const maxRank = suit === 'z' ? 7 : 9;
      if (rank < 1 || rank > maxRank) {
        throw new Error(`${suit} 花色沒有 ${rank} 這個點數`);
      }
      tiles.push(makeTile(suit, rank));
    }
    digits = '';
  }

  if (digits !== '') {
    throw new Error(`數字 ${digits} 後面沒有接花色字母`);
  }

  return tiles;
}

export function formatHand(tiles) {
  const sorted = sortTiles(tiles);
  const groups = [];
  let currentSuit = null;
  let currentDigits = '';

  for (const tile of sorted) {
    if (tile.suit !== currentSuit) {
      if (currentDigits) groups.push(currentDigits + currentSuit);
      currentSuit = tile.suit;
      currentDigits = '';
    }
    currentDigits += tile.rank;
  }
  if (currentDigits) groups.push(currentDigits + currentSuit);

  return groups.join('');
}

export function handToDisplay(tiles) {
  return sortTiles(tiles).map(tileDisplayName).join(' ');
}

export function handToCodes(tiles) {
  return sortTiles(tiles).map(tileCode);
}
