package cn.zhangben.paw;

import android.content.*;
import org.json.*;
import java.nio.charset.StandardCharsets;

/** Serializes background settlement and foreground edits to avoid lost updates. */
final class LedgerStore {
    static final Object LOCK=new Object();
    static String load(Context c){synchronized(LOCK){
        SharedPreferences prefs=c.getSharedPreferences("ledger",0);String raw=prefs.getString("state","");
        try{
            JSONObject s=new JSONObject(raw);
            if(s.optInt("version")==2&&InterestEngine.settle(s,InterestEngine.today())){
                s.put("revision",s.getLong("revision")+1);String updated=s.toString();
                if(updated.getBytes(StandardCharsets.UTF_8).length<=MainActivity.MAX_BYTES&&prefs.edit().putString("state",updated).commit()){BackupStore.afterSave(c,updated);return updated;}
            }
        }catch(Exception ignored){}
        return raw;
    }}
    static boolean save(Context c,String value){return save(c,value,false);}
    static boolean save(Context c,String value,boolean restore){synchronized(LOCK){
        try{
            if(value.getBytes(StandardCharsets.UTF_8).length>MainActivity.MAX_BYTES)return false;
            JSONObject next=new JSONObject(value);if(next.getInt("version")!=2)return false;
            SharedPreferences prefs=c.getSharedPreferences("ledger",0);String previous=prefs.getString("state","");
            long revision=0;if(!restore&&!previous.isEmpty()){JSONObject old=new JSONObject(previous);if(old.optInt("version")==2)revision=old.getLong("revision");}
            if(!restore&&next.getLong("revision")!=revision+1)return false;
            next.getJSONArray("accounts");next.getJSONArray("transactions");next.getJSONArray("plans");
            if(restore)BackupStore.protect(c,previous);
            if(!prefs.edit().putString("state",value).commit())return false;
            BackupStore.afterSave(c,value);
            return true;
        }catch(Exception error){return false;}
    }}
}
