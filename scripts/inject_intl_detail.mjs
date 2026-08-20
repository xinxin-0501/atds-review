// 注入 intlDetail 字段：将联网检索到的国际联动数据写入午盘快照 JSON
// 用法: node scripts/inject_intl_detail.mjs [YYYYMMDD]  （默认当天）
import fs from 'fs';
import path from 'path';

const ROOT = 'D:/Work buddy/2026-08-12-20-19-30';
const d = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const file = path.join(ROOT, `data/reviews/${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}_11-35.json`);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));

report.intlDetail = {
  asOfLabel: '美股/欧股/商品/VIX/半导体为美东2026-08-19(周三)收盘；离岸人民币/在岸/中间价为8/19数据。注：本快照为收盘后补执行(19:05)，A股指数为8/20盘中快照、东财涨停池为8/20全日涨停数据',
  us: {
    dowJones: { name: '道琼斯工业平均指数', price: 53463.05, changePct: 0.22, time: '美东8/19收盘(结束三连跌,+119.65点)', source: '新华社/腾讯新闻(一手)', url: 'https://news.qq.com/rain/a/20260820A03KND00' },
    sp500: { name: '标普500', price: 7707.98, changePct: 0.21, time: '美东8/19收盘(结束三连跌,+16.22点)', source: '新华社/腾讯新闻(一手)', url: 'https://news.qq.com/rain/a/20260820A03KND00' },
    nasdaq: { name: '纳斯达克综合指数', price: 26331.09, changePct: 0.16, time: '美东8/19收盘(+41.38点,涨幅收窄)', source: '新华社/腾讯新闻(一手)', url: 'https://news.qq.com/rain/a/20260820A03KND00' },
    sox: { name: '费城半导体指数SOX', price: 11738.23, changePct: -2.12, time: '美东8/19收盘(30只成分股仅4只飘红,存储光通信续跌)', source: '新浪财经美股行情(一手API)', url: 'https://hq.sinajs.cn/list=gb_sox' },
    nvda: { name: '英伟达 NVDA', price: 217.56, changePct: -0.99, time: '美东8/19收盘(七巨头唯一下跌)', source: '新浪财经美股行情(一手API)', url: 'https://hq.sinajs.cn/list=gb_nvda' },
    amd: { name: 'AMD', price: 466.42, changePct: -3.71, time: '美东8/19收盘(AI硬件链续跌)', source: '新浪财经美股行情(一手API)', url: 'https://hq.sinajs.cn/list=gb_amd' },
    micron: { name: '美光科技(存储)', price: 937.11, changePct: -0.39, time: '美东8/19收盘(存储整体续跌:希捷-7.87%/西数-6.87%/闪迪-3.50%)', source: '东财美股行情(一手)', url: 'https://quote.eastmoney.com/us/MU.html' },
    bio: { name: '纳斯达克生物科技指数', price: null, changePct: 6.40, time: '美东8/19收盘(六年最大单日涨幅)', source: '每日经济新闻(一手)', url: 'https://new.qq.com/rain/a/20260820A02YHK00' }
  },
  europe: {
    ftse100: { name: '英国富时100', price: 10743.35, changePct: 0.14, time: '8/19收盘', source: '新华社(官方)', url: 'https://www.xinhuanet.com/fortune/20260820/5ce666c54a5941048d0f4070cc29f7e8/c.html' },
    cac40: { name: '法国CAC40', price: 8501.91, changePct: -0.09, time: '8/19收盘', source: '新华社(官方)', url: 'https://www.xinhuanet.com/fortune/20260820/5ce666c54a5941048d0f4070cc29f7e8/c.html' },
    dax: { name: '德国DAX', price: 26091.33, changePct: -0.14, time: '8/19收盘', source: '新华社(官方)', url: 'https://www.xinhuanet.com/fortune/20260820/5ce666c54a5941048d0f4070cc29f7e8/c.html' },
    stoxx600: { name: '欧洲Stoxx50', price: 6444.46, changePct: -0.37, time: '8/19收盘', source: '国际金融报(官方)', url: 'https://so.html5.qq.com/page/real/search_news?docid=70000021_7356a86295581952' }
  },
  commodities: {
    wti: { name: 'WTI原油(当月连续)', price: 84.40, changePct: 0.40, unit: '美元/桶', time: '美东8/19收盘', source: '东财财经早餐(一手)', url: 'https://finance.eastmoney.com/a/202608193846670183.html' },
    wtiSep: { name: 'WTI原油(9月合约)', price: 85.83, changePct: 1.05, unit: '美元/桶', time: '美东8/19收盘(纽约尾盘口径)', source: '每日经济新闻(一手)', url: 'https://new.qq.com/rain/a/20260820A02YHK00' },
    brent: { name: '布伦特原油(10月)', price: 91.65, changePct: 0.69, unit: '美元/桶', time: '美东8/19收盘(霍尔木兹通航受阻+阿联酋断经贸)', source: '东财财经早餐(一手)', url: 'https://finance.eastmoney.com/a/202608193846670183.html' },
    comexGold: { name: 'COMEX黄金期货', price: 4580.70, changePct: 3.62, unit: '美元/盎司', time: '美东8/19收盘(+160.10美元,突破4500)', source: '东财财经早餐(一手)', url: 'https://finance.eastmoney.com/a/202608193846670183.html' },
    spotGold: { name: '现货黄金', price: 4521.87, changePct: 4.35, unit: '美元/盎司', time: '美东8/19收盘(六日最大涨幅)', source: '美股复盘行情终端(一手)', url: 'https://www.dahecube.com/article.html?artid=284011?recid=1' }
  },
  fx: {
    usdcnh: { name: '离岸人民币(美元兑CNH)', price: 6.7398, changePct: null, time: '8/19北京时间18:00(升52.8bp)', source: '东财财经早餐(官方媒体)', url: 'https://finance.eastmoney.com/a/202608193846670183.html' },
    usdcnhNy: { name: '离岸人民币(纽约尾盘)', price: 6.7308, changePct: null, time: '8/19纽约尾盘(较前日涨155点,创月内新高)', source: '每日经济新闻(一手)', url: 'https://new.qq.com/rain/a/20260820A02YHK00' },
    cnyOnshore: { name: '在岸人民币', price: 6.7377, changePct: null, time: '8/19 16:30收盘(升50bp)', source: '东财财经早餐(官方媒体)', url: 'https://finance.eastmoney.com/a/202608193846670183.html' },
    cnyFixing: { name: '人民币对美元中间价', price: 6.7854, changePct: null, unit: '调升51基点(前值6.7905)', time: '8/19', source: '北京商报/人民银行(官方)', url: 'https://www.sohu.com/a/1064813973_122014422' },
    usdIndex: { name: '美元指数', price: 98.833, changePct: -0.83, time: '8/19收盘(三周最大跌幅,逾三个月低位)', source: '东财财经早餐(官方媒体)', url: 'https://finance.eastmoney.com/a/202608193846670183.html' }
  },
  sentiment: {
    vix: { name: 'VIX恐慌指数', price: 14.89, changePct: -6.00, time: '美东8/19收盘(从15.84回落,流动性恐慌缓解)', source: 'MacroMicro行情(一手)', url: 'https://en.macromicro.me/collections/11/us-stock/2/vix' },
    vixNote: 'VIX 8/19收14.89(-6.00%)：美国财政部宣布扩大长端国债流动性回购(10-30年单次上限20亿→至少40亿美元,9/9生效)，30年美债收益率自5.33%高位回落至5.19%、10年降至4.64%，"债券义警"担忧缓和，恐慌溢价回落；但债务首破40万亿+利息支出1.17万亿，"死亡螺旋"未被拆除，若30年重回5.2%上方VIX随时反弹',
    fomcNote: '美联储7月会议纪要(8/20凌晨公布)：以9:3维持利率不变(3名官员主张加息25bp)，多位决策者称若通胀不回落需进一步加息；工作人员预测2028年初才开始降息，与市场此前"9月加息33%"定价形成预期差——纪要整体偏鹰但市场作鸽派解读，推动美元跌0.83%、金价涨3.6%',
    middleEast: '美伊谈判反复：特朗普8/19改口称"可能在某个时候恢复与伊朗谈判"（此前称不谈判），但阿联酋已宣布暂停与伊朗一切贸易金融往来，霍尔木兹海峡通航量大幅下降——供应中断预期支撑油价(WTI连涨)、黄金避险需求共振，地缘不确定性是当前最大变量',
    aiChip: '美股存储/光通信/AI硬件延续失血：费半-2.12%、希捷-7.87%、西部数据-6.87%、闪迪-3.50%、博通-4.61%、AMD-3.71%、NVDA-0.99%；但资金切换至医药——Moderna+176.97%(黑色素瘤mRNA疫苗III期达标,市值增440亿美元)、默沙东+12.62%、纳斯达克生科指数+6.4%(六年最大涨幅)；亚太8/19重挫：日经-3.16%、韩国KOSPI-5.80%(盘中熔断)',
    cnLink: '外盘→A股映射：1) 隔夜美股医药爆发直接点燃今日A股医药全链(生物制品11家/化学制药10家/医疗器械4家/医疗服务3家涨停，沃森生物/康希诺/智飞生物20cm)；2) 美股存储光通信续跌但A股算力链先跌后修复(亨通光电+5.28%/中际旭创+0.96%)，内资主导特征明显；3) 金价大涨映射赤峰黄金+7.91%；4) 油价上行支撑焦炭/能源(金能科技+7.77%/宝泰隆+5.26%)；5) 美元大跌+人民币升值156点创月内新高，利好人民币资产；8/19 A股放量大跌(沪-2.40%/创-6.26%)后今日超跌修复反弹'
  }
};

// 同步扩充 intlMkt，保留完整外盘字段供渲染与后续使用
const im = report.intlMkt = report.intlMkt || {};
Object.assign(im, {
  'us.INX': { name: '标普500', price: 7707.98, changePct: 0.21, time: '08-19收盘' },
  'us.SOX': { name: '费城半导体', price: 11738.23, changePct: -2.12, time: '08-19收盘' },
  'us.NVDA': { name: '英伟达', price: 217.56, changePct: -0.99, time: '08-19收盘' },
  'us.AMD': { name: 'AMD', price: 466.42, changePct: -3.71, time: '08-19收盘' },
  'us.VIX': { name: 'VIX恐慌指数', price: 14.89, changePct: -6.00, time: '08-19收盘' },
  'fx.USDCNH': { name: '离岸人民币', price: 6.7398, changePct: null, time: '8/19北京时间18:00' }
});

fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
console.log('intlDetail 注入完成:', file);
console.log('intlDetail 字段数:', Object.keys(report.intlDetail).length, '| intlMkt 键数:', Object.keys(im).length);
