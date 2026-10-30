package cn.zhangben.paw;
import android.app.job.*;
public final class FundSyncJob extends JobService {
    @Override public boolean onStartJob(JobParameters p){new Thread(()->{FundSync.sync(getApplicationContext(),false);jobFinished(p,false);},"fund-sync").start();return true;}
    @Override public boolean onStopJob(JobParameters p){return true;}
}
