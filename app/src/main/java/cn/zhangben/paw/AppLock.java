package cn.zhangben.paw;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.hardware.biometrics.BiometricPrompt;
import android.os.*;
import android.view.*;
import android.widget.*;

/** Uses the phone's authentication UI; the app never stores a PIN or biometric data. */
final class AppLock {
    static final int CREDENTIAL_REQUEST=801;
    private final Activity activity;
    private final FrameLayout root;
    private final View content;
    private final Runnable unlocked,changed;
    private View cover;
    private volatile boolean authenticated,authenticating,foreground,pendingAuthResume;
    private volatile long backgroundAt,verifiedAt;
    private Runnable pendingSuccess,pendingCancel;
    AppLock(Activity a,FrameLayout root,View content,Runnable unlocked,Runnable changed){this.activity=a;this.root=root;this.content=content;this.unlocked=unlocked;this.changed=changed;authenticated=!enabled();}
    private SharedPreferences prefs(){return activity.getSharedPreferences("privacy",0);}
    boolean enabled(){return prefs().getBoolean("lockEnabled",false);}
    boolean allowed(){return !enabled()||(authenticated&&(backgroundAt==0||SystemClock.elapsedRealtime()-backgroundAt<delay()*1000L));}
    boolean hidden(){return prefs().getBoolean("hideAmounts",false);}
    int delay(){return prefs().getInt("lockDelay",30);}
    void setHidden(boolean value){prefs().edit().putBoolean("hideAmounts",value).commit();changed.run();}
    void setDelay(int seconds){if(seconds!=0&&seconds!=30&&seconds!=60)return;prefs().edit().putInt("lockDelay",seconds).commit();changed.run();}
    void start(){updateSecure();if(enabled())showCover();else showContent();}
    void onPause(){foreground=false;if(enabled()){if(backgroundAt==0)backgroundAt=SystemClock.elapsedRealtime();showCover();}}
    void onResume(){
        foreground=true;
        if(!enabled()){authenticated=true;showContent();return;}
        if(authenticating)return;
        boolean justVerified=pendingAuthResume&&SystemClock.elapsedRealtime()-verifiedAt<2000;pendingAuthResume=false;
        if(!justVerified&&backgroundAt>0&&SystemClock.elapsedRealtime()-backgroundAt>=delay()*1000L)authenticated=false;
        backgroundAt=0;
        if(authenticated)showContent();else{showCover();unlock();}
    }
    void lockNow(){if(!enabled())return;authenticated=false;showCover();}
    private void updateSecure(){if(enabled())activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);}
    private void showCover(){
        content.setVisibility(View.INVISIBLE);
        if(cover==null){
            LinearLayout layout=new LinearLayout(activity);layout.setOrientation(LinearLayout.VERTICAL);layout.setGravity(Gravity.CENTER);layout.setPadding(60,60,60,60);layout.setBackgroundColor(Color.rgb(247,248,242));
            ImageView paw=new ImageView(activity);paw.setImageResource(R.drawable.ic_launcher);int size=(int)(76*activity.getResources().getDisplayMetrics().density);layout.addView(paw,new LinearLayout.LayoutParams(size,size));
            TextView title=new TextView(activity);title.setText("Money 已锁定");title.setTextSize(24);title.setTextColor(Color.rgb(35,60,49));title.setPadding(0,36,0,15);layout.addView(title);
            TextView note=new TextView(activity);note.setText("使用手机指纹或锁屏密码继续");note.setTextColor(Color.rgb(123,132,124));note.setGravity(Gravity.CENTER);layout.addView(note);
            Button button=new Button(activity);button.setText("解锁 Money");button.setOnClickListener(v->unlock());LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-2,-2);params.topMargin=36;layout.addView(button,params);
            layout.setContentDescription("Money 已锁定");cover=layout;root.addView(cover,new FrameLayout.LayoutParams(-1,-1));
        }
        cover.setVisibility(View.VISIBLE);cover.bringToFront();
    }
    private void showContent(){if(enabled()&&!foreground){showCover();return;}if(cover!=null)cover.setVisibility(View.GONE);content.setVisibility(View.VISIBLE);unlocked.run();}
    private void verified(){authenticated=true;verifiedAt=SystemClock.elapsedRealtime();pendingAuthResume=!foreground;backgroundAt=foreground?0:verifiedAt;}
    void requestEnabled(boolean value){
        if(value==enabled())return;
        KeyguardManager km=(KeyguardManager)activity.getSystemService(Context.KEYGUARD_SERVICE);
        if(!km.isDeviceSecure()){Toast.makeText(activity,"请先在手机系统设置中设置锁屏密码，再开启应用锁",Toast.LENGTH_LONG).show();return;}
        authenticate(()->{prefs().edit().putBoolean("lockEnabled",value).commit();verified();updateSecure();showContent();changed.run();},()->{if(enabled()){if(backgroundAt>0&&SystemClock.elapsedRealtime()-backgroundAt>=delay()*1000L)authenticated=false;if(foreground&&authenticated){backgroundAt=0;showContent();}else showCover();}changed.run();});
    }
    private void unlock(){if(authenticating||!enabled())return;authenticate(()->{verified();showContent();changed.run();},()->{authenticated=false;showCover();});}
    private void authenticate(Runnable success,Runnable cancel){
        if(authenticating)return;authenticating=true;pendingSuccess=success;pendingCancel=cancel;
        if(Build.VERSION.SDK_INT>=30){
            try{
                BiometricPrompt prompt=new BiometricPrompt.Builder(activity).setTitle("验证身份以使用 Money").setSubtitle("使用手机生物识别或锁屏密码").setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG|android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL).build();
                prompt.authenticate(new CancellationSignal(),activity.getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result){finish(true);}
                    @Override public void onAuthenticationError(int code,CharSequence message){if(code==BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS||code==BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT||code==BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE)credential();else finish(false);}
                });return;
            }catch(Exception ignored){}
        }
        credential();
    }
    private void credential(){try{KeyguardManager km=(KeyguardManager)activity.getSystemService(Context.KEYGUARD_SERVICE);Intent intent=km.createConfirmDeviceCredentialIntent("解锁 Money","验证手机锁屏密码");if(intent==null){finish(false);return;}activity.startActivityForResult(intent,CREDENTIAL_REQUEST);}catch(Exception error){finish(false);}}
    boolean onActivityResult(int request,int result){if(request!=CREDENTIAL_REQUEST)return false;finish(result==Activity.RESULT_OK);return true;}
    private void finish(boolean success){Runnable action=success?pendingSuccess:pendingCancel;pendingSuccess=null;pendingCancel=null;authenticating=false;if(action!=null)action.run();}
}
