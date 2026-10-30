package cn.zhangben.paw;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Daily rotating local snapshots, optional user-selected external folder, and pre-restore protection. */
final class BackupStore {
    private static final ExecutorService WORKER=Executors.newSingleThreadExecutor();
    private static String pendingExternal;
    private static boolean running;
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("backup_settings",0);}
    private static File directory(Context c){File dir=new File(c.getFilesDir(),"ledger_backups");if(!dir.exists()&&!dir.mkdirs())throw new IllegalStateException("无法创建备份目录");return dir;}
    private static String day(){return InterestEngine.today();}
    static boolean enabled(Context c){return prefs(c).getBoolean("enabled",true);}
    private static boolean valid(String json){try{JSONObject s=new JSONObject(json);return (s.optInt("version")==1||s.optInt("version")==2)&&s.optJSONArray("transactions")!=null;}catch(Exception e){return false;}}
    private static void write(Context c,String name,String json)throws IOException{
        AtomicFile file=new AtomicFile(new File(directory(c),name));FileOutputStream out=null;
        try{out=file.startWrite();out.write(json.getBytes(StandardCharsets.UTF_8));file.finishWrite(out);}catch(IOException error){if(out!=null)file.failWrite(out);throw error;}
    }
    static synchronized void protect(Context c,String previous){
        if(!valid(previous))return;
        try{write(c,"before-restore-"+System.currentTimeMillis()+".json",previous);prune(c,"before-restore-",5);}catch(Exception error){prefs(c).edit().putString("localError","恢复前快照失败："+error.getMessage()).apply();}
    }
    static synchronized void afterSave(Context context,String json){
        Context c=context.getApplicationContext();if(!enabled(c)||!valid(json))return;
        try{write(c,"daily-"+day()+".json",json);prune(c,"daily-",14);prefs(c).edit().putLong("localAt",System.currentTimeMillis()).remove("localError").apply();}
        catch(Exception error){prefs(c).edit().putString("localError","本机自动备份失败："+error.getMessage()).apply();}
        queueExternal(c,json);
    }
    private static void prune(Context c,String prefix,int keep){File[] files=directory(c).listFiles((dir,name)->name.startsWith(prefix)&&name.endsWith(".json"));if(files==null)return;Arrays.sort(files,(a,b)->b.getName().compareTo(a.getName()));for(int i=keep;i<files.length;i++)files[i].delete();}
    static void configure(Context c,boolean value){prefs(c).edit().putBoolean("enabled",value).commit();if(value)synchronized(LedgerStore.LOCK){afterSave(c,c.getSharedPreferences("ledger",0).getString("state",""));}}
    static synchronized String load(Context c,String name)throws IOException{
        if(!name.matches("(daily-\\d{4}-\\d{2}-\\d{2}|before-restore-\\d+)\\.json"))throw new IOException("无效的备份名称");
        File file=new File(directory(c),name);if(!file.exists()||file.length()>MainActivity.MAX_BYTES)throw new IOException("备份不存在或过大");
        ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=new FileInputStream(file)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>MainActivity.MAX_BYTES)throw new IOException("文件过大");out.write(b,0,n);}}return new String(out.toByteArray(),StandardCharsets.UTF_8);
    }
    static synchronized String list(Context c){JSONArray result=new JSONArray();try{File[] files=directory(c).listFiles((dir,name)->name.matches("(daily-\\d{4}-\\d{2}-\\d{2}|before-restore-\\d+)\\.json"));if(files!=null){Arrays.sort(files,(a,b)->Long.compare(b.lastModified(),a.lastModified()));for(File f:files){try{JSONObject s=new JSONObject(load(c,f.getName()));result.put(new JSONObject().put("id",f.getName()).put("time",f.lastModified()).put("bytes",f.length()).put("reason",f.getName().startsWith("daily-")?"每日自动备份":"恢复前保护备份").put("transactions",s.getJSONArray("transactions").length()).put("accounts",s.optJSONArray("accounts")==null?2:s.getJSONArray("accounts").length()));}catch(Exception ignored){}}}}catch(Exception ignored){}return result.toString();}
    static JSONObject status(Context c)throws JSONException{return new JSONObject().put("autoBackup",enabled(c)).put("backupLocalAt",prefs(c).getLong("localAt",0)).put("backupExternalAt",prefs(c).getLong("externalAt",0)).put("backupFolder",prefs(c).getString("folderName","")).put("backupError",prefs(c).getString("localError","")+prefs(c).getString("externalError",""));}
    static void chooseFolder(Context c,Uri tree)throws Exception{
        Uri doc=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));String name="已选择的文件夹";
        try(Cursor cursor=c.getContentResolver().query(doc,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}
        prefs(c).edit().putString("folder",tree.toString()).putString("folderName",name).remove("externalError").commit();
        synchronized(LedgerStore.LOCK){afterSave(c,c.getSharedPreferences("ledger",0).getString("state",""));}
    }
    static void clearFolder(Context c){prefs(c).edit().remove("folder").remove("folderName").remove("externalError").commit();}
    private static synchronized void queueExternal(Context c,String json){
        if(prefs(c).getString("folder","").isEmpty())return;pendingExternal=json;if(running)return;running=true;
        WORKER.execute(()->{while(true){String value;synchronized(BackupStore.class){value=pendingExternal;pendingExternal=null;if(value==null){running=false;return;}}
            if(!enabled(c))continue;try{writeExternal(c,value);prefs(c).edit().putLong("externalAt",System.currentTimeMillis()).remove("externalError").apply();}
            catch(Exception e){prefs(c).edit().putString("externalError","外部备份失败："+e.getMessage()).apply();}
        }});
    }
    private static void writeExternal(Context c,String json)throws Exception{
        String configured=prefs(c).getString("folder","");if(configured.isEmpty())return;Uri tree=Uri.parse(configured);String parentId=DocumentsContract.getTreeDocumentId(tree);
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parentId),parent=DocumentsContract.buildDocumentUriUsingTree(tree,parentId),target=null;
        String filename="Money-自动备份-"+day()+".json";ArrayList<String[]> older=new ArrayList<>();
        try(Cursor cursor=c.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
            if(cursor==null)throw new IOException("无法读取所选文件夹");while(cursor.moveToNext()){String name=cursor.getString(1),id=cursor.getString(0);if(filename.equals(name))target=DocumentsContract.buildDocumentUriUsingTree(tree,id);if(name!=null&&name.matches("(账本|Money)-自动备份-\\d{4}-\\d{2}-\\d{2}\\.json"))older.add(new String[]{name,id});}
        }
        if(target==null)target=DocumentsContract.createDocument(c.getContentResolver(),parent,"application/json",filename);
        if(target==null)throw new IOException("无法创建备份文件");
        try(OutputStream out=c.getContentResolver().openOutputStream(target,"wt")){if(out==null)throw new IOException("无法写入文件");out.write(json.getBytes(StandardCharsets.UTF_8));}
        Collections.sort(older,(a,b)->b[0].compareTo(a[0]));int keep=0;for(String[] item:older){if(item[0].equals(filename))continue;if(++keep>=14)DocumentsContract.deleteDocument(c.getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(tree,item[1]));}
    }
}
