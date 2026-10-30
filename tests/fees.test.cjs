const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../app/src/main/assets/insights.js');
const D='2026-10-20';
const funded=()=>C.account(C.account(C.blank(D),{name:'银行卡',balance:100000,rule:{mode:'daily',rate:'1'}},'savings-main',D),{name:'微信',balance:200000,rule:{mode:'daily',rate:'1'}},'free-main',D);
const transfer=(s,fee=250)=>C.transact(s,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:10000,fee,date:D,effectiveDate:D,note:'转存'});
function confirmAll(s,asOf){let next=s;for(const p of [...(s.pendingInterest||[])].sort((a,b)=>a.date.localeCompare(b.date)))next=C.confirmInterest(next,p.id,asOf);return next;}
test('a transfer fee reduces only the source balance, total assets and monthly cash flow once',()=>{
 const initial=funded(),s=transfer(initial);C.validate(s);
 assert.deepEqual(C.accountBalances(s),{'savings-main':110000,'free-main':189750});
 const r=C.monthlyReport(s,'2026-10');assert.equal(r.expense,250);assert.equal(r.fees,250);assert.equal(r.net,-250);assert.equal(r.count,1);assert.equal(r.tags[0].amount,250);assert.equal(r.closing,299750);
 assert.deepEqual(C.balances(C.removeTransaction(s,s.transactions.at(-1).id)),C.balances(initial));
 assert.deepEqual(C.balances(C.migrate(JSON.parse(JSON.stringify(s)))),C.balances(s));
});
test('fees participate in linked plan progress, allocation sources and both accounts interest principal',()=>{
 let s=C.plan(funded(),{name:'保留自由',accountId:'free-main',target:100000,daily:100,time:'21:00'});
 s=C.transact(s,{kind:'income',accountId:'free-main',amount:20000,date:D,effectiveDate:D});s=transfer(s);
 assert.equal(C.progress(s.plans[0],s),9750);assert.equal(C.paidToday(s.plans[0],D,s),9750);
 const total=Object.values(C.balances(s)).reduce((a,b)=>a+b,0);assert.equal(total,319750);assert.equal(C.allocate(total,[{name:'全部',percent:'100'}])[0].amount,total);
 const next=confirmAll(C.settle(s,'2026-10-21'),'2026-10-21');assert.equal(C.accountBalances(next)['free-main'],211847);assert.equal(C.accountBalances(next)['savings-main'],111100);
});
test('insufficient funds including the fee reject atomically; invalid fees and restored fees are rejected',()=>{
 const s=funded(),before=JSON.stringify(s);assert.throws(()=>transfer(s,195000));assert.equal(JSON.stringify(s),before);
 for(const fee of [-1,0.5,'2',null,NaN,C.LIMIT+1])assert.throws(()=>transfer(s,fee));
 const bad=transfer(s);bad.transactions.at(-1).fee=-1;assert.throws(()=>C.validate(bad));
});
test('older transfers with no fee and new zero fee transfers retain their original behavior',()=>{
 const s=transfer(funded(),0);delete s.transactions.at(-1).fee;C.validate(s);assert.equal(C.monthlyReport(s,'2026-10').fees,0);assert.equal(C.monthlyReport(s,'2026-10').expense,0);assert.equal(C.accountBalances(s)['free-main'],190000);
});
