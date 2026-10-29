const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.resolve(__dirname, '../public/game.js'), 'utf8');
const elements = {
  screen: {innerHTML: ''}, clock: {textContent: ''},
  soundToggle: {textContent: '', addEventListener(){}},
  themeToggle: {textContent: '', setAttribute(){}, addEventListener(){}},
};
const saved = new Map();
const context = {
  console, JSON, Array, Object, String, Math, Number, Date, setTimeout(){},
  localStorage: {getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value)},
  document: {documentElement: {dataset: {}}, getElementById: id => elements[id], addEventListener(){}},
  window: {},
};
vm.createContext(context);
vm.runInContext(code, context);
const run = expression => vm.runInContext(expression, context);

run('window.setGameAccount({id:"account-1",display_name:"Player A",avatar_url:"/api/account/avatar/account-1?v=1"})');
run('start()');
if(!elements.screen.innerHTML.includes('avatar-photo')) throw Error('Profile picture missing from player marker');
if(!elements.screen.innerHTML.includes('Player A')) throw Error('Account name not used in game');
if(!saved.has('neon-borough-v1:account-1')) throw Error('Account-specific game save not written');

run('window.clearGameAccount()');
run('window.setGameAccount({id:"account-2",display_name:"Player B",avatar_url:null})');
if(run('s.players.length') !== 0) throw Error('Another account inherited player data');
run('start()');
if(elements.screen.innerHTML.includes('avatar-photo')) throw Error('Photo leaked into a different account');
console.log('Game smoke passed: account name, account-scoped saves, picture marker, and logout isolation');
