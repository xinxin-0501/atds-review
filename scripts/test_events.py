#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
test_events.py —— 验证 AKShare 事件数据源(step 1)
拉取莲花控股(600186)近 30 天公告,验证减持/增发/回购/股东大会/监管问询等事件能否拿到。
运行: python test_events.py
"""
import sys
import datetime

TODAY = datetime.date.today()
START = (TODAY - datetime.timedelta(days=30)).strftime("%Y%m%d")
END = TODAY.strftime("%Y%m%d")

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


def test_akshare(code="600186"):
    print(f"=== 测试 AKShare: 拉取 {code} 近30天公告 ({START}~{END}) ===")
    try:
        import akshare as ak
    except ImportError as e:
        print("✗ akshare 未安装:", e)
        print("  提示: pip install -i https://pypi.tuna.tsinghua.edu.cn/simple akshare")
        return False

    df = None
    # 主函数: 巨潮个股公告(按代码+日期范围)
    try:
        df = ak.stock_zh_a_disclosure_report_cninfo(
            symbol=code, market="沪深京", start_date=START, end_date=END
        )
    except Exception as e:
        print("✗ stock_zh_a_disclosure_report_cninfo 失败:", repr(e))

    if df is None or len(df) == 0:
        # 备选函数: stock_notice_report(全市场按日期,再按代码过滤)
        print("  尝试备选 stock_notice_report ...")
        try:
            df = ak.stock_notice_report(symbol="全部", date=TODAY.strftime("%Y%m%d"))
            if df is not None and len(df):
                df = df[df["代码"] == code] if "代码" in df.columns else df
        except Exception as e:
            print("✗ stock_notice_report 失败:", repr(e))

    if df is None or len(df) == 0:
        print("✗ 未能拿到公告数据(可能接口变化或该股票近期无公告)")
        return False

    print(f"✓ 拿到 {len(df)} 条公告,列名: {list(df.columns)}")
    title_col = next((c for c in df.columns if "标题" in c or "名称" in c or "title" in str(c).lower()), None)
    date_col = next((c for c in df.columns if "日期" in c or "时间" in c or "date" in str(c).lower()), None)

    hits = 0
    for _, row in df.iterrows():
        title = str(row.get(title_col, "") or "").strip()
        if not title:
            continue
        t, d, lv = classify(title)
        if t:
            hits += 1
            dt = str(row.get(date_col, "") or "")[:10]
            print(f"  [{lv}|{d}] {dt} {t} · {title[:30]}")
    print(f"=== 结果: 命中 {hits} 条关键事件 (减持/回购/增发/股东大会/问询等) ===")
    return hits > 0


if __name__ == "__main__":
    code = sys.argv[1] if len(sys.argv) > 1 else "600186"
    ok = test_akshare(code)
    sys.exit(0 if ok else 1)
