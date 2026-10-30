'use strict';
(() => {
  const C=window.Ledger, native=typeof window.Android!=='undefined';
  let preferences=readPreferences(),modalKind='',selectedTags=new Set(),tagFilter='',reportMonth=C.today().slice(0,7);
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=(name,cls='')=>`<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const button=(action,label,cls='primary',id='')=>`<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const money=n=>preferences.hideAmounts?'••••':C.money(n), bucketName=b=>b==='savings'?'存款':'自由';
  const clock=()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
  const formAmount=(label,name,value='',placeholder='0.00')=>`<label class="field"><span>${label}</span><input name="${name}" data-money inputmode="decimal" type="text" maxlength="15" autocomplete="off" placeholder="${placeholder}" value="${esc(value)}" required></label>`;
  let state=C.blank(), current='ledger', filter='all', noteKind='expense', noteBucket='free', noteAccount='free-main', toastTimer, damaged=false, rawSaved='';
  let calcDraft;
  const modal=$('#modal');
  try {
    rawSaved=native?Android.loadState():localStorage.getItem('zhangben-state')||'';
    if(rawSaved)state=C.migrate(JSON.parse(rawSaved));
    const before=state;state=C.settle(state);
    if(rawSaved && (JSON.stringify(state)!==rawSaved||state!==before)){
      state.revision++;const json=JSON.stringify(state);
      if(native){if(!Android.saveState(json))throw new Error('迁移保存失败');}else localStorage.setItem('zhangben-state',json);
      rawSaved=json;
    }
  } catch(error) { damaged=true; }
  calcDraft=JSON.parse(JSON.stringify(state.allocation));
  function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3200);}
  function refresh(){
    if(damaged)return false;
    const raw=native?Android.loadState():localStorage.getItem('zhangben-state');
    let latest=raw?C.migrate(JSON.parse(raw)):state;
    const settled=C.settle(latest);
    if(settled!==latest){settled.revision=latest.revision+1;const json=JSON.stringify(settled);if(native){if(!Android.saveState(json))return false;}else localStorage.setItem('zhangben-state',json);latest=settled;}
    const changed=JSON.stringify(latest)!==JSON.stringify(state);state=latest;return changed;
  }
  function persist(next, message, options={}) {
    if(!damaged&&!options.restore){const latest=native?Android.loadState():localStorage.getItem('zhangben-state');if(latest){const parsed=C.migrate(JSON.parse(latest));if(parsed.revision!==state.revision){state=parsed;throw new Error('账户已自动更新，请再次保存，输入内容仍保留');}}}
    next={...next,revision:state.revision+1};C.validate(next);
    const json=JSON.stringify(next);
    if(new TextEncoder().encode(json).length>8*1024*1024)throw new Error('账本已超过 8 MB，请先导出备份');
    if(native){if(!(options.restore?Android.restoreState(json):Android.saveState(json))){refresh();throw new Error('保存未完成，余额可能刚更新，请再次保存');}}
    else {if(options.restore)protectBrowserBackup(localStorage.getItem('zhangben-state'));localStorage.setItem('zhangben-state',json);}
    state=native?C.validate(JSON.parse(Android.loadState())):next;rawSaved=JSON.stringify(state);damaged=false;
    if(!native)recordBrowserBackup(json,options.restore);if(options.close!==false&&modal.open)modal.close();if(options.render!==false){if(options.keepDraft)renderKeepingEntry();else render();}if(message)toast(message);
  }
  function accountOptions(selected,bucket=null,exclude=null){const b=C.accountBalances(state);return state.accounts.filter(a=>!a.archived&&(!bucket||a.bucket===bucket)&&a.id!==exclude).map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)} · ${bucketName(a.bucket)} ¥${money(b[a.id])}</option>`).join('');}
  const accountName=id=>state.accounts.find(a=>a.id===id)?.name||'账户';
  const planProgress=p=>C.progress(p,state),planComplete=p=>C.complete(p,state),planPaid=p=>C.paidToday(p,C.today(),state);

  function readPreferences(){
    const defaults={native,hideAmounts:false,autoBackup:true,lockEnabled:false,lockDelay:30,backupLocalAt:0,backupExternalAt:0,backupFolder:'',backupError:''};
    try{return {...defaults,...JSON.parse(native?Android.preferences():localStorage.getItem('zhangben-preferences')||'{}')};}catch(error){return defaults;}
  }
  function setPreference(key,value){
    if(native){if(key==='hideAmounts')Android.hideAmounts(value);if(key==='autoBackup')Android.autoBackup(value);if(key==='lockDelay')Android.lockDelay(value);preferences={...preferences,[key]:value};}
    else{preferences={...preferences,[key]:value};localStorage.setItem('zhangben-preferences',JSON.stringify(preferences));if(key==='autoBackup'&&value&&rawSaved)recordBrowserBackup(rawSaved);}
    applyPrivacy();
  }
  function applyPrivacy(){document.body.classList.toggle('privacy-hidden',preferences.hideAmounts);const button=$('#hide-button');if(button){button.setAttribute('aria-label',preferences.hideAmounts?'显示金额':'隐藏金额');button.innerHTML=icon(preferences.hideAmounts?'eye-off':'eye');}}
  function renderKeepingEntry(){const form=$('#entry-form'),draft=form?{amount:form.elements.amount.value,note:form.elements.note.value,date:form.elements.date.value,time:form.elements.time.value,accountId:form.elements.accountId.value}:null;const y=scrollY;render();if(draft&&$('#entry-form'))for(const [key,value] of Object.entries(draft))$('#entry-form').elements[key].value=value;window.scrollTo(0,y);}
  function browserBackups(){try{return JSON.parse(localStorage.getItem('zhangben-backups')||'[]');}catch(error){return [];}}
  function protectBrowserBackup(json){if(!json)return;try{C.migrate(JSON.parse(json));const all=browserBackups(),time=Date.now();all.unshift({id:'before-'+time,time,reason:'恢复前保护备份',state:json});const before=all.filter(b=>b.id.startsWith('before-')).slice(0,5);localStorage.setItem('zhangben-backups',JSON.stringify([...before,...all.filter(b=>b.id.startsWith('daily-'))]));}catch(error){}}
  function recordBrowserBackup(json){if(!preferences.autoBackup)return;try{const id='daily-'+C.today(),all=browserBackups().filter(b=>b.id!==id);all.unshift({id,time:Date.now(),reason:'每日自动备份',state:json});const daily=all.filter(b=>b.id.startsWith('daily-')).sort((a,b)=>b.id.localeCompare(a.id)).slice(0,14),before=all.filter(b=>b.id.startsWith('before-')).slice(0,5);localStorage.setItem('zhangben-backups',JSON.stringify([...daily,...before].sort((a,b)=>b.time-a.time)));preferences.backupLocalAt=Date.now();preferences.backupError='';localStorage.setItem('zhangben-preferences',JSON.stringify(preferences));}catch(error){preferences.backupError='浏览器自动备份空间不足，请导出文件备份';}}
  const stamp=time=>time?new Date(time).toLocaleString('zh-CN',{hour12:false}):'尚无备份';
  function settingsDialog(){
    preferences=readPreferences();const status=reminderStatus();
    const row=(action,symbol,title,value='›')=>`<button class="settings-row" data-action="${action}">${icon(symbol)}<div><strong>${title}</strong></div><span>${value}</span></button>`;
    const toggle=(action,symbol,title,on)=>`<button class="settings-row" data-action="${action}" role="switch" aria-checked="${on}">${icon(symbol)}<div><strong>${title}</strong></div><span class="switch ${on?'on':''}"></span></button>`;
    showModal('设置',`<div class="settings-modal"><h3 class="settings-section">备份与恢复</h3><div class="settings-list">${toggle('toggle-backup','save','自动备份',preferences.autoBackup)}${row('backup-list','book','备份与恢复预览')}${row('choose-folder','save','外部备份文件夹',preferences.backupFolder?'已设置 ›':'选择 ›')}${preferences.backupFolder?`<div class="settings-status">${esc(preferences.backupFolder)}</div>${button('clear-folder','取消外部备份','text-button')}`:''}${row('export','save','导出备份')}${row('import','book','从文件恢复')}</div>${preferences.backupError?`<p class="backup-error">${esc(preferences.backupError)}</p>`:''}<h3 class="settings-section">应用锁</h3><div class="settings-list">${toggle('toggle-lock','lock','应用锁',preferences.lockEnabled)}${preferences.lockEnabled?`<label class="field"><span>离开后重新验证</span><select name="lockDelay"><option value="0" ${preferences.lockDelay===0?'selected':''}>立即</option><option value="30" ${preferences.lockDelay===30?'selected':''}>30 秒后</option><option value="60" ${preferences.lockDelay===60?'selected':''}>1 分钟后</option></select></label>${button('lock-now',icon('lock')+'立即锁定','secondary')}`:''}</div><h3 class="settings-section">标签与提醒</h3><div class="settings-list">${row('manage-tags','tag','自定义标签',state.tags.length+' 个 ›')}${toggle('toggle-reminders','bell','每日存钱提醒',state.settings.reminders)}${row('notifications','bell','通知权限',status.notifications?'已开启 ›':'未开启 ›')}${row('exact','plan','准点提醒',status.exact?'已开启 ›':'未开启 ›')}</div></div>`);modalKind='settings';
  }
  function backupsDialog(){
    const all=native?JSON.parse(Android.listBackups()):browserBackups().map(b=>{let s;try{s=C.migrate(JSON.parse(b.state));}catch(error){return null;}return {...b,transactions:s.transactions.length,accounts:s.accounts.length};}).filter(Boolean);
    showModal('备份与恢复预览',`${all.length?all.map(b=>`<button class="backup-row" data-action="preview-backup" data-id="${esc(b.id)}"><span><strong>${esc(b.reason)}</strong><small>${esc(stamp(b.time))} · ${b.accounts} 个账户 · ${b.transactions} 笔账单</small></span><span class="small-label">预览 ›</span></button>`).join(''):'<p class="backup-list-empty">暂无备份</p>'}<div class="modal-actions">${button('import','选择外部备份文件','secondary')}${button('settings','返回设置','secondary')}</div>`);modalKind='backups';
  }
  function restorePreview(text,label){
    try{
      const next=C.settle(C.migrate(JSON.parse(text.replace(/^\uFEFF/,'')))),summary=C.preview(next),currentSummary=C.preview(state),oldBalances=C.accountBalances(state),newBalances=C.accountBalances(next);
      showModal('恢复预览',`<p class="sheet-note">来源：${esc(label)}。备份将按当前日期补算收益后恢复；确认前不会改动当前账本。</p><div class="restore-comparison"><div><span>当前总资产</span><strong>¥${money(currentSummary.total)}</strong></div><div><span>恢复后总资产</span><strong>¥${money(summary.total)}</strong></div></div><p class="restore-counts">账户 ${currentSummary.accounts} → ${summary.accounts} 个<br>账单 ${currentSummary.transactions} → ${summary.transactions} 笔<br>计划 ${currentSummary.plans} → ${summary.plans} 个<br>标签 ${currentSummary.tags} → ${summary.tags} 个</p><div class="section-head"><h3>备份中的账户</h3><span class="small-label">当前 → 恢复后</span></div>${next.accounts.slice(0,12).map(a=>`<div class="report-line"><span>${esc(a.name)}</span><strong>¥${money(oldBalances[a.id]||0)} → ¥${money(newBalances[a.id])}</strong></div>`).join('')}${next.accounts.length>12?`<p class="helper">另有 ${next.accounts.length-12} 个账户，恢复时一并导入。</p>`:''}<p class="helper warning">恢复将替换当前财务数据。应用锁、金额隐藏和备份文件夹等本机设置保持不变。</p><div class="modal-actions">${button('close','取消','secondary')}<button id="confirm-action" class="primary dark">确认恢复</button></div>`);modalKind='restore';
      $('#confirm-action').addEventListener('click',()=>{try{persist(next,'备份已恢复',{restore:true});}catch(error){toast(error.message);}});
    }catch(error){toast('无法导入：'+error.message);}
  }
  function tagPicker(place,selected){return state.tags.length?`<div class="tag-picker">${state.tags.map(t=>`<label class="tag-choice"><input type="checkbox" name="${place==='entry'?'entryTag':'tagIds'}" value="${esc(t.id)}" ${selected.has(t.id)?'checked':''}>${esc(t.name)}</label>`).join('')}</div>`:'';}
  function tagsDialog(){showModal('自定义标签',`<form id="tag-form"><label class="field"><span>新标签名称</span><input name="name" maxlength="20" placeholder="例如：餐饮、通勤、兼职收入" required></label><button type="submit" class="primary">${icon('plus')}创建标签</button></form>${state.tags.map(t=>`<div class="tag-manager-row"><span>${esc(t.name)}</span>${button('edit-tag','重命名','text-button',t.id)}${button('delete-tag','删除','text-button',t.id)}</div>`).join('')}`);modalKind='tags';}
  function tagDialog(id){const t=state.tags.find(t=>t.id===id);if(!t)return;showModal('重命名标签',`<form id="tag-form" data-id="${esc(id)}"><label class="field"><span>标签名称</span><input name="name" maxlength="20" value="${esc(t.name)}" required></label><button class="primary" type="submit">保存名称</button></form>`);}
  function monthlyReportSection(){
    const r=C.monthlyReport(state,reportMonth);
    return `<section class="card" id="monthly-report"><div class="card-head"><h2>月度报告</h2><input type="month" class="report-month" name="reportMonth" value="${reportMonth}" aria-label="报告月份"></div><div class="report-grid"><div class="report-metric"><span>收入</span><strong class="income">+¥${money(r.income)}</strong></div><div class="report-metric"><span>支出</span><strong class="expense">−¥${money(r.expense)}</strong></div><div class="report-metric"><span>收支结余</span><strong>¥${money(r.net)}</strong></div><div class="report-metric"><span>资产变化</span><strong>${r.change>=0?'+':'−'}¥${money(Math.abs(r.change))}</strong></div></div><div class="report-line"><span>月初资产</span><strong>¥${money(r.opening)}</strong></div><div class="report-line"><span>期末资产</span><strong>¥${money(r.closing)}</strong></div><div class="report-line"><span>估算收益</span><strong>¥${money(r.interest)}</strong></div><div class="report-line"><span>转账手续费</span><strong class="expense">¥${money(r.fees)}</strong></div><div class="report-line"><span>资产调整</span><strong>¥${money(r.adjustment)}</strong></div><div class="report-line"><span>记录</span><strong>${r.count} 笔 · ${r.days} 天</strong></div></section>`;
  }
  function tagShareSection(){
    const r=C.monthlyReport(state,reportMonth),overlap=r.tags.reduce((sum,t)=>sum+t.amount,0)>r.expense;
    return `<section class="card" id="tag-share"><div class="card-head"><h2>标签占比</h2><span class="small-label">${esc(reportMonth)} · 支出</span></div>${r.expense?r.tags.map(t=>{const share=t.amount/r.expense*100;return `<div class="report-line"><span>${esc(t.name)}</span><strong>¥${money(t.amount)} · ${share.toFixed(1)}%</strong></div><div class="tag-bar"><span style="width:${share}%"></span></div>`;}).join(''):'<p class="helper">这个月还没有支出</p>'}${overlap?'<p class="helper">多标签支出分别计入各标签，占比合计可能超过 100%。</p>':''}</section>`;
  }

  function showModal(title,html) {
    modalKind='';
    $('#modal-content').innerHTML=`<div class="card-head"><h2 id="modal-title">${esc(title)}</h2>${button('close',icon('close'),'icon-button')}</div>${html}`;
    $('#modal-content [data-action="close"]').setAttribute('aria-label','关闭');
    if(!modal.open)modal.showModal();
  }
  function confirmDialog(title,text,onConfirm) {
    showModal(title,`<p class="sheet-note">${esc(text)}</p><div class="modal-actions">${button('close','取消','secondary')}<button id="confirm-action" class="primary dark">确认</button></div>`);
    $('#confirm-action').addEventListener('click',()=>{try{onConfirm();}catch(error){toast(error.message);}});
  }
  function empty(symbol,title,text){return `<div class="empty"><div class="empty-icon">${icon(symbol)}</div><h3>${title}</h3></div>`;}
  function record(t) {
    const transfer=t.kind==='transfer',adj=t.kind==='adjustment',interest=t.kind==='interest',positive=t.kind==='income'||interest||(adj&&t.amount>0);
    const cls=transfer?'':interest?'interest':positive?'income':'expense';
    const label=transfer?accountName(t.fromAccountId)+' → '+accountName(t.toAccountId):accountName(t.accountId)+' · '+(adj?'余额调整':interest?'利息':positive?'收入':'支出');
    return `<button class="record" style="width:100%;text-align:left" data-action="transaction" data-id="${esc(t.id)}"><span class="record-icon ${cls}">${icon(transfer?'transfer':interest?'percent':positive?'down':'up')}</span><span class="record-main"><span class="record-title" style="display:block">${esc(t.note||(transfer?'账户转存':adj?'手动设置余额':interest?'一笔利息':positive?'一笔收入':'一笔支出'))}</span><span class="record-tags">${(t.tagIds||[]).map(id=>`<span class="tag-label">${esc(state.tags.find(tag=>tag.id===id)?.name||'')}</span>`).join('')}</span><span class="record-meta" style="display:block">${esc(t.date.slice(5).replace('-','/'))}${t.time?' '+esc(t.time):''} · ${label}</span></span><span class="record-value ${cls}">${transfer?'':positive?'+':'−'}${money(Math.abs(t.amount))}${transfer&&t.fee?`<small class="expense">手续费 −${money(t.fee)}</small>`:''}</span></button>`;
  }
  function pendingInterestSection(){
    const list=state.pendingInterest||[];if(!list.length)return '';
    const total=list.reduce((n,p)=>n+p.amount,0);
    return `<section class="card" id="pending-interest"><div class="card-head"><h2>待确认利息</h2><span class="tag">¥${money(total)}</span></div>${list.map(p=>`<div class="record"><span class="record-icon interest">${icon('percent')}</span><span class="record-main"><span class="record-title" style="display:block">¥${money(p.amount)}</span><span class="record-meta" style="display:block">${esc(accountName(p.accountId))} · ${p.yieldMode==='fund'?`${esc(C.addDays(p.date,1))} 利息（${esc(p.date)} 产生）`:`${esc(p.date)} 的收益`}${p.estimatedAmount!==undefined?' · 已修改':''}</span></span><button class="text-button" data-action="edit-pending-interest" data-id="${esc(p.id)}">修改</button><button class="text-button" data-action="confirm-interest" data-id="${esc(p.id)}">确认</button><button class="text-button" data-action="ignore-interest" data-id="${esc(p.id)}">忽略</button></div>`).join('')}${button('confirm-all-interest','全部按当前金额确认','secondary')}</section>`;
  }
  function editPendingInterestDialog(id){
    const p=(state.pendingInterest||[]).find(p=>p.id===id);if(!p)return;
    showModal('修改待确认利息',`<form id="pending-interest-form" data-id="${esc(id)}"><p class="sheet-note">${p.yieldMode==='fund'?`${esc(C.addDays(p.date,1))} 利息 · ${esc(p.date)} 产生`:`${esc(p.date)} 的收益`}${p.estimatedAmount!==undefined?' · 原估算 ¥'+money(p.estimatedAmount):''}</p>${formAmount('待确认金额（元）','amount',C.raw(p.amount))}<button class="primary" type="submit">保存修改</button></form>`);
  }
  function confirmFundInterestDialog(id){
    const p=(state.pendingInterest||[]).find(p=>p.id===id);if(!p)return;
    showModal('核对 '+C.addDays(p.date,1)+' 利息',`<form id="fund-confirm-form" data-id="${esc(id)}"><p class="sheet-note">${esc(p.date)} 产生 · ${p.estimatedAmount!==undefined?'原估算 ¥'+money(p.estimatedAmount)+'，当前待确认 ¥'+money(p.amount):'账本估算 ¥'+money(p.amount)}。请对照微信实际到账金额。</p>${formAmount('实际到账金额（元）','actual',C.raw(p.amount))}<button class="primary" type="submit">按实际金额确认</button></form>`);
  }
  function ledgerPage() {
    const b=C.balances(state),hasAssets=state.transactions.length>0;
    const fundIssue=state.accounts.find(a=>!a.archived&&a.rule.mode==='fund'&&a.error);
    const transactions=[...state.transactions].reverse().filter(t=>filter==='all'||(filter==='month'?t.date.startsWith(C.today().slice(0,7)):t.kind===filter||(filter==='expense'&&t.kind==='transfer'&&t.fee>0))).filter(t=>!tagFilter||t.tagIds.includes(tagFilter)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
    return `<div class="page-heading"><div><h1>收支</h1></div></div>
      ${!hasAssets?`<div class="intro-note"><strong>初始资产</strong>${button('balances','去设置 '+icon('arrow'),'text-button')}</div>`:''}
      ${fundIssue?`<div class="reminder-strip">${icon('percent')}<div>${esc(fundIssue.name)}：${esc(fundIssue.error)} ${button('sync-fund','更新收益','text-button')}</div></div>`:''}
      ${pendingInterestSection()}
      <section class="card"><form id="entry-form" novalidate><div class="card-head"><h2>记一笔</h2><div class="segmented" aria-label="收支类型"><button type="button" data-action="kind" data-id="expense" class="${noteKind==='expense'?'selected expense':''}" aria-pressed="${noteKind==='expense'}">支出</button><button type="button" data-action="kind" data-id="income" class="${noteKind==='income'?'selected income':''}" aria-pressed="${noteKind==='income'}">收入</button></div></div>
      <label class="small-label" for="entry-amount">${noteKind==='expense'?'花了多少钱':'收到多少钱'}</label><div class="amount-input"><span>¥</span><input id="entry-amount" name="amount" data-money type="text" inputmode="decimal" maxlength="15" placeholder="0.00" autocomplete="off" aria-label="记账金额" required></div>
      <div class="account-choices"><button type="button" data-action="bucket" data-id="savings" class="${noteBucket==='savings'?'selected':''}" aria-pressed="${noteBucket==='savings'}">${icon('safe')}存款 <span class="faint">${money(b.savings)}</span></button><button type="button" data-action="bucket" data-id="free" class="${noteBucket==='free'?'selected':''}" aria-pressed="${noteBucket==='free'}">${icon('wallet')}自由 <span class="faint">${money(b.free)}</span></button></div>
      <label class="field"><span>明细账户</span><select name="accountId" aria-label="记账明细账户">${accountOptions(noteAccount,noteBucket)}</select></label><div class="card-head" style="margin:16px 0 4px"><span class="small-label">标签 · 可多选</span>${button('manage-tags',icon('tag')+'管理标签','text-button')}</div>${tagPicker('entry',selectedTags)}<div class="form-row"><label class="field"><span>日期</span><input type="date" name="date" value="${C.today()}" required aria-label="记账日期"></label><label class="field"><span>时间</span><input type="time" name="time" value="${clock()}" aria-label="记账时间"></label></div><label class="field"><span>备注</span><input name="note" placeholder="这笔钱用在哪里" maxlength="200" aria-label="记账备注"></label><button class="primary" type="submit">${icon('plus')}保存这笔${noteKind==='income'?'收入':'支出'}</button></form></section>
      <div class="section-head"><h2>账单记录</h2>${button('transfer','账户转账','text-button')}</div><div class="filter-row" aria-label="账单筛选">${[['all','全部'],['month','本月'],['income','收入'],['expense','支出'],['interest','利息']].map(([value,label])=>button('filter',label,filter===value?'selected':'',value)).join('')}</div>
      ${state.tags.length?`<select class="tag-filter" name="tagFilter" aria-label="按标签筛选"><option value="">全部标签</option>${state.tags.map(t=>`<option value="${esc(t.id)}" ${t.id===tagFilter?'selected':''}>${esc(t.name)}</option>`).join('')}</select>`:''}<section class="card records ledger-records">${transactions.length?transactions.map(record).join(''):empty('book','还没有账单','从第一笔记录开始，让每一分钱更清晰。')}</section>${tagShareSection()}${monthlyReportSection()}`;
  }
  function allocationAmount(){const b=C.balances(state);return calcDraft.source==='custom'?C.cents(calcDraft.customTotal,true):calcDraft.source==='total'?b.savings+b.free:b[calcDraft.source];}
  function allocationResults(){
    try{const total=allocationAmount(),rows=C.allocate(total,calcDraft.rows);return `<div class="card-head"><h2>分配结果</h2><span class="tag">合计 ¥${money(total)}</span></div>${rows.map((r,i)=>`<div class="allocation-result"><div><span class="color-dot" style="background:${['#9dba6d','#dfb97a','#8fabb0','#bf9baa'][i%4]}"></span>${esc(r.name||'未命名')} <small>${esc(r.percent)}%</small></div><strong>¥${money(r.amount)}</strong></div>`).join('')}`;}
    catch(error){return `<h2>分配结果</h2><p class="helper">${esc(error.message)}</p>`;}
  }
  function calculatorPage() {
    const d=calcDraft;let amount='';try{amount=C.raw(allocationAmount());}catch(error){}
    return `<div class="page-heading"><div><h1>分配</h1></div></div><section class="card"><div class="card-head"><h2>分配设置</h2><span class="tag">自动计算</span></div><form id="allocation-form"><label class="field"><span>金额来源</span><select name="source">${[['total','总资产'],['savings','存款'],['free','自由'],['custom','自填金额']].map(([key,label])=>`<option value="${key}" ${key===d.source?'selected':''}>${label}</option>`).join('')}</select></label><label class="small-label" for="allocation-total">${d.source==='custom'?'试算总金额':'同步的当前金额'}</label><div class="amount-input"><span>¥</span><input id="allocation-total" name="total" data-money inputmode="decimal" maxlength="15" placeholder="0.00" value="${d.source==='custom'?esc(d.customTotal):amount}" ${d.source==='custom'?'':'readonly'} aria-label="分配总金额"></div><label class="field"><span>项目数量</span><input type="number" name="count" min="1" max="1000" value="${d.rows.length}" aria-label="分配项目数量"></label><div id="allocation-rows">${d.rows.map((r,i)=>`<div class="allocation-row"><input name="name-${i}" value="${esc(r.name)}" maxlength="40" aria-label="第${i+1}项名称"><div class="percent-input"><input name="percent-${i}" value="${esc(r.percent)}" inputmode="decimal" maxlength="12" aria-label="第${i+1}项占比"><span>%</span></div><button type="button" data-action="remove-allocation" data-id="${i}" class="icon-button" aria-label="删除第${i+1}项" ${d.rows.length===1?'disabled':''}>${icon('close')}</button></div>`).join('')}</div><div class="allocation-total"><button type="button" data-action="add-allocation" class="text-button">${icon('plus')}添加项目</button><span id="percent-sum"></span></div></form></section><section class="card" id="allocation-results">${allocationResults()}</section>`;
  }

  function reminderStatus() {
    try {return native?JSON.parse(Android.reminderStatus()):{native:false,notifications:false,exact:false};}catch(error){return {};}
  }
  function planCard(p) {
    const total=planProgress(p),done=planComplete(p),paid=planPaid(p),percent=p.target===null?0:Math.min(100,total/p.target*100);
    const todayNeed=p.target===null?p.daily:Math.min(p.daily,Math.max(0,p.target-total+paid));
    return `<section class="card plan-card"><div class="card-head"><span class="plan-symbol">${icon(done?'check':'plan')}</span><div class="plan-name"><h3>${esc(p.name)}</h3><span class="tag ${done?'done':p.paused?'paused':''}">${done?'已达成':p.paused?'已暂停':p.target===null?'无上限 · 持续积累':'正在积攒'}</span></div>${button('edit-plan',icon('edit'),'icon-button',p.id)}</div><div class="plan-money"><strong>¥${money(total)}</strong><span>/ ${p.target===null?'无上限':'¥'+money(p.target)}</span></div>${p.target===null?'':`<div class="progress" role="progressbar" aria-label="计划进度" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${percent}%"></div></div>`}${p.accountId?`<p class="helper">账户：${esc(accountName(p.accountId))}</p>`:''}<div class="plan-info"><span>每日 <strong>¥${money(p.daily)}</strong> · ${p.time} 提醒</span><span>${done?'目标已完成':paid>=todayNeed?'今日已完成':'今日已存 ¥'+money(paid)}</span></div><div class="plan-actions">${done?button('plan-detail','查看完成记录','primary',p.id):p.paused?button('toggle-plan','继续计划','primary',p.id):button('contribute',icon('plus')+'存入一笔','primary',p.id)}${button('plan-detail','记录','secondary',p.id)}</div></section>`;
  }
  function plansPage() {
    const finished=state.plans.filter(planComplete).length,status=reminderStatus();
    return `<div class="page-heading"><div><h1>计划</h1></div><button class="plus-circle" data-action="new-plan" aria-label="新建存钱计划">${icon('plus')}</button></div>
      ${status.native&&state.settings.reminders&&(!status.notifications||!status.exact)?`<div class="reminder-strip">${icon('bell')}<div>${!status.notifications?'通知未开启':'准点提醒未开启'}${button(!status.notifications?'notifications':'exact','开启','text-button')}</div></div>`:''}
      ${state.plans.length?`<div class="section-head"><h2>我的计划</h2><span class="muted">${finished} 个已达成</span></div>${[...state.plans].sort((a,b)=>Number(planComplete(a))-Number(planComplete(b))).map(planCard).join('')}${button('new-plan',icon('plus')+'创建新计划','secondary')}`:`<section class="card plan-empty">${empty('plan','暂无计划','')}${button('new-plan',icon('plus')+'创建第一个计划','primary')}</section>`}
      `;
  }
  function minePage() {
    const b=C.balances(state),total=b.savings+b.free,savingsPercent=total?Math.round(b.savings/total*100):0;
    return `<div class="page-heading"><div><h1>我的</h1></div>${button('balances',icon('edit')+'设置余额','text-button')}</div><section class="hero"><div class="hero-top"><span>我的总资产</span></div><div class="hero-amount"><span class="currency">¥</span>${money(total)}</div></section>
      <div class="asset-grid"><button data-action="accounts" data-id="savings" class="card asset-card savings" style="text-align:left;width:100%">${icon('safe')}<p>存款</p><strong>¥${money(b.savings)}</strong><span aria-hidden="true">›</span></button><button data-action="accounts" data-id="free" class="card asset-card free" style="text-align:left;width:100%">${icon('wallet')}<p>自由</p><strong>¥${money(b.free)}</strong><span aria-hidden="true">›</span></button></div>
      <section class="card"><div class="card-head" style="margin-bottom:8px"><h2>资产分布</h2></div><div class="asset-composition"><div style="width:${total?savingsPercent:50}%"></div><div style="width:${total?100-savingsPercent:50}%"></div></div><div class="legend"><span>存款 ${total?savingsPercent:0}%</span><span>自由 ${total?100-savingsPercent:0}%</span></div></section>
      <section class="card"><div class="card-head"><h2>累计估算收益</h2>${button('transfer','账户转账','text-button')}</div><div class="earnings-number income">+ ¥${money(state.transactions.filter(t=>t.kind==='interest').reduce((n,t)=>n+t.amount,0))}</div></section>`;
  }
  function render() {
    applyPrivacy();
    $('#today-label').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'});
    if(damaged){$('#content').innerHTML=`<section class="card">${empty('shield','账本数据暂时无法读取','原始数据仍被保留，请先导出，然后尝试恢复备份。')}${button('export','导出原始数据','primary')}${button('import','导入备份','secondary')}</section>`;return;}
    $('#content').innerHTML=`<div class="fade-in">${({ledger:ledgerPage,calculator:calculatorPage,plans:plansPage,mine:minePage})[current]()}</div>`;
    $$('.bottom-nav button').forEach(b=>{b.classList.toggle('active',b.dataset.tab===current);if(b.dataset.tab===current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    if(current==='calculator'){calcDraft=JSON.parse(JSON.stringify(state.allocation));updatePercent();}
    $$('[data-action="edit-plan"]').forEach(b=>b.setAttribute('aria-label','编辑存钱计划'));
  }
  function balanceDialog() {
    const b=C.balances(state);
    showModal('设置我的资产',`<form id="balances-form">${formAmount('存款余额（元）','savings',C.raw(b.savings))}${formAmount('自由余额（元）','free',C.raw(b.free))}<div class="modal-actions">${button('close','取消','secondary')}<button type="submit" class="primary">保存余额</button></div></form>`);
  }
  const modeLabels={none:'不自动计息',annual:'年利率',monthly:'月利率',daily:'日利率',fixed:'每日固定收益',formula:'自定义每日收益公式',fund:'微信零钱通 · 兴全货币 E（自动）'};
  function accountsDialog(bucket){
    const balances=C.accountBalances(state),list=state.accounts.filter(a=>a.bucket===bucket&&!a.archived);
    showModal(bucketName(bucket)+' · 明细账户',`<p class="sheet-note">合计 ¥${money(C.balances(state)[bucket])}</p>${list.map(a=>{const estimate=C.interestPreview(state,a);return `<button class="account-detail" data-action="edit-account" data-id="${esc(a.id)}"><span class="record-icon">${icon(bucket==='savings'?'safe':'wallet')}</span><span class="record-main"><strong>${esc(a.name)}</strong><small>${modeLabels[a.rule.mode]}${['annual','monthly','daily'].includes(a.rule.mode)?' '+esc(a.rule.rate)+'%':''}</small><small>${a.error?esc(a.error):a.rule.mode==='fund'?fundSummary():'预计每日 +¥'+(preferences.hideAmounts?'••••':estimate===null?'—':estimate.toFixed(4))}</small></span><span class="record-value">¥${money(balances[a.id])}<small>设置 ›</small></span></button>`;}).join('')}<div class="modal-actions">${button('new-account',icon('plus')+'新增明细','primary',bucket)}${button('transfer','账户转账','secondary')}</div>`);
  }
  function accountDialog(accountId,bucket){
    const a=state.accounts.find(a=>a.id===accountId&&!a.archived),r=a?a.rule:C.rule();bucket=a?a.bucket:bucket;
    const balances=C.accountBalances(state),source=state.accounts.find(a=>!a.archived&&a.bucket===bucket&&balances[a.id]>0);
    showModal(a?'设置 · '+a.name:'新增'+bucketName(bucket)+'明细',`<form id="account-form" data-id="${a?esc(a.id):''}" data-bucket="${bucket}"><label class="field"><span>账户名称</span><input name="name" maxlength="40" value="${a?esc(a.name):''}" placeholder="例如：微信、招商银行卡、现金" required></label>${formAmount('当前余额（元）','balance',a?C.raw(balances[a.id]):'0.00')}${a?'':`<label class="field"><span>这笔余额从哪里来？</span><select name="sourceId"><option value="new" ${source?'':'selected'}>新增此前未记入的资金（增加总资产）</option>${accountOptions(source?.id)}</select></label>`}<label class="field"><span>自定义收益计算方式</span><select name="mode">${Object.entries(modeLabels).map(([mode,label])=>`<option value="${mode}" ${r.mode===mode?'selected':''}>${label}</option>`).join('')}</select></label><div data-rule-field="fund"><div class="detail-meta"><span>产品</span><strong>微信零钱通 · 兴全货币 E</strong></div><div class="detail-meta"><span>基金代码</span><strong>017269</strong></div><p class="helper" id="fund-status">${fundStatus(a)}</p><p class="helper" id="fund-pending" data-id="${a?esc(a.id):''}">${fundPending(a)}</p>${a?button('sync-fund','更新基金收益','secondary'):''}</div><div data-rule-field="rate"><label class="field"><span>利率（%，最多六位小数）</span><input name="rate" inputmode="decimal" value="${esc(r.rate)}" placeholder="例如：1.5"></label></div><div data-rule-field="basis"><label class="field"><span>年计息基数 / 公式中的基数</span><select name="basis"><option value="365" ${r.basis===365?'selected':''}>365 天</option><option value="360" ${r.basis===360?'selected':''}>360 天</option></select></label></div><div data-rule-field="compound"><label class="check-label"><input name="compound" type="checkbox" ${r.compound?'checked':''}>收益加入后续计息本金（每日复利）</label></div><div data-rule-field="fixed">${formAmount('每天固定增加（元）','fixed',r.fixed)}</div><div data-rule-field="formula"><label class="field"><span>每日收益公式（结果单位：元）</span><textarea name="formula" data-money maxlength="150">${esc(r.formula)}</textarea></label><p class="helper">支持：本金、余额、利率、基数，以及数字、括号和加减乘除。例：本金 * 利率 / 基数。利率填 3 时，公式中按 0.03 参与计算；“余额”包含已入账收益，“本金”不包含尚未支出的收益。</p></div><details class="calculation-help"><summary>计算说明</summary><p class="helper" id="rule-help"></p></details><button class="primary" type="submit">保存并同步资产</button></form>${a&&a.id!==a.bucket+'-main'?`<div class="modal-actions">${button('delete-account','删除账户','danger',a.id)}</div>`:''}`);
    updateRuleFields();
    const balanceInput=$('#account-form [name="balance"]');if(balanceInput)balanceInput.addEventListener('input',()=>{balanceInput.dataset.dirty='1';});
  }
  function fundSummary(){const s=C.fundStats(state);if(!s)return '等待联网获取官方收益';return '万份收益 '+s.income+' 元 · 近7日年化 '+(s.annualized===null?'—':s.annualized.toFixed(2)+'%');}
  function fundStatus(a){
    const s=C.fundStats(state);if(!s)return a?'尚未获取官方收益，请点下方“更新基金收益”，联网后也会自动更新。':'保存后会自动获取官方收益。';
    const updated=s.updatedAt?new Date(s.updatedAt).toLocaleString('zh-CN',{hour12:false}):'';
    const annual=s.annualized===null?'':' · 近7日年化约 '+s.annualized.toFixed(2)+'%';
    const stale=s.date<C.addDays(C.today(),-1)?'；尚未公布到昨天，公布后会自动补记':'';
    return '最新 '+s.date+' 万份收益 '+s.income+' 元'+annual+'（兴证全球基金官网）'+(updated?'；更新于 '+updated:'')+stale;
  }
  function fundPending(a){
    if(!a||a.rule.mode!=='fund')return '';
    let total=0;const today=C.today();let first='';
    for(const t of state.transactions){
      const inflow=(t.kind==='transfer'&&t.toAccountId===a.id)||(t.kind==='income'&&t.accountId===a.id);
      if(!inflow)continue;
      const start=C.fundEarnStart(a,t);
      if(start>today){total+=t.amount;if(!first||start<first)first=start;}
    }
    return total?`待确认转入 ¥${money(Math.min(total,C.accountBalances(state)[a.id]||0))}，预计 ${first} 起计息`:'当前份额已全部确认';
  }
  function transferFundHelp(fromId,toId,time=clock()){
    const from=state.accounts.find(a=>a.id===fromId),to=state.accounts.find(a=>a.id===toId),parts=[];
    if(to&&to.rule.mode==='fund'){
      const confirm=C.fundConfirmDate(C.today(),time);
      parts.push(`转入零钱通：${time<'15:00'?'15:00 前':'15:00 后'}，预计 ${confirm} 确认份额并开始计息。`);
    }
    if(from&&from.rule.mode==='fund')parts.push('转出零钱通：普通转出当日仍计息，快速转出当日不计息。');
    return parts.join(' ');
  }
  function updateTransferFundFields(){
    const form=$('#transfer-form');if(!form)return;
    const from=state.accounts.find(a=>a.id===form.elements.fromAccountId.value),to=state.accounts.find(a=>a.id===form.elements.toAccountId.value);
    const box=$('#out-method-field');if(box)box.hidden=from?.rule.mode!=='fund';
    const help=$('#transfer-fund-help');if(help)help.textContent=transferFundHelp(from?.id,to?.id,form.elements.time.value);
  }
  function syncFund(force=false){if(native&&typeof Android.syncFund==='function')Android.syncFund(force);else if(force)toast('请在 Android 安装包中联网更新');}
  function updateRuleFields(){const mode=$('#account-form [name="mode"]').value;const fields={fund:['fund'],rate:['annual','monthly','daily','formula'],basis:['annual','formula'],compound:['annual','monthly','daily'],fixed:['fixed'],formula:['formula']};for(const [field,modes] of Object.entries(fields))$(`[data-rule-field="${field}"]`).hidden=!modes.includes(mode);$('#rule-help').textContent={annual:'每日收益 = 计息本金 × 年利率 ÷ 选定年基数。',monthly:'每日收益 = 计息本金 × 月利率 ÷ 30。',daily:'每日收益 = 计息本金 × 日利率。',fixed:'每天按固定金额登记收益，不因余额变化而改变。',formula:'你填写的公式每天计算一次；结果须为非负金额。',fund:'每日估算收益 = 估算基金份额 × 当日官方万份收益 ÷ 10000。转入按交易日 15:00 截止、T+1 确认份额后开始计息；收益次日进入待确认列表，确认后才增加账本余额。7 日年化只作参考，不参与计算。此应用不读取微信零钱通的个人份额。',none:'这个账户不自动增加收益，可手动记录实际收入。'}[mode];}
  function transferDialog(){
    const source=state.accounts.find(a=>a.bucket==='free')?.id,target=state.accounts.find(a=>a.bucket==='savings')?.id;
    showModal('账户内部转账',`<form id="transfer-form" novalidate><label class="field"><span>转出账户</span><select name="fromAccountId">${accountOptions(source)}</select></label><label class="field"><span>转入账户</span><select name="toAccountId">${accountOptions(target)}</select></label><label class="field"><span>转出时间</span><input type="time" name="time" value="${clock()}" aria-label="转出时间"></label>${formAmount('转入金额（元）','amount')}${formAmount('手续费（元，转出账户另扣）','fee','0.00')}<div id="out-method-field" hidden><label class="field"><span>零钱通转出方式</span><select name="outMethod"><option value="normal">普通转出：当日仍计息，T+1 到账</option><option value="fast">快速转出：当日不计息，2 小时内到账</option></select></label></div><p class="helper" id="transfer-fund-help"></p><label class="field"><span>备注</span><input name="note" maxlength="200" placeholder="例如：微信转入银行卡"></label><button class="primary" type="submit">记录转账</button></form>`);
    updateTransferFundFields();
  }
  function fundDetail(t){
    const from=state.accounts.find(a=>a.id===t.fromAccountId),to=state.accounts.find(a=>a.id===t.toAccountId),account=state.accounts.find(a=>a.id===t.accountId),parts=[];
    const into=t.kind==='transfer'?to:t.kind==='income'?account:null;
    if(into&&into.rule.mode==='fund'&&C.fundEarnStart(into,t)>t.effectiveDate)parts.push(`<div class="detail-meta"><span>份额确认</span><strong>${esc(C.fundConfirmDate(t.effectiveDate,t.time))} 起计息</strong></div>`);
    if(t.kind==='transfer'&&from&&from.rule.mode==='fund')parts.push(`<div class="detail-meta"><span>转出方式</span><strong>${t.outMethod==='normal'?'普通转出 · 当日仍计息':t.outMethod==='fast'?'快速转出 · 当日不计息':'未指定 · 按快速转出计息'}</strong></div>`);
    return parts.join('');
  }
  function transactionDialog(txId) {
    const t=state.transactions.find(t=>t.id===txId);if(!t)return;
    const transfer=t.kind==='transfer',negative=t.kind==='expense'||t.amount<0;
    showModal('账单详情',`<div class="detail-amount ${transfer?'':negative?'expense':t.kind==='interest'?'interest':'income'}">${transfer?'':negative?'−':'+'} ¥${money(Math.abs(t.amount))}</div><div class="detail-meta"><span>类型</span><strong>${transfer?'账户内部转账':t.kind==='interest'?'利息':t.kind==='adjustment'?'余额调整':t.kind==='income'?'收入':'支出'}</strong></div><div class="detail-meta"><span>账户</span><strong>${transfer?esc(accountName(t.fromAccountId)+' → '+accountName(t.toAccountId)):esc(accountName(t.accountId))}</strong></div>${transfer?`<div class="detail-meta"><span>手续费</span><strong class="expense">¥${money(t.fee||0)}</strong></div>`:''}${fundDetail(t)}<div class="detail-meta"><span>日期</span><strong>${esc(t.date)}${t.time?' '+esc(t.time):''}</strong></div><form id="note-form" data-id="${esc(t.id)}"><label class="field"><span>备注</span><textarea name="note" maxlength="200" placeholder="给这笔账补充一点说明">${esc(t.note)}</textarea></label>${tagPicker('edit',new Set(t.tagIds||[]))}<button class="primary" type="submit">保存备注与标签</button></form>${button('delete-transaction','删除这笔记录','text-button',t.id)}`);
  }
  function planDialog(planId) {
    const p=state.plans.find(p=>p.id===planId);
    showModal(p?'编辑存钱计划':'创建存钱计划',`<form id="plan-form" data-id="${p?esc(p.id):''}"><label class="field"><span>计划名称</span><input name="name" maxlength="40" value="${p?esc(p.name):''}" placeholder="例如：给未来的自己存一笔钱" required></label><label class="field"><span>关联明细账户</span><select name="accountId">${accountOptions(p?.accountId||(!p?'savings-main':''))}</select></label><label class="check-label"><input type="checkbox" name="unlimited" ${p&&p.target===null?'checked':''}>无上限，持续存钱</label><div id="target-field" ${p&&p.target===null?'hidden':''}>${formAmount('目标金额（元）','target',p&&p.target!==null?C.raw(p.target):'')}</div>${formAmount('每天计划存入（元）','daily',p?C.raw(p.daily):'')}<label class="field"><span>每日提醒时间</span><input name="time" type="time" value="${p?p.time:'21:00'}" required></label><button class="primary" type="submit">${p?'保存计划':'创建计划 '+icon('arrow')}</button></form>${p?`<div class="modal-actions">${button('toggle-plan',p.paused?'继续计划':'暂停计划','secondary',p.id)}${button('delete-plan','删除计划','danger',p.id)}</div>`:''}`);
    const unlimited=$('[name="unlimited"]');$('[name="target"]').required=!unlimited.checked;
  }
  function contributionDialog(planId){
    const p=state.plans.find(p=>p.id===planId);if(!p)return;
    const need=Math.max(0,p.daily-planPaid(p)),suggestion=p.target===null?need:Math.min(need,Math.max(0,p.target-planProgress(p)));
    const choices=state.accounts.filter(a=>!a.archived&&a.id!==p.accountId);const from=choices.find(a=>a.bucket==='free')?.id||choices[0]?.id;
    showModal('存入 · '+p.name,`<p class="sheet-note">今天已完成 ¥${money(planPaid(p))}，每日计划 ¥${money(p.daily)}。</p><form id="contribute-form" data-id="${esc(p.id)}">${formAmount('本次存入金额（元）','amount',suggestion?C.raw(suggestion):'')}<label class="field"><span>登记方式</span><select name="mode">${p.accountId?'':'<option value="record">仅登记进度（旧版独立计划）</option>'}<option value="transfer">从其他账户转入（总资产不变）</option><option value="income">实际新增收入（增加总资产）</option></select></label><label class="field"><span>转出账户（新增收入时忽略）</span><select name="fromAccountId">${accountOptions(from,null,p.accountId)}</select></label>${p.accountId?`<p class="helper">转入账户：${esc(accountName(p.accountId))}。记录会同时更新该账户、存款／自由、总资产与计划。</p>`:`<label class="field"><span>转入账户</span><select name="toAccountId">${accountOptions('savings-main')}</select></label>`}<label class="field"><span>备注（可选）</span><input name="note" maxlength="200" placeholder="记录一下今天的小进步"></label><button type="submit" class="primary">${icon('check')}确认存入</button></form>`);
  }

  function planDetail(planId) {
    const p=state.plans.find(p=>p.id===planId);if(!p)return;
    if(p.accountId){const txs=state.transactions.filter(t=>t.createdAt>=p.createdAt&&(C.deltas(t)[p.accountId]||0)!==0).slice().reverse();showModal(p.name,`<div class="detail-amount">¥${money(planProgress(p))}</div><p class="helper">关联 ${esc(accountName(p.accountId))} · 进度和记录直接读取共享账户数据。</p><div class="records">${txs.map(record).join('')||empty('plan','还没有变化','向关联账户转入或记录收入即可同步。')}</div>${button('edit-plan','编辑计划','secondary',p.id)}`);return;}
    showModal(p.name,`<div class="detail-amount">¥${money(planProgress(p))}</div><p class="helper" style="text-align:center">${planComplete(p)?'目标已达成，计划自动结束':p.target===null?'无上限 · 持续积累':'目标 ¥'+money(p.target)} · ${p.entries.length} 次存入</p>${p.entries.length?`<div class="records" style="padding:0">${[...p.entries].reverse().map(e=>`<div class="record"><span class="record-icon income">${icon('check')}</span><span class="record-main"><span class="record-title" style="display:block">${esc(e.note||'为计划存入一笔')}</span><span class="record-meta" style="display:block">${esc(e.date)} · ${e.transactionId?'自由转入存款':'仅登记进度'}</span></span><span class="record-value income">+${money(e.amount)}</span>${button('delete-entry',icon('close'),'text-button',p.id+'|'+e.id)}</div>`).join('')}</div>`:empty('plan','还没有存入记录','每一次小小的积累，都会被记住。')}${button('edit-plan',icon('edit')+'编辑计划','secondary',p.id)}`);
  }
  function readCalcDraft(){const form=$('#allocation-form');if(!form)return;calcDraft={source:form.elements.source.value,customTotal:form.elements.source.value==='custom'?form.elements.total.value:calcDraft.customTotal,rows:$$('#allocation-rows .allocation-row').map(row=>({name:row.querySelector('input').value,percent:row.querySelectorAll('input')[1].value}))};}
  function saveAllocation(redraw=false){persist({...state,allocation:JSON.parse(JSON.stringify(calcDraft))},null,{render:redraw,close:false});if(!redraw){updatePercent();$('#allocation-results').innerHTML=allocationResults();}}
  function updatePercent(){const el=$('#percent-sum');if(!el)return;const sum=calcDraft.rows.reduce((n,r)=>n+(Number(r.percent)||0),0);el.textContent=`占比合计 ${Number(sum.toFixed(4))}%`;el.classList.toggle('expense',Math.abs(sum-100)>.00001);}
  function exportBackup(){
    const text=damaged?rawSaved:JSON.stringify(state,null,2);
    if(native)Android.exportBackup(text);
    else {const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Money备份-'+C.today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('备份已导出');}
  }
  window.onBackupImport=text=>restorePreview(text,'文件备份');
  function importBackup(){
    if(native)Android.importBackup();else {const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{if(input.files[0]){if(input.files[0].size>8*1024*1024)return toast('文件不能超过 8 MB');window.onBackupImport(await input.files[0].text());}};input.click();}
  }
  document.addEventListener('click',event=>{
    const tab=event.target.closest('[data-tab]');
    if(tab){if(damaged)return toast('请先恢复账本数据');refresh();current=tab.dataset.tab;calcDraft=JSON.parse(JSON.stringify(state.allocation));render();window.scrollTo({top:0,behavior:'instant'});return;}
    const btn=event.target.closest('button[data-action]');if(!btn)return;
    const action=btn.dataset.action,id=btn.dataset.id;
    try {
      if(action==='close')modal.close();
      if(action==='settings')settingsDialog();
      if(action==='toggle-hide'){setPreference('hideAmounts',!preferences.hideAmounts);renderKeepingEntry();if(modal.open&&modalKind==='settings')settingsDialog();}
      if(action==='toggle-backup'){setPreference('autoBackup',!preferences.autoBackup);settingsDialog();}
      if(action==='choose-folder'){if(native)Android.chooseBackupFolder();else toast('选择自动备份文件夹需要安装安卓 App');}
      if(action==='clear-folder'){if(native)Android.clearBackupFolder();preferences=readPreferences();settingsDialog();}
      if(action==='backup-list')backupsDialog();
      if(action==='preview-backup'){const value=native?Android.loadBackup(id):browserBackups().find(b=>b.id===id)?.state;if(value)restorePreview(value,'自动备份');}
      if(action==='toggle-lock'){if(native)Android.configureLock(!preferences.lockEnabled);else toast('应用锁使用手机系统身份验证，请在安卓 App 中设置');}
      if(action==='lock-now'&&native)Android.lockNow();
      if(action==='manage-tags')tagsDialog();
      if(action==='edit-tag')tagDialog(id);
      if(action==='delete-tag')confirmDialog('删除这个标签？','仅移除标签及其账单关联，不会删除账单或改变资产。',()=>{const next=C.removeTag(state,id);selectedTags.delete(id);if(tagFilter===id)tagFilter='';persist(next,'标签已删除',{keepDraft:true});tagsDialog();});

      if(action==='balances')balanceDialog();
      if(action==='accounts')accountsDialog(id);
      if(action==='new-account')accountDialog(null,id);
      if(action==='edit-account')accountDialog(id);
      if(action==='delete-account'){const a=state.accounts.find(x=>x.id===id);confirmDialog('删除这个账户？','余额会划回同类基础账户，历史账单保留；待确认利息会移除。',()=>{persist(C.removeAccount(state,id),'账户已删除，资产已保留');if(noteAccount===id)noteAccount=a.bucket+'-main';syncFund();});}
      if(action==='transfer')transferDialog();
      if(action==='kind'||action==='bucket'){
        const form=$('#entry-form'),draft=form?{amount:form.elements.amount.value,note:form.elements.note.value,date:form.elements.date.value,time:form.elements.time.value}:null;
        if(action==='kind')noteKind=id;else {noteBucket=id;noteAccount=state.accounts.find(a=>a.bucket===id).id;}render();
        if(draft)for(const key of Object.keys(draft))$('#entry-form').elements[key].value=draft[key];
      }
      if(action==='filter'){filter=id;const y=scrollY;render();window.scrollTo(0,y);}
      if(action==='transaction')transactionDialog(id);
      if(action==='edit-pending-interest')editPendingInterestDialog(id);
      if(action==='confirm-interest'){const p=(state.pendingInterest||[]).find(p=>p.id===id);if(p?.yieldMode==='fund')confirmFundInterestDialog(id);else persist(C.confirmInterest(state,id),'利息已确认');}
      if(action==='ignore-interest')confirmDialog('忽略这笔利息？','忽略后不会入账，也不会再自动补记。',()=>persist(C.ignoreInterest(state,id),'已忽略这笔利息'));
      if(action==='confirm-all-interest'){const confirm=()=>{let next=state;for(const p of [...(state.pendingInterest||[])])next=C.confirmInterest(next,p.id);persist(next,'待确认利息已全部确认');};if((state.pendingInterest||[]).some(p=>p.yieldMode==='fund'))confirmDialog('按当前金额确认全部利息？','列表中已修改的金额会直接入账；未修改的基金收益仍是估算值。',confirm);else confirm();}
      if(action==='sync-fund'){syncFund(true);toast('正在更新微信零钱通收益');}
      if(action==='delete-transaction'){const t=state.transactions.find(t=>t.id===id);confirmDialog('删除这笔账单？',t?.kind==='interest'?'删除会撤销这笔收益，并同步更新资产。同一天的这笔收益不会再次自动记入。':'删除会撤销这笔账单对资产的影响。如果是计划转存，对应的存入进度也会撤销；若余额不足以撤销，则无法删除。',()=>persist(C.removeTransaction(state,id),'账单已删除，资产已更新'));}
      if(action==='new-plan')planDialog();
      if(action==='edit-plan')planDialog(id);
      if(action==='contribute')contributionDialog(id);
      if(action==='plan-detail')planDetail(id);
      if(action==='toggle-plan')persist({...state,plans:state.plans.map(p=>p.id===id?{...p,paused:!p.paused}:p)},'计划状态已更新');
      if(action==='delete-plan')confirmDialog('删除这个计划？','计划及其进度记录会被删除。已发生的自由转存款会保留在账单里，账户余额不会改变。',()=>persist({...state,plans:state.plans.filter(p=>p.id!==id)},'计划已删除'));
      if(action==='delete-entry'){const [pid,eid]=id.split('|');confirmDialog('撤销这次存入？','仅登记的进度会移除。如果这次存入关联了自由转存款，相应转存也会撤销，达到目标的计划可能重新开始。',()=>persist(C.removeEntry(state,pid,eid),'存入记录已撤销'));}
      if(action==='toggle-reminders'){persist({...state,settings:{...state.settings,reminders:!state.settings.reminders}},state.settings.reminders?'每日提醒已关闭':'每日提醒已开启',{close:false});if(modal.open&&modalKind==='settings')settingsDialog();}
      if(action==='notifications'){if(native)Android.requestNotifications();else toast('系统通知需要安装安卓 APK 后开启');}
      if(action==='exact'){if(native)Android.requestExactAlarm();else toast('准点提醒需要安装安卓 APK 后设置');}
      if(action==='export')exportBackup();
      if(action==='import')importBackup();
      if(action==='add-allocation'){readCalcDraft();if(calcDraft.rows.length>=1000)throw new Error('项目数量过多');calcDraft.rows.push({name:'项目'+(calcDraft.rows.length+1),percent:'0'});saveAllocation(true);}
      if(action==='remove-allocation'){readCalcDraft();if(calcDraft.rows.length<=1)return;calcDraft.rows.splice(Number(id),1);saveAllocation(true);}

    }catch(error){toast(error.message);}
  });
  document.addEventListener('submit',event=>{
    event.preventDefault();const form=event.target;const data=new FormData(form);
    try {
      if(form.id==='pending-interest-form')persist(C.editPendingInterest(state,form.dataset.id,C.cents(data.get('amount'))),'待确认利息已修改');
      if(form.id==='fund-confirm-form')persist(C.confirmInterest(state,form.dataset.id,C.today(),C.cents(data.get('actual'))),'实际收益已确认');
      if(form.id==='entry-form'){
        const amountText=String(data.get('amount')||'').trim();if(!amountText)throw new Error('请输入金额');
        const entryDate=data.get('date');if(!entryDate)throw new Error('请选择日期');
        const next=C.transact(state,{kind:noteKind,bucket:noteBucket,accountId:data.get('accountId'),amount:C.cents(amountText),date:entryDate,time:data.get('time')||clock(),note:data.get('note'),tagIds:[...selectedTags]});
        const previousTags=selectedTags;selectedTags=new Set();try{persist(next,'已记下这笔'+(noteKind==='income'?'收入':'支出'));}catch(error){selectedTags=previousTags;throw error;}
      }
      if(form.id==='tag-form'){persist(C.tag(state,data.get('name'),form.dataset.id||undefined),'标签已保存',{keepDraft:true});tagsDialog();}
      if(form.id==='account-form'){
        const next=C.account(state,{name:data.get('name'),bucket:form.dataset.bucket,balance:C.cents(data.get('balance'),true),sourceId:data.get('sourceId')==='new'?null:data.get('sourceId'),rule:{mode:data.get('mode'),rate:data.get('rate')||'0',basis:Number(data.get('basis')),compound:!!data.get('compound'),fixed:data.get('fixed')||'0',formula:data.get('formula')}},form.dataset.id||undefined);persist(next,'账户与资产已同步更新');syncFund();
      }
      if(form.id==='transfer-form'){
        const from=state.accounts.find(a=>a.id===data.get('fromAccountId')),amountText=String(data.get('amount')||'').trim();if(!amountText)throw new Error('请输入金额');
        persist(C.transact(state,{kind:'transfer',fromAccountId:data.get('fromAccountId'),toAccountId:data.get('toAccountId'),amount:C.cents(amountText),fee:C.cents(data.get('fee')||'0',true),time:data.get('time')||clock(),outMethod:from?.rule.mode==='fund'?data.get('outMethod'):undefined,note:data.get('note')||'账户内部转账'}),'转账已记录');
      }
      if(form.id==='balances-form')persist(C.setBalances(state,C.cents(data.get('savings'),true),C.cents(data.get('free'),true)),'账户余额已更新');
      if(form.id==='note-form')persist({...state,transactions:state.transactions.map(t=>t.id===form.dataset.id?{...t,note:String(data.get('note')).trim(),tagIds:data.getAll('tagIds')}:t)},'备注已保存');
      if(form.id==='plan-form'){
        const next=C.plan(state,{name:data.get('name'),target:data.get('unlimited')?null:C.cents(data.get('target')),daily:C.cents(data.get('daily')),time:data.get('time'),accountId:data.get('accountId')},form.dataset.id||undefined);
        persist(next,form.dataset.id?'计划已更新':'新的存钱计划已创建');
      }
      if(form.id==='contribute-form'){
        const next=C.contribute(state,form.dataset.id,C.cents(data.get('amount')),data.get('mode'),data.get('note'),{fromAccountId:data.get('fromAccountId'),toAccountId:data.get('toAccountId')});
        const p=next.plans.find(p=>p.id===form.dataset.id);persist(next,C.complete(p,next)?'目标达成！计划已自动结束':'又离目标近了一步，存入已记录');
      }
      if(form.id==='allocation-form'){readCalcDraft();saveAllocation(false);}
    }catch(error){toast(error.message);}
  });
  document.addEventListener('change',event=>{
    try{
      if(event.target.name==='entryTag'){if(event.target.checked)selectedTags.add(event.target.value);else selectedTags.delete(event.target.value);}
      if(event.target.name==='tagFilter'){tagFilter=event.target.value;renderKeepingEntry();}
      if(event.target.name==='reportMonth'){reportMonth=event.target.value;renderKeepingEntry();}
      if(event.target.name==='lockDelay'){setPreference('lockDelay',Number(event.target.value));}
      if(event.target.name==='accountId'&&event.target.closest('#entry-form'))noteAccount=event.target.value;
      if(event.target.name==='mode'&&event.target.closest('#account-form'))updateRuleFields();
      if(event.target.closest('#transfer-form')&&['fromAccountId','toAccountId','time'].includes(event.target.name))updateTransferFundFields();
      if(event.target.closest('#allocation-form')){
        if(event.target.name==='count'){readCalcDraft();const n=Number(event.target.value);if(!Number.isInteger(n)||n<1||n>1000)throw new Error('项目数量须为 1～1000');while(calcDraft.rows.length<n)calcDraft.rows.push({name:'项目'+(calcDraft.rows.length+1),percent:'0'});calcDraft.rows=calcDraft.rows.slice(0,n);saveAllocation(true);}
        else if(event.target.name==='source'){readCalcDraft();saveAllocation(true);}
      }
    }catch(error){toast(error.message);}

    if(event.target.name==='unlimited'){$('#target-field').hidden=event.target.checked;$('[name="target"]').required=!event.target.checked;}
    if(event.target.name==='mode'&&$('#mode-helper'))$('#mode-helper').textContent=event.target.value==='transfer'?'本次金额将从“自由”扣除并计入“存款”，总资产不变。请先自行完成实际转账。':'适合已经实际存好的钱，仅跟踪计划进度。登记不会自动增加资产或执行银行转账。';
  });
  document.addEventListener('input',event=>{if(event.target.closest('#allocation-form')&&!['count','source'].includes(event.target.name)){try{readCalcDraft();saveAllocation(false);}catch(error){toast(error.message);}}});
  modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)modal.close();}});
  window.onNativeBack=()=>{if(modal.open){modal.close();return true;}if(current!=='ledger'){current='ledger';render();window.scrollTo(0,0);return true;}return false;};
  window.onFundSynced=status=>{try{if(modal.open&&$('#fund-status')){refresh();const box=$('#fund-pending'),acc=state.accounts.find(a=>box&&a.id===box.dataset.id)||state.accounts.find(a=>a.rule.mode==='fund'),form=$('#account-form'),balance=form&&form.querySelector('[name="balance"]');$('#fund-status').textContent=fundStatus(acc);if(box&&acc)box.textContent=fundPending(acc);if(form&&acc&&form.dataset.id===acc.id&&balance&&!balance.dataset.dirty)balance.value=C.raw(C.accountBalances(state)[acc.id]);}else if(!modal.open){const changed=refresh();if(changed)renderKeepingEntry();}if(status)toast(status);}catch(error){toast(error.message);}};
  window.onNativeResume=()=>{try{syncFund();preferences=readPreferences();applyPrivacy();if(modal.open)return;const changed=refresh();if(!modal.open&&(changed||current==='plans'||current==='mine')){calcDraft=JSON.parse(JSON.stringify(state.allocation));render();}}catch(error){toast(error.message);}};
  syncFund();
  setInterval(()=>{if(!document.hidden&&!modal.open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))window.onNativeResume();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)window.onNativeResume();});
  window.onNativePreferencesChanged=()=>{preferences=readPreferences();renderKeepingEntry();if(modal.open&&modalKind==='settings')settingsDialog();};
  render();
})();
