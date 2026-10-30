const fs=require('node:fs'),path=require('node:path');const C=require('../app/src/main/assets/finance.js'),Legacy=require('../app/src/main/assets/core.js');
const dir=path.join(__dirname,'android/assets');fs.mkdirSync(dir,{recursive:true});
const asOf=C.today(),start=C.addDays(asOf,-3);
const cases=[];
const rules=[{mode:'annual',rate:'3.65'},{mode:'annual',rate:'1.234567',basis:360},{mode:'monthly',rate:'0.28'},{mode:'daily',rate:'0.07',compound:true},{mode:'daily',rate:'0.07',compound:false},{mode:'fixed',fixed:'1.23'},{mode:'formula',rate:'3.65',formula:'本金 * 利率 / 基数 + 0.25'},{mode:'formula',rate:'2.5',formula:'(余额 * 利率 / 360) + 0.013579'}];
for(let i=0;i<rules.length;i++){
  let s=C.account(C.blank(start),{name:'测试账户',balance:1234567,rule:rules[i]},'savings-main',start);
  s.revision=23;
  const next=C.settle(s,asOf);
  cases.push({input:s,asOf,expected:next,balances:C.accountBalances(next)});
}
// A transfer with a fee must produce identical interest, balances and principal on Android.
let feeState=C.account(C.blank(start),{name:'手续费来源',balance:200000,rule:{mode:'daily',rate:'1'}},'free-main',start);
feeState=C.account(feeState,{name:'手续费目标',balance:100000,rule:{mode:'daily',rate:'1'}},'savings-main',start);
feeState=C.transact(feeState,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:10000,fee:250,date:start,effectiveDate:start});
cases.push({input:feeState,asOf,expected:C.settle(feeState,asOf),balances:C.accountBalances(C.settle(feeState,asOf))});
// Simulate replaying an account checkpoint after an automatically generated yield was deleted.
let deletedState=C.account(C.blank(start),{name:'已删除收益',balance:100000,rule:{mode:'fixed',fixed:'1.00'}},'savings-main',start);
deletedState=C.settle(deletedState,C.addDays(start,1));const deletedPending=deletedState.pendingInterest[0];
deletedState=C.confirmInterest(deletedState,deletedPending.id,C.addDays(start,1));deletedState=C.removeTransaction(deletedState,deletedState.transactions.at(-1).id);deletedState.accounts[0].lastAccruedDate=C.addDays(start,-1);
cases.push({input:deletedState,asOf,expected:C.settle(deletedState,asOf),balances:C.accountBalances(C.settle(deletedState,asOf))});
for(const missing of [false,true]){
 let fund=C.account(C.blank(start),{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main',start);
 fund.fundData={code:'017269',source:'xqfunds',updatedAt:1,quotes:{[start]:'0.2663',[C.addDays(start,2)]:'0.2663'}};
 if(!missing)fund.fundData.quotes[C.addDays(start,1)]='0.2097';
 cases.push({input:fund,asOf,expected:C.settle(fund,asOf),balances:C.accountBalances(C.settle(fund,asOf))});
}
// WeChat 零钱通 timing: a morning transfer confirms next trading day; a normal redemption still earns on its day.
let wechat=C.blank(start);
wechat=C.account(wechat,{name:'自由',balance:200000,rule:{mode:'none'}},'free-main',start);
wechat=C.account(wechat,{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main',start);
wechat.fundData={code:'017269',source:'xqfunds',updatedAt:1,quotes:{[start]:'1',[C.addDays(start,1)]:'1',[C.addDays(start,2)]:'1'}};
wechat=C.transact(wechat,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:100000,date:C.addDays(start,1),effectiveDate:C.addDays(start,1),time:'10:00'});
wechat=C.transact(wechat,{kind:'transfer',fromAccountId:'savings-main',toAccountId:'free-main',amount:300000,date:C.addDays(start,2),effectiveDate:C.addDays(start,2),time:'16:00',outMethod:'normal'});
cases.push({input:wechat,asOf,expected:C.settle(wechat,asOf),balances:C.accountBalances(C.settle(wechat,asOf))});
// Withdrawing beyond confirmed shares must clamp at zero instead of producing negative interest.
let over=C.blank(start);
over=C.account(over,{name:'自由',balance:600000,rule:{mode:'none'}},'free-main',start);
over=C.account(over,{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main',start);
over.fundData={code:'017269',source:'xqfunds',updatedAt:1,quotes:{[start]:'1',[C.addDays(start,1)]:'1',[C.addDays(start,2)]:'1',[C.addDays(start,3)]:'1'}};
over=C.transact(over,{kind:'transfer',fromAccountId:'free-main',toAccountId:'savings-main',amount:500000,date:C.addDays(start,1),effectiveDate:C.addDays(start,1),time:'10:00'});
over=C.transact(over,{kind:'transfer',fromAccountId:'savings-main',toAccountId:'free-main',amount:1200000,date:C.addDays(start,1),effectiveDate:C.addDays(start,1),time:'10:00',outMethod:'fast'});
cases.push({input:over,asOf,expected:C.settle(over,asOf),balances:C.accountBalances(C.settle(over,asOf))});
// Fund dividends are reinvested before bookkeeping confirmation, including during a multi-day catch-up.
let reinvest=C.account(C.blank(start),{name:'零钱通复利',balance:1000000,rule:{mode:'fund'}},'savings-main',start);
reinvest.fundData={code:'017269',source:'xqfunds',updatedAt:1,quotes:{[start]:'100',[C.addDays(start,1)]:'100',[C.addDays(start,2)]:'100'}};
cases.push({input:reinvest,asOf,expected:C.settle(reinvest,asOf),balances:C.accountBalances(C.settle(reinvest,asOf))});
// A calculation error must leave the checkpoint at the previous successful day in both engines.
let formulaError=C.account(C.blank(start),{name:'公式错误',balance:10000,rule:{mode:'formula',formula:'本金 / (余额 - 50)'}},'savings-main',start);
formulaError=C.transact(formulaError,{kind:'expense',accountId:'savings-main',amount:5000,date:C.addDays(start,1),effectiveDate:C.addDays(start,1)});
cases.push({input:formulaError,asOf,expected:C.settle(formulaError,asOf),balances:C.accountBalances(C.settle(formulaError,asOf))});
// Removed accounts retain historical transactions but must never accrue again in the native background engine.
let archived=C.account(C.blank(start),{name:'已删除账户',bucket:'savings',balance:10000,rule:{mode:'fixed',fixed:'1'}},null,start);
archived=C.removeAccount(archived,archived.accounts.at(-1).id,start);
cases.push({input:archived,asOf,expected:C.settle(archived,asOf),balances:C.accountBalances(C.settle(archived,asOf))});
fs.writeFileSync(path.join(dir,'interest-fixtures.json'),JSON.stringify(cases));
let old=Legacy.setBalances(Legacy.blank(),100000,50000);old=Legacy.transact(old,{kind:'expense',bucket:'free',amount:2850,note:'升级保留备注'});
fs.writeFileSync(path.join(dir,'v1-backup.json'),JSON.stringify(old));
console.log('Generated',cases.length,'cross-engine fixtures and a v1 upgrade fixture.');
