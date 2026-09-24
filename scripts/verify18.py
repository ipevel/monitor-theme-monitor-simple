"""
Headless regression for the built theme.

No version in that line on purpose: the file name carries one already, and the
script is reused across releases (it verified v1.7.0 through v1.8.1), so a
version written here only went stale.

Run with a system Python that has Playwright installed:

    python scripts/verify18.py [http://127.0.0.1:PORT] [dist]

With no URL it serves the second argument -- `dist/` by default -- on a
throwaway port and answers the panel's four API calls itself, so nothing but the
built bundle is under test. Passing a URL instead checks whatever is already
serving there, which is how a downloaded release package is verified. Everything
it asserts is a thing a unit test cannot see: a computed colour, a string that
was formatted at render time, whether the page logged an error.
"""

import datetime
import functools
import http.server
import json
import socketserver
import sys
import threading
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
ROOT = sys.argv[2] if len(sys.argv) > 2 else "dist"

# PowerShell drops an empty `""` argument when calling a native command, so the
# two-argument form above arrives here as one and the directory lands in BASE.
# Left alone, that opened `file:///E:/.../dist/` -- a directory listing, which
# rendered no node and read as the theme being broken. A BASE that is not a URL
# is that directory, not a page to open.
if BASE and not BASE.startswith(("http://", "https://")):
    ROOT, BASE = BASE, None

NOW = 1_770_000_000

# 「今天 +5 天」，给不带 expires_in 的那台节点用：主题只能自己按日期算天数，日期
# 只有跟着日子走，「5 天后到期」那条断言才不会在某个日期之后变成「已过期」。偏移
# 量 5 和断言里的 5 是一对，改一个要改另一个。
SOON_DATE = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()

NODES = [
    {
        "id": 1,
        "name": "tokyo-01",
        "sort": 1,
        "public": True,
        "online": True,
        "country": "JP",
        "last_seen": NOW,
        "hostname": "tokyo-01",
        "ip": "203.0.113.47",
        "ipv4": "203.0.113.47",
        "ipv6": "2001:db8:85a3::8a2e",
        "remark": "",
        "os": "Debian",
        "kernel": "6.8.0",
        "arch": "x86_64",
        "virt": "kvm",
        "cpu_name": "Intel Xeon E5-2680 v4",
        "cpu_cores": 2,
        "mem_total": 4 * 1024 ** 3,
        "swap_total": 2 * 1024 ** 3,
        "disk_total": 100 * 1024 ** 3,
        "agent_version": "1.0.0",
        "price": 5,
        "currency": "USD",
        "billing_cycle": "monthly",
        "expires_at": None,
        "traffic_limit": 0,
        "traffic_mode": "sum",
        "traffic_reset_day": 1,
        "total_rx": 1024 ** 3,
        "total_tx": 1024 ** 3,
        "month_rx": 10 * 1024 ** 3,
        "month_tx": 5 * 1024 ** 3,
        "day_rx": 1024 ** 3,
        "day_tx": 512 * 1024 ** 2,
        "metrics": {
            "uptime": 90000,
            "cpu": 7.5,
            "load": [0.4, 0.5, 0.6],
            "mem_total": 4 * 1024 ** 3,
            "mem_used": 3 * 1024 ** 3,
            "swap_total": 2 * 1024 ** 3,
            "swap_used": 0,
            "disk_total": 100 * 1024 ** 3,
            "disk_used": 95 * 1024 ** 3,
            "net_rx": 2 * 1024 ** 2,
            "net_tx": 512 * 1024,
            "total_rx": 1024 ** 3,
            "total_tx": 1024 ** 3,
            "month_rx": 10 * 1024 ** 3,
            "month_tx": 5 * 1024 ** 3,
            "tcp": 40,
            "udp": 6,
            "procs": 120,
        },
    },
    {
        "id": 2,
        "name": "shanghai-02",
        "sort": 2,
        "public": True,
        "online": False,
        "country": "CN",
        "last_seen": NOW - 3600,
        "os": "Debian",
        "kernel": "6.8.0",
        "arch": "x86_64",
        "virt": "kvm",
        "cpu_name": "",
        "cpu_cores": 2,
        "mem_total": 2 * 1024 ** 3,
        "swap_total": 0,
        "disk_total": 40 * 1024 ** 3,
        "agent_version": "1.0.0",
        "price": 0,
        "currency": "",
        "billing_cycle": "",
        "expires_at": None,
        "traffic_limit": 0,
        "traffic_mode": "sum",
        "traffic_reset_day": 1,
        "total_rx": 0,
        "total_tx": 0,
        "month_rx": 0,
        "month_tx": 0,
        "day_rx": 0,
        "day_tx": 0,
        "metrics": None,
    },
    {
        # 排序回归的三名演员之一：本月流量最大（80 GiB），CPU 安静。
        "id": 3,
        "name": "frankfurt-03",
        "sort": 3,
        "public": True,
        "online": True,
        "country": "DE",
        "last_seen": NOW,
        "hostname": "frankfurt-03",
        "ip": "203.0.113.48",
        "ipv4": "203.0.113.48",
        "ipv6": "",
        "remark": "",
        "os": "Debian",
        "kernel": "6.8.0",
        "arch": "x86_64",
        "virt": "kvm",
        "cpu_name": "Intel Xeon",
        "cpu_cores": 2,
        "mem_total": 4 * 1024 ** 3,
        "swap_total": 0,
        "disk_total": 100 * 1024 ** 3,
        "agent_version": "1.0.0",
        "price": 5,
        "currency": "USD",
        "billing_cycle": "monthly",
        "expires_at": "2027-06-01",
        # 用固定的天数，不让写死的日历日自己衰减：这套 mock 要长期跑，「到期时间」
        # 排序的断言才永远成立。
        "expires_in": 250,
        "traffic_limit": 100 * 1024 ** 3,
        "traffic_mode": "sum",
        "traffic_reset_day": 1,
        "total_rx": 1024 ** 3,
        "total_tx": 1024 ** 3,
        "month_rx": 60 * 1024 ** 3,
        "month_tx": 20 * 1024 ** 3,
        "day_rx": 1024 ** 3,
        "day_tx": 512 * 1024 ** 2,
        "metrics": {
            "uptime": 90000,
            "cpu": 3.0,
            "load": [0.2, 0.2, 0.2],
            "mem_total": 4 * 1024 ** 3,
            "mem_used": 2 * 1024 ** 3,
            "swap_total": 0,
            "swap_used": 0,
            "disk_total": 100 * 1024 ** 3,
            "disk_used": 30 * 1024 ** 3,
            "net_rx": 0,
            "net_tx": 0,
            "total_rx": 1024 ** 3,
            "total_tx": 1024 ** 3,
            "month_rx": 60 * 1024 ** 3,
            "month_tx": 20 * 1024 ** 3,
            "tcp": 40,
            "udp": 6,
            "procs": 120,
        },
    },
    {
        # 排序回归的三名演员之二：CPU 最响（90%），到期最近，流量最小。
        "id": 4,
        "name": "osaka-04",
        "sort": 4,
        "public": True,
        "online": True,
        "country": "JP",
        "last_seen": NOW,
        "hostname": "osaka-04",
        "ip": "203.0.113.49",
        "ipv4": "203.0.113.49",
        "ipv6": "",
        "remark": "",
        "os": "Debian",
        "kernel": "6.8.0",
        "arch": "x86_64",
        "virt": "kvm",
        "cpu_name": "Intel Xeon",
        "cpu_cores": 2,
        "mem_total": 4 * 1024 ** 3,
        "swap_total": 0,
        "disk_total": 100 * 1024 ** 3,
        "agent_version": "1.0.0",
        "price": 5,
        "currency": "USD",
        "billing_cycle": "monthly",
        "expires_at": "2026-12-01",
        # hub 说 3 天，写死的日期却在几个月之外：卡片必须写 3（hub 的口径）。
        # 两个数故意不一致 —— 这就是这条断言的意义。
        "expires_in": 3,
        "traffic_limit": 0,
        "traffic_mode": "sum",
        "traffic_reset_day": 1,
        "total_rx": 1024 ** 3,
        "total_tx": 1024 ** 3,
        "month_rx": 512 * 1024 ** 2,
        "month_tx": 512 * 1024 ** 2,
        "day_rx": 1024 ** 3,
        "day_tx": 512 * 1024 ** 2,
        "metrics": {
            "uptime": 90000,
            "cpu": 90.0,
            "load": [0.4, 0.4, 0.4],
            "mem_total": 4 * 1024 ** 3,
            "mem_used": 1024 ** 3,
            "swap_total": 0,
            "swap_used": 0,
            "disk_total": 100 * 1024 ** 3,
            "disk_used": 30 * 1024 ** 3,
            "net_rx": 3 * 1024 ** 2,
            "net_tx": 128 * 1024,
            "total_rx": 1024 ** 3,
            "total_tx": 1024 ** 3,
            "month_rx": 512 * 1024 ** 2,
            "month_tx": 512 * 1024 ** 2,
            "tcp": 40,
            "udp": 6,
            "procs": 120,
        },
    },
    {
        # 反方向的证人：这一台不带 expires_in，主题只能自己按 expires_at 算天数 ——
        # hub v1.3.0 之前的 hub 就是这样，契约要求主题照常工作。日期取「今天 +5 天」
        # 现算（SOON_DATE），跟着日子走，所以「5 天后到期」这条断言不会过期。
        "id": 5,
        "name": "sydney-05",
        "sort": 5,
        "public": True,
        "online": True,
        "country": "AU",
        "last_seen": NOW,
        "hostname": "sydney-05",
        "ip": "203.0.113.50",
        "ipv4": "203.0.113.50",
        "ipv6": "",
        "remark": "",
        "os": "Debian",
        "kernel": "6.8.0",
        "arch": "x86_64",
        "virt": "kvm",
        "cpu_name": "Intel Xeon",
        "cpu_cores": 2,
        "mem_total": 4 * 1024 ** 3,
        "swap_total": 0,
        "disk_total": 100 * 1024 ** 3,
        "agent_version": "1.0.0",
        "price": 5,
        "currency": "USD",
        "billing_cycle": "monthly",
        "expires_at": SOON_DATE,
        "traffic_limit": 0,
        "traffic_mode": "sum",
        "traffic_reset_day": 1,
        "total_rx": 1024 ** 3,
        "total_tx": 1024 ** 3,
        "month_rx": 512 * 1024 ** 2,
        "month_tx": 512 * 1024 ** 2,
        "day_rx": 1024 ** 3,
        "day_tx": 512 * 1024 ** 2,
        "metrics": {
            "uptime": 90000,
            "cpu": 5.0,
            "load": [0.3, 0.3, 0.3],
            "mem_total": 4 * 1024 ** 3,
            "mem_used": 1024 ** 3,
            "swap_total": 0,
            "swap_used": 0,
            "disk_total": 100 * 1024 ** 3,
            "disk_used": 20 * 1024 ** 3,
            "net_rx": 0,
            "net_tx": 0,
            "total_rx": 1024 ** 3,
            "total_tx": 1024 ** 3,
            "month_rx": 512 * 1024 ** 2,
            "month_tx": 512 * 1024 ** 2,
            "tcp": 10,
            "udp": 2,
            "procs": 100,
        },
    },
]

PING = {"ping": [], "loss": {}}


def handler_for(path: str):
    if path == "/api/me":
        return {"authed": True, "github": False, "site_name": "probe", "public_page": True}
    if path == "/api/nodes":
        return {"nodes": NODES}
    if path.startswith("/api/nodes/") and path.endswith("/metrics"):
        return {"metrics": [], "ping": [], "probes": {}, "loss": {}}
    return None


results = []


def reddish(colour):
    """A warm colour, clearly not the near-black a healthy reading is printed in."""
    try:
        r, g, b = (int(v) for v in colour[colour.index("(") + 1:colour.index(")")].split(",")[:3])
    except ValueError:
        return False
    return r > g + 40 and r > b + 40


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("  PASS  " if ok else "  FAIL  ") + name + (f"  -- {detail}" if detail else ""))


def serve(directory):
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=directory
    )
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def main():
    httpd = None
    base = BASE
    if not base:
        httpd, base = serve(ROOT)

    errors = []
    with sync_playwright() as pw:
        # The bundled Playwright build and the browser cache on this machine are
        # usually a revision apart; Edge is the one Chromium that is always there.
        browser = pw.chromium.launch(
            executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        )
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        # The harness answers HTTP only, so the live socket is expected to fail and
        # fall back to polling -- that is not the panel failing.
        page.on(
            "console",
            lambda m: errors.append(m.text) if m.type == "error" and "WebSocket" not in m.text else None,
        )
        page.on("pageerror", lambda e: errors.append(str(e)))

        def api_route(route):
            path = urlparse(route.request.url).path
            body = handler_for(path)
            if body is None:
                route.fulfill(status=404, body="")
            else:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        page.route("**/api/**", api_route)
        page.goto(base, wait_until="networkidle")
        page.wait_for_selector("text=tokyo-01", timeout=10000)

        # 1. The card prints the live rate it was already being sent. The rate
        # line has carried no arrow glyph since the v1.9 rebuild -- the icon is
        # an aria-hidden svg -- so the regex below is the bare value.
        check("卡片显示实时速率", page.locator("text=/2\\.0 MB\\/s/").count() > 0)

        # 1b. A country code draws its flag, not a letter badge. The sprite was
        # built from a hand-written list of 120 codes that had no artwork for CN,
        # and a missing flag is a fallback rather than an error -- so nothing
        # failed, nothing logged, and 133 countries went without a flag for two
        # releases. Both mocked countries are asserted, one of them CN.
        check("卡片为 CN 画出国旗", page.locator('use[href="#flag-cn"]').count() > 0)
        check("卡片为 JP 画出国旗", page.locator('use[href="#flag-jp"]').count() > 0)

        # 2. Card and detail print the same number for the same reading.
        card_cpu = page.locator("text=7.5%").first
        check("卡片 CPU 保留一位小数", card_cpu.count() > 0)

        # 3. An offline host is counted in red, not in the ink of a healthy fleet.
        strip = page.evaluate("""() => {
            const label = [...document.querySelectorAll('div')].find(
              d => d.textContent.trim() === '节点' && d.className.includes('text-[11px]'),
            )
            if (!label) return null
            const value = label.parentElement.children[1]
            return { text: value.textContent.trim(), colour: getComputedStyle(value).color }
        }""")
        # Red, and not the near-black a healthy fleet is printed in.
        check(
            "概览条离线转为告警色",
            bool(strip) and reddish(strip["colour"]),
            str(strip),
        )

        # 4. The sort select must actually reorder. v1.9.0 shipped an onChange
        # that lifted `document.startViewTransition` into a local and called it
        # detached: every supporting browser threw "Illegal invocation" before
        # `setFilters` ran, so no selection ever did anything -- and this script
        # only asserted rendering, so the release shipped without anyone noticing.
        # Three options, three different first cards, assert on all of them.
        sort_sel = 'select[aria-label="排序方式"]'

        def card_names():
            return page.evaluate(
                "() => [...document.querySelectorAll('a[href^=\"/node/\"]')]"
                ".map(a => a.querySelector('h3')?.textContent.trim())"
            )

        names = card_names()
        check("问题优先把离线排最前", names[0] == "shanghai-02", str(names))
        page.locator(sort_sel).select_option(label="CPU 占用")
        page.wait_for_timeout(400)
        names = card_names()
        check("按 CPU 占用排序生效", names[0] == "osaka-04", str(names))
        page.locator(sort_sel).select_option(label="本月流量")
        page.wait_for_timeout(400)
        names = card_names()
        check("按本月流量排序生效", names[0] == "frankfurt-03", str(names))
        page.locator(sort_sel).select_option(label="到期时间")
        page.wait_for_timeout(400)
        names = card_names()
        check("按到期时间排序生效", names[0] == "osaka-04", str(names))
        page.locator(sort_sel).select_option(label="问题优先")
        page.wait_for_timeout(400)

        # 4b. The day count comes from the hub where it sends one, and from the
        # date only where it does not. The two mocked nodes face opposite ways:
        # osaka-04 carries expires_in: 3 beside a date months away, sydney-05
        # carries the date alone. Reverting the read fills the first check with
        # the date's own number; dropping the fallback blanks the second.
        def expiry_text(name):
            return page.evaluate(
                """(name) => {
                    const card = [...document.querySelectorAll('a[href^="/node/"]')]
                      .find(a => a.querySelector('h3')?.textContent.trim() === name)
                    if (!card) return null
                    const span = [...card.querySelectorAll('span')]
                      .find(s => /到期$/.test(s.textContent.trim()))
                    return span ? span.textContent.trim() : null
                }""",
                name,
            )

        osaka_expiry = expiry_text("osaka-04")
        check("到期天数以 hub 的 expires_in 为准", osaka_expiry == "3 天后到期", str(osaka_expiry))
        sydney_expiry = expiry_text("sydney-05")
        check("hub 不给 expires_in 时按 expires_at 自己算", sydney_expiry == "5 天后到期", str(sydney_expiry))

        # The strip counts the same nodes with the same judgement the cards use,
        # so it cannot read 0 台 while a card says 3 天后到期.
        strip_expiring = page.evaluate("""() => {
            const label = [...document.querySelectorAll('div')].find(
              d => d.textContent.trim() === '即将到期' && d.className.includes('text-[11px]'),
            )
            if (!label) return null
            return label.parentElement.children[1].textContent.trim()
        }""")
        check("概览条按同一口径数即将到期", strip_expiring == "2 台", str(strip_expiring))

        # 5. The metric effects: a capped plan draws the month rail, an
        # unlimited one does not, and the context figures carry their
        # half-height rails.
        check(
            "有配额的卡画出本月用量条",
            page.locator('a:has-text("frankfurt-03") div.mb-1\\.5.h-1').count() > 0,
        )
        check(
            "无限套餐不画用量条",
            page.locator('a:has-text("tokyo-01") div.mb-1\\.5.h-1').count() == 0,
        )
        check(
            "负载与交换带半高细条",
            page.locator('a:has-text("tokyo-01") span.h-0\\.5.w-14').count() == 2,
        )

        # 6. Open the detail page.
        page.locator("a", has_text="tokyo-01").first.click()
        page.wait_for_selector("text=主机 / IP", timeout=10000)

        # 7. The address is masked before it is asked for.
        check("详情页默认脱敏 IP", page.locator("text=203.0.*.*").count() > 0)
        check("详情页默认不显示完整 IP", page.locator("text=203.0.113.47").count() == 0)

        # 8. ...and available once asked for.
        page.locator("button", has_text="显示").first.click()
        check("点击后显示完整 IP", page.locator("text=203.0.113.47").count() > 0)
        page.locator("button", has_text="隐藏").first.click()
        check("可以收回完整 IP", page.locator("text=203.0.*.*").count() > 0)

        # 9. The detail page colours a reading past its threshold, like the card.
        detail_cpu = page.evaluate("""() => {
            const dt = [...document.querySelectorAll('dt')].find(d => d.textContent.trim() === 'CPU')
            if (!dt) return null
            const dd = dt.nextElementSibling
            return { text: dd.textContent.trim(), colour: getComputedStyle(dd).color }
        }""")
        check(
            "详情页 CPU 与卡片同格式",
            bool(detail_cpu) and detail_cpu["text"] == "7.5%",
            str(detail_cpu),
        )
        disk = page.evaluate("""() => {
            const dt = [...document.querySelectorAll('dt')].find(d => d.textContent.trim() === '硬盘')
            if (!dt) return null
            const dd = dt.nextElementSibling
            return getComputedStyle(dd).color
        }""")
        check(
            "详情页超标读数上色（硬盘 95%）",
            bool(disk) and reddish(disk) and disk != detail_cpu["colour"],
            str(disk),
        )

        # 10. Nothing threw.
        check("无 JS 运行时错误", len(errors) == 0, "; ".join(errors[:2]))

        browser.close()
    if httpd:
        httpd.shutdown()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
