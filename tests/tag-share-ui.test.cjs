const {chromium}=require('playwright'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path'),C=require('../app/src/main/assets/insights.js');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage({viewport:{width:320,height:700},isMobile:true,hasTouch:true});
    const today=C.today();let s=C.blank(today);s=C.tag(C.tag(s,'餐饮'),'出行');
    s=C.account(s,{name:'自由',balance:500000,rule:{}},'free-main',today);
    const [food,travel]=s.tags.map(t=>t.id);
    for(const [amount,tagIds] of [[10000,[food,travel]],[10000,[food]],[20000,[]]])s=C.transact(s,{kind:'expense',accountId:'free-main',amount,date:today,effectiveDate:today,tagIds});
    await page.goto(pathToFileURL(path.resolve(__dirname,'../app/src/main/assets/index.html')).href);
    await page.evaluate(value=>localStorage.setItem('zhangben-state',value),JSON.stringify(s));await page.reload();
    const share=page.locator('#tag-share');assert.match(await share.innerText(),/餐饮\s*¥200\.00 · 50\.0%/);
    assert.match(await share.innerText(),/出行\s*¥100\.00 · 25\.0%/);
    assert.match(await share.innerText(),/未标记\s*¥200\.00 · 50\.0%/);
    assert.match(await share.innerText(),/占比合计可能超过 100%/);
    assert.equal(await page.locator('#content > .fade-in > :last-child').getAttribute('id'),'monthly-report');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('[name="reportMonth"]').fill(C.addDays(today,-40).slice(0,7));
    assert.match(await share.innerText(),/这个月还没有支出/);
    console.log('TAG SHARE UI PASS: label shares, untagged spending, overlap, narrow layout and month switching.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
