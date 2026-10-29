// Run the actual game's selector with real Web Crypto, without rendering a million wheels.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const elements = {
  screen: {}, clock: {}, soundToggle: {addEventListener() {}},
  themeToggle: {addEventListener() {}, setAttribute() {}},
};
const context = vm.createContext({
  console, setTimeout, clearTimeout,
  localStorage: {getItem() {return null;}, setItem() {}},
  document: {documentElement: {dataset: {}}, getElementById: id => elements[id], addEventListener() {}},
  window: {crypto: webcrypto},
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8'), context);
const stats = vm.runInContext(`(() => {
  // Fail if the production selector accidentally falls back to Math.random.
  Math.random=()=>{throw Error('Insecure random source used')};
  const spins=1000000;
  const counts=ROULETTE_PRIZES.map(()=>0);
  const pairs=ROULETTE_PRIZES.map(()=>ROULETTE_PRIZES.map(()=>0));
  let first;
  for(let i=0;i<spins;i++){
    const prize=pickRoulettePrize();
    counts[prize]++;
    // Use non-overlapping pairs so the pair-count variance is straightforward.
    if(i%2===0)first=prize;else pairs[first][prize]++;
  }
  return JSON.stringify({spins,counts,pairs,prizes:ROULETTE_PRIZES});
})()`, context);
const {spins,counts,pairs,prizes} = JSON.parse(stats);
const outcomes = prizes.map((prize,i) => {
  const probability=prize.weight/100;
  const expected=spins*probability;
  const standardDeviation=Math.sqrt(spins*probability*(1-probability));
  const z=(counts[i]-expected)/standardDeviation;
  assert.ok(Math.abs(z)<6, `Prize $${prize.cash} deviated more than six standard deviations`);
  return {prize:prize.cash,expectedPercent:prize.weight,actualPercent:counts[i]/spins*100,count:counts[i],standardDeviations:z};
});
let maxPairDeviation=0;
for(let i=0;i<prizes.length;i++)for(let j=0;j<prizes.length;j++){
  const probability=prizes[i].weight*prizes[j].weight/10000;
  const expected=spins/2*probability;
  const z=Math.abs(pairs[i][j]-expected)/Math.sqrt(spins/2*probability*(1-probability));
  maxPairDeviation=Math.max(maxPairDeviation,z);
  assert.ok(z<6, `Consecutive outcome pair ${i},${j} deviated more than six standard deviations`);
}
const report={
  generatedAt:new Date().toISOString(),
  method:'Production pickRoulettePrize(), Web Crypto getRandomValues(), rejection sampling; Math.random disabled',
  spins,
  outcomes,
  independentPairs:spins/2,
  maxPairStandardDeviations:maxPairDeviation,
  thresholdStandardDeviations:6,
  averagePayout:outcomes.reduce((sum,row)=>sum+row.prize*row.count,0)/spins,
  expectedAveragePayout:prizes.reduce((sum,row)=>sum+row.cash*row.weight/100,0),
  passed:true,
  limitation:'Statistical checks can detect distribution and sequence problems; they cannot prove true randomness or browser tamper resistance.',
};
console.table(outcomes.map(row=>({Prize:`$${row.prize}`,Expected:`${row.expectedPercent}%`,Observed:`${row.actualPercent.toFixed(4)}%`,Count:row.count})));
console.log(`PASS: ${spins.toLocaleString()} spins and ${(spins/2).toLocaleString()} independent outcome pairs within the six-standard-deviation threshold.`);
console.log(`Average payout: $${report.averagePayout.toFixed(4)}; expected $${report.expectedAveragePayout.toFixed(2)}.`);
if(process.argv.includes('--report')){
  const filename=path.join(__dirname,'roulette_simulation_results.json');
  fs.writeFileSync(filename,JSON.stringify(report,null,2)+'\n');
  console.log(`Saved report: ${filename}`);
}
