const test=require('node:test'),assert=require('node:assert/strict'),C=require('../app/src/main/assets/insights.js');
const start='2026-10-19',end='2026-10-22';
function seed(){return C.account(C.blank(start),{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main',start);}
const data=quotes=>({code:'017269',source:'xqfunds',updatedAt:1,quotes});
const pendingAmounts=s=>(s.pendingInterest||[]).map(p=>p.amount);
function confirmAll(s,asOf=end){let next=s;for(const p of [...(s.pendingInterest||[])].sort((a,b)=>a.date.localeCompare(b.date)))next=C.confirmInterest(next,p.id,asOf);return next;}
test('fund interest waits for confirmation before it changes balance, plans or reports',()=>{
 let s=seed();s=C.plan(s,{name:'存钱',accountId:'savings-main',daily:20,target:70,time:'20:00'});
 s.fundData=data({'2026-10-19':'0.2663','2026-10-20':'0.2097','2026-10-21':'0.2663'});
 let settled=C.settle(s,end);
 assert.deepEqual(pendingAmounts(settled),[26,21,27]);
 assert.equal(C.balances(settled).savings,1000000);
 assert.equal(C.monthlyReport(settled,'2026-10').interest,0);
 assert.equal(C.progress(settled.plans[0],settled),0);
 assert.equal(settled.transactions.filter(t=>t.kind==='interest').length,0);
 settled=confirmAll(settled);
 assert.deepEqual(settled.transactions.filter(t=>t.kind==='interest').map(t=>t.amount),[26,21,27]);
 assert.equal(C.balances(settled).savings,1000074);
 assert.equal(C.progress(settled.plans[0],settled),74);assert(C.complete(settled.plans[0],settled));
 assert.equal(C.monthlyReport(settled,'2026-10').interest,74);
 assert.deepEqual(C.settle(settled,end),settled);
});
test('actual fund payout can replace the estimate without losing its earning date',()=>{
 let s=seed();s.fundData=data({'2026-10-19':'0.2663'});s=C.settle(s,'2026-10-20');
 const pending=s.pendingInterest[0];assert.equal(pending.amount,26);
 assert.throws(()=>C.confirmInterest(s,pending.id,'2026-10-20',0),/实际收益金额无效/);
 s=C.confirmInterest(s,pending.id,'2026-10-20',27);
 const t=s.transactions.find(t=>t.id===pending.id);
 assert.equal(t.amount,27);assert.equal(t.sourceDate,'2026-10-19');assert.equal(t.date,'2026-10-20');
 assert.match(t.note,/2026-10-20 的利息（2026-10-19 产生）/);
 assert.equal(C.accountBalances(s)['savings-main'],1000027);
 assert.equal(C.monthlyReport(s,'2026-10').interest,27);
 assert.equal(C.fundBalance(s,s.accounts.find(a=>a.id==='savings-main'),'2026-10-20'),1000027);
 assert.equal(s.pendingInterest.length,0);
});
test('editing a pending fund yield keeps it pending and uses the edited amount for later estimates',()=>{
 let s=seed();s.fundData=data({'2026-10-19':'100','2026-10-20':'100'});s=C.settle(s,'2026-10-20');
 const p=s.pendingInterest[0];assert.equal(p.amount,10000);
 assert.throws(()=>C.editPendingInterest(s,p.id,0),/利息金额/);
 s=C.editPendingInterest(s,p.id,12000);assert.equal(s.pendingInterest[0].estimatedAmount,10000);
 assert.equal(C.balances(s).savings,1000000);assert.equal(s.transactions.filter(t=>t.kind==='interest').length,0);
 s=C.migrate(JSON.parse(JSON.stringify(s)));s=C.settle(s,'2026-10-21');
 assert.deepEqual(pendingAmounts(s),[12000,10120]);
 s=C.confirmInterest(s,p.id,'2026-10-21');
 const recorded=s.transactions.find(t=>t.id===p.id);
 assert.equal(recorded.amount,12000);assert.match(recorded.note,/原估算 ¥100\.00/);
 assert.equal(C.balances(s).savings,1012000);
});
test('fund income uses the next-day posting date even when confirmed later or across months',()=>{
 let s=C.account(C.blank('2026-10-31'),{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main','2026-10-31');
 s.fundData=data({'2026-10-31':'0.2663'});s=C.settle(s,'2026-11-01');
 const p=s.pendingInterest[0];s=C.confirmInterest(s,p.id,'2026-11-03',27);
 const t=s.transactions.find(t=>t.id===p.id);
 assert.equal(t.date,'2026-11-01');assert.equal(t.effectiveDate,'2026-11-01');assert.equal(t.sourceDate,'2026-10-31');
 assert.equal(C.monthlyReport(s,'2026-10').interest,0);assert.equal(C.monthlyReport(s,'2026-11').interest,27);
});
test('fund estimates reinvest prior daily yields even while bookkeeping confirmation is pending',()=>{
 let s=seed();s.fundData=data({'2026-10-19':'100','2026-10-20':'100','2026-10-21':'100'});
 s=C.settle(s,end);
 assert.deepEqual(pendingAmounts(s),[10000,10100,10201]);
 assert.equal(C.balances(s).savings,1000000);
 assert.equal(C.fundBalance(s,s.accounts[0],'2026-10-21'),1020100);
 s=confirmAll(s);
 assert.equal(C.balances(s).savings,1030301);
 assert.equal(C.fundBalance(s,s.accounts[0],'2026-10-21'),1020100);
});
test('missing dates stop without consuming the checkpoint; later fetch catches up exactly once',()=>{
 let s=seed();s.fundData=data({'2026-10-19':'0.2663','2026-10-21':'0.2663'});s=C.settle(s,end);
 assert.equal(s.accounts[0].lastAccruedDate,'2026-10-19');assert.match(s.accounts[0].error,/2026-10-20/);assert.deepEqual(pendingAmounts(s),[26]);assert.equal(C.balances(s).savings,1000000);
 assert.strictEqual(C.settle(s,end),s);
 s.fundData.quotes['2026-10-20']='0.2097';s=C.settle(s,end);assert.deepEqual(pendingAmounts(s),[26,21,27]);assert.equal(C.balances(s).savings,1000000);assert.equal(s.accounts[0].error,'');
 s=confirmAll(s);assert.equal(C.balances(s).savings,1000074);
});
test('a cached current-day quote does not post early and fills previous missing days',()=>{
 let s=seed();s.fundData=data({'2026-10-19':'1'});s=C.settle(s,'2026-10-25');
 assert.equal(s.accounts[0].lastAccruedDate,'2026-10-19');assert.match(s.accounts[0].error,/2026-10-20/);
 for(const day of ['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'])s.fundData.quotes[day]='1';
 s=C.settle(s,'2026-10-25');
 assert.equal(s.accounts[0].lastAccruedDate,'2026-10-24');assert.equal(s.accounts[0].error,'');
 assert(!s.pendingInterest.some(p=>p.date==='2026-10-25'));
 assert.equal(s.pendingInterest.length,6);
});
test('a deleted confirmed yield stays removed across backup and checkpoint replay',()=>{
 let s=seed();s.fundData=data({'2026-10-19':'1.00'});s=C.settle(s,'2026-10-20');
 const id=s.pendingInterest[0].id;s=C.confirmInterest(s,id,'2026-10-20');assert.equal(C.balances(s).savings,1000100);
 s=C.removeTransaction(s,id);s=C.migrate(JSON.parse(JSON.stringify(s)));s.accounts[0].lastAccruedDate='2026-10-18';s=C.settle(s,'2026-10-20');
 assert.equal(C.balances(s).savings,1000000);assert(!s.transactions.some(t=>t.id===id));assert(!(s.pendingInterest||[]).some(p=>p.id===id));
});
test('switching to fund mode never applies new fund data to old interest days',()=>{
 let s=C.account(C.blank(start),{name:'存款',balance:1000000,rule:{mode:'fixed',fixed:'1'}},'savings-main',start);
 s=C.account(s,{name:'零钱通',rule:{mode:'fund'}},'savings-main','2026-10-21');assert.equal(C.balances(s).savings,1000000);assert.deepEqual(s.pendingInterest.map(p=>p.amount),[100,100]);assert.equal(s.accounts[0].lastAccruedDate,'2026-10-20');
 s.fundData=data({'2026-10-19':'100','2026-10-20':'100','2026-10-21':'0.2663'});
 let settled=C.settle(s,end);assert.deepEqual(pendingAmounts(settled),[100,100,26]);assert.equal(C.balances(settled).savings,1000000);
 settled=confirmAll(settled);assert.equal(C.balances(settled).savings,1000226);
});
test('negative or missing published yields never silently become a positive income',()=>{
 let s=seed();s.fundData=data({'2026-10-19':'-0.20'});s=C.settle(s,end);assert.equal(C.balances(s).savings,1000000);assert.equal(s.accounts[0].lastAccruedDate,'2026-10-18');assert.match(s.accounts[0].error,/负收益/);assert.deepEqual(pendingAmounts(s),[]);
});
test('fund stats use official daily quotes and only annualize a contiguous 7-day window',()=>{
 const quotes={};for(let i=0;i<7;i++)quotes[C.addDays('2026-10-15',i)]='0.2663';
 const s=seed();assert.equal(C.fundStats(s),null);s.fundData=data(quotes);
 const stats=C.fundStats(s);assert.equal(stats.date,'2026-10-21');assert.equal(stats.income,'0.2663');assert.ok(Math.abs(stats.annualized-0.2663/10000*365*100)<1e-9);
 delete quotes['2026-10-18'];assert.equal(C.fundStats(s).annualized,null);
});
function wechatState(quotes={'2026-10-19':'1','2026-10-20':'1','2026-10-21':'1'}){
 let s=C.blank('2026-10-19');
 s=C.account(s,{name:'自由',balance:200000,rule:{mode:'none'}},'free-main','2026-10-19');
 s=C.account(s,{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main','2026-10-19');
 s.fundData=data(quotes);return s;
}
test('wechat zero-change confirmation follows the 15:00 trading-day cut-off',()=>{
 assert.equal(C.fundConfirmDate('2026-10-19','14:59'),'2026-10-20');
 assert.equal(C.fundConfirmDate('2026-10-19','15:00'),'2026-10-21');
 assert.equal(C.fundConfirmDate('2026-10-17','10:00'),'2026-10-20');
 assert.equal(C.fundConfirmDate('2026-09-30','10:00'),'2026-10-08');
 assert.equal(C.fundConfirmDate('2026-09-30','15:01'),'2026-10-09');
 assert.equal(C.isTradingDay('2026-10-01'),false);
 assert.equal(C.isTradingDay('2026-10-08'),true);
});
test('a transfer before 15:00 earns from the next trading day, a late transfer one day later',()=>{
 let early=wechatState();
 early=C.transact(early,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:100000,date:'2026-10-20',effectiveDate:'2026-10-20',time:'10:00'});
 let settled=C.settle(early,'2026-10-22');
 assert.deepEqual(pendingAmounts(settled),[100,100,110]);assert.equal(C.balances(settled).savings,1100000);
 settled=confirmAll(settled);assert.equal(C.balances(settled).savings,1100310);
 let late=wechatState({'2026-10-19':'1','2026-10-20':'1','2026-10-21':'1','2026-10-22':'1'});
 late=C.transact(late,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:100000,date:'2026-10-20',effectiveDate:'2026-10-20',time:'15:00'});
 settled=C.settle(late,'2026-10-23');
 assert.deepEqual(pendingAmounts(settled),[100,100,100,110]);assert.equal(C.balances(settled).savings,1100000);
 settled=confirmAll(settled);assert.equal(C.balances(settled).savings,1100410);
});
test('normal redemption earns on its own day, fast redemption does not',()=>{
 const run=method=>{
  let s=wechatState();
  s=C.transact(s,{kind:'transfer',fromAccountId:'savings-main',toAccountId:'free-main',amount:500000,date:'2026-10-20',effectiveDate:'2026-10-20',time:'10:00',outMethod:method});
  return C.settle(s,'2026-10-22');
 };
 const normal=run('normal'),fast=run('fast');
 assert.deepEqual(pendingAmounts(normal),[100,100,50]);assert.deepEqual(pendingAmounts(fast),[100,50,50]);
 assert.equal(C.balances(normal).savings,500000);assert.equal(C.balances(fast).savings,500000);
 assert.equal(C.balances(confirmAll(normal)).savings,500250);assert.equal(C.balances(confirmAll(fast)).savings,500200);
});
test('legacy fund accounts without the initial marker still count their opening balance',()=>{
 const s=wechatState();const opening=s.transactions.find(t=>t.accountId==='savings-main'&&t.kind==='adjustment');delete opening.initial;
 const settled=C.settle(s,'2026-10-20');assert.deepEqual(pendingAmounts(settled),[100]);assert.equal(C.balances(settled).savings,1000000);assert.equal(settled.accounts[0].lastAccruedDate,'2026-10-19');
 assert.equal(C.balances(confirmAll(settled,'2026-10-20')).savings,1000100);
});
test('2024 spring festival starts on New Year eve',()=>{
 assert.equal(C.isTradingDay('2024-02-09'),false);
 assert.equal(C.fundConfirmDate('2024-02-08','10:00'),'2024-02-19');
 assert.equal(C.fundConfirmDate('2024-02-08','15:00'),'2024-02-20');
});
test('withdrawing more than confirmed never creates negative interest',()=>{
 let s=C.blank('2026-10-19');
 s=C.account(s,{name:'自由',balance:600000,rule:{mode:'none'}},'free-main','2026-10-19');
 s=C.account(s,{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main','2026-10-19');
 s.fundData=data({'2026-10-19':'1','2026-10-20':'1','2026-10-21':'1'});
 s=C.transact(s,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:500000,date:'2026-10-20',effectiveDate:'2026-10-20',time:'10:00'});
 s=C.transact(s,{kind:'transfer',fromAccountId:'savings-main',toAccountId:'free-main',amount:1200000,date:'2026-10-20',effectiveDate:'2026-10-20',time:'10:00',outMethod:'fast'});
 const settled=C.settle(s,'2026-10-22');
 assert.deepEqual(pendingAmounts(settled),[100,30]);assert.equal(C.balances(settled).savings,300000);assert.ok(settled.accounts[0].carry>=0);
 assert.equal(C.balances(confirmAll(settled)).savings,300130);
});
test('normal redemption fees do not earn interest',()=>{
 let s=wechatState();
 s=C.transact(s,{kind:'transfer',fromAccountId:'savings-main',toAccountId:'free-main',amount:500000,fee:250,date:'2026-10-20',effectiveDate:'2026-10-20',time:'10:00',outMethod:'normal'});
 const settled=C.settle(s,'2026-10-21');
 assert.deepEqual(pendingAmounts(settled),[100,99]);assert.equal(C.balances(settled).savings,499750);
});
test('migrate repairs negative carry and negative yield left by the 1.6.0 edge',()=>{
 const s=seed();s.accounts[0].carry=-1;
 s.transactions.push({id:'yield_bad',kind:'interest',amount:-19,bucket:'savings',accountId:'savings-main',date:'2026-10-20',effectiveDate:'2026-10-21',createdAt:1,note:'bad',tagIds:[]});
 const fixed=C.migrate(JSON.parse(JSON.stringify(s)));
 assert.equal(fixed.accounts[0].carry,0);assert(!fixed.transactions.some(t=>t.id==='yield_bad'));assert(fixed.deletedInterest.includes('yield_bad'));assert.doesNotThrow(()=>C.validate(fixed));
});
test('restore rejects malformed fund identity, dates and values while old backups remain valid',()=>{
 assert.doesNotThrow(()=>C.validate(seed()));for(const quotes of [{'bad':'1'},{'2026-02-30':'1'},{'2026-10-19':'NaN'},{'2026-10-19':1},{'2026-10-19':'1e3'}]){const s=seed();s.fundData=data(quotes);assert.throws(()=>C.validate(s));}
 const s=seed();s.fundData={...data({}),code:'340005'};assert.throws(()=>C.validate(s));
});
