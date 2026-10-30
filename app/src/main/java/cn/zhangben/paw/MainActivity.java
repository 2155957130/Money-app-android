package cn.zhangben.paw;

import android.Manifest;
import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private WebView web;
    private AppLock appLock;
    private boolean pageLoaded;
    private String exportSnapshot;
    private static final int EXPORT = 201, IMPORT = 202, BACKUP_FOLDER = 203;
    static final int MAX_BYTES = 8 * 1024 * 1024;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(247,248,242));
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(247,248,242));
        if (Build.VERSION.SDK_INT >= 30) frame.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom));
            return WindowInsets.CONSUMED;
        });
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(247,248,242));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith("file:///android_asset/")) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        });
        frame.addView(web,new FrameLayout.LayoutParams(-1,-1));
        setContentView(frame);
        appLock=new AppLock(this,frame,web,()->{if(!pageLoaded){pageLoaded=true;web.loadUrl("file:///android_asset/index.html");}else web.evaluateJavascript("window.onNativeResume && window.onNativeResume()",null);},()->{if(pageLoaded&&appLock.allowed())web.evaluateJavascript("window.onNativePreferencesChanged && window.onNativePreferencesChanged()",null);});
        appLock.start();
        ReminderReceiver.schedule(this);
    }
    @Override public void onResume() {
        super.onResume();
        ReminderReceiver.schedule(this);
        if(appLock!=null)appLock.onResume();
    }
    @Override public void onPause(){if(appLock!=null)appLock.onPause();super.onPause();}
    @Override public void onBackPressed() {
        if(appLock!=null&&!appLock.allowed()){moveTaskToBack(true);return;}
        web.evaluateJavascript("window.onNativeBack ? window.onNativeBack() : false", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }
    private void callback(String name, String value) {
        web.post(() -> web.evaluateJavascript("window."+name+" && window."+name+"("+JSONObject.quote(value)+")",null));
    }
    private void message(String text) { runOnUiThread(() -> Toast.makeText(this,text,Toast.LENGTH_LONG).show()); }

    final class Bridge {
        @JavascriptInterface public void syncFund(boolean force){
            if(!appLock.allowed())return;
            new Thread(()->{String status=FundSync.sync(getApplicationContext(),force);runOnUiThread(()->{if(appLock.allowed())callback("onFundSynced",status);});},"fund-sync").start();
        }

        @JavascriptInterface public String loadState() { return appLock.allowed()?LedgerStore.load(MainActivity.this):""; }
        @JavascriptInterface public boolean saveState(String value) {
            if(!appLock.allowed())return false;
            String previous=getSharedPreferences("ledger",MODE_PRIVATE).getString("state","");
            boolean ok=LedgerStore.save(MainActivity.this,value);
            if(ok){ReminderReceiver.cancelPlans(MainActivity.this,previous);ReminderReceiver.schedule(MainActivity.this);}
            return ok;
        }
        @JavascriptInterface public boolean restoreState(String value){
            if(!appLock.allowed())return false;
            String previous=getSharedPreferences("ledger",MODE_PRIVATE).getString("state","");
            boolean ok=LedgerStore.save(MainActivity.this,value,true);
            if(ok){ReminderReceiver.cancelPlans(MainActivity.this,previous);ReminderReceiver.schedule(MainActivity.this);}
            return ok;
        }
        @JavascriptInterface public String preferences(){try{JSONObject p=BackupStore.status(MainActivity.this);return p.put("native",true).put("hideAmounts",appLock.hidden()).put("lockEnabled",appLock.enabled()).put("lockDelay",appLock.delay()).toString();}catch(Exception e){return "{}";}}
        @JavascriptInterface public void hideAmounts(boolean value){if(appLock.allowed())runOnUiThread(()->appLock.setHidden(value));}
        @JavascriptInterface public void configureLock(boolean value){if(appLock.allowed())runOnUiThread(()->appLock.requestEnabled(value));}
        @JavascriptInterface public void lockDelay(int seconds){if(appLock.allowed())runOnUiThread(()->appLock.setDelay(seconds));}
        @JavascriptInterface public void lockNow(){if(appLock.allowed())runOnUiThread(()->appLock.lockNow());}
        @JavascriptInterface public void autoBackup(boolean value){if(appLock.allowed())BackupStore.configure(MainActivity.this,value);}
        @JavascriptInterface public String listBackups(){return appLock.allowed()?BackupStore.list(MainActivity.this):"[]";}
        @JavascriptInterface public String loadBackup(String name){if(!appLock.allowed())return "";try{return BackupStore.load(MainActivity.this,name);}catch(Exception error){message(error.getMessage());return "";}}
        @JavascriptInterface public void chooseBackupFolder(){if(!appLock.allowed())return;runOnUiThread(()->{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);try{startActivityForResult(intent,BACKUP_FOLDER);}catch(Exception error){message("当前手机没有可用的文件夹选择器");}});}
        @JavascriptInterface public void clearBackupFolder(){if(appLock.allowed())BackupStore.clearFolder(MainActivity.this);}
        @JavascriptInterface public String reminderStatus() {
            try {
                NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
                NotificationChannel ch=nm.getNotificationChannel(ReminderReceiver.CHANNEL);
                boolean notifications=nm.areNotificationsEnabled() && (ch==null || ch.getImportance()!=NotificationManager.IMPORTANCE_NONE);
                boolean exact=Build.VERSION.SDK_INT<31 || ((AlarmManager)getSystemService(ALARM_SERVICE)).canScheduleExactAlarms();
                return new JSONObject().put("native",true).put("notifications",notifications).put("exact",exact).toString();
            } catch(Exception e) { return "{}"; }
        }
        @JavascriptInterface public void requestNotifications() { runOnUiThread(() -> {
            if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},101);
            } else {
                Intent intent=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName());
                startActivity(intent);
            }
        }); }
        @JavascriptInterface public void requestExactAlarm() { runOnUiThread(() -> {
            if(Build.VERSION.SDK_INT>=31) {
                try { startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName()))); }
                catch(Exception e) { message("请在手机设置中允许 Money 的闹钟和提醒权限"); }
            } else message("当前系统已支持定时提醒");
        }); }
        @JavascriptInterface public void exportBackup(String json) { runOnUiThread(() -> {
            if(!appLock.allowed())return;
            exportSnapshot=json;
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE,"Money备份-"+ReminderReceiver.day(System.currentTimeMillis())+".json");
            try { startActivityForResult(intent,EXPORT); } catch(Exception e) { exportSnapshot=null;message("当前手机没有可用的文件选择器"); }
        }); }
        @JavascriptInterface public void importBackup() { runOnUiThread(() -> {
            if(!appLock.allowed())return;
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try { startActivityForResult(intent,IMPORT); } catch(Exception e) { message("当前手机没有可用的文件选择器"); }
        }); }
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(code,permissions,results);
        ReminderReceiver.schedule(this);
        web.evaluateJavascript("window.onNativeResume && window.onNativeResume()",null);
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(appLock!=null&&appLock.onActivityResult(request,result))return;
        if(request==BACKUP_FOLDER){if(result==RESULT_OK&&data!=null&&data.getData()!=null){try{Uri uri=data.getData();getContentResolver().takePersistableUriPermission(uri,data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));BackupStore.chooseFolder(this,uri);message("自动备份文件夹已设置");}catch(Exception error){message("无法使用这个文件夹："+error.getMessage());}}if(pageLoaded)web.evaluateJavascript("window.onNativePreferencesChanged && window.onNativePreferencesChanged()",null);return;}
        if(result!=RESULT_OK || data==null || data.getData()==null) {exportSnapshot=null;return;}
        Uri uri=data.getData();
        try {
            if(request==EXPORT && exportSnapshot!=null) {
                try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")) {
                    if(out==null) throw new IOException(); out.write(exportSnapshot.getBytes(StandardCharsets.UTF_8));
                }
                message("备份已保存，请妥善保管这个文件");
            } else if(request==IMPORT) {
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                try(InputStream in=getContentResolver().openInputStream(uri)) {
                    if(in==null) throw new IOException(); byte[] buffer=new byte[8192];int n;
                    while((n=in.read(buffer))!=-1){if(bytes.size()+n>MAX_BYTES)throw new IOException("文件不能超过 8 MB");bytes.write(buffer,0,n);}
                }
                callback("onBackupImport",new String(bytes.toByteArray(),StandardCharsets.UTF_8));
            }
        } catch(Exception e) { message("文件操作失败"+(e.getMessage()==null?"":"："+e.getMessage())); }
        finally {exportSnapshot=null;}
    }
}
