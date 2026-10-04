#!/usr/bin/env node
'use strict';

/**
 * 大件物流比价估算 CLI（京东 / 顺丰 / 德邦）
 *
 *   npx bulky-item-shipping --item "纸箱:60:40:50:15:8" --floor-from 4 --floor-to 6
 *
 * 全部选项：
 *   --item 名称:长cm:宽cm:高cm:单件重kg:数量   可重复
 *   --json-file <path>      从 JSON 读取（{items:[{name,l,w,h,weight,count}], floor_from, ...}）
 *   --floor-from N          起点楼层（1 = 一楼）
 *   --floor-to N            终点楼层
 *   --elevator-from         起点有可用电梯（则不计上楼费）
 *   --elevator-to           终点有可用电梯
 *   --json                  输出结构化 JSON（给 Agent/程序解析）
 *   -h, --help / -v, --version
 */

const fs = require('fs');
const { compute, renderText, parseItem } = require('../lib/estimate.js');
const pkg = require('../package.json');

const HELP = `
大件物流比价估算（京东 / 顺丰 / 德邦）

用法：
  bulky-item-shipping --item "纸箱:60:40:50:15:8" --item "折叠床:100:30:20:20:1" \\
                      --floor-from 4 --floor-to 6

选项：
  --item <规格>          名称:长cm:宽cm:高cm:单件重kg:数量（可重复）
  --json-file <路径>     从 JSON 文件读取货物与楼层
  --floor-from <N>       起点楼层（1 = 一楼，默认 1）
  --floor-to <N>         终点楼层（默认 1）
  --elevator-from        起点有可用电梯
  --elevator-to          终点有可用电梯
  --json                 输出结构化 JSON
  -h, --help             帮助
  -v, --version          版本

输出：体积重、计费重量、三家上楼费档位与金额、超限检查，
      以及「要填进小程序的数据」和「问客服的话术」。

不联网、不算线路运价 —— 那需要小程序/客服。
它保证四项不出错：体积重、计费重量、上楼费档位、超限风险。
`;

function readArgv(argv) {
  const opts = { items: [], jsonFile: null, floorFrom: 1, floorTo: 1, elevatorFrom: false, elevatorTo: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`选项 ${a} 缺少值`);
      return argv[++i];
    };
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      case '--item': opts.items.push(parseItem(next())); break;
      case '--json-file': opts.jsonFile = next(); break;
      case '--floor-from': opts.floorFrom = parseInt(next(), 10); break;
      case '--floor-to': opts.floorTo = parseInt(next(), 10); break;
      case '--elevator-from': opts.elevatorFrom = true; break;
      case '--elevator-to': opts.elevatorTo = true; break;
      case '--json': opts.json = true; break;
      default: throw new Error(`未知选项：${a}（用 --help 看用法）`);
    }
  }
  return opts;
}

function loadJsonFile(path, opts) {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const items = (data.items || []).map((it) => ({
    name: it.name || '件',
    l: Number(it.l), w: Number(it.w), h: Number(it.h),
    weight: Number(it.weight), count: it.count == null ? 1 : parseInt(it.count, 10),
  }));
  return {
    items,
    floorFrom: data.floor_from ?? opts.floorFrom,
    floorTo: data.floor_to ?? opts.floorTo,
    elevatorFrom: data.elevator_from ?? opts.elevatorFrom,
    elevatorTo: data.elevator_to ?? opts.elevatorTo,
  };
}

function main() {
  let opts;
  try {
    opts = readArgv(process.argv.slice(2));
  } catch (e) {
    console.error('错误：' + e.message);
    process.exit(2);
  }

  if (opts.help) { process.stdout.write(HELP); return; }
  if (opts.version) { console.log(pkg.version); return; }

  if (opts.jsonFile) {
    try {
      Object.assign(opts, loadJsonFile(opts.jsonFile, opts));
    } catch (e) {
      console.error(`错误：读取 ${opts.jsonFile} 失败 —— ${e.message}`);
      process.exit(2);
    }
  }

  if (!opts.items.length) {
    process.stdout.write(HELP);
    console.error('错误：至少给一个 --item，或用 --json-file。');
    process.exit(2);
  }

  const result = compute(opts.items, opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result));
  }
}

main();
