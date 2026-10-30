const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../app/src/main/assets/finance.js'),Legacy=require('../app/src/main/assets/core.js');
const D='2026-10-19';
function funded(rule={},balance=1000000){return C.account(C.blank(D),{name:'微信',balance,rule},'savings-main',D);}
function confirmAll(s,asOf='2026-10-22'){let next=s;for(const p of [...(s.pendingInterest||[])].sort((a,b)=>a.date.localeCompare(b.date)))next=C.confirmInterest(next,p.id,asOf);return next;}
function settleDay(s,day){return confirmAll(C.settle(s,C.addDays(day,1)),C.addDays(day,1));}
test('v1 migration preserves every balance, note and plan entry without inventing funds',()=>{
  let s=Legacy.setBalances(Legacy.blank(),1200000,350000);s=Legacy.transact(s,{kind:'expense',bucket:'free',amount:2850,note:'午餐'});
  s=Legacy.plan(s,{name:'旅行',target:10000,daily:100,time:'21:00'});s=Legacy.contribute(s,s.plans[0].id,100,'record','已存');
  const next=C.migrate(s,D);assert.deepEqual(C.balances(next),Legacy.balances(s));assert.equal(next.transactions[2].note,'午餐');assert.equal(next.plans[0].entries[0].note,'已存');C.validate(next);
  assert.equal(C.progress(next.plans[0],next),100);assert.equal(C.paidToday(next.plans[0],C.today(),next),100);
});
test('splitting an existing balance into detail accounts never increases total assets',()=>{
  let s=funded();s=C.account(s,{name:'银行卡',bucket:'savings',balance:400000,sourceId:'savings-main',rule:{mode:'annual',rate:'1.5'}},null,D);
  const bank=s.accounts.at(-1);assert.equal(C.accountBalances(s)['savings-main'],600000);assert.equal(C.accountBalances(s)[bank.id],400000);assert.deepEqual(C.balances(s),{savings:1000000,free:0});C.validate(s);
  s=C.transact(s,{kind:'expense',accountId:bank.id,amount:10000});assert.equal(C.balances(s).savings,990000);assert.throws(()=>C.transact(s,{kind:'expense',accountId:bank.id,amount:999999}));
});
test('all interest waits for confirmation; settle is idempotent and catch-up is exact',()=>{
  let s=funded({mode:'annual',rate:'3.65'});s=C.settle(s,'2026-10-22');
  assert.equal(C.balances(s).savings,1000000);assert.deepEqual(s.pendingInterest.map(p=>p.amount),[100,100,100]);
  const json=JSON.stringify(s);assert.equal(C.settle(s,'2026-10-22'),s);assert.equal(JSON.stringify(C.settle(s,'2026-10-20')),json);C.validate(s);
  s=confirmAll(s,'2026-10-22');assert.equal(C.balances(s).savings,1000300);assert.equal(s.pendingInterest.length,0);
});
test('ordinary interest can be edited while pending without posting assets',()=>{
 let s=C.settle(funded({mode:'fixed',fixed:'1'}),'2026-10-20');const id=s.pendingInterest[0].id;
 s=C.editPendingInterest(s,id,125);C.validate(s);
 assert.equal(s.pendingInterest[0].amount,125);assert.equal(s.pendingInterest[0].estimatedAmount,100);
 assert.equal(C.balances(s).savings,1000000);
 s=C.settle(s,'2026-10-20');assert.equal(s.pendingInterest[0].amount,125);
 s=C.confirmInterest(s,id,'2026-10-20');assert.equal(C.balances(s).savings,1000125);
});
test('simple and compound interest follow the configured basis once confirmed',()=>{
  const simple=settleDay(settleDay(funded({mode:'daily',rate:'1',compound:false},100000),'2026-10-19'),'2026-10-20');
  const compound=settleDay(settleDay(funded({mode:'daily',rate:'1',compound:true},100000),'2026-10-19'),'2026-10-20');
  assert.equal(C.balances(simple).savings,102000);assert.equal(C.balances(compound).savings,102010);
  const annual=confirmAll(C.settle(funded({mode:'annual',rate:'3.6',basis:360}),'2026-10-20'),'2026-10-20');assert.equal(C.balances(annual).savings,1000100);
  const monthly=confirmAll(C.settle(funded({mode:'monthly',rate:'0.3'}),'2026-10-20'),'2026-10-20');assert.equal(C.balances(monthly).savings,1000100);
});
test('fixed income, custom formulas, and fractional-cent carry are deterministic after confirmation',()=>{
  const fixed=C.settle(funded({mode:'fixed',fixed:'0.13'},0),'2026-10-22');assert.deepEqual(fixed.pendingInterest.map(p=>p.amount),[13,13,13]);assert.equal(C.balances(fixed).savings,0);assert.equal(C.balances(confirmAll(fixed)).savings,39);
  const formula=confirmAll(C.settle(funded({mode:'formula',rate:'3.65',formula:'本金 * 利率 / 基数 + 0.25'}),'2026-10-21'),'2026-10-21');assert.equal(C.balances(formula).savings,1000250);
  const tiny=confirmAll(C.settle(funded({mode:'annual',rate:'3.65'},100),C.addDays(D,100)),C.addDays(D,100));assert.equal(C.balances(tiny).savings,101);assert.equal(tiny.accounts[0].carry,0);
  assert.throws(()=>C.rule({mode:'formula',formula:'fetch(1)'}));assert.throws(()=>C.rule({mode:'formula',formula:'-1'}));
});
test('withdrawals and later deposits update simple-interest principal correctly',()=>{
  let s=confirmAll(C.settle(funded({mode:'annual',rate:'3.65'}),'2026-10-20'),'2026-10-20');
  s=C.transact(s,{kind:'expense',accountId:'savings-main',amount:1000000,effectiveDate:'2026-10-20'});assert.equal(C.principal(s,'savings-main'),0);
  s=C.transact(s,{kind:'income',accountId:'savings-main',amount:10000,effectiveDate:'2026-10-20'});assert.equal(C.principal(s,'savings-main'),10000);
  s=confirmAll(C.settle(s,'2026-10-21'),'2026-10-21');assert.equal(C.balances(s).savings,10101);
});
test('linked plans share normal income, expense, transfer and confirmed interest changes',()=>{
  let s=funded({mode:'fixed',fixed:'1.00'});s=C.plan(s,{name:'旅行',target:1000,daily:100,time:'21:00',accountId:'savings-main'});const pid=s.plans[0].id;
  s=C.transact(s,{kind:'income',accountId:'savings-main',amount:1000});assert.equal(C.progress(s.plans[0],s),1000);assert(C.complete(s.plans[0],s));
  s=C.transact(s,{kind:'expense',accountId:'savings-main',amount:600});assert.equal(C.progress(s.plans[0],s),400);assert(!C.complete(s.plans[0],s));
  s=C.settle(s,'2026-10-20');assert.equal(C.progress(s.plans[0],s),400);s=confirmAll(s,'2026-10-20');assert.equal(C.progress(s.plans[0],s),500);C.validate(s);
  assert.throws(()=>C.contribute(s,pid,100,'record',''));
});
test('rule changes settle past days with the old rule and only affect new days',()=>{
  let s=funded({mode:'fixed',fixed:'1.00'});
  s=C.account(s,{name:'微信',rule:{mode:'fixed',fixed:'2.00'}},'savings-main','2026-10-21');
  assert.equal(C.balances(s).savings,1000000);assert.deepEqual(s.pendingInterest.map(p=>p.amount),[100,100]);
  s=C.settle(s,'2026-10-22');assert.deepEqual(s.pendingInterest.map(p=>p.amount),[100,100,200]);
  s=confirmAll(s,'2026-10-22');assert.equal(C.balances(s).savings,1000400);
});
test('a formula error keeps its day open for correction instead of permanently skipping income',()=>{
 let s=funded({mode:'formula',rate:'0',formula:'本金 / (余额 - 50)'},10000);
 s=C.transact(s,{kind:'expense',accountId:'savings-main',amount:5000,date:'2026-10-20',effectiveDate:'2026-10-20'});
 s=C.settle(s,'2026-10-22');
 assert.equal(s.accounts[0].lastAccruedDate,'2026-10-19');
 assert.match(s.accounts[0].error,/2026-10-20/);
 s=C.account(s,{name:'微信',rule:{mode:'fixed',fixed:'1'}},'savings-main','2026-10-22');
 s=C.settle(s,'2026-10-22');
 assert.deepEqual(s.pendingInterest.map(p=>[p.date,p.amount]),[['2026-10-19',200],['2026-10-20',100],['2026-10-21',100]]);
});
test('account links, dates, ratios, and transaction references are validated on restore',()=>{
  const s=funded();C.validate(JSON.parse(JSON.stringify(s)));
  const bad=JSON.parse(JSON.stringify(s));bad.transactions[0].accountId='missing';assert.throws(()=>C.validate(bad));
  const bad2=JSON.parse(JSON.stringify(s));bad2.accounts[0].lastAccruedDate='2026-02-31';assert.throws(()=>C.validate(bad2));
  assert.equal(C.allocate(101,[{name:'全部',percent:'100'}])[0].amount,101);
});
