#!/usr/bin/env node
'use strict';

/**
 * 大件物流比价估算 CLI（京东 / 顺丰 / 德邦）
 *
 *   npx bulky-item-shipping --item "纸箱:60:40:50:15:8" --floor-from 4 --floor-to 6
 *
 * 默认：终端打印文本报告，并在当前目录写出 HTML 报告（可离线打开 / 打印 / 转发）。
 * 数据有变时（拿到小程序实价、客服确认）重跑一次即可刷新 HTML。
 *
 * 全部选项见 --help。
 */

const fs = require('fs');
const path = require('path');
const { compute, renderText, parseItem } = require('../lib/estimate.js');
const { renderHtml } = require('../lib/render-html.js');
const pkg = require('../package.json');

const DEFAULT_HTML = '大件物流比价报告.html';

const HELP = `
大件物流比价估算（京东 / 顺丰 / 德邦）

用法：
  bulky-item-shipping --item "纸箱:60:40:50:15:8" --item "折叠床:100:30:20:20:1" \\
                      --floor-from 4 --floor-to 6

货物与楼层：
  --item <规格>          名称:长cm:宽cm:高cm:单件重kg:数量（可重复）
  --json-file <路径>     从 JSON 文件读取货物与楼层
  --floor-from <N>       起点楼层（1 = 一楼，默认 1）
  --floor-to <N>         终点楼层（默认 1）
  --elevator-from        起点有可用电梯
  --elevator-to          终点有可用电梯
  --from <文本>          起点描述（写进报告抬头）
  --to <文本>            终点描述

报告内容（拿到实价后填进来，重跑即刷新）：
  --quote "<承运>=<金额>"  到手总价，可重复。例：--quote "京东=435"
  --note  "<承运>=<备注>"  给某个承运加备注。例：--note "京东=小程序实价"
  --pending "<待确认项>"   加入「还缺什么」，可重复

输出：
  --out <路径>           HTML 报告路径（默认 ./${DEFAULT_HTML}）
  --no-html              不生成 HTML
  --json                 只输出结构化 JSON（不生成 HTML）
  -h, --help / -v, --version

输出内容：体积重 → 计费重量 → 三家上楼费档位与金额 → 超限检查
          → 到手总价对比 → 待确认 → 行动清单 + 问客服话术。

不联网、不算线路运价 —— 那需要小程序 / 客服。
它保证四项不出错：体积重、计费重量、上楼费档位、超限风险。
`;

function readArgv(argv) {
  const o = {
    items: [], jsonFile: null, floorFrom: 1, floorTo: 1,
    elevatorFrom: false, elevatorTo: false, from: null, to: null,
    quotes: {}, notes: {}, pending: [], out: null, html: true, json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`选项 ${a} 缺少值`);
      return argv[++i];
    };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '--item': o.items.push(parseItem(next())); break;
      case '--json-file': o.jsonFile = next(); break;
      case '--floor-from': o.floorFrom = parseInt(next(), 10); break;
      case '--floor-to': o.floorTo = parseInt(next(), 10); break;
      case '--elevator-from': o.elevatorFrom = true; break;
      case '--elevator-to': o.elevatorTo = true; break;
      case '--from': o.from = next(); break;
      case '--to': o.to = next(); break;
      case '--pending': o.pending.push(next()); break;
      case '--out': o.out = next(); break;
      case '--no-html': o.html = false; break;
      case '--json': o.json = true; o.html = false; break;
      case '--quote': {
        const v = next();
        const eq = v.lastIndexOf('=');
        if (eq < 1) throw new Error(`--quote 需要 "<承运>=<金额>"，收到：${v}`);
        const amt = v.slice(eq + 1).trim();
        o.quotes[v.slice(0, eq).trim()] = amt === '' ? null : Number(amt);
        break;
      }
      case '--note': {
        const v = next();
        const eq = v.indexOf('=');
        if (eq < 1) throw new Error(`--note 需要 "<承运>=<备注>"，收到：${v}`);
        o.notes[v.slice(0, eq).trim()] = v.slice(eq + 1).trim();
        break;
      }
      default: throw new Error(`未知选项：${a}（用 --help 看用法）`);
    }
  }
  return o;
}

function loadJsonFile(p, o) {
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    items: (d.items || []).map((it) => ({
      name: it.name || '件',
      l: Number(it.l), w: Number(it.w), h: Number(it.h),
      weight: Number(it.weight), count: it.count == null ? 1 : parseInt(it.count, 10),
    })),
    floorFrom: d.floor_from ?? o.floorFrom,
    floorTo: d.floor_to ?? o.floorTo,
    elevatorFrom: d.elevator_from ?? o.elevatorFrom,
    elevatorTo: d.elevator_to ?? o.elevatorTo,
    from: d.from ?? o.from,
    to: d.to ?? o.to,
    quotes: { ...o.quotes, ...(d.quotes || {}) },
    notes: { ...o.notes, ...(d.notes || {}) },
    pending: [...o.pending, ...(d.pending || [])],
  };
}

function main() {
  let o;
  try {
    o = readArgv(process.argv.slice(2));
  } catch (e) {
    console.error('错误：' + e.message);
    process.exit(2);
  }
  if (o.help) { process.stdout.write(HELP); return; }
  if (o.version) { console.log(pkg.version); return; }

  if (o.jsonFile) {
    try { Object.assign(o, loadJsonFile(o.jsonFile, o)); }
    catch (e) { console.error(`错误：读取 ${o.jsonFile} 失败 —— ${e.message}`); process.exit(2); }
  }

  if (!o.items.length) {
    process.stdout.write(HELP);
    console.error('错误：至少给一个 --item，或用 --json-file。');
    process.exit(2);
  }

  const result = compute(o.items, o);

  if (o.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(renderText(result));

  if (!o.html) return;

  const quotes = Object.entries(o.quotes).map(([carrier, amount]) => ({
    carrier, amount, note: o.notes[carrier] || '',
  }));
  const html = renderHtml(result, {
    from: o.from, to: o.to, quotes, pending: o.pending,
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    version: pkg.version,
  });

  const outPath = path.resolve(o.out || DEFAULT_HTML);
  try {
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`\n📄 HTML 报告已生成：${outPath}`);
    console.log('   可用浏览器打开 / 打印 / 转发；数据有变时重跑本命令即可刷新。');
  } catch (e) {
    console.error(`\n⚠️ 写入 HTML 失败：${e.message}`);
    process.exitCode = 1;
  }
}

main();
