package cn.zhangben.paw;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import org.json.*;
import java.time.LocalDate;
import java.util.*;

/** Manual live-network probe: fetch official 万份收益, then settle tomorrow in memory. Not part of the shipped APK. */
public class FundProbe extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            JSONObject s=new JSONObject(LedgerStore.load(getTargetContext()));
            JSONObject data;String source="live";
            try{data=FundSync.fetch();}
            catch(Exception network){data=s.optJSONObject("fundData");source="cached";if(data==null)throw network;}
            if("live".equals(source)&&FundSync.lastDownloadedBytes>1024*1024)throw new AssertionError("Ranged fund download exceeded 1 MiB: "+FundSync.lastDownloadedBytes);
            JSONObject quotes=data.getJSONObject("quotes");
            ArrayList<String> days=new ArrayList<>();Iterator<String> it=quotes.keys();while(it.hasNext())days.add(it.next());Collections.sort(days);
            String latest=days.get(days.size()-1),income=quotes.getString(latest);
            s.put("fundData",data);
            JSONArray accounts=s.getJSONArray("accounts");JSONObject account=accounts.getJSONObject(0);
            account.getJSONObject("rule").put("mode","fund").put("rate","0");
            account.put("openedOn",latest).put("lastAccruedDate",LocalDate.parse(latest).minusDays(1).toString()).put("carry",0);
            long before=500000;
            s.put("transactions",new JSONArray().put(new JSONObject().put("id","probe_open").put("kind","adjustment").put("bucket","savings").put("accountId","savings-main").put("amount",before).put("date",latest).put("effectiveDate",latest).put("createdAt",1).put("note","probe").put("tagIds",new JSONArray())));
            s.put("pendingInterest",new JSONArray()).put("deletedInterest",new JSONArray());
            String asOf=LocalDate.parse(latest).plusDays(1).toString();
            InterestEngine.settle(s,asOf);
            long balance=InterestEngine.balance(s,"savings-main",null);
            long paid=0;String id="";JSONArray pa=s.optJSONArray("pendingInterest");
            if(pa!=null)for(int i=0;i<pa.length();i++){JSONObject p=pa.getJSONObject(i);if("savings-main".equals(p.optString("accountId"))){paid+=p.getLong("amount");id=p.getString("id");}}
            long paidDelta=paid;
            long expected=new java.math.BigInteger(String.valueOf(before)).multiply(new java.math.BigDecimal(income).movePointRight(6).toBigIntegerExact()).divide(java.math.BigInteger.valueOf(10000)).divide(java.math.BigInteger.valueOf(1000000)).longValueExact();
            if(paidDelta!=expected)throw new AssertionError("pending interest mismatch: expected "+expected+" got "+paidDelta);
            if(balance!=before)throw new AssertionError("pending interest changed the balance: expected "+before+" got "+balance);
            JSONObject catchup=new JSONObject(s.toString());
            String opening=LocalDate.parse(latest).minusDays(3).toString();
            if(!quotes.has(opening)||!quotes.has(LocalDate.parse(latest).minusDays(1).toString()))throw new AssertionError("recent official history is incomplete");
            catchup.put("pendingInterest",new JSONArray());
            catchup.getJSONArray("transactions").getJSONObject(0).put("date",opening).put("effectiveDate",opening);
            JSONObject catchupAccount=catchup.getJSONArray("accounts").getJSONObject(0);
            catchupAccount.put("openedOn",opening).put("lastAccruedDate",LocalDate.parse(opening).minusDays(1).toString()).put("carry",0);
            InterestEngine.settle(catchup,latest);
            int caught=catchup.getJSONArray("pendingInterest").length();
            if(caught!=3||!catchupAccount.getString("error").isEmpty())throw new AssertionError("three-day catch-up failed: pending="+caught+" error="+catchupAccount.getString("error"));
            StringBuilder text=new StringBuilder("PASS("+source+"): downloadedBytes="+FundSync.lastDownloadedBytes+" quotes="+days.size()+" latest="+latest+" income="+income+" asOf="+asOf);
            text.append("\nlastAccrued=").append(account.getString("lastAccruedDate")).append(" error=").append(account.getString("error"));
            text.append("\nbalance=").append(balance).append(" pendingInterestDelta=").append(paidDelta).append(" lastId=").append(id);
            text.append("\nexpectedFloorCents=").append(expected);
            text.append(" catchupPending=").append(caught);
            result.putString("stream",text.toString()+"\n");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable error){
            android.util.Log.e("FundProbe", "probe failed", error);
            result.putString("stream","FAIL: "+error+"\n"+android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED,result);
        }
    }
}
