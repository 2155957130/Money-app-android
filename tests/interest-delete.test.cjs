const {test}=require('node:test');const assert=require('node:assert/strict');const C=require('../app/src/main/assets/insights.js');
const D='2026-10-19';
const funded=()=>C.account(C.blank(D),{name:'测试收益',balance:100000,rule:{mode:'fixed',fixed:'1.00'}},'savings-main',D);
function confirmAll(s,asOf){let next=s;for(const p of [...(s.pendingInterest||[])].sort((a,b)=>a.date.localeCompare(b.date)))next=C.confirmInterest(next,p.id,asOf);return next;}
test('confirmed interest can be deleted and updates total, month report and linked plan together',()=>{
 let s=C.plan(funded(),{name:'收益积累',target:1000,daily:100,time:'21:00',accountId:'savings-main'});s=C.settle(s,'2026-10-20');
 assert.equal(s.pendingInterest.length,1);assert.equal(C.progress(s.plans[0],s),0);
 s=confirmAll(s,'2026-10-20');const tx=s.transactions.at(-1);
 assert.equal(C.progress(s.plans[0],s),100);s=C.removeTransaction(s,tx.id);C.validate(s);
 assert.equal(C.balances(s).savings,100000);assert.equal(C.monthlyReport(s,'2026-10').interest,0);assert.equal(C.progress(s.plans[0],s),0);assert(s.deletedInterest.includes(tx.id));
});
test('a deleted confirmed interest stays removed after reload, catchup replay and backup roundtrip',()=>{
 let s=C.settle(funded(),'2026-10-20');const id=s.pendingInterest[0].id;s=C.confirmInterest(s,id,'2026-10-20');s=C.removeTransaction(s,id);s=C.migrate(JSON.parse(JSON.stringify(s)));s.accounts[0].lastAccruedDate=C.addDays(D,-1);
 s=C.settle(s,'2026-10-21');assert.equal(s.transactions.some(t=>t.id===id),false);assert.deepEqual(s.pendingInterest.map(p=>[p.date,p.amount]),[['2026-10-20',100]]);assert.equal(C.balances(s).savings,100000);C.validate(s);
});
test('spent interest cannot be removed if that would make account negative; rejection is atomic',()=>{
 let s=confirmAll(C.settle(funded(),'2026-10-20'),'2026-10-20');const id=s.transactions.at(-1).id;s=C.transact(s,{kind:'expense',accountId:'savings-main',amount:100100,date:'2026-10-20'});const before=JSON.stringify(s);assert.throws(()=>C.removeTransaction(s,id));assert.equal(JSON.stringify(s),before);
});
test('deletion markers are validated and deleting ordinary cash flow does not mark interest',()=>{
 let s=funded();s=C.removeTransaction(s,s.transactions[0].id);assert.equal(s.deletedInterest,undefined);
 for(const value of [null,{},['x','x'],['bad/path']])assert.throws(()=>C.validate({...funded(),deletedInterest:value}));
});
