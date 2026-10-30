const {chromium}=require('playwright'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/src/main/assets/index.html')).href);
  await page.locator('[data-action="balances"]').first().click();
  await page.locator('#balances-form [name="savings"]').fill('1000');
  await page.locator('#balances-form [name="free"]').fill('0');
  await page.locator('#balances-form button[type="submit"]').click();
  await page.locator('[data-tab="mine"]').click();
  await page.locator('[data-action="accounts"][data-id="savings"]').click();
  assert.equal(await page.locator('[data-action="new-fund-account"]').count(),0);
  assert(!(await page.locator('#modal').innerText()).includes('不要把整个存款账户'));
  await page.locator('[data-action="new-account"]').click();
  await page.locator('#account-form [name="name"]').fill('测试零钱通');
  await page.locator('#account-form [name="balance"]').fill('200');
  await page.locator('#account-form [name="mode"]').selectOption('fund');
  await page.locator('#account-form button[type="submit"]').click();
  let s=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhangben-state')));
  const a=s.accounts.find(a=>a.name==='测试零钱通');assert(a);assert.equal(a.rule.mode,'fund');assert.equal(s.transactions.length,2);
  const total=Object.values((await page.evaluate(()=>Ledger.balances(JSON.parse(localStorage.getItem('zhangben-state')))))).reduce((x,y)=>x+y,0);
  await page.locator('[data-action="accounts"][data-id="savings"]').click();
  await page.locator('[data-action="edit-account"][data-id="'+a.id+'"]').click();
  await page.locator('[data-action="delete-account"]').click();
  await page.locator('#confirm-action').click();
  s=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhangben-state')));
  assert.equal(s.accounts.find(x=>x.id===a.id).archived,true);
  assert.equal(Object.values((await page.evaluate(()=>Ledger.balances(JSON.parse(localStorage.getItem('zhangben-state')))))).reduce((x,y)=>x+y,0),total);
  await page.locator('[data-action="accounts"][data-id="savings"]').click();
  assert.equal(await page.locator('[data-action="edit-account"][data-id="'+a.id+'"]').count(),0);
  console.log('ACCOUNT UI PASS: normal add with fund yield mode, clean savings list, safe account removal.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
