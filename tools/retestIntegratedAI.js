// 麻將學園技巧整合進 chooseAiDiscard / chooseAiCallDecision(src/game.js)之後的複測:
// 比較「整合前(Basic 版,舊邏輯)」vs「整合後(現在人機對局/麻將實戰正式使用的版本)」,
// 四個座位統一套用同一版邏輯(不是只有一家套用),看整體對局結果實際變化多少。
//
// 用法:node tools/retestIntegratedAI.js [每組局數,預設 3000]

import { chooseAiDiscardBasic, chooseAiCallDecisionBasic } from '../src/game.js';
import { runBatch, wilsonInterval, meanInterval, pct, FOCUS_SEAT } from './simulateAcademyClaims.js';

const n = Number(process.argv[2]) || 3000;
console.log(`每組模擬局數:${n}(四個座位統一套用同一版邏輯,座位 ${FOCUS_SEAT} 的統計數字有代表性)`);

const basicStrategies = {
  discardStrategies: { 0: chooseAiDiscardBasic, 1: chooseAiDiscardBasic, 2: chooseAiDiscardBasic, 3: chooseAiDiscardBasic },
  callStrategies: {
    0: chooseAiCallDecisionBasic,
    1: chooseAiCallDecisionBasic,
    2: chooseAiCallDecisionBasic,
    3: chooseAiCallDecisionBasic,
  },
};

// 整合後版本就是引擎現在的預設值,不用另外指定策略
const before = runBatch(n, basicStrategies);
const after = runBatch(n, {});

function row(label, stats) {
  const win = wilsonInterval(stats.seat1Win, stats.hands);
  const dealIn = wilsonInterval(stats.seat1DealIn, stats.hands);
  const draw = wilsonInterval(stats.draws, stats.hands);
  const shimocha = wilsonInterval(stats.shimochaCalledOffSeat1, stats.hands);
  const score = meanInterval(stats.seat1TsumoOrRonScores);
  return [
    label,
    `${pct(win.p)} [${pct(win.lo)}, ${pct(win.hi)}]`,
    `${pct(dealIn.p)} [${pct(dealIn.lo)}, ${pct(dealIn.hi)}]`,
    `${pct(draw.p)} [${pct(draw.lo)}, ${pct(draw.hi)}]`,
    score.n > 0 ? `${score.mean.toFixed(2)} [${score.lo.toFixed(2)}, ${score.hi.toFixed(2)}]` : '—',
    `${pct(shimocha.p)} [${pct(shimocha.lo)}, ${pct(shimocha.hi)}]`,
  ];
}

const rows = [row('整合前(Basic 舊邏輯)', before), row('整合後(現在的正式版)', after)];
const columns = ['版本', '勝率(95% CI)', '放槍率(95% CI)', '流局率(95% CI)', '胡牌平均台數(95% CI)', '下家至少吃碰一次(95% CI)'];
const widths = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
function printRow(cells) {
  console.log(cells.map((c, i) => String(c).padEnd(widths[i])).join(' | '));
}
printRow(columns);
for (const r of rows) printRow(r);
