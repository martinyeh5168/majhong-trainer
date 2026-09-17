// 題庫。故意不放文字描述或提示 —— 牌型直接排出來,靠自己判斷,
// 答案一律由 src/ 的引擎現場算出來,題庫之後要擴充也不用擔心答案跟引擎邏輯對不上。

export const efficiencyQuestions = [
  { id: 'E1', kind: 'efficiency', hand: '123456789m123p45p55s1z' },
  { id: 'E2', kind: 'efficiency', hand: '123456789m12356p999s' },
  { id: 'E3', kind: 'efficiency', hand: '11155m234567p45689s5z' },
  { id: 'E4', kind: 'efficiency', hand: '123456789m12377p24s3z' },
  { id: 'E5', kind: 'efficiency', hand: '123456789m12356p188s' },
];

export const waitQuestions = [
  { id: 'W1', kind: 'wait', hand: '123456789m12345p55s' },
  { id: 'W2', kind: 'wait', hand: '123456789m12377p12s' },
  { id: 'W3', kind: 'wait', hand: '123456789m12379p55s' },
  { id: 'W4', kind: 'wait', hand: '123456789m123456p9s' },
  { id: 'W5', kind: 'wait', hand: '123456789m1235566p' },
  { id: 'W6', kind: 'wait', hand: '147m147p147s1234567z' },
];

// 防守判斷:對手(訓練用直接揭示手牌)已經聽牌,考驗能不能從自己 17 張手牌裡
// 挑出一張不會放槍的安全牌。危不危險一律由 getWaits() 現場算,不是憑感覺編的。
export const safetyQuestions = [
  { id: 'D1', kind: 'safety', hand: '234567m3459p16789s55z', opponentHand: '123456789m12345p55s' },
  { id: 'D2', kind: 'safety', hand: '234567m456p123467s66z', opponentHand: '123456789m12377p12s' },
  { id: 'D3', kind: 'safety', hand: '234567m6789p12345s77z', opponentHand: '123456789m12379p55s' },
  { id: 'D4', kind: 'safety', hand: '112233m44556p1789s11z', opponentHand: '123456789m123456p9s' },
  { id: 'D5', kind: 'safety', hand: '234567m5789p123456s3z', opponentHand: '123456789m1235566p' },
];

export const scoringQuestions = [
  {
    id: 'S1',
    kind: 'scoring',
    hand: '123456789m12345p55s',
    winningTile: '6p',
    context: { selfDrawn: true },
  },
  {
    id: 'S2',
    kind: 'scoring',
    hand: '111m222m333m44455p66s',
    winningTile: '5p',
    context: { selfDrawn: true },
  },
  {
    id: 'S3',
    kind: 'scoring',
    hand: '111m222m333m44455p66s',
    winningTile: '5p',
    context: { selfDrawn: false },
  },
  {
    id: 'S4',
    kind: 'scoring',
    hand: '1223334445556699m',
    winningTile: '7m',
    context: { selfDrawn: true },
  },
  {
    id: 'S5',
    kind: 'scoring',
    hand: '1112223334445556z',
    winningTile: '6z',
    context: { selfDrawn: true },
  },
  {
    id: 'S6',
    kind: 'scoring',
    hand: '9s',
    melds: [
      { type: 'pon', tiles: '111m' },
      { type: 'pon', tiles: '222m' },
      { type: 'pon', tiles: '333m' },
      { type: 'pon', tiles: '444p' },
      { type: 'chi', tiles: '123p' },
    ],
    winningTile: '9s',
    context: { selfDrawn: false },
  },
  {
    id: 'S7',
    kind: 'scoring',
    hand: '123456789m12345p55s',
    winningTile: '6p',
    context: { selfDrawn: true, isDealer: true, isFirstTurn: true },
  },
];
