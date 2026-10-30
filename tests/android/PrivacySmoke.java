package cn.zhangben.paw;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import android.webkit.WebView;
import android.database.Cursor;
import android.provider.DocumentsContract;
import org.json.*;
import java.lang.reflect.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public class PrivacySmoke extends Instrumentation {
    Activity activity;WebView web;AppLock lock;
    void check(boolean v,String m){if(!v)throw new AssertionError(m);}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    String js(String code)throws Exception{CountDownLatch done=new CountDownLatch(1);String[] result={null};runOnMainSync(()->web.evaluateJavascript(code,value->{result[0]=value;done.countDown();}));check(done.await(15,TimeUnit.SECONDS),"JS timeout");return result[0];}
    void action(String code)throws Exception{String result=js("(function(){try{"+code+";return 'OK'}catch(e){return e.stack||e.message}})()");check("\"OK\"".equals(result),result);}
    JSONObject saved()throws Exception{return new JSONObject(getTargetContext().getSharedPreferences("ledger",0).getString("state","{}"));}
    void mark(String text){Bundle b=new Bundle();b.putString("stream",text+"\n");sendStatus(1,b);}
    void open(boolean ready)throws Exception{activity=startActivitySync(new Intent().setClassName("cn.zhangben.paw","cn.zhangben.paw.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));Field w=activity.getClass().getDeclaredField("web");w.setAccessible(true);web=(WebView)w.get(activity);Field l=activity.getClass().getDeclaredField("appLock");l.setAccessible(true);lock=(AppLock)l.get(activity);if(ready)ready();}
    void ready()throws Exception{for(int i=0;i<60;i++){if("true".equals(js("!!document.querySelector('#entry-form')")))return;Thread.sleep(200);}throw new AssertionError("App page not loaded");}
    void shell(String command)throws Exception{try(ParcelFileDescriptor p=getUiAutomation().executeShellCommand(command);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(p)){byte[] b=new byte[1024];while(in.read(b)!=-1){}}}
    void pin()throws Exception{Thread.sleep(900);shell("input text 123456");shell("input keyevent 66");Thread.sleep(700);}
    void waitEnabled(boolean expected)throws Exception{for(int i=0;i<40;i++){if(lock.enabled()==expected)return;Thread.sleep(200);}throw new AssertionError("System credential auth did not finish; enabled="+lock.enabled());}
    void pressUnlock()throws Exception{runOnMainSync(()->{ArrayList<View> views=new ArrayList<>();activity.getWindow().getDecorView().findViewsWithText(views,"解锁 Money",View.FIND_VIEWS_WITH_TEXT);for(View v:views)if(v instanceof Button){v.performClick();return;}throw new AssertionError("Unlock button missing");});}
    AccessibilityNodeInfo find(AccessibilityNodeInfo node,String label){if(node==null)return null;String text=node.getText()==null?"":node.getText().toString(),desc=node.getContentDescription()==null?"":node.getContentDescription().toString();if(text.equalsIgnoreCase(label)||desc.equalsIgnoreCase(label))return node;for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo match=find(node.getChild(i),label);if(match!=null)return match;}return null;}
    void clickSystem(String label)throws Exception{for(int i=0;i<40;i++){AccessibilityNodeInfo node=find(getUiAutomation().getRootInActiveWindow(),label);if(node!=null){for(int j=0;j<5&&node!=null;j++,node=node.getParent())if(node.isClickable()&&node.isEnabled()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;}Thread.sleep(150);}throw new AssertionError("System picker button missing: "+label);}
    @Override public void onStart(){Bundle result=new Bundle();try{
        Context c=getTargetContext();c.getSharedPreferences("privacy",0).edit().clear().commit();BackupStore.clearFolder(c);BackupStore.configure(c,true);mark("Opening clean app");open(true);mark("App ready");
        action("document.querySelector('[data-action=settings]').click();document.querySelector('[data-action=manage-tags]').click();var f=document.getElementById('tag-form');f.elements.name.value='原生标签测试';f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
        check(saved().getJSONArray("tags").length()>0,"Tag was not persisted");
        JSONArray list=new JSONArray(BackupStore.list(c));check(list.length()>0,"No automatic local backup");String dailyId="";for(int i=0;i<list.length();i++)if(dailyId.isEmpty()&&list.getJSONObject(i).getString("id").startsWith("daily-"))dailyId=list.getJSONObject(i).getString("id");check(!dailyId.isEmpty(),"Daily backup missing");
        JSONObject snapshot=new JSONObject(BackupStore.load(c,dailyId));check(snapshot.getJSONArray("tags").length()==saved().getJSONArray("tags").length(),"Auto backup lost tags");
        try{BackupStore.load(c,"../ledger.xml");throw new AssertionError("Path traversal allowed");}catch(IOException expected){}
        String unchanged=saved().toString();action("document.querySelector('#modal [data-action=close]').click();document.querySelector('[data-action=settings]').click();document.querySelector('[data-action=backup-list]').click();document.querySelector('[data-action=preview-backup]').click()");
        check("true".equals(js("document.querySelector('#modal-title').textContent==='恢复预览' && !!document.querySelector('#confirm-action')")),"Restore preview missing");check(unchanged.equals(saved().toString()),"Preview changed the ledger");action("document.querySelector('#confirm-action').click()");
        list=new JSONArray(BackupStore.list(c));boolean protection=false;for(int i=0;i<list.length();i++)if(list.getJSONObject(i).getString("id").startsWith("before-restore-"))protection=true;check(protection,"No protective pre-restore snapshot");
        // The production SAF writer is exercised through a test-only DocumentsProvider.
        mark("Local backup and preview passed; opening system folder picker");Uri tree=Uri.parse("content://cn.zhangben.paw.test.documents/tree/root");long started=System.currentTimeMillis();
        runOnMainSync(()->activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).putExtra(DocumentsContract.EXTRA_INITIAL_URI,DocumentsContract.buildDocumentUriUsingTree(tree,"root")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),203));
        clickSystem("Show roots");clickSystem("Money独立测试文件夹");clickSystem("Use this folder");clickSystem("Allow");
        for(int i=0;i<60;i++){if(BackupStore.status(c).getLong("backupExternalAt")>=started)break;Thread.sleep(200);}
        check(BackupStore.status(c).getLong("backupExternalAt")>=started,"External SAF backup failed: "+BackupStore.status(c).optString("backupError"));
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,"root");boolean found=false;try(Cursor cursor=c.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID},null,null,null)){while(cursor!=null&&cursor.moveToNext()){Uri file=DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0));ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=c.getContentResolver().openInputStream(file)){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);}JSONObject external=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));check(external.getJSONArray("tags").length()==saved().getJSONArray("tags").length(),"External backup contents mismatch");found=true;}}check(found,"No file written into selected tree");BackupStore.clearFolder(c);
        // Amount hiding persists and applies to the actual WebView.
        mark("External folder backup passed");action("Android.hideAmounts(true)");for(int i=0;i<30;i++){if(lock.hidden())break;Thread.sleep(100);}check(lock.hidden(),"Hide preference not stored");
        action("document.querySelector('[data-tab=mine]').click()");check("true".equals(js("document.querySelector('.hero-amount').textContent.indexOf('••••')>=0")),"Visible amount leaked");
        // Enabling and disabling use the real Android credential screen (QA PIN only).
        mark("Enabling app lock through Android credentials");action("Android.configureLock(true)");pin();waitEnabled(true);check((activity.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_SECURE)!=0,"Recent task/screenshot protection missing");mark("Lock enabled");
        runOnMainSync(()->lock.setDelay(0));shell("input keyevent 3");Thread.sleep(300);check(!lock.allowed(),"Immediate background lock was bypassed");runOnMainSync(()->activity.startActivity(new Intent().setClassName("cn.zhangben.paw","cn.zhangben.paw.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));pin();for(int i=0;i<40&&!lock.allowed();i++)Thread.sleep(200);check(lock.allowed(),"Immediate-return credential verification failed");
        runOnMainSync(()->lock.lockNow());check(!lock.allowed(),"Manual lock did not lock");check(web.getVisibility()==View.INVISIBLE,"Locked WebView remained visible");check("\"\"".equals(js("Android.loadState()")),"Locked bridge leaked ledger data");check("false".equals(js("Android.saveState('{}')")),"Locked bridge accepted a write");
        pressUnlock();Thread.sleep(600);shell("input keyevent 4");Thread.sleep(500);check(!lock.allowed(),"Canceling authentication unlocked data");
        pressUnlock();pin();for(int i=0;i<40&&!lock.allowed();i++)Thread.sleep(200);check(lock.allowed(),"Correct device credential did not unlock");
        mark("Manual unlock passed; testing cold launch");runOnMainSync(()->activity.finish());open(false);check(!lock.allowed(),"Cold launch bypassed authentication");pin();for(int i=0;i<40&&!lock.allowed();i++)Thread.sleep(200);check(lock.allowed(),"Cold launch PIN unlock failed");ready();
        action("Android.configureLock(false)");pin();waitEnabled(false);action("Android.hideAmounts(false)");BackupStore.clearFolder(c);
        result.putString("stream","PASS: native tag persistence, atomic daily backup, restore preview/protective snapshot, SAF folder writing, amount hiding, real Android PIN enable/unlock/cancel/cold-launch/disable, locked bridge gating and secure task protection.\n");finish(Activity.RESULT_OK,result);
    }catch(Throwable e){result.putString("stream","FAIL: "+android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
}
