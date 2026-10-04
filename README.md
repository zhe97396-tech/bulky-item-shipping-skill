# 大件物流比价（京东 / 顺丰 / 德邦）

搬家寄大件、跨省运箱子 —— 把**京东 / 顺丰 / 德邦**三家的计费规则、上楼费档位、超限条件
全部对齐的比价工具 + 一套可复用的比价方法。

**跨 Agent 通用**：Codex / Cursor / Claude Code / Jules / Amp / Hermes 都能用 ——
`AGENTS.md` 是通用入口，CLI 是通用执行器。

```
✅ 跨 Agent（AGENTS.md 标准）
✅ 零依赖 CLI（node >= 14）
✅ 可 npx 运行
✅ 也可纯当文档读
```

---

## 它解决什么问题

大件物流最坑的不是运价，而是**三家口径不一致 + 一个几乎没人知道的分档机制**：

### ① 网上问不到准价

官网默认展示的往往是贵的那档。实测：同一批货，官网「大件次日」912 元起，
而客服推荐的「卡航」只要 421 元 —— **差一倍，只是产品不同**。

→ **官网规则页 + 小程序实填 + 客服电话，三条路都要走。**

### ② 上楼费按「子件结构」分档，不是按总重 —— 这是最贵的坑

| 条件 | 京东（重货标快） | 顺丰（卡航） |
|---|---|---|
| 所有件 &lt;60kg 且整票 ≥100kg | **0.3 元/kg** | **0.3 元/kg** |
| 任一件 ≥60kg | 0.9 元/kg | 1.0 元/kg |

录单时把货填成「一件 150kg」而不是「8 件箱子」，
**同样一批货要多花 105 元**。

顺丰官方明文支持**子母件**（「若为子母件，则将每件的计费重量进行汇总后计算总运费」）——
按件申报是承运方自己设计的机制，**不是钻空子**。

### ③ 计费重量 = max(实重, 体积重)；楼层不加价

京东官方写「二楼以上（含）及负一层以下（含）」，顺丰写「二楼（含）以上」——
两家都只界定「算不算上楼」，**没有楼层费率**。
网上「每层加收 20–50 元」的说法与官方规则不符，不要采信。

---

## 快速开始

### 方式一：npx（推荐）

```bash
npx bulky-item-shipping \
  --item "纸箱:60:40:50:15:8" \
  --item "物流袋:50:40:40:10:2" \
  --item "折叠床:100:30:20:20:1" \
  --floor-from 4 --floor-to 6
```

`--item` 格式：`名称:长cm:宽cm:高cm:单件重kg:数量`（可重复）

**输出：**

- 终端：可读的文本报告
- 📄 **当前目录自动生成 `大件物流比价报告.html`** —— 自包含单文件、零外部依赖、可离线打开 / 打印 / 转发

```
【第 1 步】体积重 → 计费重量（三家系数不同）
【第 2 步】三家的上楼费档位判定 + 金额
【第 3 步】超长超重 / 不支持上楼的检查
【第 4 步】到手总价对比（用 --quote 填进去）
【第 5 步】还缺什么 + 行动清单 + 问客服话术
```

> 📌 **HTML 是最终交付物，而且可刷新。**
> 后续拿到新信息（小程序实价、客服确认、体积复测）时，**重跑同一条命令**即可刷新报告 —— 不要手改 HTML。

加 `--json` 只输出结构化 JSON（不生成 HTML），给程序 / Agent 解析。

> 工具**不算线路运价**（那需要小程序 / 客服询价）。
> 它保证四项不出错：**体积重、计费重量、上楼费档位、超限风险**。

### 方式二：克隆后本地运行

```bash
git clone <repo-url>
cd bulky-item-shipping-skill
node bin/cli.js --item "纸箱:60:40:50:15:8" --floor-from 4 --floor-to 6
```

### 方式三：让你的 Agent 读 `AGENTS.md`

`AGENTS.md` 是跨 Agent 的通用约定（Codex / Cursor / Jules / Amp 等都读它）。
把仓库放在 Agent 的工作区里，或把 `AGENTS.md` 内容贴进它的 rules / system prompt。

Agent 会先问你 6 项信息，再跑 CLI，再出结论。

---

## 安装到各 Agent

| Agent | 怎么做 |
|---|---|
| **Hermes** | 仓库放到 `~/.hermes/skills/bulky-item-shipping/`（读 `SKILL.md`）|
| **Claude Code** | 仓库根的 `CLAUDE.md` 会被自动读（指向 `AGENTS.md`）|
| **Codex / Cursor / Jules / Amp** | 仓库根的 `AGENTS.md` 会被自动读 |
| **其他 / 通用** | 把 `AGENTS.md` 内容贴进 system prompt 或 rules 文件 |
| **只要数字** | `npx bulky-item-shipping ...`，任何能跑 shell 的地方都行 |

---

## 命令行选项

| 选项 | 说明 |
|---|---|
| `--item <规格>` | `名称:长cm:宽cm:高cm:单件重kg:数量`（可重复）|
| `--json-file <路径>` | 从 JSON 读取货物、楼层、实价、待确认项 |
| `--floor-from <N>` / `--floor-to <N>` | 起点 / 终点楼层（1 = 一楼）|
| `--elevator-from` / `--elevator-to` | 该端有可用电梯（则不计上楼费）|
| `--from <文本>` / `--to <文本>` | 起点 / 终点描述（写进报告抬头）|
| `--quote "<承运>=<金额>"` | **到手总价**（可重复）——填进去会自动比较并标出最低 |
| `--note "<承运>=<备注>"` | 给某个承运加备注 |
| `--pending "<待确认项>"` | 加入报告里的「还缺什么」（可重复）|
| `--out <路径>` | HTML 报告输出路径（默认 `./大件物流比价报告.html`）|
| `--no-html` | 不生成 HTML（只要终端文本）|
| `--json` | 只输出结构化 JSON |
| `-h` / `--help`、`-v` / `--version` | 帮助 / 版本 |

### 典型用法：拿到报价后刷新报告

```bash
npx bulky-item-shipping \
  --item "纸箱:60:40:50:15:8" --floor-from 4 --floor-to 6 \
  --from "A 城 B 区（4 楼无电梯）" --to "C 城 D 区（6 楼无电梯）" \
  --quote "京东（重货标快）=435" --note "京东（重货标快）=小程序实价" \
  --quote "顺丰（卡航）=571"     --note "顺丰（卡航）=按最高档 1 元/kg" \
  --pending "体积未量准，计费重量可能上浮" \
  --out "~/Desktop/大件物流比价报告.html"
```

报告会自动给出「**推荐：京东，到手约 ¥435 —— 比第二便宜的省 ¥136**」。

### 也可以当库用

```js
const { compute } = require('bulky-item-shipping');
const { renderHtml } = require('bulky-item-shipping/lib/render-html');

const r = compute(
  [{ name: '纸箱', l: 60, w: 40, h: 50, weight: 15, count: 8 }],
  { floorFrom: 4, floorTo: 6 }
);
require('fs').writeFileSync('报告.html', renderHtml(r, { from: 'A', to: 'B' }));
```

---

## 文件

```
AGENTS.md                     通用 Agent 入口（跨工具标准）
CLAUDE.md                     Claude Code 入口（指向 AGENTS.md）
SKILL.md                      Hermes skill 入口
README.md                     本文件
package.json                  npm 包定义
bin/cli.js                    命令行入口（含 HTML 输出）
lib/estimate.js               核心计算（全项目唯一实现）
lib/render-html.js            HTML 报告渲染器（自包含单文件）
references/carrier-rules.md   三家规则速查（系数 / 上楼档位 / 超限 / 进位 / 保价）
templates/report.md           纯 Markdown 备选模板（无 node 环境时手填用）
```

---

## 三条铁律

1. **三条路都要走** —— 官网规则页 + 小程序实填 + 客服电话。少一条就拿错价。
2. **上楼费按「子件结构」分档** —— 必须**按件申报**。
3. **计费重量 = max(实重, 体积重)**；**楼层不加价**。

详细规则见 [`references/carrier-rules.md`](./references/carrier-rules.md)。

---

## 免责声明

- **费率会变。** 本项目里的数值是 2026-10 在官方渠道查证的**基线**，
  **下单前一律以官方页面 / 小程序 / 955xx 客服为准**。
- 最终运费以承运方上门测重测方、按实际产品与网点政策开单为准。
- 本项目与京东、顺丰、德邦**无任何关联**，不代表其官方口径。

---

## 贡献

发现规则变动或新的坑？欢迎提 Issue / PR。

**请附官方来源**（页面链接或截图）。第三方内容农场把某家的档位安到另一家头上是常见错误，
这类说法一律不采信。

---

## 许可

MIT
