package cn.zhangben.paw;

import android.app.*;
import android.content.*;
import android.os.Build;
import org.json.*;
import java.util.Calendar;

public final class InterestReceiver extends BroadcastReceiver {
    static void schedule(Context c){
        FundSync.schedule(c);
        try{
            AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pi=PendingIntent.getBroadcast(c,921,new Intent(c,InterestReceiver.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            am.cancel(pi);String raw=c.getSharedPreferences("ledger",0).getString("state","");JSONObject s=new JSONObject(raw);
            if(s.optInt("version")!=2)return;
            boolean active=false;JSONArray accounts=s.getJSONArray("accounts");for(int i=0;i<accounts.length();i++)if(!"none".equals(accounts.getJSONObject(i).getJSONObject("rule").getString("mode")))active=true;
            if(!active)return;
            Calendar next=Calendar.getInstance();next.add(Calendar.DAY_OF_YEAR,1);next.set(Calendar.HOUR_OF_DAY,0);next.set(Calendar.MINUTE,0);next.set(Calendar.SECOND,5);next.set(Calendar.MILLISECOND,0);
            try{if(Build.VERSION.SDK_INT<31||am.canScheduleExactAlarms())am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next.getTimeInMillis(),pi);else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next.getTimeInMillis(),pi);}catch(SecurityException error){am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next.getTimeInMillis(),pi);}
        }catch(Exception ignored){}
    }
    @Override public void onReceive(Context c,Intent intent){LedgerStore.load(c);ReminderReceiver.schedule(c);}
}
