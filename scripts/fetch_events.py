#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_events.py —— 事件数据采集(AKShare 主源 + 巨潮降级),输出本地缓存
将观察池个股的 减持/增发/回购/股东大会/监管问询 等事件写入 data/events_cache.json。
cloud_fetch.mjs 读取该缓存(命中则不再重复请求巨潮,实现"盘中读缓存")。

架构:
  - 主源 AKShare(底层封装巨潮/东财,自动处理反爬)
  - 降级 巨潮 http://www.cninfo.com.cn/new/hisAnnouncement/query(POST JSON)
  - 5秒超时 + 3次重试 + 本地缓存 + "不造假"降级提示
用法: python fetch_events.py
"""
import os
import json
import datetime
import urllib.request
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config.json")
CACHE_PATH = os.path.join(ROOT, "data", "events_cache.json")

# 关键词 → (eventType, direction, impactLevel)
KW = [
    ("减持", "减持", "利空", "高"), ("增持", "增持", "利好", "中"),
    ("增发", "增发", "中性", "中"), ("非公开发行", "增发", "中性", "中"),
    ("定增", "增发", "中性", "中"), ("配股", "增发", "中性", "中"),
    ("回购", "回购", "利好", "中"),
    ("股东大会", "股东大会", "中性", "低"), ("股东会", "股东大会", "中性", "低"),
    ("问询", "监管问询", "利空", "高"), ("关注函", "监管问询", "利空", "高"),
    ("监管函", "监管问询", "利空", "高"), ("警示函", "监管问询", "利空", "高"),
    ("立案", "监管问询", "利空", "高"), ("处罚", "监管问询", "利空", "高"),
    ("调查", "监管问询", "利空", "高"),
    ("解禁", "解禁", "利空", "中"), ("限售", "解禁", "利空", "中"),
    ("重组", "重组", "中性", "中"), ("并购", "重组", "中性", "中"),
    ("收购", "重组", "中性", "中"),
    ("停牌", "停牌", "中性", "中"), ("复牌", "复牌", "中性", "低"),
]


def classify(title):
    for kw, t, d, lv in KW:
        if kw in title:
            if t == "回购" and "注销" in title:
                d = "中性"
            return t, d, lv
    return None, None, None


def bj_today():
    return (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")


def days_left(d, today):
    dt = datetime.datetime.strptime(d, "%Y-%m-%d")
    tt = datetime.datetime.strptime(today, "%Y-%m-%d")
    return (dt - tt).days


def make_event(title, date_str, today, source):
    t, d, lv = classify(title)
    if not t:
        return None
    left = days_left(date_str, today)
    cnt = ("T-%d天" % left) if left > 0 else (("%d天前" % abs(left)) if left < 0 else "今日")
    return {
        "type": t, "eventType": t,
        "name": title[:30], "title": title[:30],
        "date": date_str, "eventDate": date_str, "left": left, "countdown": cnt,
        "dir": d, "direction": d, "level": lv, "impactLevel": lv,
        "detail": title[:48], "source": source,
    }


def fetch_cninfo(code, name):
    """巨潮公告检索(降级备选):POST JSON,5秒超时+3次重试。返回 [(title, date)]"""
    num = code
    c0 = num[0]
    if c0 in "489":
        return []  # 北交所巨潮口径不完整
    org_id = ("gssh0" + num) if c0 in "65" else ("gssz0" + num)
    today = bj_today()
    start = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=8) - datetime.timedelta(days=30)).strftime("%Y-%m-%d")

    def post(body):
        for attempt in range(3):
            req = urllib.request.Request(
                "https://www.cninfo.com.cn/new/hisAnnouncement/query",
                data=body.encode("utf-8"),
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception:
                if attempt == 2:
                    raise
        return None

    def body_for(stock_val):
        return "pageNum=1&pageSize=50&column=szse&tabName=fulltext&plate=&stock=%s&searchkey=&secid=&category=&trade=&seDate=%s~%s&sortName=&sortType=&isHLtitle=true" % (
            urllib.parse.quote(stock_val), start, today)

    try:
        j = post(body_for(num + "," + org_id))
        anns = (j or {}).get("announcements") or []
        if not anns and name:
            j2 = post("pageNum=1&pageSize=50&column=szse&tabName=fulltext&plate=&stock=&searchkey=%s&secid=&category=&trade=&seDate=%s~%s&sortName=&sortType=&isHLtitle=true" % (
                urllib.parse.quote(name), start, today))
            anns = [a for a in ((j2 or {}).get("announcements") or []) if str(a.get("secCode")) == num]
    except Exception as e:
        print("  [巨潮降级失败]", code, name, repr(e))
        return None  # None = 源不可用

    out = []
    for a in anns:
        title = str(a.get("announcementTitle") or "").replace("<em>", "").replace("</em>", "")
        ts = a.get("announcementTime")
        date_str = (datetime.datetime.fromtimestamp((ts + 8 * 3600 * 1000) / 1000, tz=datetime.timezone.utc).strftime("%Y-%m-%d") if ts else today)
        out.append((title, date_str))
    return out


def fetch_akshare(code):
    """AKShare 主源:巨潮个股公告。返回 [(title, date)] 或 None(失败)"""
    today = bj_today()
    start = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=8) - datetime.timedelta(days=30)).strftime("%Y%m%d")
    end = today.replace("-", "")
    try:
        import akshare as ak
        df = ak.stock_zh_a_disclosure_report_cninfo(symbol=code, market="沪深京", start_date=start, end_date=end)
    except Exception as e:
        print("  [AKShare 失败]", code, repr(e))
        return None
    if df is None or len(df) == 0:
        return []
    title_col = next((c for c in df.columns if "标题" in c or "名称" in c or "title" in str(c).lower()), None)
    date_col = next((c for c in df.columns if "日期" in c or "时间" in c or "date" in str(c).lower()), None)
    out = []
    for _, row in df.iterrows():
        title = str(row.get(title_col, "") or "").strip()
        if not title:
            continue
        date_str = str(row.get(date_col, "") or "")[:10].replace("/", "-")
        if not date_str or date_str == "nan":
            date_str = today
        out.append((title, date_str))
    return out


def main():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    watch = [(w["code"], w["name"]) for w in cfg.get("watchlist", []) if w.get("code")]
    today = bj_today()

    # 盘中读缓存:今天已抓过则跳过(事件类数据无需实时刷新,盘前/盘后各一次即可)
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, encoding="utf-8") as f:
                old = json.load(f)
            if old.get("date") == today and old.get("byCode"):
                print(f"今日缓存已存在({len(old['byCode'])} 只),盘中跳过重抓")
                return
        except Exception:
            pass

    by_code = {}
    for code, name in watch:
        events = []
        source_ok = False
        # 主源: AKShare
        try:
            raw = fetch_akshare(code)
            if raw is not None:
                source_ok = True
                source = "AKShare"
            else:
                # 降级: 巨潮直连
                raw = fetch_cninfo(code, name)
                if raw is not None:
                    source_ok = True
                    source = "巨潮"
        except Exception:
            raw = None
        if raw is None:
            print(f"{code} {name}: 源不可用(不缓存,下次重试)")
            continue
        for title, date_str in raw:
            ev = make_event(title, date_str, today, source)
            if ev:
                events.append(ev)
        lv_rank = {"高": 0, "中": 1, "低": 2}
        events.sort(key=lambda e: (lv_rank.get(e["level"], 2), e["date"]))
        by_code[code] = events
        print(f"{code} {name}: {len(events)} 条事件 [{source}]")

    cache = {"date": today, "byCode": by_code}
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    print(f"✓ 已写入缓存 {CACHE_PATH} ({len(by_code)} 只股票)")


if __name__ == "__main__":
    main()
