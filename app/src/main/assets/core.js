(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ledger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMIT = 9000000000000;
  const fail = message => { throw new Error(message); };
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
  function cents(value, allowZero = false) {
    const s = String(value).trim();
    if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) fail('请输入有效金额，最多保留两位小数');
    const [whole, decimal = ''] = s.split('.');
    const n = Number(whole) * 100 + Number(decimal.padEnd(2,'0'));
    if (!Number.isSafeInteger(n) || n > LIMIT || n < (allowZero ? 0 : 1)) fail(allowZero ? '金额须在 0～900 亿元之间' : '金额须大于 0，且不超过 900 亿元');
    return n;
  }
  const money = n => (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const raw = n => (n / 100).toFixed(2);
  const blank = () => ({version:1, transactions:[], plans:[], settings:{reminders:true}});
  function deltas(t) {
    if (t.kind === 'transfer') return {free:-t.amount, savings:t.amount};
    return {savings:t.bucket === 'savings' ? (t.kind === 'expense' ? -t.amount : t.amount) : 0,
      free:t.bucket === 'free' ? (t.kind === 'expense' ? -t.amount : t.amount) : 0};
  }
  function balances(s) {
    const totals=s.transactions.reduce((b,t) => { const d = deltas(t); b.savings += BigInt(d.savings); b.free += BigInt(d.free); return b; }, {savings:0n,free:0n});
    return {savings:Number(totals.savings),free:Number(totals.free)};
  }
  function checkBalances(s) {
    const b = balances(s);
    if (b.savings < 0 || b.free < 0) fail('账户余额不足，请先在“我的”中设置余额或检查这笔金额');
    if (b.savings > LIMIT || b.free > LIMIT || b.savings + b.free > LIMIT) fail('总资产超过可支持的金额范围');
    return b;
  }
  function transact(s, data) {
    if (!['income','expense','transfer','adjustment'].includes(data.kind)) fail('无效的交易类型');
    if (data.kind !== 'transfer' && !['savings','free'].includes(data.bucket)) fail('请选择存款或自由');
    if (!Number.isSafeInteger(data.amount) || Math.abs(data.amount)>LIMIT || data.amount===0 || (data.kind !== 'adjustment' && data.amount<0)) fail('金额无效');
    const t = {id:id(), kind:data.kind, bucket:data.bucket || 'savings', amount:data.amount,
      note:String(data.note || '').trim().slice(0,200), date:data.date || today(), createdAt:Date.now()};
    if (data.planId) t.planId=data.planId;
    const next = {...s, transactions:[...s.transactions,t]};
    checkBalances(next); return next;
  }
  function setBalances(s, savings, free) {
    if (![savings,free].every(n=>Number.isSafeInteger(n) && n>=0 && n<=LIMIT) || savings+free>LIMIT) fail('余额无效或总额过大');
    const b = balances(s), entries = [];
    for (const key of ['savings','free']) {
      const n = (key === 'savings' ? savings : free) - b[key];
      if (n) entries.push({id:id(), kind:'adjustment', bucket:key, amount:n, note:'手动设置余额', date:today(), createdAt:Date.now()});
    }
    return {...s, transactions:[...s.transactions,...entries]};
  }
  const progress = p => p.entries.reduce((sum,e)=>sum+e.amount,0);
  const complete = p => p.target !== null && progress(p)>=p.target;
  const paidToday = (p, date=today()) => p.entries.filter(e=>e.date===date).reduce((sum,e)=>sum+e.amount,0);
  function plan(s, data, editId) {
    const name = String(data.name || '').trim();
    if (!name || name.length>40) fail('计划名称需为 1～40 个字');
    if (data.target!==null && (!Number.isSafeInteger(data.target)||data.target<=0||data.target>LIMIT)) fail('请输入有效的目标金额');
    if (!Number.isSafeInteger(data.daily)||data.daily<=0||data.daily>LIMIT) fail('请输入有效的每日金额');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) fail('请选择有效的提醒时间');
    const old = editId ? s.plans.find(p=>p.id===editId) : null;
    if (editId && !old) fail('计划不存在');
    const p = {id:old ? old.id : id(), name, target:data.target, daily:data.daily, time:data.time,
      entries:old ? old.entries : [], startedAt:old ? old.startedAt : today(), paused:old ? old.paused : false};
    return {...s, plans:old ? s.plans.map(x=>x.id===old.id ? p : x) : [...s.plans,p]};
  }
  function contribute(s, planId, amount, mode, note) {
    const p = s.plans.find(x=>x.id===planId);
    if (!p || p.paused || complete(p)) fail('该计划已结束或暂停');
    if (!Number.isSafeInteger(amount)||amount<=0||amount>LIMIT || progress(p)+amount>LIMIT) fail('存入金额无效或累计金额过大');
    if (!['record','transfer'].includes(mode)) fail('请选择登记方式');
    let next = s, transactionId = null;
    if (mode==='transfer') {
      next = transact(s,{kind:'transfer',amount,note:note || '计划存入 · '+p.name,planId});
      transactionId=next.transactions[next.transactions.length-1].id;
    }
    const entry = {id:id(), amount, date:today(), createdAt:Date.now(), transactionId, note:String(note||'').slice(0,200)};
    return {...next,plans:next.plans.map(x=>x.id===planId ? {...x, entries:[...x.entries,entry]} : x)};
  }
  function removeTransaction(s, txId) {
    const next = {...s,transactions:s.transactions.filter(t=>t.id!==txId),plans:s.plans.map(p=>({...p,entries:p.entries.filter(e=>e.transactionId!==txId)}))};
    checkBalances(next); return next;
  }
  function removeEntry(s, planId, entryId) {
    const p = s.plans.find(x=>x.id===planId), entry = p && p.entries.find(x=>x.id===entryId);
    if (!entry) fail('记录不存在');
    let next = entry.transactionId ? removeTransaction(s,entry.transactionId) : s;
    return {...next,plans:next.plans.map(x=>x.id===planId ? {...x,entries:x.entries.filter(e=>e.id!==entryId)} : x)};
  }
  function allocate(total, rows) {
    if (!Number.isSafeInteger(total)||total<0||total>LIMIT||!rows.length) fail('请输入有效的总金额和分配项目');
    const weights=rows.map(r=>cents(r.percent,true));
    if (weights.reduce((a,b)=>a+b,0)!==10000) fail('所有项目的占比之和须为 100%');
    // BigInt prevents losing cents when multiplying large balances by percentages.
    let assigned=0;
    return rows.map((r,i)=>{ const amount=i===rows.length-1 ? total-assigned : Number(BigInt(total)*BigInt(weights[i])/10000n); assigned+=amount; return {...r,amount}; });
  }
  function calculate(input) {
    const text=String(input).replace(/\s/g,'').replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
    if (!text || text.length>150 || /[^\d.+\-*/()%]/.test(text)) fail('仅支持数字、括号、百分号和加减乘除');
    let pos=0;
    function atom(){
      let value;
      if(text[pos]==='+'||text[pos]==='-'){const sign=text[pos++];value=atom()*(sign==='-'?-1:1);}
      else if(text[pos]==='('){pos++;value=sum();if(text[pos++]!==')')fail('括号不匹配');}
      else {const m=text.slice(pos).match(/^(\d+(\.\d*)?|\.\d+)/);if(!m)fail('算式不完整');pos+=m[0].length;value=Number(m[0]);}
      if(text[pos]==='%'){value/=100;pos++;} return value;
    }
    function product(){let v=atom();while(text[pos]==='*'||text[pos]==='/'){const op=text[pos++],r=atom();if(op==='/'&&r===0)fail('不能除以 0');v=op==='*'?v*r:v/r;}return v;}
    function sum(){let v=product();while(text[pos]==='+'||text[pos]==='-'){const op=text[pos++],r=product();v=op==='+'?v+r:v-r;}return v;}
    const result=sum();if(pos!==text.length||!Number.isFinite(result)||Math.abs(result)>LIMIT/100)fail('算式无效或结果过大');return Number(result.toFixed(8));
  }
  function validate(s) {
    if (!s || s.version!==1 || !Array.isArray(s.transactions)||!Array.isArray(s.plans)||!s.settings||typeof s.settings.reminders!=='boolean') fail('这不是有效的账本备份文件');
    if(s.transactions.length>100000||s.plans.length>1000) fail('备份数据过大');
    const ids=new Set();
    const isId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,99}$/.test(v);
    const isDate=v=>{
      if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
      const date=new Date(v+'T12:00:00');
      return !isNaN(date.getTime())&&date.getFullYear()===Number(v.slice(0,4))&&date.getMonth()+1===Number(v.slice(5,7))&&date.getDate()===Number(v.slice(8,10));
    };
    for(const t of s.transactions){
      if(!isId(t.id)||ids.has(t.id)||!['income','expense','transfer','adjustment'].includes(t.kind)||!['savings','free'].includes(t.bucket)||!Number.isSafeInteger(t.amount)||!t.amount||Math.abs(t.amount)>LIMIT||(t.kind!=='adjustment'&&t.amount<0)||!isDate(t.date)||typeof t.note!=='string'||t.note.length>200||!Number.isSafeInteger(t.createdAt)) fail('备份中的账单数据无效');
      ids.add(t.id);
    }
    const planIds=new Set(),entryIds=new Set(),links=new Set();
    for(const p of s.plans){
      if(!isId(p.id)||planIds.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||!Number.isSafeInteger(p.daily)||p.daily<=0||p.daily>LIMIT||(p.target!==null&&(!Number.isSafeInteger(p.target)||p.target<=0||p.target>LIMIT))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time)||typeof p.paused!=='boolean'||!isDate(p.startedAt)||!Array.isArray(p.entries)||p.entries.length>100000) fail('备份中的计划数据无效');
      planIds.add(p.id);
      for(const e of p.entries){
        if(!isId(e.id)||entryIds.has(e.id)||!Number.isSafeInteger(e.amount)||e.amount<=0||e.amount>LIMIT||!isDate(e.date)||!Number.isSafeInteger(e.createdAt)||typeof e.note!=='string'||e.note.length>200) fail('备份中的存入记录无效');
        entryIds.add(e.id);
        if(e.transactionId!==null){const t=s.transactions.find(t=>t.id===e.transactionId);if(links.has(e.transactionId)||!t||t.kind!=='transfer'||t.planId!==p.id||t.amount!==e.amount)fail('计划与转存记录不匹配');links.add(e.transactionId);}
      }
      if(progress(p)>LIMIT) fail('计划累计金额过大');
    }
    checkBalances(s); return s;
  }
  return {LIMIT,id,today,cents,money,raw,blank,deltas,balances,transact,setBalances,progress,complete,paidToday,plan,contribute,removeTransaction,removeEntry,allocate,calculate,validate};
});
