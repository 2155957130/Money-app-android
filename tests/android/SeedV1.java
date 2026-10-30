package cn.zhangben.paw;
import android.app.*;
import android.os.Bundle;
import java.io.*;
import java.nio.charset.StandardCharsets;
/** Seeds only this isolated emulator's app data before installing the upgrade. */
public class SeedV1 extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){Bundle result=new Bundle();try{
        ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=getContext().getAssets().open("v1-backup.json")){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
        boolean ok=getTargetContext().getSharedPreferences("ledger",0).edit().putString("state",new String(out.toByteArray(),StandardCharsets.UTF_8)).commit();
        if(!ok)throw new IOException("Seed failed");result.putString("stream","PASS: v1 balances and notes seeded for an actual in-place APK upgrade.\n");finish(Activity.RESULT_OK,result);
    }catch(Exception e){result.putString("stream",android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
}
