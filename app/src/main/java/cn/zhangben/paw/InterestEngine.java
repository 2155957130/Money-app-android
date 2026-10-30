package cn.zhangben.paw;

import org.json.*;
import java.math.*;
import java.time.*;
import java.util.*;

/** Pure daily settlement. The same state and rules are used by the UI and background receiver. */
public final class InterestEngine {
    static final long LIMIT=9000000000000L;
    static final BigInteger MICRO=BigInteger.valueOf(1000000);
    static String previous(String date){return LocalDate.parse(date).minusDays(1).toString();}
    static String next(String date){return LocalDate.parse(date).plusDays(1).toString();}
    static String today(){return LocalDate.now().toString();}
    static long delta(JSONObject t,String id)throws JSONException{
        long amount=t.getLong("amount");
        if("transfer".equals(t.getString("kind"))){if(id.equals(t.getString("fromAccountId")))return -amount-t.optLong("fee",0);if(id.equals(t.getString("toAccountId")))return amount;return 0;}
        if(!id.equals(t.getString("accountId")))return 0;
        return "expense".equals(t.getString("kind"))?-amount:amount;
    }
    static long balance(JSONObject s,String id,String through)throws JSONException{
        long balance=0;JSONArray tx=s.getJSONArray("transactions");
        for(int i=0;i<tx.length();i++){JSONObject t=tx.getJSONObject(i);if(through==null||t.getString("effectiveDate").compareTo(through)<=0)balance+=delta(t,id);}
        return balance;
    }
    static long principal(JSONObject s,String id,String through)throws JSONException{
        ArrayList<JSONObject> tx=new ArrayList<>();JSONArray all=s.getJSONArray("transactions");
        for(int i=0;i<all.length();i++){JSONObject t=all.getJSONObject(i);if(through==null||t.getString("effectiveDate").compareTo(through)<=0)tx.add(t);}
        Collections.sort(tx,(a,b)->{int cmp=a.optString("effectiveDate").compareTo(b.optString("effectiveDate"));return cmp!=0?cmp:Long.compare(a.optLong("createdAt"),b.optLong("createdAt"));});
        long balance=0,interest=0;
        for(JSONObject t:tx){long change=delta(t,id);balance+=change;if("interest".equals(t.getString("kind")))interest+=change;if(change<0)interest=Math.min(interest,Math.max(0,balance));}
        return Math.max(0,balance-interest);
    }
    static final String[][] HOLIDAYS={
        {"2024-01-01","2024-01-01"},{"2024-02-09","2024-02-17"},{"2024-04-04","2024-04-06"},{"2024-05-01","2024-05-05"},{"2024-06-08","2024-06-10"},{"2024-09-15","2024-09-17"},{"2024-10-01","2024-10-07"},
        {"2025-01-01","2025-01-01"},{"2025-01-28","2025-02-04"},{"2025-04-04","2025-04-06"},{"2025-05-01","2025-05-05"},{"2025-05-31","2025-06-02"},{"2025-10-01","2025-10-08"},
        {"2026-01-01","2026-01-03"},{"2026-02-15","2026-02-23"},{"2026-04-04","2026-04-06"},{"2026-05-01","2026-05-05"},{"2026-06-19","2026-06-21"},{"2026-09-25","2026-09-27"},{"2026-10-01","2026-10-07"},
        {"2027-01-01","2027-01-01"}
    };
    static boolean tradingDay(String date){
        LocalDate day=LocalDate.parse(date);if(day.getDayOfWeek().getValue()>=6)return false;
        for(String[] range:HOLIDAYS)if(date.compareTo(range[0])>=0&&date.compareTo(range[1])<=0)return false;
        return true;
    }
    static String nextTradingDay(String date){
        String next=next(date);
        for(int i=0;i<60&&!tradingDay(next);i++)next=next(next);
        return next;
    }
    static String confirmDate(String date,String time){
        boolean before=time==null||time.isEmpty()||time.compareTo("15:00")<0;
        String order=tradingDay(date)&&before?date:nextTradingDay(date);
        return nextTradingDay(order);
    }
    static String earnStart(JSONObject a,JSONObject t)throws JSONException{
        String id=a.getString("id"),opened=a.getString("openedOn"),kind=t.getString("kind"),effective=t.getString("effectiveDate");
        boolean initial=t.optBoolean("initial",false)||(!t.has("time")&&effective.compareTo(opened)<=0);
        if("transfer".equals(kind)&&id.equals(t.optString("toAccountId")))return initial?effective:confirmDate(effective,t.optString("time",""));
        if("income".equals(kind)&&id.equals(t.optString("accountId")))return initial?effective:confirmDate(effective,t.optString("time",""));
        return effective;
    }
    static String earnEnd(JSONObject a,JSONObject t)throws JSONException{
        String id=a.getString("id"),kind=t.getString("kind");
        if("transfer".equals(kind)&&id.equals(t.optString("fromAccountId"))&&"normal".equals(t.optString("outMethod")))return t.getString("effectiveDate");
        return previous(t.getString("effectiveDate"));
    }
    /** Confirmed zero-change balance that earns interest on the given day. */
    static long fundBalance(JSONObject s,JSONObject a,String date)throws JSONException{
        long balance=0;String id=a.getString("id");JSONArray tx=s.getJSONArray("transactions");
        for(int i=0;i<tx.length();i++){
            JSONObject t=tx.getJSONObject(i);long change=delta(t,id);if(change==0)continue;
            if(change>0){
                if("interest".equals(t.getString("kind"))&&"fund".equals(t.optString("yieldMode"))&&t.has("sourceDate")){
                    if(t.getString("sourceDate").compareTo(date)<0)balance+=change;
                }else if(earnStart(a,t).compareTo(date)<=0)balance+=change;
            }
            else{
                String end=earnEnd(a,t);
                if(date.compareTo(end)>0)balance+=change;
                else if(date.equals(end)&&"transfer".equals(t.getString("kind"))&&id.equals(t.optString("fromAccountId"))&&"normal".equals(t.optString("outMethod"))&&t.optLong("fee",0)>0)balance-=t.optLong("fee",0);
            }
        }
        JSONArray pending=s.optJSONArray("pendingInterest");
        if(pending!=null)for(int i=0;i<pending.length();i++){
            JSONObject p=pending.getJSONObject(i);
            if(id.equals(p.getString("accountId"))&&"fund".equals(p.optString("yieldMode"))&&p.getString("date").compareTo(date)<0)balance+=p.getLong("amount");
        }
        return Math.max(0,balance);
    }
    static BigInteger daily(JSONObject s,JSONObject a,String date)throws Exception{
        JSONObject r=a.getJSONObject("rule");String mode=r.getString("mode"),id=a.getString("id");
        long b=balance(s,id,date),p=principal(s,id,date);
        if("none".equals(mode))return BigInteger.ZERO;
        if("fund".equals(mode)){
            JSONObject data=s.optJSONObject("fundData"),quotes=data==null?null:data.optJSONObject("quotes");
            if(quotes==null||!quotes.has(date))throw new IllegalArgumentException("等待官方公布 "+date+" 万份收益");
            BigDecimal value=new BigDecimal(quotes.getString(date));if(value.signum()<0)throw new IllegalArgumentException("该日为负收益，请核对实际到账后手动记账");
            return BigInteger.valueOf(fundBalance(s,a,date)).multiply(value.movePointRight(6).toBigIntegerExact()).divide(BigInteger.valueOf(10000));
        }
        if("fixed".equals(mode))return new BigDecimal(r.getString("fixed")).movePointRight(2).toBigIntegerExact().multiply(MICRO);
        if("formula".equals(mode)){
            String expression=r.getString("formula").replace("本金",BigDecimal.valueOf(p,2).toPlainString()).replace("余额",BigDecimal.valueOf(b,2).toPlainString()).replace("利率",new BigDecimal(r.getString("rate")).movePointLeft(2).toPlainString()).replace("基数",String.valueOf(r.getInt("basis")));
            double value=new Arithmetic(expression).calculate();
            if(value<0)throw new IllegalArgumentException("每日收益公式的结果不能小于 0");
            return BigInteger.valueOf(Math.round(value*100000000));
        }
        BigInteger units=new BigDecimal(r.getString("rate")).movePointRight(6).toBigIntegerExact();
        long divisor="annual".equals(mode)?r.getInt("basis"):"monthly".equals(mode)?30:1;
        return BigInteger.valueOf(r.getBoolean("compound")?b:p).multiply(units).divide(BigInteger.valueOf(100*divisor));
    }
    static boolean contains(JSONArray tx,String id)throws JSONException{for(int i=0;i<tx.length();i++)if(id.equals(tx.getJSONObject(i).getString("id")))return true;return false;}
    static boolean excluded(JSONObject s,String id){JSONArray deleted=s.optJSONArray("deletedInterest");if(deleted==null)return false;for(int i=0;i<deleted.length();i++)if(id.equals(deleted.optString(i)))return true;return false;}
    static void check(JSONObject s)throws JSONException{
        long total=0;JSONArray accounts=s.getJSONArray("accounts");for(int i=0;i<accounts.length();i++){long b=balance(s,accounts.getJSONObject(i).getString("id"),null);if(b<0||b>LIMIT)throw new IllegalArgumentException("明细账户余额不足或金额超出范围");total+=b;}if(total>LIMIT)throw new IllegalArgumentException("总资产超过可支持范围");
    }
    public static boolean settle(JSONObject s,String asOf)throws Exception{
        if(s.optInt("version")!=2)return false;
        String original=s.toString();String through=previous(asOf);boolean changed=false;JSONArray accounts=s.getJSONArray("accounts"),tx=s.getJSONArray("transactions");
        for(int i=0;i<accounts.length();i++){
            JSONObject a=accounts.getJSONObject(i);if(a.optBoolean("archived",false)||a.getString("lastAccruedDate").compareTo(through)>=0)continue;
            changed=true;
            if("none".equals(a.getJSONObject("rule").getString("mode"))){a.put("lastAccruedDate",through).put("error","");continue;}
            String date=next(a.getString("lastAccruedDate"));int loops=0;
            while(date.compareTo(through)<=0){
                if(++loops>36600)throw new IllegalArgumentException("计息区间超过 100 年，请检查手机日期");
                try{
                    BigInteger credit=daily(s,a,date).add(BigInteger.valueOf(a.getLong("carry")));
                    long amount=credit.divide(MICRO).longValueExact();
                    if(amount>0){
                        String tid="yield_"+a.getString("id")+"_"+date.replace("-","");
                        JSONArray pending=s.optJSONArray("pendingInterest");
                        if(pending==null){pending=new JSONArray();s.put("pendingInterest",pending);}
                        if(!contains(tx,tid)&&!excluded(s,tid)&&!contains(pending,tid)){
                            if(pending.length()>=100000)throw new IllegalArgumentException("待确认利息过多，请先处理");
                            JSONObject entry=new JSONObject().put("id",tid).put("accountId",a.getString("id")).put("bucket",a.getString("bucket")).put("amount",amount).put("date",date).put("createdAt",LocalDate.parse(next(date)).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()).put("note","待确认利息 · "+a.getString("name")+" · "+date);
                            if("fund".equals(a.getJSONObject("rule").getString("mode")))entry.put("yieldMode","fund");
                            pending.put(entry);
                        }
                    }
                    a.put("carry",credit.mod(MICRO).longValue()).put("error","");
                }catch(Exception error){a.put("error",date+"："+error.getMessage());break;}
                a.put("lastAccruedDate",date);date=next(date);
            }
        }
        return !original.equals(s.toString());
    }
    static long progress(JSONObject s,JSONObject p)throws JSONException{
        if(p.has("accountId")&&!p.isNull("accountId")&&!p.optString("accountId").isEmpty())return Math.max(0,balance(s,p.getString("accountId"),null)-p.getLong("baseline"));
        long sum=0;JSONArray entries=p.getJSONArray("entries");for(int i=0;i<entries.length();i++)sum+=entries.getJSONObject(i).getLong("amount");return sum;
    }
    static long paid(JSONObject s,JSONObject p,String date)throws JSONException{
        if(p.has("accountId")&&!p.isNull("accountId")&&!p.optString("accountId").isEmpty()){
            long net=0;JSONArray tx=s.getJSONArray("transactions");for(int i=0;i<tx.length();i++){JSONObject t=tx.getJSONObject(i);if(date.equals(t.getString("effectiveDate"))&&t.getLong("createdAt")>=p.getLong("createdAt"))net+=delta(t,p.getString("accountId"));}JSONArray legacy=p.getJSONArray("entries");for(int i=0;i<legacy.length();i++){JSONObject e=legacy.getJSONObject(i);if(date.equals(e.getString("date"))&&(e.optBoolean("legacy",false)||e.getLong("createdAt")<p.getLong("createdAt")))net+=e.getLong("amount");}return Math.max(0,net);
        }
        long sum=0;JSONArray entries=p.getJSONArray("entries");for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);if(date.equals(e.getString("date")))sum+=e.getLong("amount");}return sum;
    }
    private static strictfp class Arithmetic {
        final String text;int pos;
        Arithmetic(String input){text=input.replaceAll("\\s","").replace('×','*').replace('÷','/').replace('−','-');}
        double calculate(){if(text.isEmpty()||text.length()>150||!text.matches("[0-9.+*/()%\\-]+"))throw new IllegalArgumentException("算式无效");double value=sum();if(pos!=text.length()||!Double.isFinite(value)||Math.abs(value)>LIMIT/100.0)throw new IllegalArgumentException("算式无效或结果过大");return new BigDecimal(value).setScale(8,RoundingMode.HALF_UP).doubleValue();}
        char at(){return pos<text.length()?text.charAt(pos):'\0';}
        double atom(){double value;char c=at();if(c=='+'||c=='-'){pos++;value=atom()*(c=='-'?-1:1);}else if(c=='('){pos++;value=sum();if(at()!=')')throw new IllegalArgumentException("括号不匹配");pos++;}else{int start=pos;boolean dot=false;while(Character.isDigit(at())||at()=='.'&&!dot){if(at()=='.')dot=true;pos++;}if(start==pos)throw new IllegalArgumentException("算式不完整");value=Double.parseDouble(text.substring(start,pos));}if(at()=='%'){value/=100;pos++;}return value;}
        double product(){double v=atom();while(at()=='*'||at()=='/'){char op=text.charAt(pos++);double r=atom();if(op=='/'&&r==0)throw new IllegalArgumentException("不能除以 0");v=op=='*'?v*r:v/r;}return v;}
        double sum(){double v=product();while(at()=='+'||at()=='-'){char op=text.charAt(pos++);double r=product();v=op=='+'?v+r:v-r;}return v;}
    }
}
