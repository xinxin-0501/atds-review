// 注入 intlDetail 字段：将联网检索到的国际联动数据写入午盘快照 JSON
// 用法: node scripts/inject_intl_detail.mjs [YYYYMMDD]  （默认当天）
import fs from 'fs';
import path from 'path';

const ROOT = 'D:/Work buddy/2026-08-12-20-19-30';
const d = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const file = path.join(ROOT, `data/reviews/${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}_11-35.json`);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));

report.intlDetail = {
  asOfLabel: '美股/欧股/商品/VIX/半导体为美东2026-08-18(周二)收盘；离岸人民币/在岸/中间价为8/18数据；8/19盘中商品参考价另附。注：本快照为收盘后补执行(20:22)，A股为8/19全天收盘数据(11:35快照时段数据见行情文件)',
  us: {
    dowJones: { name: '道琼斯工业平均指数', price: 53343.40, changePct: -0.22, time: '美东8/18收盘(三连阴,跌116点)', source: '财联社/腾讯行情(一手)', url: 'https://www.jwview.com/jingwei/html/08-18/683963.shtml' },
    sp500: { name: '标普500', price: 7691.76, changePct: -0.69, time: '美东8/18收盘(三连阴)', source: '财联社/腾讯行情(一手)', url: 'https://www.jwview.com/jingwei/html/08-18/683963.shtml' },
    nasdaq: { name: '纳斯达克综合指数', price: 26289.71, changePct: -1.33, time: '美东8/18收盘(三连阴,领跌)', source: '财联社/腾讯行情(一手)', url: 'https://caifuhao.eastmoney.com/news/20260819092158610418140' },
    sox: { name: '费城半导体指数SOX', price: 11992.46, changePct: -4.98, time: '美东8/18收盘(全球芯片抛售,单日重挫)', source: '新浪财经美股行情(一手API)', url: 'https://finance.sina.com.cn/stock/usstock/' },
    nvda: { name: '英伟达 NVDA', price: 219.74, changePct: -2.34, time: '美东8/18收盘', source: '腾讯行情API/新浪美股(一手)', url: 'https://quote.eastmoney.com/us/NVDA.html' },
    amd: { name: 'AMD', price: 484.39, changePct: -4.27, time: '美东8/18收盘', source: '腾讯行情API/新浪美股(一手)', url: 'https://quote.eastmoney.com/us/AMD.html' },
    micron: { name: '美光科技(存储)', price: null, changePct: -5.0, time: '美东8/18收盘(存储股集体回落,由涨转跌)', source: 'Saxo市场速览(一手)', url: 'https://www.home.saxo/en-sg/content/articles/macro/market-quick-take---korea-leads-a-global-chip-selloff-as-long-bond-yields-hit-a-19-year-high---19-august-2026-19082026' }
  },
  europe: {
    ftse100: { name: '英国富时100', price: 10728.04, changePct: 0.07, time: '8/18收盘', source: '新华社(官方)', url: 'https://m.cnfin.com/gs-lb//zixun/20260819/4456952_1.html' },
    cac40: { name: '法国CAC40', price: 8509.36, changePct: -0.82, time: '8/18收盘', source: '新华社(官方)', url: 'https://m.cnfin.com/gs-lb//zixun/20260819/4456952_1.html' },
    dax: { name: '德国DAX', price: 26128.36, changePct: -0.80, time: '8/18收盘', source: '新华社(官方)', url: 'https://m.cnfin.com/gs-lb//zixun/20260819/4456952_1.html' },
    stoxx600: { name: '欧洲Stoxx50', price: 6468.17, changePct: -0.95, time: '8/18收盘', source: '国际金融要情(官方)', url: 'https://so.html5.qq.com/page/real/search_news?docid=70000021_1136a84e91b32052' }
  },
  commodities: {
    wti: { name: 'WTI原油(9月合约)', price: 84.42, changePct: 0.81, unit: '美元/桶', time: '美东8/18收盘', source: '陆家嘴财经早餐/亚商投顾(一手)', url: 'https://xueqiu.com/1689987310/405560138' },
    wtiIntra: { name: 'WTI原油(8/19盘中)', price: 85.29, changePct: 0.41, unit: '美元/桶', time: '8/19盘中(腾讯API)', source: '腾讯公开API(实时)', url: 'https://qt.gtimg.cn' },
    brent: { name: '布伦特原油(10月)', price: 91.33, changePct: 0.51, unit: '美元/桶', time: '美东8/18收盘(站稳90上方)', source: '陆家嘴财经早餐(一手)', url: 'https://xueqiu.com/1689987310/405560138' },
    comexGold: { name: 'COMEX黄金期货', price: 4389.50, changePct: -1.88, unit: '美元/盎司', time: '美东8/18收盘(加息预期+长债收益率压制)', source: '陆家嘴财经早餐(一手)', url: 'https://xueqiu.com/1689987310/405560138' },
    spotGold: { name: '现货黄金', price: 4434.51, changePct: -0.06, unit: '美元/盎司', time: '8/19盘中', source: '国际金融要情(官方)', url: 'https://so.html5.qq.com/page/real/search_news?docid=70000021_1136a84e91b32052' }
  },
  fx: {
    usdcnh: { name: '离岸人民币(美元兑CNH)', price: 6.7468, changePct: 0.05, time: '8/18纽约尾盘(较前日贬36bp)', source: '陆家嘴财经早餐(官方媒体)', url: 'https://xueqiu.com/1689987310/405560138' },
    cnyOnshore: { name: '在岸人民币', price: 6.7427, changePct: 0.07, time: '8/18 16:30收盘(较前日贬45bp)', source: '陆家嘴财经早餐(官方媒体)', url: 'https://xueqiu.com/1689987310/405560138' },
    cnyFixing: { name: '人民币对美元中间价', price: 6.7905, changePct: null, unit: '调贬32基点(前值6.7873)', time: '8/18', source: '陆家嘴财经早餐(官方媒体)', url: 'https://xueqiu.com/1689987310/405560138' },
    usdIndex: { name: '美元指数', price: 99.65, changePct: 0.07, time: '8/18收盘', source: '陆家嘴财经早餐(官方媒体)', url: 'https://xueqiu.com/1689987310/405560138' }
  },
  sentiment: {
    vix: { name: 'VIX恐慌指数', price: 15.84, changePct: 4.28, time: '美东8/18收盘(风险偏好恶化)', source: 'Saxo市场速览(一手)', url: 'https://www.home.saxo/en-sg/content/articles/macro/market-quick-take---korea-leads-a-global-chip-selloff-as-long-bond-yields-hit-a-19-year-high---19-august-2026-19082026' },
    vixNote: 'VIX 8/18收15.84(+4.28%)，长债收益率创新高+全球芯片抛售推升波动；30年美债收益率8/17收5.311%创2007年6月以来最高、8/18盘中触及5.336%后回落至5.27%下方——"债市风暴"压制全球风险资产估值，高盛称美联储"或被迫加息"',
    middleEast: '美伊谅解备忘录8/17到期未续签、谈判无进展，特朗普拒绝延长并威胁"轰炸阿曼"；霍尔木兹海峡航运受阻推升油价，WTI三连阳站上84、布伦特站稳90上方；油价上行主因政治面而非供需，后续关注美伊谈判进展',
    aiChip: '全球芯片集体抛售：韩国KOSPI 8/19盘中-5.89%(三星-2.19%/SK海力士领跌)、日经8/18-2.54%(铠侠-7.58%/东京电子-6.17%)；美股费半-4.98%、NVDA-2.34%、AMD-4.27%；存储股由涨转跌(美光跌近5%)；A股光通信/存储/半导体(中际旭创-9.36%/亨通光电-9.94%/国瓷材料-13.65%)大幅映射下杀',
    cnPolicy: '国内政策面：国务院修改住房公积金管理条例(9/20施行,放宽租房提取、新增装修提取)；功率半导体台厂酝酿10月第三波涨价(10%-15%)；兆易创新半年报净利+1091.5%；宇树科技今日科创板挂牌(发行价150.80元)——政策面温和，但外部流动性冲击主导今日情绪'
  }
};

// 同步扩充 intlMkt，保留完整外盘字段供渲染与后续使用
const im = report.intlMkt = report.intlMkt || {};
Object.assign(im, {
  'us.INX': { name: '标普500', price: 7691.76, changePct: -0.69, time: '08-18收盘' },
  'us.SOX': { name: '费城半导体', price: 11992.46, changePct: -4.98, time: '08-18收盘' },
  'us.NVDA': { name: '英伟达', price: 219.74, changePct: -2.34, time: '08-18收盘' },
  'us.AMD': { name: 'AMD', price: 484.39, changePct: -4.27, time: '08-18收盘' },
  'us.VIX': { name: 'VIX恐慌指数', price: 15.84, changePct: 4.28, time: '08-18收盘' },
  'fx.USDCNH': { name: '离岸人民币', price: 6.7468, changePct: 0.05, time: '8/18纽约尾盘' }
});

fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
console.log('intlDetail 注入完成:', file);
console.log('intlDetail 字段数:', Object.keys(report.intlDetail).length, '| intlMkt 键数:', Object.keys(im).length);
