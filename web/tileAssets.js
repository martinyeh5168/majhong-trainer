// 牌面圖檔來自 FluffyStuff/riichi-mahjong-tiles(CC0 公有領域,免費可用)
// 從 app.js 抽出來,讓 academy.js 等其他模組也能算出圖檔路徑,不用各自重複一份對照表。
const SUIT_FILE = { m: 'Man', p: 'Pin', s: 'Sou' };
const HONOR_FILE = ['Ton', 'Nan', 'Shaa', 'Pei', 'Chun', 'Hatsu', 'Haku']; // z1~z7:東南西北中發白
const FLOWER_FILE = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo', 'Spring', 'Summer', 'Autumn', 'Winter']; // f1~f8:梅蘭菊竹春夏秋冬

export function tileImageSrc(tile) {
  const name =
    tile.suit === 'z'
      ? HONOR_FILE[tile.rank - 1]
      : tile.suit === 'f'
      ? FLOWER_FILE[tile.rank - 1]
      : `${SUIT_FILE[tile.suit]}${tile.rank}`;
  return `web/tiles/${name}.svg`;
}
