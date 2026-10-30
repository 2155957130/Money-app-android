package cn.zhangben.paw;

import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.webkit.WebView;
import org.json.*;
import java.lang.reflect.Field;
import java.util.concurrent.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class NativeSmoke extends Instrumentation {
    private Activity activity;
    private WebView web;
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private String js(String code) throws Exception {
        CountDownLatch done=new CountDownLatch(1);String[] value={null};
        runOnMainSync(()->web.evaluateJavascript(code,result->{value[0]=result;done.countDown();}));
        check(done.await(15,TimeUnit.SECONDS),"JavaScript callback timed out");return value[0];
    }
    private void ready() throws Exception {
        Field field=activity.getClass().getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
        for(int i=0;i<60;i++){if("true".equals(js("!!document.querySelector('#entry-form')")))return;Thread.sleep(500);}
        throw new AssertionError("Local WebView failed to render the entry form");
    }
    private void action(String code) throws Exception {String result=js("(function(){try{"+code+";return 'OK'}catch(e){return e.stack||e.message}})()");check("\"OK\"".equals(result),result);}
    private JSONObject saved() throws Exception {return new JSONObject(getTargetContext().getSharedPreferences("ledger",0).getString("state","{}"));}
    private String asset(String name)throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=getContext().getAssets().open(name)){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);}return new String(bytes.toByteArray(),StandardCharsets.UTF_8);}
    private void crossEngineFixtures()throws Exception{
        JSONArray cases=new JSONArray(asset("interest-fixtures.json"));
        for(int i=0;i<cases.length();i++){
            JSONObject f=cases.getJSONObject(i),actual=new JSONObject(f.getJSONObject("input").toString()),expected=f.getJSONObject("expected");String asOf=f.getString("asOf");
            InterestEngine.settle(actual,asOf);
            JSONArray accounts=actual.getJSONArray("accounts");
            for(int j=0;j<accounts.length();j++){
                JSONObject a=accounts.getJSONObject(j),e=expected.getJSONArray("accounts").getJSONObject(j);String id=a.getString("id");
                check(InterestEngine.balance(actual,id,null)==f.getJSONObject("balances").getLong(id),"Interest balance mismatch in case "+i);
                check(a.getLong("carry")==e.getLong("carry"),"Fractional-cent carry mismatch in case "+i);
                check(a.getString("lastAccruedDate").equals(e.getString("lastAccruedDate")),"Settlement checkpoint mismatch");
                check(a.getString("error").equals(e.getString("error")),"Formula calculation error in case "+i+": "+a.getString("error"));
            }
            JSONArray tx=actual.getJSONArray("transactions"),etx=expected.getJSONArray("transactions");check(tx.length()==etx.length(),"Yield record count mismatch");
            for(int j=0;j<tx.length();j++){JSONObject t=tx.getJSONObject(j),e=etx.getJSONObject(j);check(t.getString("id").equals(e.getString("id"))&&t.getLong("amount")==e.getLong("amount"),"Yield record mismatch");}
            JSONArray pending=actual.optJSONArray("pendingInterest"),epending=expected.optJSONArray("pendingInterest");
            check((pending==null?0:pending.length())==(epending==null?0:epending.length()),"Pending interest count mismatch in case "+i);
            if(pending!=null)for(int j=0;j<pending.length();j++){JSONObject p=pending.getJSONObject(j),e=epending.getJSONObject(j);check(p.getString("id").equals(e.getString("id"))&&p.getLong("amount")==e.getLong("amount")&&p.getString("date").equals(e.getString("date"))&&p.getString("accountId").equals(e.getString("accountId")),"Pending interest mismatch in case "+i);}
            check(!InterestEngine.settle(actual,asOf),"Settlement was not idempotent");
        }
    }
    private void currentDayFundQuote()throws Exception{
        String current=java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE);
        JSONObject quote=new JSONObject().put("fundCode","017269").put("date",current).put("incomeUnit","0.2666");
        JSONObject market=new JSONObject().put("000300.SH",new JSONObject().put("ALL",new JSONObject().put("fundMarketInfos",new JSONArray().put(quote))));
        JSONObject parsed=FundSync.parse("var settings1="+quote+";\nvar fundMarketInfo="+market+";",1);
        check("0.2666".equals(parsed.getJSONObject("quotes").getString(java.time.LocalDate.now().toString())),"Current-day official quote was discarded");
        String compact="var settings1="+quote+";\nvar fundMarketInfo="+market+";\nvar unrelated={";
        JSONObject ranged=FundSync.parseCompact(compact,1);
        check("0.2666".equals(ranged.getJSONObject("quotes").getString(java.time.LocalDate.now().toString())),"Compact fund response changed quotes");
    }
    private void submit(String formId,String fields) throws Exception {action("var f=document.getElementById('"+formId+"');"+fields+";f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");}
    private void open() throws Exception {
        Intent launch=new Intent().setClassName("cn.zhangben.paw","cn.zhangben.paw.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=startActivitySync(launch);ready();
    }
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            getTargetContext().getSharedPreferences("privacy",0).edit().clear().commit();
            currentDayFundQuote();
            crossEngineFixtures();
            // When a v1 APK was seeded, verify the actual on-device migration before resetting QA data.
            if(saved().optInt("version")==1){open();check(saved().getInt("version")==2,"v1 was not migrated");check("升级保留备注".equals(saved().getJSONArray("transactions").getJSONObject(2).getString("note")),"Upgrade lost notes");check("147150".equals(js("(function(){var b=Ledger.balances(JSON.parse(Android.loadState()));return b.savings+b.free})()")),"Upgrade changed balances");runOnMainSync(()->activity.finish());}
            // No WebView is involved in this catch-up: load the old state through the native store first.
            JSONObject catchup=new JSONArray(asset("interest-fixtures.json")).getJSONObject(0);getTargetContext().getSharedPreferences("ledger",0).edit().putString("state",catchup.getJSONObject("input").toString()).commit();
            JSONObject accrued=new JSONObject(LedgerStore.load(getTargetContext()));
            check(InterestEngine.balance(accrued,"savings-main",null)==catchup.getJSONObject("balances").getLong("savings-main"),"Background catch-up failed");
            getTargetContext().getSharedPreferences("ledger",0).edit().clear().commit();
            getTargetContext().getSharedPreferences("reminder_sent",0).edit().clear().commit();
            open();
            check("true".equals(js("!!window.Android")),"Native bridge missing");
            action("document.querySelector('[data-action=balances]').click()");
            submit("balances-form","f.elements.savings.value='1000';f.elements.free.value='500'");
            submit("entry-form","f.elements.amount.value='28.50';f.elements.note.value='native expense'");
            check(saved().getJSONArray("transactions").length()==3,"Native transaction was not persisted");
            check("147150".equals(js("(function(){var b=Ledger.balances(JSON.parse(Android.loadState()));return b.savings+b.free})()")),"Asset calculation mismatch");
            check("[7000,3000]".equals(js("Ledger.allocate(10000,[{percent:'70'},{percent:'30'}]).map(function(r){return r.amount})")),"BigInt allocation unavailable in WebView");
            check("true".equals(js("!!document.querySelector('#monthly-report')&&!document.querySelector('#asset-trend')")),"Month report was not moved to ledger");
            action("document.querySelector('[data-action=transfer]').click()");
            submit("transfer-form","f.elements.amount.value='100';f.elements.fee.value='1.50'");
            check(InterestEngine.balance(saved(),"free-main",null)==37000,"Native fee debit mismatch");
            check(InterestEngine.balance(saved(),"savings-main",null)==110000,"Transfer receiver mismatch");
            check("150".equals(js("Ledger.monthlyReport(JSON.parse(Android.loadState()),Ledger.today().slice(0,7)).fees")),"Fee missing from monthly report");
            action("var t=JSON.parse(Android.loadState()).transactions.at(-1);document.querySelector('[data-action=transaction][data-id=\"'+t.id+'\"]').click();document.querySelector('[data-action=delete-transaction]').click();document.querySelector('#confirm-action').click()");
            check(InterestEngine.balance(saved(),"free-main",null)==47150,"Deleting transfer did not restore fee");
            action("document.querySelector('[data-tab=plans]').click();document.querySelector('[data-action=new-plan]').click()");
            submit("plan-form","f.elements.name.value='Native reminder QA';f.elements.target.value='50';f.elements.daily.value='50';f.elements.time.value=new Date().toTimeString().slice(0,5)");
            JSONObject p=saved().getJSONArray("plans").getJSONObject(0);String planId=p.getString("id");
            NotificationManager nm=(NotificationManager)getTargetContext().getSystemService(Context.NOTIFICATION_SERVICE);
            boolean seen=false;
            for(int i=0;i<25;i++){for(android.service.notification.StatusBarNotification n:nm.getActiveNotifications())if(planId.equals(n.getTag()))seen=true;if(seen)break;Thread.sleep(500);}
            check(seen,"Scheduled native reminder did not arrive");
            action("document.querySelector('[data-action=contribute]').click()");
            submit("contribute-form","f.elements.amount.value='50';f.elements.mode.value='transfer'");
            check(saved().getJSONArray("plans").getJSONObject(0).getJSONArray("entries").length()==1,"Plan contribution missing");
            check("true".equals(js("Ledger.complete(JSON.parse(Android.loadState()).plans[0])")),"Plan did not auto-complete");
            for(android.service.notification.StatusBarNotification n:nm.getActiveNotifications())check(!planId.equals(n.getTag()),"Completed plan reminder was not cleared");
            String before=saved().toString();runOnMainSync(()->activity.finish());open();
            check(before.equals(saved().toString()),"Activity restart lost saved data");
            check("147150".equals(js("(function(){var b=Ledger.balances(JSON.parse(Android.loadState()));return b.savings+b.free})()")),"Transfer changed total assets");
            JSONObject stale=saved();stale.put("revision",stale.getLong("revision")-1);String preserved=saved().toString();check(!LedgerStore.save(getTargetContext(),stale.toString()),"Stale write was accepted");check(preserved.equals(saved().toString()),"Stale write changed assets");
            result.putString("stream","PASS: APK launch, actual v1 migration (when seeded), 17 cross-engine interest fixtures, transfer fee UI/native balances and deletion, ledger monthly report, background catch-up, stale-write protection, shared assets, real scheduled notification, linked plan transfer/completion, notification cancellation, restart persistence.\n");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable error){result.putString("stream","FAIL: "+android.util.Log.getStackTraceString(error));finish(Activity.RESULT_CANCELED,result);}
    }
}
