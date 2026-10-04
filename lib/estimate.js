'use strict';

/**
 * 大件物流比价核心计算（京东 / 顺丰 / 德邦）
 *
 * 本文件是全项目唯一实现，CLI（bin/cli.js）与 Agent 都调它，避免多份口径漂移。
 * 规则数值见 references/carrier-rules.md；条款会变，下单前以官方为准。
 */

/** 轻抛系数（体积重除数）。系数越小，体积重越大。 */
const DIVISORS = [
  { carrier: 'jd', name: '京东·重货标快/特快', div: 6000 },
  { carrier: 'sf', name: '顺丰·卡航', div: 6000 },
  { carrier: 'db', name: '德邦·零担（精准汽运/卡航）', div: 4800 },
  { carrier: 'db', name: '德邦·快递类', div: 6000 },
];

const volumeWeight = (cm3, div) => cm3 / div;

/** 京东（重货标快）：整票 / 最重件 双门槛。 */
function jdUpstairs(billW, heaviest) {
  if (billW < 100 && heaviest < 60) return [0, '免费（整票<100kg 且 最重件<60kg）'];
  if (heaviest >= 60) return [billW * 0.9, '0.9 元/kg（最重件≥60kg）'];
  return [billW * 0.3, '0.3 元/kg（整票≥100kg 且 最重件<60kg）'];
}

/** 顺丰卡航：收件标准 = 单件≥60kg 或 单票≥100kg。 */
function sfUpstairs(billW, heaviest) {
  if (heaviest >= 60) return [billW * 1.0, '1.0 元/kg（最重件≥60kg）'];
  if (billW >= 100) return [billW * 0.3, '0.3 元/kg（所有子件<60kg 且整票≥100kg）'];
  return [0, '不收取（未达收件标准）'];
}

/** 德邦零担：按最重件分 0.3 / 1 / 2 元/kg。 */
function dbUpstairs(billW, heaviest) {
  if (heaviest <= 60 && billW > 100) return [billW * 0.3, '0.3 元/kg（最重件≤60kg 且整票>100kg）'];
  if (heaviest <= 150) return [billW * 1.0, '1 元/kg（最重件≤150kg）'];
  return [billW * 2.0, '2 元/kg（最重件>150kg）'];
}

/** 超长超重 / 不支持上楼的检查。长度单位 m，重量 kg。 */
function checkLimits(items) {
  const warn = [];
  for (const it of items) {
    const dims = [it.l, it.w, it.h].slice().sort((a, b) => a - b);
    const third = dims[0] / 100, second = dims[1] / 100, longest = dims[2] / 100;
    const sides = (it.l + it.w + it.h) / 100;
    const nm = it.name;

    if (longest > 2.5) warn.push(`[上楼不支持] ${nm}：最长边 ${longest.toFixed(2)}m > 2.5m（京东不收上楼）`);
    if (sides > 5.0) warn.push(`[上楼不支持] ${nm}：三边之和 ${sides.toFixed(2)}m > 5m（京东不收上楼）`);
    if (it.weight > 135) warn.push(`[上楼不支持] ${nm}：单件 ${it.weight}kg > 135kg（京东不收上楼）`);
    if (it.weight > 130) warn.push(`[上楼不支持] ${nm}：单件 ${it.weight}kg > 130kg（顺丰不收上楼）`);
    if ((longest > 3.1 && longest <= 4.0) || (it.weight > 300 && it.weight <= 1000) || (sides > 5.5 && sides <= 6.3))
      warn.push(`[超长超重] ${nm}：触发京东重货超长超重加收（计费重×0.2 元/kg，20–500 元/票）`);
    if (longest > 3.0 || second > 1.8 || third > 1.5)
      warn.push(`[超长超重] ${nm}：触发顺丰卡航超长附加（计费重×0.5 元/kg）`);
    if (it.weight > 1000) warn.push(`[可能拒收] ${nm}：单件 ${it.weight}kg 超 1000kg，先问收派员`);
  }
  return warn;
}

/** 主计算：返回结构化结果（供 CLI 与 Agent 复用）。 */
function compute(items, opts = {}) {
  const floorFrom = opts.floorFrom ?? 1;
  const floorTo = opts.floorTo ?? 1;
  const elevatorFrom = !!opts.elevatorFrom;
  const elevatorTo = !!opts.elevatorTo;

  const pieces = items.reduce((a, it) => a + it.count, 0);
  const actualWeight = items.reduce((a, it) => a + it.weight * it.count, 0);
  const cm3 = items.reduce((a, it) => a + it.l * it.w * it.h * it.count, 0);
  const m3 = cm3 / 1e6;
  const heaviest = items.reduce((a, it) => Math.max(a, it.weight), 0);

  const billing = DIVISORS.map((d) => {
    const vw = volumeWeight(cm3, d.div);
    return { name: d.name, divisor: d.div, volumeWeight: vw, billingWeight: Math.max(actualWeight, vw), volumetric: vw > actualWeight };
  });

  const byName = Object.fromEntries(billing.map((b) => [b.name, b.billingWeight]));

  let upstairs = null;
  if (!(elevatorFrom && elevatorTo)) {
    const rows = [
      ['京东（重货标快）', ...jdUpstairs(byName['京东·重货标快/特快'], heaviest)],
      ['顺丰（卡航）', ...sfUpstairs(byName['顺丰·卡航'], heaviest)],
      ['德邦（零担）', ...dbUpstairs(byName['德邦·零担（精准汽运/卡航）'], heaviest)],
    ];
    upstairs = rows.map(([carrier, amount, rule]) => ({ carrier, amount: Math.round(amount * 10) / 10, rule }));
  }

  return {
    items, floorFrom, floorTo, elevatorFrom, elevatorTo,
    pieces, actualWeight, volumeM3: m3, cm3, heaviest,
    billing, upstairs, warnings: checkLimits(items),
  };
}

/* ---------- 文本渲染（中英混排按双宽对齐） ---------- */

const dispWidth = (s) => [...String(s)].reduce((a, c) => a + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - dispWidth(s)));
const padL = (s, n) => ' '.repeat(Math.max(0, n - dispWidth(s))) + String(s);
const num = (x, d = 1) => Number(x).toFixed(d);

function renderText(r) {
  const L = [];
  const P = (s = '') => L.push(s);

  P('='.repeat(68));
  P('  大件物流比价估算（京东 / 顺丰 / 德邦）');
  P('='.repeat(68));
  P();
  P('【你填进去的货】');
  for (const it of r.items) P(`  ${it.name}: ${it.l}×${it.w}×${it.h}cm × ${it.count}件, 单件${it.weight}kg`);
  P(`  合计：${r.pieces} 件 ｜ 实重 ${num(r.actualWeight)} kg ｜ 体积 ${num(r.volumeM3, 3)} m³`);
  P(`  单件最重：${r.heaviest} kg（这是上楼费档位的关键）`);
  P();

  P('【第 1 步：算体积重 → 得计费重量】');
  P('  体积重 = 长×宽×高 ÷ 轻抛系数；计费重量 = max(实重, 体积重)');
  P();
  P('  ' + pad('承运/产品', 30) + padL('系数', 7) + padL('体积重', 12) + padL('计费重量', 12));
  P('  ' + '-'.repeat(62));
  for (const b of r.billing) {
    P('  ' + pad(b.name, 30) + padL(b.divisor, 7) + padL(num(b.volumeWeight) + 'kg', 12) + padL(num(b.billingWeight) + 'kg', 12) + (b.volumetric ? ' ← 体积重更大（泡货）' : ''));
  }
  P();

  P('【第 2 步：上楼费（分水岭 = 有没有单件 ≥60kg）】');
  if (r.elevatorFrom && r.elevatorTo) {
    P('  两端都有可用电梯 → 三家都不收上楼费。');
  } else {
    P(`  起点 ${r.floorFrom} 楼（${r.elevatorFrom ? '有' : '无'}电梯）→ 终点 ${r.floorTo} 楼（${r.elevatorTo ? '有' : '无'}电梯）`);
    P();
    P('  ' + pad('承运', 22) + padL('金额', 11) + '  规则');
    P('  ' + '-'.repeat(62));
    for (const u of r.upstairs) P('  ' + pad(u.carrier, 22) + padL(num(u.amount) + ' 元', 11) + '  ' + u.rule);
    P();
    P('  ※ 按「派送端无电梯」计；有电梯且满足要求可不收。');
  }
  P();

  P('【第 3 步：超限检查】');
  if (r.warnings.length) for (const w of r.warnings) P('  ⚠ ' + w);
  else P('  ✓ 没有触发超长超重 / 不支持上楼的条件。');
  P();

  P('='.repeat(68));
  P('【下一步：拿真实报价】');
  P('='.repeat(68));
  P();
  P('A. 小程序里要填的数据（三家一样，照着填）');
  P(`   总件数 ${r.pieces} 件 ｜ 总体积 ${num(r.volumeM3, 3)} m³ ｜ 实重合计 ${num(r.actualWeight)} kg`);
  P('   ◆ 关键：按「件」逐个录入，不要填成一件！');
  P('     （填成一件，上楼费会从 0.3 元/kg 跳到 0.9~1.0 元/kg）');
  P('   ◆ 送货方式选「送货上楼 / 步梯上楼」');
  P();
  P('B. 打电话问客服（照念）');
  P(`   「从 ___ 到 ___。物品是以下这些，总共约 ${num(r.volumeM3, 2)} 立方、实重约 ${Math.round(r.actualWeight)} 公斤：`);
  for (const it of r.items) P(`     · ${it.count} 件 ${it.name}，各 ${it.l}×${it.w}×${it.h}cm、约 ${it.weight}kg`);
  P(`   起点 ${r.floorFrom} 楼、终点 ${r.floorTo} 楼，约无电梯。」`);
  P();
  P('   必问五句：');
  P('     1. 含上门取件 + 两端搬楼，一共多少钱？');
  P('     2. 计费重量按什么算、轻抛系数多少？');
  P('     3. 上楼费按实际重量还是计费重量？');
  P(`     4. 我每件都不超过 60 公斤（最重大约 ${r.heaviest}kg），是不是按最低档？`);
  P('     5. 取件端收不收费？');
  P();
  P('C. 拿到两家的「到手总价」后对比，选低的。三个必做：');
  P('     · 首重/续重问清楚（首重多少 kg、多少钱）');
  P('     · 优惠券通常只抵运费，不抵上楼费');
  P('     · 让快递员当面点清件数');
  P();
  P('※ 本工具不算线路运价（那需联系客服/小程序）。它保证四项不出错：');
  P('  体积重、计费重量、上楼费档位、超限风险。');
  P();
  return L.join('\n');
}

/** 解析 "名称:长cm:宽cm:高cm:单件重kg:数量" */
function parseItem(s) {
  const parts = String(s).split(':');
  if (parts.length !== 6) throw new Error(`--item 需要 6 段（名称:长:宽:高:单件重kg:数量），收到：${s}`);
  const [name, l, w, h, weight, count] = parts;
  const o = { name, l: Number(l), w: Number(w), h: Number(h), weight: Number(weight), count: parseInt(count, 10) };
  for (const k of ['l', 'w', 'h', 'weight']) if (!Number.isFinite(o[k])) throw new Error(`--item 的「${k}」不是数字：${s}`);
  if (!Number.isInteger(o.count) || o.count < 1) throw new Error(`--item 的数量必须是 ≥1 的整数：${s}`);
  return o;
}

module.exports = { DIVISORS, volumeWeight, jdUpstairs, sfUpstairs, dbUpstairs, checkLimits, compute, renderText, parseItem };
