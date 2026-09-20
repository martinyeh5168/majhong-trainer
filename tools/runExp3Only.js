// 只跑實驗三(第四章・下家封鎖),因為完整跑一次全部三個實驗中途被系統記憶體不足砍掉,
// 實驗一、二的結果已經拿到了,這支腳本補跑剩下那組,避免重跑浪費時間。
import { runBatch, wilsonInterval, pct, shieldShimochaDiscard, FOCUS_SEAT } from './simulateAcademyClaims.js';

const n = Number(process.argv[2]) || 3000;
console.log(`實驗三單獨補跑,每組 ${n} 局`);

const control = runBatch(n, {});
const treat = runBatch(n, { discardStrategies: { [FOCUS_SEAT]: shieldShimochaDiscard } });

const shimoControl = wilsonInterval(control.shimochaCalledOffSeat1, control.hands);
const shimoTreat = wilsonInterval(treat.shimochaCalledOffSeat1, treat.hands);

console.log('對照組(照常效率打):', pct(shimoControl.p), `[${pct(shimoControl.lo)}, ${pct(shimoControl.hi)}]`);
console.log('實驗組(優先躲下家):', pct(shimoTreat.p), `[${pct(shimoTreat.lo)}, ${pct(shimoTreat.hi)}]`);
