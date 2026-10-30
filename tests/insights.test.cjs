const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../app/src/main/assets/insights.js'),Old=require('../app/src/main/assets/finance.js');
const D='2026-10-01';
const seed=()=>C.account(C.blank(D),{name:'银行卡',balance:100000,rule:{}},'savings-main',D);
test('v1.1 data gets empty tags while preserving all amounts and settings',()=>{const old=Old.setBalances(Old.blank(D),100000,50000);const next=C.migrate(old,D);assert.deepEqual(next.tags,[]);assert(next.transactions.every(t=>Array.isArray(t.tagIds)));assert.deepEqual(C.balances(next),Old.balances(old));});
test('custom multi-tags, renames and removal keep stable references without changing money',()=>{
  let s=C.tag(C.tag(seed(),'餐饮'),'工作日');const ids=s.tags.map(t=>t.id);s=C.transact(s,{kind:'expense',accountId:'savings-main',amount:2850,tagIds:ids});const before=C.balances(s);
  assert.deepEqual(s.transactions.at(-1).tagIds,ids);s=C.tag(s,'外出餐饮',ids[0]);assert.equal(s.tags[0].name,'外出餐饮');assert.throws(()=>C.tag(s,'工作日'));
  s=C.removeTag(s,ids[0]);assert.deepEqual(s.transactions.at(-1).tagIds,[ids[1]]);assert.deepEqual(C.balances(s),before);C.validate(s);
  assert.throws(()=>C.transact(s,{kind:'income',accountId:'savings-main',amount:100,tagIds:['missing']}));
});
test('asset chart reconciles ledger deltas, adjustments and internal transfers',()=>{
  let s=seed();s=C.transact(s,{kind:'income',accountId:'free-main',amount:50000,effectiveDate:'2026-10-02',date:'2026-10-02'});s=C.transact(s,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:10000,effectiveDate:'2026-10-03'});s=C.transact(s,{kind:'expense',accountId:'savings-main',amount:2000,effectiveDate:'2026-10-04'});
  assert.deepEqual(C.assetSeries(s,'2026-10-01','2026-10-05').map(p=>p.total),[100000,150000,150000,148000,148000]);assert.equal(C.balances(s).savings+C.balances(s).free,148000);
});
test('monthly reports distinguish cash flow, adjustments and multiple tag membership',()=>{
  let s=C.tag(C.tag(seed(),'餐饮'),'日常');const ids=s.tags.map(t=>t.id);
  s=C.transact(s,{kind:'income',accountId:'savings-main',amount:10000,date:'2026-10-02',effectiveDate:'2026-10-02'});s=C.transact(s,{kind:'expense',accountId:'savings-main',amount:2000,date:'2026-10-03',effectiveDate:'2026-10-03',tagIds:ids});
  const r=C.monthlyReport(s,'2026-10');assert.equal(r.income,10000);assert.equal(r.expense,2000);assert.equal(r.net,8000);assert.equal(r.adjustment,100000);assert.equal(r.opening,0);assert.equal(r.closing,108000);assert.equal(r.change,108000);assert.equal(r.count,2);assert.deepEqual(r.tags.map(t=>t.amount),[2000,2000]);
  const next=C.monthlyReport(s,'2026-11');assert.equal(next.opening,next.closing);assert.equal(next.count,0);assert.throws(()=>C.monthlyReport(s,'2026-13'));
});
test('backup preview validates all tag references and reports exact contents',()=>{let s=C.tag(seed(),'工资');s=C.transact(s,{kind:'income',accountId:'savings-main',amount:100,tagIds:[s.tags[0].id]});const p=C.preview(s);assert.equal(p.total,100100);assert.equal(p.transactions,2);assert.equal(p.tags,1);const bad=JSON.parse(JSON.stringify(s));bad.transactions[0].tagIds=['no'];assert.throws(()=>C.preview(bad));});
