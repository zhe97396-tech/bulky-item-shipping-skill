'use strict';

/**
 * HTML 报告渲染器 —— 生成自包含单文件（CSS 内联、零依赖、可离线打开/打印/转发）。
 *
 * 设计要点：报告可以从「货物数据 + 实价 + 待确认项」重新生成，
 * 所以后续每拿到一条新信息（小程序实价、客服确认），重跑一次就能刷新 HTML，
 * 不需要手动改文件。
 */

const { compute } = require('./estimate.js');

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const n1 = (x) => Number(x).toFixed(1);
const n3 = (x) => Number(x).toFixed(3);

const CSS = `
:root{--ink:#1a2233;--sub:#5b6880;--line:#e3e8f0;--bg:#f5f7fb;--card:#fff;--brand:#2f6df6;
      --warn:#c2410c;--warnbg:#fff7ed;--ok:#0f766e;--okbg:#f0fdfa;--bad:#b91c1c;--badbg:#fef2f2;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
     font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px 64px}
header{background:linear-gradient(135deg,#1e3a8a,#2f6df6 55%,#5b9bff);color:#fff;border-radius:16px;padding:26px 28px 20px;box-shadow:0 10px 30px rgba(47,109,246,.22)}
header h1{margin:0 0 6px;font-size:22px}
header .route{font-size:14px;opacity:.95;margin-bottom:14px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.fact{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:9px 11px}
.fact b{display:block;font-size:11.5px;opacity:.85;font-weight:600;margin-bottom:2px}
.fact span{font-size:13.5px;font-weight:600}
h2{font-size:18px;margin:32px 0 12px;padding-left:11px;border-left:4px solid var(--brand)}
h3{font-size:15.5px;margin:20px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:0 1px 3px rgba(20,30,60,.05)}
.alert{border-radius:12px;padding:14px 18px;margin:16px 0;font-size:14.5px}
.alert.warn{background:var(--warnbg);border:1px solid #fed7aa;color:#7c2d12}
.alert.ok{background:var(--okbg);border:1px solid #99f6e4;color:#134e4a}
.alert.bad{background:var(--badbg);border:1px solid #fecaca;color:#7f1d1d}
.alert.info{background:#f8fafc;border:1px solid var(--line);color:var(--sub)}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;background:#fff;border-radius:10px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#f0f4fb;font-weight:600;font-size:13px;color:#3c4a63}
td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:none}
tr.hl td{background:#eef4ff}
tr.win td{background:#ecfdf5}
tr.bad td{background:#fef2f2}
ul,ol{padding-left:20px;margin:8px 0} li{margin:5px 0}
.muted{color:var(--sub);font-size:13px}
code{background:#f2f5fa;padding:1.5px 6px;border-radius:5px;font-size:13px;font-family:ui-monospace,Consolas,monospace}
.pill{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:5px}
.p-ok{background:#dcfce7;color:#166534} .p-mid{background:#fef3c7;color:#92400e} .p-bad{background:#fee2e2;color:#991b1b}
.big{font-size:19px;font-weight:700}
footer{margin-top:34px;font-size:12.5px;color:var(--sub);line-height:1.95;border-top:1px solid var(--line);padding-top:16px}
.blank{display:inline-block;min-width:90px;border-bottom:1px solid #94a3b8}
@media print{body{background:#fff}.wrap{max-width:none;padding:0}header{box-shadow:none}}
`;

/**
 * @param {object} result  compute() 的返回值
 * @param {object} meta    { from, to, quotes:[{carrier,amount,note}], pending:[string], generatedAt, version }
 */
function renderHtml(result, meta = {}) {
  const r = result;
  const from = meta.from || '（起点待填）';
  const to = meta.to || '（终点待填）';
  const quotes = (meta.quotes || []).filter((q) => q && q.carrier);
  const pending = meta.pending || [];
  const genAt = meta.generatedAt || new Date().toLocaleString('zh-CN', { hour12: false });

  const priced = quotes.filter((q) => Number.isFinite(Number(q.amount)));
  const cheapest = priced.length ? priced.reduce((a, b) => (Number(a.amount) <= Number(b.amount) ? a : b)) : null;
  const second = priced.length > 1
    ? priced.filter((q) => q !== cheapest).reduce((a, b) => (Number(a.amount) <= Number(b.amount) ? a : b))
    : null;

  const H = [];
  const P = (s = '') => H.push(s);

  P('<!DOCTYPE html>');
  P('<html lang="zh-CN"><head><meta charset="utf-8">');
  P('<meta name="viewport" content="width=device-width,initial-scale=1">');
  P('<title>大件物流比价报告</title>');
  P(`<style>${CSS}</style>`);
  P('</head><body><div class="wrap">');

  /* ---------- header ---------- */
  P('<header>');
  P('  <h1>大件物流比价报告</h1>');
  P(`  <div class="route">📍 ${esc(from)} &nbsp;→&nbsp; ${esc(to)}</div>`);
  P('  <div class="facts">');
  P(`    <div class="fact"><b>货物</b><span>${r.pieces} 件 / ${r.items.length} 类</span></div>`);
  P(`    <div class="fact"><b>实际重量</b><span>${n1(r.actualWeight)} kg</span></div>`);
  P(`    <div class="fact"><b>总体积</b><span>${n3(r.volumeM3)} m³</span></div>`);
  P(`    <div class="fact"><b>单件最重</b><span>${r.heaviest} kg</span></div>`);
  const floorTxt = `${r.floorFrom} 楼(${r.elevatorFrom ? '有' : '无'}电梯) → ${r.floorTo} 楼(${r.elevatorTo ? '有' : '无'}电梯)`;
  P(`    <div class="fact"><b>楼层</b><span>${esc(floorTxt)}</span></div>`);
  P('  </div>');
  P('</header>');

  /* ---------- 结论 ---------- */
  if (cheapest) {
    const saved = second ? Number(second.amount) - Number(cheapest.amount) : null;
    P('<div class="alert ok">');
    P(`  <b>🎯 推荐：${esc(cheapest.carrier)}，到手约 ¥${esc(cheapest.amount)}</b>`);
    if (saved && saved > 0) P(`  —— 比第二便宜的（${esc(second.carrier)} ¥${esc(second.amount)}）省 <b>¥${n1(saved)}</b>。`);
    P('</div>');
  } else {
    P('<div class="alert warn">');
    P('  <b>⚠️ 还缺「到手总价」 —— 请到小程序各填一遍后，用 <code>--quote 承运=金额</code> 重新生成本报告。</b>');
    P('</div>');
  }

  /* ---------- 一、计费重量 ---------- */
  P('<h2>一、计费重量（你的钱花在这里）</h2>');
  P('<div class="card">');
  P('  <p class="muted" style="margin:0 0 8px">计费重量 = max(实际重量, 体积重量)；体积重 = 长×宽×高 ÷ 轻抛系数。三家系数不同。</p>');
  P('  <table><tr><th>承运 / 产品</th><th>轻抛系数</th><th>体积重</th><th>计费重量</th></tr>');
  for (const b of r.billing) {
    const cls = b.volumetric ? ' class="hl"' : '';
    P(`    <tr${cls}><td>${esc(b.name)}</td><td class="num">${b.divisor}</td>` +
      `<td class="num">${n1(b.volumeWeight)} kg</td>` +
      `<td class="num"><b>${n1(b.billingWeight)} kg</b>${b.volumetric ? ' <span class="pill p-mid">泡货</span>' : ''}</td></tr>`);
  }
  P('  </table>');
  const anyVol = r.billing.some((b) => b.volumetric);
  P(`  <div class="alert ${anyVol ? 'warn' : 'info'}" style="margin-bottom:0">`);
  P(anyVol
    ? '  <b>你这是「泡货」</b> —— 体积重大于实重，计费重量由体积决定。<b>只看重量会严重低估运费。</b>'
    : '  实际重量大于体积重，按实重计费。');
  P('  </div>');
  P('</div>');

  /* ---------- 二、上楼费 ---------- */
  P('<h2>二、上楼费（分水岭 = 有没有单件 ≥60kg）</h2>');
  P('<div class="card">');
  if (r.upstairs === null) {
    P('  <div class="alert ok" style="margin:0">两端都有可用电梯 → 三家都不收上楼费。</div>');
  } else {
    P('  <table><tr><th>承运</th><th>上楼费</th><th>适用规则</th></tr>');
    for (const u of r.upstairs) {
      const cls = u.amount === 0 ? ' class="win"' : '';
      P(`    <tr${cls}><td>${esc(u.carrier)}</td><td class="num">¥${n1(u.amount)}</td><td class="muted">${esc(u.rule)}</td></tr>`);
    }
    P('  </table>');
    P('  <div class="alert bad" style="margin-bottom:0">');
    P('    <b>★ 最贵的坑：录单必须「按件申报」。</b><br>');
    P('    填成「一件总重」会被判成「最重件 ≥60kg」，单价从 <b>0.3 元/kg</b> 跳到 <b>0.9~1.0 元/kg</b>。<br>');
    P('    顺丰官方支持<b>子母件</b>（把每件计费重汇总），按件申报是正规机制。');
    P('  </div>');
  }
  P('</div>');

  /* ---------- 三、超限检查 ---------- */
  P('<h2>三、超长超重 / 不支持上楼 检查</h2>');
  P('<div class="card">');
  if (r.warnings.length) {
    P('  <div class="alert bad" style="margin:0"><ul style="margin:0">');
    for (const w of r.warnings) P(`    <li>${esc(w)}</li>`);
    P('  </ul></div>');
  } else {
    P('  <div class="alert ok" style="margin:0">✓ 没有触发超长超重 / 不支持上楼的条件。</div>');
  }
  P('</div>');

  /* ---------- 四、到手总价对比 ---------- */
  P('<h2>四、到手总价对比</h2>');
  P('<div class="card">');
  if (quotes.length) {
    P('  <table><tr><th>承运</th><th>到手总价</th><th>备注</th></tr>');
    for (const q of quotes) {
      const isWin = cheapest && q === cheapest;
      P(`    <tr${isWin ? ' class="win"' : ''}><td>${esc(q.carrier)}${isWin ? ' <span class="pill p-ok">最低</span>' : ''}</td>` +
        `<td class="num">${Number.isFinite(Number(q.amount)) ? '¥' + esc(q.amount) : '<span class="blank"></span>'}</td>` +
        `<td class="muted">${esc(q.note || '')}</td></tr>`);
    }
    P('  </table>');
    P('  <p class="muted" style="margin:4px 0">价格来源须标注：<b>小程序实价</b> / 客服口述 / 推算。以收派员核实为准。</p>');
  } else {
    P('  <table><tr><th>承运</th><th>到手总价</th><th>备注</th></tr>');
    for (const c of ['京东（重货标快）', '顺丰（卡航）', '德邦（零担）']) {
      P(`    <tr><td>${esc(c)}</td><td class="num"><span class="blank"></span> 元</td><td class="muted">待填</td></tr>`);
    }
    P('  </table>');
    P('  <div class="alert info" style="margin-bottom:0">');
    P('    拿到小程序报价后，用 <code>--quote "京东=435"</code> 重新生成，这里会自动填上并标出最低价。');
    P('  </div>');
  }
  P('</div>');

  /* ---------- 五、待确认 ---------- */
  P('<h2>五、还缺什么</h2>');
  P('<div class="card">');
  const defaults = [
    '体积/重量是否已量准？（体积重可能把计费重量顶上去，三家都会涨）',
    '取件端（起点楼层）师傅帮不帮搬下楼？要加钱吗？',
    '报价是否为「包干价」？有无燃油/超长等附加？',
    '优惠券能否抵上楼费？（多数只能抵纯运费）',
  ];
  const list = pending.length ? pending : defaults;
  P('  <ul style="margin:0">');
  for (const p of list) P(`    <li>${esc(p)}</li>`);
  P('  </ul>');
  P('</div>');

  /* ---------- 六、行动清单 ---------- */
  P('<h2>六、下一步</h2>');
  P('<div class="card">');
  P('  <h3>A. 小程序里要填的数据（三家一样）</h3>');
  P(`  <p style="margin:4px 0">总件数 <b>${r.pieces} 件</b> ｜ 总体积 <b>${n3(r.volumeM3)} m³</b> ｜ 实重合计 <b>${n1(r.actualWeight)} kg</b></p>`);
  P('  <ul>');
  P('    <li><b>按「件」逐个录入</b>，不要填成一件（否则上楼费翻 3 倍）</li>');
  P('    <li>送货方式选「<b>送货上楼 / 步梯上楼</b>」</li>');
  P('    <li>三家都填一遍，才叫同口径</li>');
  P('  </ul>');

  P('  <h3>B. 打电话问客服（照念）</h3>');
  P('  <div class="alert info">');
  P(`    「从 ${esc(from)} 到 ${esc(to)}。物品是以下这些，总共约 ${n3(r.volumeM3)} 立方、实重约 ${Math.round(r.actualWeight)} 公斤：<br>`);
  for (const it of r.items) {
    P(`    &nbsp;&nbsp;· ${it.count} 件 ${esc(it.name)}，各 ${it.l}×${it.w}×${it.h}cm、约 ${it.weight}kg<br>`);
  }
  P(`    起点 ${r.floorFrom} 楼、终点 ${r.floorTo} 楼，${r.elevatorFrom && r.elevatorTo ? '有电梯' : '无电梯'}。」`);
  P('  </div>');
  P('  <p style="margin:4px 0"><b>必问五句</b>：①含上门取件 + 两端搬楼一共多少钱？ ②计费重量按什么算、轻抛系数多少？ ③上楼费按实际重量还是计费重量？ ④我每件都不超过 60 公斤，是不是按最低档？ ⑤取件端收不收费？</p>');

  P('  <h3>C. 下单前</h3>');
  P('  <ul>');
  P('    <li>让快递员<b>当面点清件数</b>（按件申报才站得住脚）</li>');
  P('    <li>贵重物品<b>加保价</b></li>');
  P('    <li>小程序价是<b>预估价</b>，以收派员核实为准</li>');
  P('  </ul>');
  P('</div>');

  /* ---------- footer ---------- */
  P('<footer>');
  P(`  <b>生成时间</b>：${esc(genAt)}${meta.version ? ` ｜ 工具版本 ${esc(meta.version)}` : ''}<br>`);
  P('  <b>规则依据</b>：京东 / 顺丰 / 德邦 官方页面、官方小程序与客服口径的交叉核对。<br>');
  P('  <b>免责</b>：费率会变，本报告为下单前参考；最终以承运方上门测重测方、按实际产品与网点政策开单为准。本项目与京东、顺丰、德邦无任何关联。<br>');
  P('  <b>更新报告</b>：数据有变时重跑一次命令即可刷新本文件（不要手动改 HTML）。');
  P('</footer>');

  P('</div></body></html>');
  return H.join('\n');
}

module.exports = { renderHtml, esc };
