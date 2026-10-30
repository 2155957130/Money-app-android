const {chromium}=require('playwright'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/src/main/assets/index.html')).href);
  assert.equal(await page.locator('#entry-form button[type="submit"]').evaluate(button=>button.form?.id),'entry-form');
  await page.locator('[data-action="balances"]').first().click();
  await page.locator('#balances-form [name="savings"]').fill('0');
  await page.locator('#balances-form [name="free"]').fill('1000');
  await page.locator('#balances-form button[type="submit"]').click();
  await page.locator('#entry-amount').fill('20');
  await page.locator('#entry-form [name="note"]').fill('午饭');
  await page.locator('#entry-form button[type="submit"]').click();
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhangben-state')));
  assert.equal(state.transactions.at(-1).kind,'expense');assert.equal(state.transactions.at(-1).amount,2000);
  assert.equal(await page.locator('[data-action="transaction"]').filter({hasText:'午饭'}).count(),1);
  await page.locator('[data-action="kind"][data-id="income"]').click();
  await page.locator('#entry-amount').fill('5');
  await page.locator('#entry-form [name="note"]').fill('退款');
  await page.locator('#entry-form button[type="submit"]').click();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhangben-state')));
  assert.equal(state.transactions.at(-1).kind,'income');assert.equal(state.transactions.at(-1).amount,500);
  assert.equal(await page.locator('[data-action="transaction"]').filter({hasText:'退款'}).count(),1);
  assert((await page.locator('#monthly-report').innerText()).includes('985.00'));
  await page.locator('[data-tab="mine"]').click();assert((await page.locator('.hero-amount').innerText()).includes('985.00'));
  await page.reload();await page.locator('[data-tab="ledger"]').click();
  assert.equal(await page.locator('[data-action="transaction"]').count(),3);assert.deepEqual(errors,[]);
  console.log('ENTRY SUBMIT PASS: visible save button belongs to form; expense and income persist, report/assets update, reload retains both.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
