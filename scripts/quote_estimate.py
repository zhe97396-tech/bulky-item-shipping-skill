#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
大件物流比价估算器（京东 / 顺丰 / 德邦）

不联网、不猜线路运价。它算的是「比价前必须算清、但各家客服不会替你算」的部分：
  1) 体积重（各家轻抛系数不同）
  2) 计费重量 = max(实重, 体积重)
  3) 上楼费档位判定 + 金额（分水岭是「有没有单件 >=60kg」）
  4) 超长超重 / 不支持上楼的检查
  5) 生成「要填进小程序的数据」和「问客服的话术」

用法
----
python3 quote_estimate.py \\
    --item "纸箱:60:40:50:15:8" \\
    --item "物流袋:50:40:40:10:2" \\
    --item "折叠床:100:30:20:20:1" \\
    --floor-from 4 --floor-to 6

--item 格式：名称:长cm:宽cm:高cm:单件重kg:数量
--floor-from / --floor-to   起点、终点楼层（1 = 一楼）
--elevator-from / --elevator-to   该端有可用电梯（则不计上楼费）

也可用 JSON：
python3 quote_estimate.py --json-file items.json
JSON 格式：{"items":[{"name":"纸箱","l":60,"w":40,"h":50,"weight":15,"count":8}],
          "floor_from":4,"floor_to":6}
"""
import argparse
import json
import sys

# 轻抛系数（体积重除数）。系数越小，体积重越大。
DIVISORS = [
    ("京东·重货标快/特快", 6000),
    ("顺丰·卡航", 6000),
    ("德邦·零担（精准汽运/卡航）", 4800),
    ("德邦·快递类", 6000),
]


def volume_weight(cm3, divisor):
    return cm3 / divisor


def jd_upstairs(bill_w, heaviest):
    """京东（重货标快）：整票/最重件 双门槛。"""
    if bill_w < 100 and heaviest < 60:
        return 0.0, "免费（整票<100kg 且 最重件<60kg）"
    if heaviest >= 60:
        return bill_w * 0.9, "0.9 元/kg（最重件>=60kg）"
    return bill_w * 0.3, "0.3 元/kg（整票>=100kg 且 最重件<60kg）"


def sf_upstairs(bill_w, heaviest):
    """顺丰卡航：收件标准 = 单件>=60kg 或 单票>=100kg。"""
    if heaviest >= 60:
        return bill_w * 1.0, "1.0 元/kg（最重件>=60kg）"
    if bill_w >= 100:
        return bill_w * 0.3, "0.3 元/kg（所有子件<60kg 且整票>=100kg）"
    return 0.0, "不收取（未达收件标准）"


def db_upstairs(bill_w, heaviest):
    """德邦零担：按最重件分 0.3/1/2 元/kg。"""
    if heaviest <= 60 and bill_w > 100:
        return bill_w * 0.3, "0.3 元/kg（最重件<=60kg 且整票>100kg）"
    if heaviest <= 150:
        return bill_w * 1.0, "1 元/kg（最重件<=150kg）"
    return bill_w * 2.0, "2 元/kg（最重件>150kg）"


def check_limits(items):
    """返回警告列表。长度单位 m，重量 kg。"""
    warn = []
    for it in items:
        dims = sorted([it["l"], it["w"], it["h"]])
        longest = dims[2] / 100.0
        second = dims[1] / 100.0
        third = dims[0] / 100.0
        sides = (it["l"] + it["w"] + it["h"]) / 100.0
        nm = it["name"]
        if longest > 2.5:
            warn.append(f"[上楼不支持] {nm}：最长边 {longest:.2f}m > 2.5m（京东不收上楼）")
        if sides > 5.0:
            warn.append(f"[上楼不支持] {nm}：三边之和 {sides:.2f}m > 5m（京东不收上楼）")
        if it["weight"] > 135:
            warn.append(f"[上楼不支持] {nm}：单件 {it['weight']}kg > 135kg（京东不收上楼）")
        if it["weight"] > 130:
            warn.append(f"[上楼不支持] {nm}：单件 {it['weight']}kg > 130kg（顺丰不收上楼）")
        if (3.1 < longest <= 4.0) or (300 < it["weight"] <= 1000) or (5.5 < sides <= 6.3):
            warn.append(f"[超长超重] {nm}：触发京东重货超长超重加收（计费重×0.2 元/kg，20-500 元/票）")
        if longest > 3.0 or second > 1.8 or third > 1.5:
            warn.append(f"[超长超重] {nm}：触发顺丰卡航超长附加（计费重×0.5 元/kg）")
        if it["weight"] > 1000:
            warn.append(f"[可能拒收] {nm}：单件 {it['weight']}kg 超 1000kg，先问收派员")
    return warn


def fmt_items(items):
    return "\n".join(
        f"  {it['name']}: {it['l']:g}×{it['w']:g}×{it['h']:g}cm × {it['count']}件, 单件{it['weight']:g}kg"
        for it in items
    )


def build_report(items, floor_from, floor_to, elev_from, elev_to):
    out = []
    P = out.append

    n_pieces = sum(it["count"] for it in items)
    actual_w = sum(it["weight"] * it["count"] for it in items)
    cm3 = sum(it["l"] * it["w"] * it["h"] * it["count"] for it in items)
    m3 = cm3 / 1_000_000.0
    heaviest = max((it["weight"] for it in items), default=0)

    P("=" * 68)
    P("  大件物流比价估算（京东 / 顺丰 / 德邦）")
    P("=" * 68)
    P("")
    P("【你填进去的货】")
    P(fmt_items(items))
    P(f"  合计：{n_pieces} 件 ｜ 实重 {actual_w:.1f} kg ｜ 体积 {m3:.3f} m³")
    P(f"  单件最重：{heaviest:g} kg（这是上楼费档位的关键）")
    P("")

    P("【第 1 步：算体积重 → 得计费重量】")
    P("  体积重 = 长×宽×高 ÷ 轻抛系数；计费重量 = max(实重, 体积重)")
    P("")
    P(f"  {'承运/产品':<26}{'系数':>6}{'体积重':>12}{'计费重量':>12}")
    P("  " + "-" * 62)
    bill = {}
    for name, div in DIVISORS:
        vw = volume_weight(cm3, div)
        bw = max(actual_w, vw)
        bill[name] = bw
        flag = " ← 体积重更大（泡货）" if vw > actual_w else ""
        P(f"  {name:<26}{div:>6}{vw:>10.1f}kg{bw:>10.1f}kg{flag}")
    P("")

    P("【第 2 步：上楼费（分水岭 = 有没有单件 ≥60kg）】")
    if elev_from and elev_to:
        P("  两端都有可用电梯 → 三家都不收上楼费。")
    else:
        P(f"  起点 {floor_from} 楼（{'有' if elev_from else '无'}电梯）→ 终点 {floor_to} 楼（{'有' if elev_to else '无'}电梯）")
        P("")
        rows = [
            ("京东（重货标快）",) + jd_upstairs(bill["京东·重货标快/特快"], heaviest),
            ("顺丰（卡航）",) + sf_upstairs(bill["顺丰·卡航"], heaviest),
            ("德邦（零担）",) + db_upstairs(bill["德邦·零担（精准汽运/卡航）"], heaviest),
        ]
        P(f"  {'承运':<20}{'金额':>10}  规则")
        P("  " + "-" * 62)
        for nm, amt, why in rows:
            P(f"  {nm:<20}{amt:>8.1f} 元  {why}")
        P("")
        P("  ※ 按「派送端无电梯」计；上门端/派送端有电梯且满足要求可不收。")
    P("")

    P("【第 3 步：超限检查】")
    warn = check_limits(items)
    if warn:
        for w in warn:
            P("  ⚠ " + w)
    else:
        P("  ✓ 没有触发超长超重 / 不支持上楼的条件。")
    P("")

    P("=" * 68)
    P("【下一步：拿真实报价】")
    P("=" * 68)
    P("")
    P("A. 小程序里要填的数据（三家一样，照着填）")
    P(f"   总件数 {n_pieces} 件 ｜ 总体积 {m3:.3f} m³ ｜ 实重合计 {actual_w:.1f} kg")
    P("   ◆ 关键：按「件」逐个录入，不要填成一件！")
    P("     （填成一件，上楼费会从 0.3 元/kg 跳到 0.9~1.0 元/kg）")
    P("   ◆ 送货方式选「送货上楼 / 步梯上楼」")
    P("")
    P("B. 打电话问客服（照念）")
    P(f"   「从 ___ 到 ___。物品是以下这些，总共约 {m3:.2f} 立方、实重约 {actual_w:.0f} 公斤：")
    for it in items:
        P(f"     · {it['count']} 件 {it['name']}，各 {it['l']:g}×{it['w']:g}×{it['h']:g}cm、约 {it['weight']:g}kg")
    P(f"   起点 {floor_from} 楼、终点 {floor_to} 楼，约无电梯。」")
    P("")
    P("   必问五句：")
    P("     1. 含上门取件 + 两端搬楼，一共多少钱？")
    P("     2. 计费重量按什么算、轻抛系数多少？")
    P("     3. 上楼费按实际重量还是计费重量？")
    P(f"     4. 我每件都不超过 60 公斤（最重大约 {heaviest:g}kg），是不是按最低档？")
    P("     5. 取件端收不收费？")
    P("")
    P("C. 拿到两家的「到手总价」后对比，选低的。")
    P("   三个必做：")
    P("     · 首重/续重问清楚（首重多少 kg、多少钱）")
    P("     · 优惠券通常只抵运费，不抵上楼费")
    P("     · 让快递员当面点清件数")
    P("")
    P("※ 本脚本不算线路运价（那需联系客服/小程序）。它保证四项不出错：")
    P("  体积重、计费重量、上楼费档位、超限风险。")
    P("")
    return "\n".join(out)


def parse_item(s):
    parts = s.split(":")
    if len(parts) != 6:
        raise argparse.ArgumentTypeError(
            f"--item 需要 6 段（名称:长:宽:高:单件重kg:数量），收到：{s!r}"
        )
    name, l, w, h, wt, cnt = parts
    return {
        "name": name,
        "l": float(l), "w": float(w), "h": float(h),
        "weight": float(wt), "count": int(cnt),
    }


def main():
    ap = argparse.ArgumentParser(description="大件物流比价估算器（京东/顺丰/德邦）")
    ap.add_argument("--item", action="append", type=parse_item, default=[],
                    help="名称:长cm:宽cm:高cm:单件重kg:数量（可重复）")
    ap.add_argument("--json-file", help="从 JSON 文件读取")
    ap.add_argument("--floor-from", type=int, default=1, help="起点楼层（1=一楼）")
    ap.add_argument("--floor-to", type=int, default=1, help="终点楼层")
    ap.add_argument("--elevator-from", action="store_true", help="起点有可用电梯")
    ap.add_argument("--elevator-to", action="store_true", help="终点有可用电梯")
    a = ap.parse_args()

    items = list(a.item)
    ff, ft = a.floor_from, a.floor_to
    ef, et = a.elevator_from, a.elevator_to

    if a.json_file:
        data = json.load(open(a.json_file, encoding="utf-8"))
        items = [{
            "name": it.get("name", "件"),
            "l": float(it["l"]), "w": float(it["w"]), "h": float(it["h"]),
            "weight": float(it["weight"]), "count": int(it.get("count", 1)),
        } for it in data.get("items", [])]
        ff = data.get("floor_from", ff)
        ft = data.get("floor_to", ft)
        ef = data.get("elevator_from", ef)
        et = data.get("elevator_to", et)

    if not items:
        ap.print_help()
        print("\n错误：至少给一个 --item，或用 --json-file。")
        sys.exit(2)

    print(build_report(items, ff, ft, ef, et))


if __name__ == "__main__":
    main()
