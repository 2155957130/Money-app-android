package cn.zhangben.paw;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.content.Context;
import org.json.*;

/** Manual QA helper: rewinds a demo fund account so pending interest exists. Not part of the shipped APK. */
public class SeedPending extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            Context c=getTargetContext();JSONObject s=new JSONObject(LedgerStore.load(c));
            JSONObject fund=null;JSONArray accounts=s.getJSONArray("accounts");
            for(int i=0;i<accounts.length();i++)if("fund".equals(accounts.getJSONObject(i).getJSONObject("rule").getString("mode")))fund=accounts.getJSONObject(i);
            if(fund==null)throw new AssertionError("no fund account");
            fund.put("openedOn","2026-10-18").put("lastAccruedDate","2026-10-18").put("carry",0);
            JSONArray tx=s.getJSONArray("transactions");
            for(int i=0;i<tx.length();i++){JSONObject t=tx.getJSONObject(i);if("savings-main".equals(t.optString("accountId"))&&"adjustment".equals(t.optString("kind"))&&"2026-10-22".equals(t.optString("effectiveDate"))){t.put("date","2026-10-18").put("effectiveDate","2026-10-18");}}
            s.put("fundData",new JSONObject().put("code","017269").put("source","xqfunds").put("updatedAt",1).put("quotes",new JSONObject().put("2026-10-18","0.2663").put("2026-10-19","0.2663").put("2026-10-20","0.2663").put("2026-10-21","0.2663")));
            InterestEngine.settle(s,"2026-10-22");
            s.put("revision",s.getLong("revision")+1);
            if(!LedgerStore.save(c,s.toString()))throw new AssertionError("save failed");
            JSONArray pending=s.optJSONArray("pendingInterest");long total=0;if(pending!=null)for(int i=0;i<pending.length();i++)total+=pending.getJSONObject(i).getLong("amount");
            result.putString("stream","PASS: pending="+(pending==null?0:pending.length())+" total="+total+" balance="+InterestEngine.balance(s,"savings-main",null)+"\n");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable error){result.putString("stream","FAIL: "+error+"\n"+android.util.Log.getStackTraceString(error));finish(Activity.RESULT_CANCELED,result);}
    }
}
