package cn.zhangben.paw;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.webkit.WebView;
import org.json.*;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Manual QA helper: builds a small WeChat 零钱通 demo with a pending transfer. Not part of the shipped APK. */
public class WechatDemo extends Instrumentation {
    private Activity activity;
    private WebView web;
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private String js(String code) throws Exception {
        CountDownLatch done=new CountDownLatch(1);String[] value={null};
        runOnMainSync(()->web.evaluateJavascript(code,result->{value[0]=result;done.countDown();}));
        if(!done.await(15,TimeUnit.SECONDS))throw new AssertionError("JavaScript timeout");
        return value[0];
    }
    private void action(String code)throws Exception{String result=js("(function(){try{"+code+";return 'OK'}catch(e){return e.stack||e.message}})()");if(!"\"OK\"".equals(result))throw new AssertionError(result);}
    private void submit(String formId,String fields)throws Exception{action("var f=document.getElementById('"+formId+"');"+fields+";f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");}
    private void ready()throws Exception{for(int i=0;i<60;i++){if("true".equals(js("!!document.querySelector('#entry-form')")))return;Thread.sleep(300);}throw new AssertionError("Page not ready");}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            activity=startActivitySync(new android.content.Intent().setClassName("cn.zhangben.paw","cn.zhangben.paw.MainActivity").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            Field field=activity.getClass().getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
            ready();
            action("document.querySelector('[data-action=balances]').click()");
            submit("balances-form","f.elements.savings.value='5000';f.elements.free.value='1200'");
            action("document.querySelector('[data-tab=mine]').click()");
            action("document.querySelector('[data-action=accounts][data-id=savings]').click()");
            action("document.querySelector('[data-action=edit-account]').click()");
            submit("account-form","f.elements.name.value='微信零钱通';f.elements.balance.value='5000';f.elements.mode.value='fund'");
            Thread.sleep(5000);
            action("document.querySelector('[data-action=transfer]').click()");
            submit("transfer-form","f.elements.fromAccountId.value='free-main';f.elements.toAccountId.value='savings-main';f.elements.time.value='14:00';f.elements.amount.value='1000';f.elements.note.value='转入零钱通'");
            action("document.querySelector('[data-action=transfer]').click()");
            submit("transfer-form","f.elements.fromAccountId.value='savings-main';f.elements.toAccountId.value='free-main';f.elements.time.value='16:00';f.elements.amount.value='100';f.elements.outMethod.value='normal';f.elements.note.value='普通转出'");
            JSONObject state=new JSONObject(activity.getSharedPreferences("ledger",0).getString("state","{}"));
            JSONObject account=state.getJSONArray("accounts").getJSONObject(0);
            JSONObject last=state.getJSONArray("transactions").getJSONObject(state.getJSONArray("transactions").length()-1);
            result.putString("stream","PASS: balance="+InterestEngine.balance(state,"savings-main",null)+" mode="+account.getJSONObject("rule").getString("mode")+" lastTime="+last.optString("time")+" outMethod="+last.optString("outMethod")+" confirm="+InterestEngine.confirmDate(last.getString("effectiveDate"),last.optString("time"))+"\n");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable error){result.putString("stream","FAIL: "+error+"\n"+android.util.Log.getStackTraceString(error));finish(Activity.RESULT_CANCELED,result);}
    }
}
