const {chromium}=require('playwright'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path'),C=require('../app/src/main/assets/insights.js');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const start=C.addDays(C.today(),-2),missing=C.addDays(start,1);
  const s=C.account(C.blank(start),{name:'零钱通',balance:1000000,rule:{mode:'fund'}},'savings-main',start);
  s.fundData={code:'017269',source:'xqfunds',updatedAt:1,quotes:{[start]:'0.2663'}};
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/src/main/assets/index.html')).href);
  await page.evaluate(value=>localStorage.setItem('zhangben-state',value),JSON.stringify(s));
  await page.reload();
  assert.match(await page.locator('.reminder-strip').innerText(),new RegExp(missing));
  assert.equal(await page.locator('.reminder-strip [data-action="sync-fund"]').count(),1);
  const posted=C.addDays(start,1);
  assert.match(await page.locator('#pending-interest').innerText(),new RegExp(posted+' 利息（'+start+' 产生）'));
  await page.setViewportSize({width:320,height:700});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'pending interest overflows a narrow phone');
  await page.locator('#pending-interest [data-action="edit-pending-interest"]').first().click();
  await page.locator('#pending-interest-form [name="amount"]').fill('0.27');
  await page.locator('#pending-interest-form button[type="submit"]').click();
  let pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhangben-state')));
  assert.equal(pending.pendingInterest[0].amount,27);
  assert.equal(pending.pendingInterest[0].estimatedAmount,26);
  assert.equal(C.accountBalances(pending)['savings-main'],1000000);
  await page.reload();
  assert.match(await page.locator('#pending-interest').innerText(),/已修改/);
  await page.locator('#pending-interest [data-action="confirm-interest"]').first().click();
  assert.match(await page.locator('#modal-title').innerText(),new RegExp(posted));
  assert.equal(await page.locator('#fund-confirm-form [name="actual"]').inputValue(),'0.27');
  await page.locator('#fund-confirm-form button[type="submit"]').click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhangben-state')));
  const confirmed=saved.transactions.find(t=>t.kind==='interest');
  assert.equal(confirmed.amount,27);assert.equal(confirmed.sourceDate,start);assert.equal(confirmed.date,posted);
  assert.equal(C.accountBalances(saved)['savings-main'],1000027);
  console.log('FUND STATUS UI PASS: missing quote warning, explicit earning date, actual payout confirmation and synchronized balance.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
