const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8');
const saved = new Map();
let now = 1000;
let reducedMotion = false;
let nextTimer = 0;
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
  window: {matchMedia: () => ({matches: reducedMotion})},
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
const expected = [[0,0],[.399999,0],[.4,1],[.649999,1],[.65,2],[.829999,2],[.83,3],[.929999,3],[.93,4],[.979999,4],[.98,5],[.999999,5]];
for (const [roll, prize] of expected) assert.equal(run(`pickRoulettePrize(${roll})`), prize);
assert.deepEqual(JSON.parse(run('JSON.stringify(Array.from({length:10000},(_,i)=>pickRoulettePrize((i+.5)/10000)).reduce((counts,i)=>(counts[i]++,counts),[0,0,0,0,0,0]))')), [4000,2500,1800,1000,500,200]);

// Force each outcome, check the pointer, and ensure exactly one charge and payout.
for (const [roll, index] of [[.2,0],[.5,1],[.7,2],[.87,3],[.95,4],[.99,5]]) {
  run(`active().cash=300; active().energy=4; Math.random=()=>${roll}`);
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
run('Math.random=()=>.99; active().cash=100; spinRoulette()');
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
run('active().done=false; active().energy=1; active().cash=20; Math.random=()=>0; spinRoulette()');
assert.equal(run('s.modal.duration'), 150);
advance(150);
assert.equal(run('active().energy'), 0);
assert.equal(run('active().cash'), 0);
assert.match(elements.screen.innerHTML, /No actions left/);
key('Escape');
assert.equal(run('s.modal'), null);
console.log('Roulette passed: weighted odds, matching landings, spending limits, duplicate protection, saved payouts, account isolation, and reduced motion');
