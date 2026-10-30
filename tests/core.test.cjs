const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../app/src/main/assets/core.js');

const funded=()=>C.setBalances(C.blank(),100000,50000);
test('money is kept in exact integer cents; invalid or oversized inputs are rejected',()=>{
  assert.equal(C.cents('0.29'),29);assert.equal(C.cents('123.4'),12340);assert.equal(C.cents('0',true),0);
  for(const bad of ['-1','0','1.001','NaN','1e3','Infinity','999999999999999'])assert.throws(()=>C.cents(bad));
});
test('income and expense update only their selected account, notes have no balance effect',()=>{
  let s=funded();s=C.transact(s,{kind:'income',bucket:'savings',amount:1234,note:'工资'});
  s=C.transact(s,{kind:'expense',bucket:'free',amount:2999,note:'午餐'});
  assert.deepEqual(C.balances(s),{savings:101234,free:47001});
  const t=s.transactions.at(-1);t.note='更新的备注';assert.deepEqual(C.balances(s),{savings:101234,free:47001});
  assert.throws(()=>C.transact(s,{kind:'expense',bucket:'free',amount:999999}));C.validate(s);
});
test('setting balances preserves old transactions and records only adjustments',()=>{
  let s=funded();const ids=s.transactions.map(t=>t.id);s=C.setBalances(s,80000,20000);
  assert.deepEqual(C.balances(s),{savings:80000,free:20000});assert.deepEqual(s.transactions.slice(0,2).map(t=>t.id),ids);
  assert.equal(s.transactions.length,4);assert.equal(C.setBalances(s,80000,20000).transactions.length,4);C.validate(s);
});
test('transfers keep total assets unchanged, plan completion cancels further contributions',()=>{
  let s=C.plan(funded(),{name:'旅行',target:20000,daily:10000,time:'21:00'});const p=s.plans[0];
  s=C.contribute(s,p.id,7000,'transfer','第一笔');s=C.contribute(s,p.id,13000,'transfer','第二笔');
  assert.deepEqual(C.balances(s),{savings:120000,free:30000});assert.equal(C.progress(s.plans[0]),20000);
  assert.equal(C.paidToday(s.plans[0]),20000);assert.equal(C.complete(s.plans[0]),true);C.validate(s);
  assert.throws(()=>C.contribute(s,p.id,100,'record',''));
  s=C.removeTransaction(s,s.transactions.at(-1).id);
  assert.equal(C.progress(s.plans[0]),7000);assert.equal(C.complete(s.plans[0]),false);
  assert.deepEqual(C.balances(s),{savings:107000,free:43000});C.validate(s);
});
test('record-only contributions and unlimited plans do not change assets',()=>{
  let s=C.plan(funded(),{name:'长期存钱',target:null,daily:100,time:'09:30'});const id=s.plans[0].id;
  s=C.contribute(s,id,10000,'record','已有存款');assert.deepEqual(C.balances(s),{savings:100000,free:50000});assert.equal(C.complete(s.plans[0]),false);
  s=C.removeEntry(s,id,s.plans[0].entries[0].id);assert.equal(C.progress(s.plans[0]),0);
  s={...s,plans:s.plans.map(p=>({...p,paused:true}))};assert.throws(()=>C.contribute(s,id,100,'record',''));C.validate(s);
});
test('deleting an old income cannot make assets negative',()=>{
  let s=C.transact(C.blank(),{kind:'income',bucket:'free',amount:100});const income=s.transactions[0].id;
  s=C.transact(s,{kind:'expense',bucket:'free',amount:99});assert.throws(()=>C.removeTransaction(s,income));
});
test('ratio allocation preserves every cent including large balances',()=>{
  for(const total of [1,101,10000,C.LIMIT]){
    const rows=C.allocate(total,[{name:'存款',percent:'33.33'},{name:'自由',percent:'33.33'},{name:'其他',percent:'33.34'}]);
    assert.equal(rows.reduce((a,r)=>a+r.amount,0),total);assert(rows.every(r=>Number.isSafeInteger(r.amount)));
  }
  assert.throws(()=>C.allocate(100,[{percent:'70'},{percent:'40'}]));
});
test('calculator handles precedence, parentheses, unary signs, percentage and bad input safely',()=>{
  assert.equal(C.calculate('(5000-1200)*30%'),1140);assert.equal(C.calculate('1+2*3'),7);assert.equal(C.calculate('-(2+3)*4'),-20);
  assert.equal(C.calculate('0.1+0.2'),0.3);assert.equal(C.calculate('12÷4×3'),9);
  for(const bad of ['1/0','alert(1)','1+','(1+2','1;2','1e10','2**3'])assert.throws(()=>C.calculate(bad));
});
test('backup round trip validates links and rejects corrupt or duplicated records',()=>{
  let s=C.plan(funded(),{name:'应急金',target:1000,daily:100,time:'21:00'});s=C.contribute(s,s.plans[0].id,500,'transfer','');
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(s))),s);
  const broken=JSON.parse(JSON.stringify(s));broken.plans[0].entries[0].amount++;assert.throws(()=>C.validate(broken));
  const duplicated=JSON.parse(JSON.stringify(s));duplicated.transactions.push(duplicated.transactions[0]);assert.throws(()=>C.validate(duplicated));
  assert.throws(()=>C.validate({}));assert.throws(()=>C.validate({...s,version:2}));
  const badDate=JSON.parse(JSON.stringify(s));badDate.transactions[0].date='2026-02-31';assert.throws(()=>C.validate(badDate));
  const badId=JSON.parse(JSON.stringify(s));badId.plans[0].id='bad|id';assert.throws(()=>C.validate(badId));
});
test('deleting a plan keeps real transfers and all asset balances',()=>{
  let s=C.plan(funded(),{name:'小目标',target:10000,daily:100,time:'20:00'});s=C.contribute(s,s.plans[0].id,1000,'transfer','');
  const b=C.balances(s);s={...s,plans:[]};C.validate(s);assert.deepEqual(C.balances(s),b);
});
