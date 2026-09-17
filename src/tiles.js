// 牌的基本定義:萬(m) / 筒(p) / 條(s) / 字牌(z)
// 字牌順序:1東 2南 3西 4北 5中 6發 7白
// 花牌(春夏秋冬梅蘭竹菊)不參與胡牌組牌,單獨計算,見 flowers.js

export const SUITS = ['m', 'p', 's', 'z', 'f'];
export const HONOR_NAMES = ['東', '南', '西', '北', '中', '發', '白'];
export const SUIT_NAMES = { m: '萬', p: '筒', s: '條' };
export const NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const FLOWER_NAMES = ['梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬']; // f1~f8

export function makeTile(suit, rank) {
  return { suit, rank };
}

export function tileCode(tile) {
  return `${tile.rank}${tile.suit}`;
}

export function tileFromCode(code) {
  const rank = Number(code.slice(0, -1));
  const suit = code.slice(-1);
  return { suit, rank };
}

export function isHonor(tile) {
  return tile.suit === 'z';
}

export function isTerminal(tile) {
  return tile.suit !== 'z' && (tile.rank === 1 || tile.rank === 9);
}

export function tilesEqual(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

// 只列會參與胡牌組牌的 136 張(萬筒條字),花牌不算在內 —— 花牌不組牌,見 allFlowerTypes()
export function allTileTypes() {
  const types = [];
  for (const suit of ['m', 'p', 's']) {
    for (let rank = 1; rank <= 9; rank++) types.push(makeTile(suit, rank));
  }
  for (let rank = 1; rank <= 7; rank++) types.push(makeTile('z', rank));
  return types;
}

// 梅蘭菊竹、春夏秋冬,共 8 張,摸到就攤開單獨計台、不算進手牌組牌
export function allFlowerTypes() {
  const types = [];
  for (let rank = 1; rank <= 8; rank++) types.push(makeTile('f', rank));
  return types;
}

export function isFlower(tile) {
  return tile.suit === 'f';
}

export function tileDisplayName(tile) {
  if (tile.suit === 'z') return HONOR_NAMES[tile.rank - 1];
  if (tile.suit === 'f') return FLOWER_NAMES[tile.rank - 1];
  return `${NUMERALS[tile.rank]}${SUIT_NAMES[tile.suit]}`;
}

// 排序用:先花色(m<p<s<z) 再點數
export function compareTiles(a, b) {
  if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  return a.rank - b.rank;
}

export function sortTiles(tiles) {
  return [...tiles].sort(compareTiles);
}
