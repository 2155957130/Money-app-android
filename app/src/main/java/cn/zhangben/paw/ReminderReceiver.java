package cn.zhangben.paw;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import org.json.*;
import java.text.SimpleDateFormat;
import java.util.*;

public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL="savings_reminders";
    private static final String ACTION="cn.zhangben.paw.REMIND";
    static String day(long millis) {return new SimpleDateFormat("yyyy-MM-dd",Locale.US).format(new Date(millis));}
    private static JSONObject state(Context c) throws JSONException {return new JSONObject(LedgerStore.load(c));}
    private static long total(JSONObject s,JSONObject p,String date) throws JSONException {
        return date==null?InterestEngine.progress(s,p):InterestEngine.paid(s,p,date);
    }
    private static boolean active(JSONObject s,JSONObject p) throws JSONException {
        return !p.optBoolean("paused",false) && (p.isNull("target") || total(s,p,null)<p.getLong("target"));
    }
    private static PendingIntent alarmIntent(Context c,String id,String date) {
        Intent intent=new Intent(c,ReminderReceiver.class).setAction(ACTION).setData(Uri.parse("zhangben://plan/"+id)).putExtra("planId",id).putExtra("date",date);
        return PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static synchronized void cancelPlans(Context c,String json) {
        try {
            JSONArray plans=new JSONObject(json).getJSONArray("plans");AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
            for(int i=0;i<plans.length();i++)am.cancel(alarmIntent(c,plans.getJSONObject(i).getString("id"),""));
        }catch(Exception ignored){}
    }
    static synchronized void schedule(Context c) {
        try {
            JSONObject s=state(c);InterestReceiver.schedule(c);JSONArray plans=s.getJSONArray("plans");
            AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
            android.content.SharedPreferences sent=c.getSharedPreferences("reminder_sent",0);
            boolean enabled=s.getJSONObject("settings").optBoolean("reminders",true);
            NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel=nm.getNotificationChannel(CHANNEL);
            enabled=enabled && nm.areNotificationsEnabled() && (channel==null || channel.getImportance()!=NotificationManager.IMPORTANCE_NONE);
            long now=System.currentTimeMillis();String today=day(now);
            for(int i=0;i<plans.length();i++) {
                JSONObject p=plans.getJSONObject(i);String id=p.getString("id");
                am.cancel(alarmIntent(c,id,""));
                if(!enabled||!active(s,p)) { nm.cancel(id,1); continue; }
                String[] time=p.getString("time").split(":");
                Calendar cal=Calendar.getInstance();cal.set(Calendar.HOUR_OF_DAY,Integer.parseInt(time[0]));cal.set(Calendar.MINUTE,Integer.parseInt(time[1]));cal.set(Calendar.SECOND,0);cal.set(Calendar.MILLISECOND,0);
                boolean fulfilled=total(s,p,today)>=p.getLong("daily");
                if(fulfilled)nm.cancel(id,1);
                if(cal.getTimeInMillis()<=now) {
                    if(!fulfilled && !today.equals(sent.getString(id,""))) cal.setTimeInMillis(now+2500);
                    else cal.add(Calendar.DAY_OF_YEAR,1);
                } else if(fulfilled) cal.add(Calendar.DAY_OF_YEAR,1);
                PendingIntent pi=alarmIntent(c,id,day(cal.getTimeInMillis()));
                try {
                    if(Build.VERSION.SDK_INT<31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,cal.getTimeInMillis(),pi);
                    else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,cal.getTimeInMillis(),pi);
                }catch(SecurityException denied){am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,cal.getTimeInMillis(),pi);}
            }
        }catch(Exception ignored){}
    }
    @Override public void onReceive(Context c,Intent intent) {
        if(ACTION.equals(intent.getAction())) {
            try {
                String today=day(System.currentTimeMillis()),id=intent.getStringExtra("planId");
                JSONObject s=state(c);
                if(s.getJSONObject("settings").optBoolean("reminders",true) && today.equals(intent.getStringExtra("date"))) {
                    JSONArray plans=s.getJSONArray("plans");
                    for(int i=0;i<plans.length();i++){
                        JSONObject p=plans.getJSONObject(i);
                        if(!p.getString("id").equals(id)||!active(s,p)) continue;
                        long remaining=p.getLong("daily")-total(s,p,today);
                        if(!p.isNull("target"))remaining=Math.min(remaining,p.getLong("target")-total(s,p,null));
                        if(remaining<=0)break;
                        NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
                        nm.createNotificationChannel(new NotificationChannel(CHANNEL,"每日存钱提醒",NotificationManager.IMPORTANCE_DEFAULT));
                        NotificationChannel ch=nm.getNotificationChannel(CHANNEL);
                        if(!nm.areNotificationsEnabled() || ch.getImportance()==NotificationManager.IMPORTANCE_NONE)break;
                        PendingIntent open=PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                        boolean privateAmounts=c.getSharedPreferences("privacy",0).getBoolean("hideAmounts",false)||c.getSharedPreferences("privacy",0).getBoolean("lockEnabled",false);
                        String text=privateAmounts?"今天的存钱计划还未完成，打开 Money 查看并登记。":String.format(Locale.CHINA,"今天还差 ¥%.2f，打开 Money 登记一下吧。",remaining/100.0);
                        Notification publicVersion=new Notification.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("Money · 每日存钱提醒").setContentText("打开 Money 查看存钱计划").build();
                        Notification notification=new Notification.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle(privateAmounts?"Money · 每日存钱提醒":"存钱时间到 · "+p.getString("name")).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(publicVersion).setContentIntent(open).setAutoCancel(true).build();
                        nm.notify(id,1,notification);
                        c.getSharedPreferences("reminder_sent",0).edit().putString(id,today).commit();
                        break;
                    }
                }
            }catch(Exception ignored){}
        }
        schedule(c);
    }
}
