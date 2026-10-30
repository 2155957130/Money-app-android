(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./core.js'):root.Ledger);if(typeof module==='object'&&module.exports)module.exports=api;else root.Ledger=api;})(typeof globalThis!=='undefined'?globalThis:this,function(old){
  'use strict';
  const {LIMIT,id,today,cents,money,raw,calculate,allocate}=old;
  const fail=m=>{throw new Error(m);},MICRO=1000000n;
  const clone=s=>JSON.parse(JSON.stringify(s));
  const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,99}$/.test(s);
  function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s;}
  function addDays(s,n){if(!validDate(s))fail('日期无效');const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function nowTime(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  // Closed days on the Shanghai/Shenzhen exchanges and China's fund market. Weekends are closed as well.
  // 2027 rules are not published yet; unknown years fall back to weekends only.
  const HOLIDAYS=[
    ['2024-01-01','2024-01-01'],['2024-02-09','2024-02-17'],['2024-04-04','2024-04-06'],['2024-05-01','2024-05-05'],['2024-06-08','2024-06-10'],['2024-09-15','2024-09-17'],['2024-10-01','2024-10-07'],
    ['2025-01-01','2025-01-01'],['2025-01-28','2025-02-04'],['2025-04-04','2025-04-06'],['2025-05-01','2025-05-05'],['2025-05-31','2025-06-02'],['2025-10-01','2025-10-08'],
    ['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07'],
    ['2027-01-01','2027-01-01']
  ];
  function isTradingDay(date){
    if(!validDate(date))return false;
    const week=new Date(date+'T12:00:00Z').getUTCDay();if(week===0||week===6)return false;
    return !HOLIDAYS.some(([from,to])=>date>=from&&date<=to);
  }
  function nextTradingDay(date){
    let next=addDays(date,1);
    for(let i=0;i<60&&!isTradingDay(next);i++)next=addDays(next,1);
    return next;
  }
  /** WeChat 零钱通: before 15:00 on a trading day, shares confirm the next trading day; otherwise one more day later. */
  function fundConfirmDate(date,time='12:00',initial=false){
    if(initial)return date;
    const beforeCutoff=(time||'12:00')<'15:00';
    const order=isTradingDay(date)&&beforeCutoff?date:nextTradingDay(date);
    return nextTradingDay(order);
  }
  function initialFundTransaction(a,t){return t.initial===true||(t.initial===undefined&&!t.time&&t.effectiveDate<=a.openedOn);}
  /** First day on which this inflow earns interest. */
  function fundEarnStart(a,t){
    if(t.kind==='transfer'&&t.toAccountId===a.id)return initialFundTransaction(a,t)?t.effectiveDate:fundConfirmDate(t.effectiveDate,t.time);
    if(t.kind==='income'&&t.accountId===a.id)return initialFundTransaction(a,t)?t.effectiveDate:fundConfirmDate(t.effectiveDate,t.time);
    return t.effectiveDate;
  }
  /** Last day on which this outflow still earns interest. Normal redemption earns on its own day; fast redemption and payments do not. */
  function fundEarnEnd(a,t){
    if(t.kind==='transfer'&&t.fromAccountId===a.id&&t.outMethod==='normal')return t.effectiveDate;
    return addDays(t.effectiveDate,-1);
  }
  /** Confirmed balance that actually earns interest on the given day. */
  function fundBalance(s,a,date){
    let balance=0n;
    for(const t of s.transactions){
      const delta=deltas(t)[a.id]||0;if(!delta)continue;
      if(delta>0){if(t.kind==='interest'&&t.yieldMode==='fund'&&t.sourceDate){if(t.sourceDate<date)balance+=BigInt(delta);}else if(fundEarnStart(a,t)<=date)balance+=BigInt(delta);}
      else{
        const end=fundEarnEnd(a,t);
        if(date>end)balance+=BigInt(delta);
        else if(date===end&&t.kind==='transfer'&&t.fromAccountId===a.id&&t.outMethod==='normal'&&t.fee)balance-=BigInt(t.fee);
      }
    }
    for(const p of s.pendingInterest||[])if(p.accountId===a.id&&p.yieldMode==='fund'&&p.date<date)balance+=BigInt(p.amount);
    return Math.max(0,Number(balance));
  }
  const defaultId=b=>b+'-main';
  const afterTransactions=s=>s.transactions.reduce((n,t)=>Math.max(n,t.createdAt+1),Date.now());
  function rule(data={}){
    const r={mode:data.mode||'none',rate:String(data.rate||'0'),basis:Number(data.basis||365),compound:!!data.compound,fixed:String(data.fixed||'0'),formula:String(data.formula||'本金 * 利率 / 基数').trim()};
    if(!['none','annual','monthly','daily','fixed','formula','fund'].includes(r.mode))fail('请选择计息方式');
    if(!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(r.rate)||Number(r.rate)>1000)fail('利率须为 0～1000%，最多六位小数');
    if(![360,365].includes(r.basis))fail('年计息基数须为 360 或 365 天');
    cents(r.fixed,true);
    if(r.formula.length>150)fail('公式最多 150 个字符');
    formula(r,10000,10000);
    return r;
  }
  function baseAccount(bucket,asOf=today()){return {id:defaultId(bucket),bucket,name:bucket==='savings'?'未分类存款':'未分类自由',rule:rule(),openedOn:asOf,lastAccruedDate:addDays(asOf,-1),carry:0,error:''};}
  function blank(asOf=today()){return {version:2,revision:0,accounts:[baseAccount('savings',asOf),baseAccount('free',asOf)],transactions:[],pendingInterest:[],plans:[],settings:{reminders:true},allocation:{source:'total',customTotal:'',rows:[{name:'存款',percent:'70'},{name:'自由',percent:'30'}]}};}
  function migrate(input,asOf=today()){
    if(input.version===2){
      // Repair the rare 1.6.0 edge where a negative confirmed balance produced a negative carry or negative yield record.
      let next=input;
      const accounts=Array.isArray(input.accounts)?input.accounts:null,transactions=Array.isArray(input.transactions)?input.transactions:null;
      const badCarry=accounts&&accounts.some(a=>a&&Number.isInteger(a.carry)&&a.carry<0);
      const removed=transactions?transactions.filter(t=>t&&t.kind==='interest'&&Number.isFinite(t.amount)&&t.amount<0):[];
      if(badCarry||removed.length){
        next={...input,
          accounts:badCarry?accounts.map(a=>a&&Number.isInteger(a.carry)&&a.carry<0?{...a,carry:0}:a):accounts,
          transactions:removed.length?transactions.filter(t=>!(t&&t.kind==='interest'&&Number.isFinite(t.amount)&&t.amount<0)):transactions
        };
        if(removed.length)next.deletedInterest=[...new Set([...(Array.isArray(input.deletedInterest)?input.deletedInterest:[]),...removed.map(t=>t.id).filter(Boolean)])];
      }
      return validate(next);
    }
    old.validate(input);const s={...blank(asOf),transactions:clone(input.transactions),plans:clone(input.plans),settings:clone(input.settings)};
    s.transactions=s.transactions.map(t=>t.kind==='transfer'?{...t,fromAccountId:defaultId('free'),toAccountId:defaultId('savings'),effectiveDate:t.date}:{...t,accountId:defaultId(t.bucket),effectiveDate:t.date});
    const savings=accountBalances(s)[defaultId('savings')],linkedAt=afterTransactions(s);
    s.plans=s.plans.map(p=>({...p,entries:p.entries.map(e=>({...e,legacy:true})),accountId:defaultId('savings'),baseline:savings-p.entries.reduce((n,e)=>n+e.amount,0),createdAt:linkedAt}));
    return validate(s);
  }
  function deltas(t){return t.kind==='transfer'?{[t.fromAccountId]:-t.amount-(t.fee||0),[t.toAccountId]:t.amount}:{[t.accountId]:t.kind==='expense'?-t.amount:t.amount};}
  function accountBalances(s,date=null){const b=Object.fromEntries(s.accounts.map(a=>[a.id,0n]));for(const t of s.transactions){if(date&&t.effectiveDate>date)continue;for(const [key,value] of Object.entries(deltas(t)))b[key]=(b[key]||0n)+BigInt(value);}return Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Number(v)]));}
  function balances(s){const b=accountBalances(s);return s.accounts.reduce((tot,a)=>{tot[a.bucket]+=b[a.id];return tot;},{savings:0,free:0});}
  function check(s){const b=accountBalances(s);let total=0;for(const a of s.accounts){if(!Number.isSafeInteger(b[a.id])||b[a.id]<0||b[a.id]>LIMIT)fail('明细账户余额不足或金额超出范围');total+=b[a.id];}if(total>LIMIT)fail('总资产超过可支持范围');return s;}
  function principal(s,accountId,date=null){
    let balance=0,interest=0;
    const list=s.transactions.filter(t=>!date||t.effectiveDate<=date).slice().sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.createdAt-b.createdAt);
    for(const t of list){const delta=deltas(t)[accountId]||0;balance+=delta;if(t.kind==='interest')interest+=delta;if(delta<0)interest=Math.min(interest,Math.max(0,balance));}
    return Math.max(0,balance-interest);
  }
  function formula(r,p,b){
    if(r.mode!=='formula')return 0;
    const expression=r.formula.replace(/本金/g,raw(p)).replace(/余额/g,raw(b)).replace(/利率/g,String(Number(r.rate)/100)).replace(/基数/g,String(r.basis));
    const value=calculate(expression);if(value<0)fail('每日收益公式的结果不能小于 0');return value;
  }
  function dailyMicros(s,a,date=null){
    const r=a.rule,b=accountBalances(s,date)[a.id],p=principal(s,a.id,date);
    if(r.mode==='none')return 0n;
    if(r.mode==='fund'){
      const value=s.fundData?.quotes?.[date];if(value===undefined)fail('等待官方公布 '+date+' 万份收益');
      if(Number(value)<0)fail('该日为负收益，请核对实际到账后手动记账');
      const [whole,dec='']=value.split('.');const confirmed=fundBalance(s,a,date);return BigInt(confirmed)*(BigInt(whole)*1000000n+BigInt(dec.padEnd(6,'0')))/10000n;
    }
    if(r.mode==='fixed')return BigInt(cents(r.fixed,true))*MICRO;
    if(r.mode==='formula')return BigInt(Math.round(formula(r,p,b)*100000000));
    const [whole,dec='']=r.rate.split('.'),units=BigInt(whole)*1000000n+BigInt(dec.padEnd(6,'0'));
    const divisor=r.mode==='annual'?r.basis:r.mode==='monthly'?30:1;
    return BigInt(r.compound?b:p)*units/(100n*BigInt(divisor));
  }
  function interestPreview(s,a){try{return Number(dailyMicros(s,a))/100000000;}catch(error){return null;}}
  /** Latest published 万份收益 plus a 7-day annualized estimate from the same official quotes. */
  function fundStats(s){
    const quotes=s.fundData?.quotes;if(!quotes)return null;
    const days=Object.keys(quotes).sort();if(!days.length)return null;
    const date=days[days.length-1];let annualized=null;
    if(days.length>=7){
      const window=days.slice(-7);let contiguous=true;
      for(let i=1;i<window.length;i++)if(window[i]!==addDays(window[0],i)){contiguous=false;break;}
      if(contiguous){const total=window.reduce((n,d)=>n+Number(quotes[d]),0);annualized=total/7/10000*365*100;}
    }
    return {date,income:quotes[date],annualized,updatedAt:s.fundData.updatedAt||0,count:days.length};
  }
  function settle(input,asOf=today()){
    if(!validDate(asOf))fail('日期无效');const through=addDays(asOf,-1);
    if(input.accounts.every(a=>a.lastAccruedDate>=through))return input;
    const s=clone(input);
    for(const a of s.accounts){
      if(a.archived||a.lastAccruedDate>=through)continue;
      if(a.rule.mode==='none'){a.lastAccruedDate=through;a.error='';continue;}
      let day=addDays(a.lastAccruedDate,1),loops=0;
      while(day<=through){
        if(++loops>36600)fail('计息区间超过 100 年，请检查手机日期');
        try{
          const credit=dailyMicros(s,a,day)+BigInt(a.carry),amount=Number(credit/MICRO);
          if(amount){
            const tid='yield_'+a.id+'_'+day.replace(/-/g,'');
            if(!s.transactions.some(x=>x.id===tid)&&!(s.deletedInterest||[]).includes(tid)){
              s.pendingInterest=s.pendingInterest||[];
              if(!s.pendingInterest.some(x=>x.id===tid)){
                if(s.pendingInterest.length>=100000)fail('待确认利息过多，请先处理');
                s.pendingInterest.push({id:tid,accountId:a.id,bucket:a.bucket,amount,date:day,createdAt:Date.parse(addDays(day,1)+'T00:00:00'),note:'待确认利息 · '+a.name+' · '+day,...(a.rule.mode==='fund'?{yieldMode:'fund'}:{})});
              }
            }
          }
          a.carry=Number(credit%MICRO);a.error='';
        }catch(error){a.error=day+'：'+error.message;break;}
        a.lastAccruedDate=day;day=addDays(day,1);
      }
    }
    return JSON.stringify(s)===JSON.stringify(input)?input:s;
  }
  function confirmInterest(s,id,asOf=today(),actualAmount=null){
    if(!validDate(asOf))fail('日期无效');
    const pending=s.pendingInterest||[],p=pending.find(x=>x.id===id);if(!p)fail('待确认利息不存在');
    if(actualAmount!==null&&(p.yieldMode!=='fund'||!Number.isSafeInteger(actualAmount)||actualAmount<=0||actualAmount>LIMIT))fail('实际收益金额无效');
    const account=s.accounts.find(a=>a.id===p.accountId);if(!account)fail('利息账户不存在');
    const rest=pending.filter(x=>x.id!==id);
    if(s.transactions.some(t=>t.id===id))return {...s,pendingInterest:rest};
    if(s.transactions.length>=100000)fail('记录数量过多，请先导出备份');
    const amount=actualAmount===null?p.amount:actualAmount;
    const fund=p.yieldMode==='fund',postedOn=fund?addDays(p.date,1):asOf;
    const note=fund?postedOn+' 的利息（'+p.date+' 产生）':p.date+' 的收益';
    const original=p.estimatedAmount??p.amount;
    const t={id:p.id,kind:'interest',bucket:p.bucket,accountId:p.accountId,amount,date:postedOn,effectiveDate:postedOn,createdAt:Date.now(),note:note+(amount!==original?'（原估算 ¥'+raw(original)+'）':''),tagIds:[],...(fund?{yieldMode:'fund',sourceDate:p.date}:{})};
    return check({...s,transactions:[...s.transactions,t],pendingInterest:rest});
  }
  function editPendingInterest(s,id,amount){
    const pending=s.pendingInterest||[],p=pending.find(x=>x.id===id);if(!p)fail('待确认利息不存在');
    if(!Number.isSafeInteger(amount)||amount<=0||amount>LIMIT)fail('利息金额须大于 0 元；没有收益可点忽略');
    if(amount===p.amount)return s;
    const original=p.estimatedAmount??p.amount;
    const edited={...p,amount};
    if(amount===original)delete edited.estimatedAmount;else edited.estimatedAmount=original;
    return {...s,pendingInterest:pending.map(x=>x.id===id?edited:x)};
  }
  function ignoreInterest(s,id){
    const pending=s.pendingInterest||[];if(!pending.some(x=>x.id===id))fail('待确认利息不存在');
    return {...s,pendingInterest:pending.filter(x=>x.id!==id),deletedInterest:[...new Set([...(s.deletedInterest||[]),id])]};
  }
  function transact(s,data){
    if(!['income','expense','transfer','adjustment'].includes(data.kind))fail('无效交易类型');
    if(!Number.isSafeInteger(data.amount)||!data.amount||Math.abs(data.amount)>LIMIT||(data.kind!=='adjustment'&&data.amount<0))fail('金额无效');
    const effectiveDate=data.effectiveDate||today(),date=data.date||today();if(!validDate(date)||!validDate(effectiveDate))fail('日期无效');
    const createdAt=s.plans.reduce((n,p)=>Math.max(n,(p.createdAt||0)+1),Date.now());
    const t={id:id(),kind:data.kind,amount:data.amount,note:String(data.note||'').trim().slice(0,200),date,effectiveDate,createdAt};
    if(data.time!==undefined&&data.time!==null&&data.time!==''){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))fail('账单时间无效');t.time=data.time;}
    if(data.initial===true)t.initial=true;
    if(t.kind==='transfer'){
      t.fromAccountId=data.fromAccountId||defaultId('free');t.toAccountId=data.toAccountId||defaultId('savings');
      if(t.fromAccountId===t.toAccountId||![t.fromAccountId,t.toAccountId].every(id=>s.accounts.some(a=>a.id===id&&!a.archived)))fail('请选择不同的转出、转入账户');
      t.fee=data.fee===undefined?0:data.fee;
      if(!Number.isSafeInteger(t.fee)||t.fee<0||t.fee>LIMIT)fail('手续费须为有效的非负金额');
      if(data.outMethod!==undefined){if(!['normal','fast'].includes(data.outMethod))fail('转出方式无效');t.outMethod=data.outMethod;}
      t.bucket=s.accounts.find(a=>a.id===t.toAccountId).bucket;
    }else{t.accountId=data.accountId||defaultId(data.bucket);const a=s.accounts.find(a=>a.id===t.accountId&&!a.archived);if(!a)fail('请选择明细账户');t.bucket=a.bucket;}
    if(data.planId)t.planId=data.planId;
    return check({...s,transactions:[...s.transactions,t]});
  }
  function setBalances(s,savings,free){
    if(![savings,free].every(n=>Number.isSafeInteger(n)&&n>=0)||savings+free>LIMIT)fail('余额无效');
    const b=balances(s);let next=s;
    for(const key of ['savings','free']){const delta=(key==='savings'?savings:free)-b[key];if(delta)next=transact(next,{kind:'adjustment',bucket:key,amount:delta,note:'手动设置余额'});}
    return next;
  }
  function account(s,data,editId,asOf=today()){
    const name=String(data.name||'').trim();if(!name||name.length>40)fail('账户名称需为 1～40 个字');
    let next=settle(s,asOf),existing=editId&&next.accounts.find(a=>a.id===editId);
    if(editId&&(!existing||existing.archived))fail('账户不存在');
    const bucket=existing?existing.bucket:data.bucket;if(!['savings','free'].includes(bucket))fail('请选择资产类别');
    const a=existing?{...existing,name,rule:rule(data.rule),error:''}:{...baseAccount(bucket,asOf),id:id(),name,rule:rule(data.rule)};
    if(existing&&existing.rule.mode!==a.rule.mode&&(existing.rule.mode==='fund'||a.rule.mode==='fund')){a.lastAccruedDate=addDays(asOf,-1);a.carry=0;}
    // Validate custom formulas against the real balance as well as their syntax.
    const desired=data.balance===undefined?(existing?accountBalances(next)[a.id]:0):data.balance;
    if(!Number.isSafeInteger(desired)||desired<0||desired>LIMIT)fail('请输入有效余额');
    if(a.rule.mode==='formula')formula(a.rule,desired,desired);
    next={...next,accounts:existing?next.accounts.map(x=>x.id===a.id?a:x):[...next.accounts,a]};
    const delta=desired-(existing?accountBalances(next)[a.id]:0);
    if(delta){
      if(!existing&&data.sourceId){if(!next.accounts.some(x=>x.id===data.sourceId&&!x.archived))fail('来源账户不存在');next=transact(next,{kind:'transfer',fromAccountId:data.sourceId,toAccountId:a.id,amount:delta,note:'明细划分 · '+name,effectiveDate:asOf,initial:true});}
      else next=transact(next,{kind:'adjustment',accountId:a.id,amount:delta,note:existing?'调整账户余额 · '+name:'初始余额 · '+name,effectiveDate:asOf,initial:!existing});
    }
    return check(next);
  }
  function removeAccount(s,accountId,asOf=today()){
    if(!validDate(asOf))fail('日期无效');
    const a=s.accounts.find(x=>x.id===accountId&&!x.archived);
    if(!a||a.id===defaultId(a.bucket))fail('只能删除自己新增的账户');
    if(s.plans.some(p=>p.accountId===accountId))fail('此账户关联了存钱计划，请先修改或删除计划');
    if(s.transactions.some(t=>t.effectiveDate>asOf&&deltas(t)[accountId]))fail('此账户有未来日期账单，请先处理这些账单');
    let next=settle(s,asOf);
    const balance=accountBalances(next)[accountId],target=defaultId(a.bucket);
    if(balance>0)next=transact(next,{kind:'transfer',fromAccountId:accountId,toAccountId:target,amount:balance,note:'删除明细账户 · '+a.name,effectiveDate:asOf,initial:true});
    const pending=(next.pendingInterest||[]).filter(p=>p.accountId===accountId);
    next={...next,accounts:next.accounts.map(x=>x.id===accountId?{...x,archived:true,rule:rule(),carry:0,error:'',lastAccruedDate:addDays(asOf,-1)}:x),pendingInterest:(next.pendingInterest||[]).filter(p=>p.accountId!==accountId),deletedInterest:[...new Set([...(next.deletedInterest||[]),...pending.map(p=>p.id)])]};
    return check(next);
  }
  const entryProgress=p=>p.entries.reduce((n,e)=>n+e.amount,0);
  function progress(p,s){return p.accountId&&s?Math.max(0,accountBalances(s)[p.accountId]-p.baseline):entryProgress(p);}
  const complete=(p,s)=>p.target!==null&&progress(p,s)>=p.target;
  function paidToday(p,date=today(),s){
    if(p.accountId&&s){let net=0;for(const t of s.transactions)if(t.effectiveDate===date&&t.createdAt>=p.createdAt)net+=deltas(t)[p.accountId]||0;for(const e of p.entries)if(e.date===date&&(e.legacy||e.createdAt<p.createdAt))net+=e.amount;return Math.max(0,net);}
    return p.entries.filter(e=>e.date===date).reduce((n,e)=>n+e.amount,0);
  }
  function plan(s,data,editId){
    const name=String(data.name||'').trim();if(!name||name.length>40)fail('计划名称需为 1～40 个字');
    if(data.target!==null&&(!Number.isSafeInteger(data.target)||data.target<=0||data.target>LIMIT))fail('目标金额无效');
    if(!Number.isSafeInteger(data.daily)||data.daily<=0||data.daily>LIMIT)fail('每日金额无效');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))fail('提醒时间无效');
    const prev=editId?s.plans.find(p=>p.id===editId):null;if(editId&&!prev)fail('计划不存在');
    const accountId=data.accountId===undefined?(prev?.accountId||defaultId('savings')):data.accountId;
    if(!accountId||!s.accounts.some(a=>a.id===accountId))fail('请选择关联明细账户');
    const p={id:prev?.id||id(),name,target:data.target,daily:data.daily,time:data.time,entries:prev?.entries||[],startedAt:prev?.startedAt||today(),createdAt:prev?.createdAt||afterTransactions(s),paused:prev?.paused||false,accountId,baseline:accountId?(prev?.accountId===accountId?prev.baseline:accountBalances(s)[accountId]-(prev?progress(prev,s):0)):0};
    return {...s,plans:prev?s.plans.map(x=>x.id===p.id?p:x):[...s.plans,p]};
  }
  function contribute(s,planId,amount,mode,note,accounts={}){
    const p=s.plans.find(p=>p.id===planId);if(!p||p.paused||complete(p,s))fail('计划已结束或暂停');
    if(!Number.isSafeInteger(amount)||amount<=0||amount>LIMIT||progress(p,s)+amount>LIMIT)fail('存入金额无效');
    if(!['record','transfer','income'].includes(mode)||p.accountId&&mode==='record')fail('关联计划请使用真实收入或账户转存');
    let next=s,transactionId=null;
    if(mode!=='record'){
      next=transact(s,{kind:mode==='income'?'income':'transfer',accountId:p.accountId||accounts.toAccountId||defaultId('savings'),fromAccountId:accounts.fromAccountId||defaultId('free'),toAccountId:p.accountId||accounts.toAccountId||defaultId('savings'),amount,note:note||'计划存入 · '+p.name,planId,time:nowTime()});
      transactionId=next.transactions.at(-1).id;
    }
    const e={id:id(),amount,date:today(),createdAt:Date.now(),transactionId,note:String(note||'').slice(0,200)};
    return {...next,plans:next.plans.map(x=>x.id===p.id?{...x,entries:[...x.entries,e]}:x)};
  }
  function removeTransaction(s,txId){const t=s.transactions.find(t=>t.id===txId);const deleted=t?.kind==='interest'?{deletedInterest:[...new Set([...(s.deletedInterest||[]),txId])]}:{};return check({...s,...deleted,transactions:s.transactions.filter(t=>t.id!==txId),plans:s.plans.map(p=>({...p,entries:p.entries.filter(e=>e.transactionId!==txId)}))});}
  function removeEntry(s,pid,eid){const e=s.plans.find(p=>p.id===pid)?.entries.find(e=>e.id===eid);if(!e)fail('记录不存在');const next=e.transactionId?removeTransaction(s,e.transactionId):s;return {...next,plans:next.plans.map(p=>p.id===pid?{...p,entries:p.entries.filter(e=>e.id!==eid)}:p)};}
  function validate(s){
    if(!s||s.version!==2||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.accounts)||!s.accounts.length||s.accounts.length>1000||!Array.isArray(s.transactions)||s.transactions.length>100000||!Array.isArray(s.plans)||s.plans.length>1000||typeof s.settings?.reminders!=='boolean')fail('账本数据格式无效');
    if(s.deletedInterest!==undefined&&(!Array.isArray(s.deletedInterest)||s.deletedInterest.length>100000||new Set(s.deletedInterest).size!==s.deletedInterest.length||s.deletedInterest.some(x=>!validId(x))))fail('收益删除记录无效');
    if(s.fundData!==undefined){const f=s.fundData;if(!f||f.code!=='017269'||f.source!=='xqfunds'||!Number.isSafeInteger(f.updatedAt)||f.updatedAt<0||!f.quotes||Array.isArray(f.quotes)||typeof f.quotes!=='object'||Object.keys(f.quotes).length>36600||Object.entries(f.quotes).some(([d,v])=>!validDate(d)||typeof v!=='string'||!/^(-?)(0|[1-9]\d*)(\.\d{1,6})?$/.test(v)||Math.abs(Number(v))>100))fail('基金收益数据无效');}
    const accounts=new Set();for(const a of s.accounts){if(!validId(a.id)||accounts.has(a.id)||!['savings','free'].includes(a.bucket)||typeof a.name!=='string'||!a.name.trim()||a.name.length>40||!validDate(a.openedOn)||!validDate(a.lastAccruedDate)||!Number.isInteger(a.carry)||a.carry<0||a.carry>=1000000||typeof a.error!=='string'||a.archived!==undefined&&typeof a.archived!=='boolean')fail('明细账户数据无效');const normalized=rule(a.rule);if(!a.rule||Object.keys(normalized).some(key=>a.rule[key]!==normalized[key]))fail('计息规则数据无效');accounts.add(a.id);}
    if(!accounts.has(defaultId('savings'))||!accounts.has(defaultId('free')))fail('缺少基础账户');
    if(s.accounts.some(a=>a.archived&&(a.id===defaultId(a.bucket)||a.rule.mode!=='none'||accountBalances(s)[a.id]!==0||s.plans.some(p=>p.accountId===a.id)||(s.pendingInterest||[]).some(p=>p.accountId===a.id))))fail('已删除账户数据无效');
    const txIds=new Set();for(const t of s.transactions){
      if(!validId(t.id)||txIds.has(t.id)||!['income','expense','transfer','adjustment','interest'].includes(t.kind)||!Number.isSafeInteger(t.amount)||!t.amount||Math.abs(t.amount)>LIMIT||t.kind!=='adjustment'&&t.amount<0||!validDate(t.date)||!validDate(t.effectiveDate)||!Number.isSafeInteger(t.createdAt)||typeof t.note!=='string'||t.note.length>200||!['savings','free'].includes(t.bucket))fail('账单数据无效');
      if(t.time!==undefined&&(typeof t.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)))fail('账单时间无效');
      if(t.initial!==undefined&&typeof t.initial!=='boolean')fail('初始记录标记无效');
      if((t.yieldMode!==undefined||t.sourceDate!==undefined)&&(t.kind!=='interest'||t.yieldMode!=='fund'||!validDate(t.sourceDate)))fail('收益来源数据无效');
      if(t.kind==='transfer'){if(t.fee!==undefined&&(!Number.isSafeInteger(t.fee)||t.fee<0||t.fee>LIMIT))fail('转账手续费无效');if(t.outMethod!==undefined&&!['normal','fast'].includes(t.outMethod))fail('转出方式无效');if(!accounts.has(t.fromAccountId)||!accounts.has(t.toAccountId)||t.fromAccountId===t.toAccountId||s.accounts.find(a=>a.id===t.toAccountId).bucket!==t.bucket)fail('转账账户无效');}
      else if(!accounts.has(t.accountId)||s.accounts.find(a=>a.id===t.accountId).bucket!==t.bucket)fail('账单账户无效');txIds.add(t.id);
    }
    if(s.pendingInterest!==undefined){
      const list=s.pendingInterest;if(!Array.isArray(list)||list.length>100000||new Set(list.map(x=>x&&x.id)).size!==list.length)fail('待确认利息数据无效');
      for(const x of list){
        if(!x||!validId(x.id)||txIds.has(x.id)||(s.deletedInterest||[]).includes(x.id)||!accounts.has(x.accountId)||!['savings','free'].includes(x.bucket)||!Number.isSafeInteger(x.amount)||x.amount<=0||x.amount>LIMIT||!validDate(x.date)||!Number.isSafeInteger(x.createdAt)||typeof x.note!=='string'||x.note.length>200||x.yieldMode!==undefined&&x.yieldMode!=='fund'||x.estimatedAmount!==undefined&&(!Number.isSafeInteger(x.estimatedAmount)||x.estimatedAmount<=0||x.estimatedAmount>LIMIT))fail('待确认利息数据无效');
        if(s.accounts.find(a=>a.id===x.accountId).bucket!==x.bucket)fail('待确认利息账户无效');
      }
    }
    const planIds=new Set(),entryIds=new Set(),links=new Set();for(const p of s.plans){
      if(!validId(p.id)||planIds.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||!Number.isSafeInteger(p.daily)||p.daily<=0||p.daily>LIMIT||p.target!==null&&(!Number.isSafeInteger(p.target)||p.target<=0||p.target>LIMIT)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time)||typeof p.paused!=='boolean'||!validDate(p.startedAt)||!Array.isArray(p.entries)||p.entries.length>100000)fail('计划数据无效');
      if(p.accountId&&(!accounts.has(p.accountId)||!Number.isSafeInteger(p.baseline)||Math.abs(p.baseline)>LIMIT||!Number.isSafeInteger(p.createdAt)))fail('关联计划数据无效');
      planIds.add(p.id);for(const e of p.entries){if(!validId(e.id)||entryIds.has(e.id)||!Number.isSafeInteger(e.amount)||e.amount<=0||e.amount>LIMIT||!validDate(e.date)||!Number.isSafeInteger(e.createdAt)||typeof e.note!=='string'||e.note.length>200)fail('计划存入记录无效');entryIds.add(e.id);if(e.transactionId!==null){const t=s.transactions.find(t=>t.id===e.transactionId);if(links.has(e.transactionId)||!t||!['transfer','income'].includes(t.kind)||t.amount!==e.amount||t.planId!==p.id)fail('计划与账单关联无效');links.add(e.transactionId);}}if(entryProgress(p)>LIMIT)fail('计划进度过大');
    }
    const a=s.allocation;if(!a||!['total','savings','free','custom'].includes(a.source)||typeof a.customTotal!=='string'||!Array.isArray(a.rows)||!a.rows.length||a.rows.length>1000||a.rows.some(r=>typeof r.name!=='string'||r.name.length>40||typeof r.percent!=='string'||r.percent.length>12))fail('分配设置无效');
    return check(s);
  }
  return {LIMIT,id,today,cents,money,raw,calculate,allocate,addDays,isTradingDay,nextTradingDay,fundConfirmDate,fundEarnStart,fundEarnEnd,fundBalance,blank,migrate,rule,account,removeAccount,accountBalances,balances,deltas,principal,interestPreview,fundStats,settle,confirmInterest,editPendingInterest,ignoreInterest,transact,setBalances,progress,complete,paidToday,plan,contribute,removeTransaction,removeEntry,validate};
});
