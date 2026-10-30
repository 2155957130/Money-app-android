package cn.zhangben.paw;

import android.content.*;
import android.app.job.*;
import org.json.*;
import java.net.*;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.*;
import java.math.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Fetches public fund prices only. No balances, identifiers or credentials leave the device. */
final class FundSync {
    static final String URL="https://www.xqfunds.com/js/static/017269.js";
    static final AtomicBoolean busy=new AtomicBoolean();
    static long lastAttempt,lastFailure;
    static boolean enabled(JSONObject state)throws JSONException{
        JSONArray accounts=state.getJSONArray("accounts");for(int i=0;i<accounts.length();i++)if(!accounts.getJSONObject(i).optBoolean("archived",false)&&"fund".equals(accounts.getJSONObject(i).getJSONObject("rule").getString("mode")))return true;return false;
    }
    static void schedule(Context c){
        try{
            JobScheduler jobs=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            JSONObject state=new JSONObject(c.getSharedPreferences("ledger",0).getString("state",""));
            if(!enabled(state)){jobs.cancel(927);return;}
            if(jobs.getPendingJob(927)==null)jobs.schedule(new JobInfo.Builder(927,new ComponentName(c,FundSyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(6*60*60*1000L).setPersisted(true).build());
        }catch(Exception ignored){}
    }
    static JSONObject variable(String text,String name)throws Exception{
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("(?:^|[;\\r\\n])\\s*var\\s+"+name+"\\s*=\\s*").matcher(text);
        if(!m.find())throw new IOException("官网数据格式变化");
        return (JSONObject)new JSONTokener(text.substring(m.end())).nextValue();
    }
    static JSONObject parse(String text,long fetchedAt)throws Exception{
        JSONObject latest=variable(text,"settings1");if(!"017269".equals(latest.getString("fundCode")))throw new IOException("基金代码不匹配");
        JSONArray rows=variable(text,"fundMarketInfo").getJSONObject("000300.SH").getJSONObject("ALL").getJSONArray("fundMarketInfos");
        return parseRows(latest,rows,fetchedAt);
    }
    static final class IncompleteFeedException extends IOException{IncompleteFeedException(){super("基金历史数据需要更大下载范围");}}
    /** The official file puts settings1 and the complete ALL history near its front. */
    static JSONObject parseCompact(String text,long fetchedAt)throws Exception{
        JSONObject latest;
        try{latest=variable(text,"settings1");}catch(Exception error){throw new IncompleteFeedException();}
        if(!"017269".equals(latest.getString("fundCode")))throw new IOException("基金代码不匹配");
        int market=text.indexOf("var fundMarketInfo");
        int code=market<0?-1:text.indexOf("\"000300.SH\"",market);
        int all=code<0?-1:text.indexOf("\"ALL\"",code);
        if(all<0||all-code>500000)throw new IncompleteFeedException();
        java.util.regex.Matcher match=java.util.regex.Pattern.compile("\"ALL\"\\s*:\\s*").matcher(text);
        if(!match.find(all))throw new IncompleteFeedException();
        JSONArray rows;
        try{rows=((JSONObject)new JSONTokener(text.substring(match.end())).nextValue()).getJSONArray("fundMarketInfos");}
        catch(JSONException error){throw new IncompleteFeedException();}
        return parseRows(latest,rows,fetchedAt);
    }
    static JSONObject parseRows(JSONObject latest,JSONArray rows,long fetchedAt)throws Exception{
        if(rows.length()==0||rows.length()>36600)throw new IOException("历史收益数据无效");
        JSONObject quotes=new JSONObject();String last="";
        for(int i=0;i<rows.length();i++){
            JSONObject row=rows.getJSONObject(i);if(!"017269".equals(row.getString("fundCode")))throw new IOException("历史基金代码不匹配");
            String day=LocalDate.parse(row.getString("date"),DateTimeFormatter.BASIC_ISO_DATE).toString();
            // The fund can publish today's quote before midnight. Keep it cached; settlement only runs through yesterday.
            if(day.compareTo(InterestEngine.today())>0)continue;
            if(!row.has("incomeUnit"))continue;
            String value=row.getString("incomeUnit");BigDecimal n=new BigDecimal(value);
            if(!value.matches("-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?")||n.abs().compareTo(new BigDecimal("100"))>0)throw new IOException("万份收益数值无效");
            if(quotes.has(day)&&!quotes.getString(day).equals(value))throw new IOException("同日收益数据冲突");
            quotes.put(day,value);if(day.compareTo(last)>0)last=day;
        }
        String expected=LocalDate.parse(latest.getString("date"),DateTimeFormatter.BASIC_ISO_DATE).toString();
        if(last.isEmpty()||!last.equals(expected)||!quotes.getString(last).equals(latest.getString("incomeUnit")))throw new IOException("最新与历史收益不一致");
        return new JSONObject().put("code","017269").put("source","xqfunds").put("updatedAt",fetchedAt).put("quotes",quotes);
    }
    static volatile long lastDownloadedBytes;
    static final class Download{final byte[] bytes;final boolean partial;Download(byte[] value,boolean ranged){bytes=value;partial=ranged;}}
    static Download download(int firstBytes)throws Exception{
        HttpsURLConnection connection=(HttpsURLConnection)new java.net.URL(URL).openConnection();
        connection.setConnectTimeout(20000);connection.setReadTimeout(30000);connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
        connection.setRequestProperty("Accept","application/javascript,text/plain");
        if(firstBytes>0)connection.setRequestProperty("Range","bytes=0-"+(firstBytes-1));
        try{
            int status=connection.getResponseCode();
            if(status!=200&&status!=206)throw new IOException("官网暂时无法连接");
            boolean partial=status==206;
            String contentRange=connection.getHeaderField("Content-Range");
            if(partial&&(firstBytes<=0||contentRange==null||!contentRange.matches("bytes 0-[0-9]+/[0-9]+")))throw new IOException("官网分段数据无效");
            int limit=partial?firstBytes:12*1024*1024;
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();long deadline=System.currentTimeMillis()+90000;
            try(InputStream in=connection.getInputStream()){byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>limit)throw new IOException("官网响应过大");if(System.currentTimeMillis()>deadline)throw new IOException("官网下载超时，请稍后重试");bytes.write(buffer,0,n);}}
            lastDownloadedBytes+=bytes.size();
            return new Download(bytes.toByteArray(),partial);
        }finally{connection.disconnect();}
    }
    static JSONObject fetch()throws Exception{
        lastDownloadedBytes=0;
        for(int size:new int[]{512*1024,1024*1024}){
            Download response=download(size);String body=new String(response.bytes,StandardCharsets.UTF_8);
            if(!response.partial)return parse(body,System.currentTimeMillis());
            try{return parseCompact(body,System.currentTimeMillis());}
            catch(IncompleteFeedException missing){/* The ALL section grew beyond this range. */}
        }
        return parse(new String(download(0).bytes,StandardCharsets.UTF_8),System.currentTimeMillis());
    }
    static String reason(Exception error){
        String message=error.getMessage();
        if(message!=null&&message.matches(".*[\\u4e00-\\u9fa5].*"))return message;
        if(error instanceof UnknownHostException||error instanceof SocketTimeoutException||error instanceof javax.net.ssl.SSLException)return "网络连接失败，请检查网络后重试";
        return "官网暂时无法获取数据，请稍后重试";
    }
    static String sync(Context c,boolean force){
        if(!busy.compareAndSet(false,true))return "正在更新基金收益";
        try{
            String raw=c.getSharedPreferences("ledger",0).getString("state","");
            if(raw.isEmpty())return "";
            JSONObject before=new JSONObject(raw);
            if(!enabled(before))return force?"请先在明细账户选择微信零钱通":"";
            long now=System.currentTimeMillis();
            if(!force&&(now-lastAttempt<60*60*1000||now-lastFailure<10*60*1000))return "";
            JSONObject data=fetch();
            lastAttempt=System.currentTimeMillis();lastFailure=0;
            synchronized(LedgerStore.LOCK){
                JSONObject state=new JSONObject(c.getSharedPreferences("ledger",0).getString("state",""));
                if(!enabled(state))return "";
                state.put("fundData",data);InterestEngine.settle(state,InterestEngine.today());state.put("revision",state.getLong("revision")+1);
                if(!LedgerStore.save(c,state.toString()))throw new IOException("保存未完成，请重试");
            }
            return force?"基金收益已更新":"";
        }catch(Exception e){lastFailure=System.currentTimeMillis();return "基金更新失败："+reason(e)+"。已保留原记录";}
        finally{busy.set(false);}
    }
}
