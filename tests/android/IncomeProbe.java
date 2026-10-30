package cn.zhangben.paw;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.webkit.WebView;
import org.json.*;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Manual QA probe for the income form submit path. Not part of the shipped APK. */
public class IncomeProbe extends Instrumentation {
    private Activity activity;private WebView web;
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private String js(String code)throws Exception{CountDownLatch done=new CountDownLatch(1);String[] value={null};runOnMainSync(()->web.evaluateJavascript(code,r->{value[0]=r;done.countDown();}));if(!done.await(15,TimeUnit.SECONDS))throw new AssertionError("js timeout");return value[0];}
    private void ready()throws Exception{for(int i=0;i<60;i++){if("true".equals(js("!!document.querySelector('#entry-form')")))return;Thread.sleep(300);}throw new AssertionError("page not ready");}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            activity=startActivitySync(new android.content.Intent().setClassName("cn.zhangben.paw","cn.zhangben.paw.MainActivity").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            Field field=activity.getClass().getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);ready();
            js("document.querySelector('[data-action=kind][data-id=income]').click()");
            Thread.sleep(300);
            js("var f=document.getElementById('entry-form');f.elements.amount.value='100';f.elements.time.value='';f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
            Thread.sleep(1500);
            JSONObject s=new JSONObject(activity.getSharedPreferences("ledger",0).getString("state","{}"));
            JSONArray tx=s.getJSONArray("transactions");String last=tx.length()==0?"none":tx.getJSONObject(tx.length()-1).optString("kind")+":"+tx.getJSONObject(tx.length()-1).optLong("amount");
            js("document.querySelector('[data-action=kind][data-id=income]').click()");
            Thread.sleep(300);
            js("var f=document.getElementById('entry-form');f.elements.amount.value='';f.elements.time.value='';f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
            Thread.sleep(500);
            String toast=js("document.getElementById('toast').textContent");
            result.putString("stream","PASS: transactions="+tx.length()+" last="+last+" emptyAmountToast="+toast+"\n");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable error){result.putString("stream","FAIL: "+error+"\n"+android.util.Log.getStackTraceString(error));finish(Activity.RESULT_CANCELED,result);}
    }
}
