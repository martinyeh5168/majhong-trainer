import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../src/handNotation.js';
import { getWaits, remainingCount, isTenpai } from '../src/tingCheck.js';

test('兩面聽(兩張都能胡)找得到全部等待的牌', () => {
  // 123m456m789m123p45p55s,45p 等 3p 或 6p
  const concealedTiles = parseHand('123456789m12345p55s');
  assert.equal(concealedTiles.length, 16);
  const waits = getWaits({ concealedTiles });
  const codes = waits.map((w) => w.code).sort();
  assert.deepEqual(codes, ['3p', '6p']);
});

test('沒聽牌的手牌回傳空陣列', () => {
  const concealedTiles = parseHand('147m147p147s1234567z');
  assert.equal(concealedTiles.length, 16);
  const waits = getWaits({ concealedTiles });
  assert.equal(waits.length, 0);
  assert.equal(isTenpai({ concealedTiles }), false);
});

test('remainingCount 依場上已出現的牌計算剩餘張數', () => {
  const target = { suit: 'p', rank: 6 };
  const visible = parseHand('6p6p'); // 場上已看到兩張 6p
  assert.equal(remainingCount(target, visible), 2);
});
