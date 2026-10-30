const test=require('node:test'),assert=require('node:assert/strict'),C=require('../app/src/main/assets/insights.js');
const day='2026-10-19';
function seeded(){let s=C.account(C.blank(day),{name:'基础存款',balance:100000,rule:{}},'savings-main',day);s=C.account(s,{name:'零钱通',bucket:'savings',balance:40000,sourceId:'savings-main',rule:{mode:'fund'}},null,day);return s;}
test('deleting a funded custom account preserves total assets and historical records',()=>{
 let s=seeded(),a=s.accounts.at(-1),before=C.balances(s),history=s.transactions.length;
 s=C.removeAccount(s,a.id,day);C.validate(s);
 assert.deepEqual(C.balances(s),before);assert.equal(C.accountBalances(s)[a.id],0);assert.equal(C.accountBalances(s)['savings-main'],100000);
 assert.equal(s.accounts.find(x=>x.id===a.id).archived,true);assert.equal(s.transactions.length,history+1);
 assert(s.transactions.some(t=>t.toAccountId===a.id));assert(s.transactions.some(t=>t.fromAccountId===a.id));
 assert.throws(()=>C.transact(s,{kind:'income',accountId:a.id,amount:100}));
 assert.throws(()=>C.account(s,{name:'重开',rule:{}},a.id,day));
 assert.throws(()=>C.removeAccount(s,'savings-main',day));
});
test('deletion clears pending estimates without changing confirmed historical income',()=>{
 let s=seeded(),a=s.accounts.at(-1);s.fundData={code:'017269',source:'xqfunds',updatedAt:1,quotes:{[day]:'1'}};
 s=C.settle(s,'2026-10-20');const pending=s.pendingInterest.find(p=>p.accountId===a.id);assert(pending);
 s=C.removeAccount(s,a.id,'2026-10-20');C.validate(s);
 assert(!s.pendingInterest.some(p=>p.accountId===a.id));assert(s.deletedInterest.includes(pending.id));
 assert.equal(C.balances(s).savings,100000);
});
test('linked plans and future transactions prevent deletion',()=>{
 let s=seeded(),a=s.accounts.at(-1);
 s=C.plan(s,{name:'旅行',daily:100,target:10000,time:'21:00',accountId:a.id});
 assert.throws(()=>C.removeAccount(s,a.id,day),/计划/);
 s={...s,plans:[]};s=C.transact(s,{kind:'income',accountId:a.id,amount:100,date:'2026-10-21',effectiveDate:'2026-10-21'});
 assert.throws(()=>C.removeAccount(s,a.id,day),/未来/);
});
