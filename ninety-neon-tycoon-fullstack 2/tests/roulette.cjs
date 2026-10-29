const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8');
const saved = new Map();
let now = 1000;
let reducedMotion = false;
let nextTimer = 0;
let randomWord = 0;
let cryptoUnavailable = false;
const randomQueue = [];
const timers = new Map();
const events = {};
const elements = {
  screen: {innerHTML: ''}, clock: {},
  soundToggle: {addEventListener() {}},
  themeToggle: {setAttribute() {}, addEventListener() {}},
};
const context = vm.createContext({
  console, JSON, Math: Object.create(Math),
  Date: class extends Date {static now() {return now;}},
  setTimeout(fn, delay) {const id = ++nextTimer; timers.set(id, {fn, at: now + delay}); return id;},
  clearTimeout(id) {timers.delete(id);},
  localStorage: {getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value)},
  document: {documentElement: {dataset: {}}, getElementById: id => elements[id], addEventListener(type, fn) {events[type] = fn;}},
  window: {
    matchMedia: () => ({matches: reducedMotion}),
    crypto: {getRandomValues(array) {
      if (cryptoUnavailable) throw Error('Random source unavailable');
      array[0] = randomQueue.length ? randomQueue.shift() : randomWord;
      return array;
    }},
  },
});
vm.runInContext(code, context);
const run = source => vm.runInContext(source, context);
function advance(ms) {
  now += ms;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) {timers.delete(id); timer.fn();}
  }
}
function open() {run('active().x=3; active().y=4; openPlace("arcade")');}
function key(name) {events.keydown({key: name, target: {matches: () => false}});}
function click(act) {events.click({target: {closest: () => ({dataset: {act}})}});}
run('window.setGameAccount({id:"roulette-a",display_name:"Player A"}); start()');
open();
assert.match(elements.screen.innerHTML, /CASH ROULETTE/);
assert.match(elements.screen.innerHTML, /PRIZES &amp; CHANCES/);
assert.equal(run('active().energy'), 4, 'Entering the arcade is free');

// Test all probability boundaries and exact distribution over an even grid.
const expected = [[0,0],[39,0],[40,1],[64,1],[65,2],[82,2],[83,3],[92,3],[93,4],[97,4],[98,5],[99,5]];
for (const [roll, prize] of expected) assert.equal(run(`pickRoulettePrize(${roll})`), prize);
assert.deepEqual(JSON.parse(run('JSON.stringify(Array.from({length:100},(_,i)=>pickRoulettePrize(i)).reduce((counts,i)=>(counts[i]++,counts),[0,0,0,0,0,0]))')), [40,25,18,10,5,2]);
// 2^32 is not divisible by 100. Reject every value in the short remainder.
for (const rejected of [4294967200, 4294967295]) {
  randomQueue.push(rejected, 98);
  assert.equal(run('pickRoulettePrize()'), 5);
  assert.equal(randomQueue.length, 0, 'Biased remainder must trigger another draw');
}
randomQueue.push(4294967199);
assert.equal(run('rouletteRandomInt(100)'), 99, 'Last acceptable value stays in range');
assert.throws(() => run('rouletteRandomInt(0)'), /Invalid random range/);
run('Math.random=()=>{throw Error("Roulette must not use Math.random")};');

// Force each outcome, check the pointer, and ensure exactly one charge and payout.
for (const [ticket, index] of [[20,0],[50,1],[70,2],[87,3],[95,4],[99,5]]) {
  randomWord = ticket;
  run('active().cash=300; active().energy=4');
  click('spin');
  assert.equal(run('active().cash'), 280);
  assert.equal(run('active().energy'), 3);
  assert.equal(run('s.modal.prize'), index);
  const landing = run('(360-s.modal.rotation%360)%360');
  const start = run(`ROULETTE_PRIZES.slice(0,${index}).reduce((sum,p)=>sum+p.weight,0)*3.6`);
  const end = start + run(`ROULETTE_PRIZES[${index}].weight*3.6`);
  assert.ok(landing > start && landing < end, 'Pointer must land inside the paid prize');
  click('spin'); click('close'); key('Escape'); run('endTurn(); openPlace("bank"); action("bank",2)');
  assert.equal(run('active().cash'), 280, 'Busy spin cannot charge or borrow again');
  assert.equal(run('s.player'), 0, 'Player cannot change mid-spin');
  assert.equal(run('s.modal.type'), 'roulette');
  advance(2000);
  run('render()'); // Theme changes and toast expiry must not restart the timer.
  assert.match(elements.screen.innerHTML, /--spin-elapsed:-2000ms/);
  advance(2600);
  const payout = run(`ROULETTE_PRIZES[${index}].cash`);
  assert.equal(run('active().cash'), 280 + payout);
  assert.equal(run('s.modal.spinning'), false);
  run('render(); render()');
  assert.equal(run('active().cash'), 280 + payout, 'Renders cannot pay twice');
}

// A paid, pending spin survives logout/reload and stays with the correct account.
randomWord = 99;
run('active().cash=100; spinRoulette()');
const pending = JSON.parse(saved.get('neon-borough-v1:roulette-a'));
assert.equal(pending.players[0].cash, 80);
assert.equal(pending.modal.prize, 5);
run('window.clearGameAccount(); window.setGameAccount({id:"roulette-b",display_name:"Player B"}); start()');
advance(5000);
assert.equal(run('active().cash'), 220, 'Pending payout must not leak to another account');
run('window.clearGameAccount(); window.setGameAccount({id:"roulette-a",display_name:"Player A"})');
assert.equal(run('active().cash'), 330, 'Reload settles the saved prize');
run('render()');
assert.equal(run('active().cash'), 330);

// Insufficient cash, exhausted actions, and completed turns block spending.
for (const setup of ['active().cash=19; active().energy=4', 'active().cash=100; active().energy=0', 'active().cash=100; active().energy=4; active().done=true']) {
  run(setup);
  const before = run('active().cash');
  click('spin');
  assert.equal(run('active().cash'), before);
  assert.equal(run('s.modal.spinning'), false);
}
reducedMotion = true;
cryptoUnavailable = true;
run('active().done=false; active().energy=1; active().cash=20; spinRoulette()');
assert.equal(run('active().cash'), 20, 'Random-source failure cannot charge the wallet');
assert.equal(run('active().energy'), 1, 'Random-source failure cannot consume an action');
cryptoUnavailable = false;
randomWord = 0;
run('spinRoulette()');
assert.equal(run('s.modal.duration'), 150);
advance(150);
assert.equal(run('active().energy'), 0);
assert.equal(run('active().cash'), 0);
assert.match(elements.screen.innerHTML, /No actions left/);
key('Escape');
assert.equal(run('s.modal'), null);
console.log('Roulette passed: weighted odds, matching landings, spending limits, duplicate protection, saved payouts, account isolation, and reduced motion');
