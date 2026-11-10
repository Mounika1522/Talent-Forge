"""Browser end-to-end test: React (Vite) -> Express -> MongoDB, with a local SMTP stub.
Requires: python playwright, servers running (see README section "Testing")."""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect

WEB = os.environ.get("TF_WEB", "http://127.0.0.1:5173")
API = os.environ.get("TF_API", "http://127.0.0.1:4000/api")
MAILS = os.environ.get("TF_MAILS", "/tmp/tf-notif/mails.jsonl")
PASSWORD = os.environ.get("TF_ADMIN_PASSWORD", "Test-Password-123")
SHOTS = os.environ.get("TF_SHOTS", "/tmp/tf-notif/shots"); os.makedirs(SHOTS, exist_ok=True)
TEAM = sorted(["krish@alphaauron.com", "santhan@alphaauron.com", "tejaswi@alphaauron.com"])
results = []

def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

def http(path, method="GET", body=None, token=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

def mails():
    if not os.path.exists(MAILS): return []
    return [json.loads(l) for l in open(MAILS) if l.strip()]

def enquiry(n, **kw):
    return {"name": f"Api Customer {n}", "email": f"api{n}@example.com", "phone": f"9876500{n:03d}", "category": "Cloud / DevOps",
            "skills": "AWS", "experience": "Fresher", "goal": "Learn new skills", "message": "", "consent": True, **kw}

status, login = http("/auth/login", "POST", {"username": "admin", "password": PASSWORD})
check("admin API login works", status == 200 and login.get("token"))
TOKEN = login["token"]
check("start state: no notifications, no leads", http("/notifications", token=TOKEN)[1]["total"] == 0 and len(http("/leads", token=TOKEN)[1]["leads"]) == 0)

with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    # ---------- A. customer submits the real enquiry form ----------
    cust = browser.new_context(viewport={"width": 1280, "height": 900}); c = cust.new_page()
    c.on("pageerror", lambda e: errors.append(str(e)))
    c.goto(WEB + "/", wait_until="networkidle")
    c.get_by_role("navigation").get_by_role("button", name="Enquiry").click()
    c.fill("input[name=name]", "Anita Rao"); c.fill("input[name=email]", "anita.rao@example.com"); c.fill("input[name=phone]", "9876543210")
    c.select_option("select[name=category]", "Cybersecurity"); c.fill("input[name=skills]", "Networking, Python")
    c.select_option("select[name=experience]", "Fresher"); c.select_option("select[name=goal]", "Build projects")
    c.fill("textarea[name=message]", "Please call after 5pm"); c.check("input[name=consent]")
    c.get_by_role("button", name="Submit enquiry").dblclick()          # double click on purpose
    c.wait_for_selector(".success-banner", timeout=15000)
    banner = c.locator(".success-banner").inner_text()
    ref = banner.split("reference is ")[1].split(".")[0].strip()
    check("customer sees thank-you banner with reference ID", ref.startswith("TF-"), banner)
    check("customer sees 'confirmation email' note (only because the thank-you email was accepted)", "confirmation email" in banner)
    time.sleep(1)
    leads = http("/leads", token=TOKEN)[1]["leads"]
    check("double-click created exactly ONE lead", len(leads) == 1, str(len(leads)))
    notes = http("/notifications", token=TOKEN)[1]
    check("exactly ONE persistent admin notification for the enquiry", notes["total"] == 1 and notes["unreadCount"] == 1)
    n0 = notes["notifications"][0]
    check("notification: message / Lead ID / category / time", n0["message"] == "New enquiry received from Anita Rao" and n0["referenceId"] == ref and n0["category"] == "Cybersecurity" and n0["submittedAt"])
    check("notification is linked to the lead", n0["leadId"] == leads[0]["_id"])
    m = mails()
    check("4 emails sent: 3 team members + customer thank-you", len(m) == 4 and sorted(x["to"][0] for x in m) == sorted(TEAM + ["anita.rao@example.com"]), str([x["to"] for x in m]))
    check("customer thank-you has the right subject", any(x["to"] == ["anita.rao@example.com"] and "Thank You for Your Interest in Talent Forge" in x["subject"] for x in m))
    check("team emails carry the Lead ID in the subject", all(ref in x["subject"] for x in m if x["to"][0] in TEAM))
    check("lead record stores email status = sent (4 log entries)", leads[0]["notificationStatus"] == "sent" and len(leads[0]["emailLog"]) == 4)
    cust.close()

    # ---------- B. admin dashboard + bell ----------
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}); a = ctx.new_page()
    a.on("pageerror", lambda e: errors.append(str(e)))
    a.goto(WEB + "/admin", wait_until="networkidle")
    check("admin login screen shows before login (no bell)", a.locator(".tf-bell").count() == 0)
    a.fill("input[autocomplete=username]", "admin"); a.fill("input[autocomplete=current-password]", PASSWORD)
    a.get_by_role("button", name="Login").click()
    a.wait_for_selector(".tf-bell", timeout=10000)
    check("bell is in the admin dashboard header actions", a.locator(".dashboard-actions .tf-bell").count() == 1)
    a.wait_for_selector(".tf-badge", timeout=10000)
    check("red badge shows 1 unread", a.locator(".tf-badge").inner_text() == "1")
    check("badge is red (Alpha Auron theme)", a.evaluate("getComputedStyle(document.querySelector('.tf-badge')).backgroundColor") == "rgb(189, 30, 53)")
    a.screenshot(path=f"{SHOTS}/dashboard-badge.png")
    a.locator(".tf-bell-btn").click()
    a.wait_for_selector(".tf-item")
    item = a.locator(".tf-item").first.inner_text()
    check("panel item: message, Lead ID, category, time", "New enquiry received from Anita Rao" in item and ref in item and "Cybersecurity" in item and ("2026" in item or "Nov" in item), item)
    a.wait_for_timeout(450); a.screenshot(path=f"{SHOTS}/panel-open.png")
    a.get_by_role("tab", name="Read", exact=True).click(); a.wait_for_selector(".tf-state h3")
    check("Read filter: friendly empty state", "No read notifications" in a.locator(".tf-state").inner_text())
    a.wait_for_timeout(450); a.screenshot(path=f"{SHOTS}/panel-empty-read.png")
    a.get_by_role("tab", name="Unread", exact=True).click(); a.wait_for_selector(".tf-item")
    check("Unread filter lists the notification", a.locator(".tf-item").count() == 1)
    # click -> opens lead + marks read
    a.locator(".tf-item").first.click()
    a.wait_for_selector(".tf-modal")
    check("clicking the notification opens that lead's details", "Anita Rao" in a.locator(".tf-modal").inner_text() and ref in a.locator(".tf-modal").inner_text() and "anita.rao@example.com" in a.locator(".tf-modal").inner_text())
    check("modal shows email delivery status per recipient", a.locator(".tf-email-box li").count() == 4 and "accepted by the mail server" in a.locator(".tf-email-box").inner_text())
    a.wait_for_timeout(450); a.screenshot(path=f"{SHOTS}/lead-modal.png")
    time.sleep(1)
    check("notification marked read on the server", http("/notifications", token=TOKEN)[1]["unreadCount"] == 0)
    check("badge disappeared", a.locator(".tf-badge").count() == 0)
    a.keyboard.press("Escape"); a.wait_for_selector(".tf-modal", state="detached")
    check("Escape closes the modal", True)

    # ---------- C. automatic refresh (no manual reload) ----------
    t0 = time.time()
    http("/leads", "POST", enquiry(1))
    a.wait_for_selector(".tf-badge", timeout=20000)
    waited = time.time() - t0
    check("new enquiry appears on the badge automatically (<= ~15 s, no reload)", a.locator(".tf-badge").inner_text() == "1" and waited <= 16, f"{waited:.1f}s")
    a.wait_for_function("document.querySelectorAll('.leads-table tbody tr').length === 2", timeout=8000)
    check("lead table also picked up the new lead automatically", a.locator(".leads-table tbody tr").count() == 2)
    http("/leads", "POST", enquiry(2)); http("/leads", "POST", enquiry(3))
    a.wait_for_function("document.querySelector('.tf-badge') && document.querySelector('.tf-badge').innerText === '3'", timeout=20000)
    check("badge counts up to 3", True)

    # ---------- D. persistence across refresh ----------
    a.reload(wait_until="networkidle"); a.wait_for_selector(".tf-badge", timeout=10000)
    check("after browser refresh the unread badge is still 3 (stored in MongoDB)", a.locator(".tf-badge").inner_text() == "3")

    # ---------- E. error state + retry ----------
    a.route("**/api/notifications**", lambda r: r.abort())
    a.locator(".tf-bell-btn").click()
    a.wait_for_selector(".tf-error", timeout=8000)
    check("API failure shows an error message with Retry", "Could not load notifications" in a.locator(".tf-error").inner_text() and a.get_by_role("button", name="Retry").count() == 1)
    a.wait_for_timeout(450); a.screenshot(path=f"{SHOTS}/panel-error.png")
    a.unroute("**/api/notifications**")
    a.get_by_role("button", name="Retry").click(); a.wait_for_selector(".tf-item", timeout=8000)
    shown = a.locator(".tf-item").count(); on_server = http("/notifications", token=TOKEN)[1]["total"]
    # 4 = Anita's (already read, not cleared yet) + the 3 new enquiries
    check("Retry recovers and lists every stored notification", shown == on_server == 4 and a.locator(".tf-error").count() == 0, f"shown={shown} server={on_server}")

    # ---------- F. mark all read / clear read ----------
    a.get_by_role("button", name="Mark all as read").click()
    a.wait_for_function("!document.querySelector('.tf-badge')", timeout=8000)
    check("Mark all as read clears the badge", http("/notifications", token=TOKEN)[1]["unreadCount"] == 0)
    check("Mark all as read button disabled when nothing is unread", a.get_by_role("button", name="Mark all as read").is_disabled())
    a.once("dialog", lambda d: d.accept())
    a.get_by_role("button", name="Clear read").click()
    a.wait_for_selector(".tf-state h3", timeout=8000)
    after = http("/notifications", token=TOKEN)[1]
    check("Clear read removes the notifications", after["total"] == 0 and "No notifications yet" in a.locator(".tf-state").inner_text())
    check("...but NOT the customer enquiries (4 leads remain)", len(http("/leads", token=TOKEN)[1]["leads"]) == 4)
    a.wait_for_timeout(450); a.screenshot(path=f"{SHOTS}/panel-empty-all.png")
    a.keyboard.press("Escape")

    # ---------- G. lead management still works (status + follow-up were broken before) ----------
    sel = a.locator(".leads-table tbody tr").first.locator("select")
    first_name = a.locator(".leads-table tbody tr").first.locator("td b").first.inner_text()
    sel.select_option("Contacted")
    time.sleep(1)
    lst = http("/leads", token=TOKEN)[1]["leads"]
    changed = [l for l in lst if l["status"] == "Contacted"]
    check("changing ONE lead's status saves to backend and only that lead", len(changed) == 1 and changed[0]["name"] == first_name, str([(l["name"], l["status"]) for l in lst]))
    note = a.locator(".leads-table tbody tr").first.locator(".note-input")
    note.fill("Called, will visit Monday"); note.blur(); time.sleep(1)
    check("follow-up note saves to backend when leaving the field", any(l["followUp"] == "Called, will visit Monday" for l in http("/leads", token=TOKEN)[1]["leads"]))

    # ---------- H. expired / invalid login while dashboard is open ----------
    a.evaluate("sessionStorage.setItem('tf-admin-token', 'expired.or.invalid')")
    a.wait_for_selector(".admin-login-card", timeout=20000)
    check("expired session -> back to login with a clear message", "Your session expired" in a.locator(".login-error").inner_text())
    check("bell is gone after logout/expiry", a.locator(".tf-bell").count() == 0)
    ctx.close()

    # ---------- I. mobile layout ----------
    mob = browser.new_context(viewport={"width": 375, "height": 800}, is_mobile=True, has_touch=True); mp = mob.new_page()
    mp.on("pageerror", lambda e: errors.append(str(e)))
    http("/leads", "POST", enquiry(4))
    mp.goto(WEB + "/admin", wait_until="networkidle")
    mp.fill("input[autocomplete=username]", "admin"); mp.fill("input[autocomplete=current-password]", PASSWORD)
    mp.get_by_role("button", name="Login").click(); mp.wait_for_selector(".tf-badge", timeout=10000)
    mp.locator(".tf-bell-btn").click(); mp.wait_for_selector(".tf-item")
    box = mp.locator(".tf-panel").bounding_box()
    check("mobile: panel fits inside the 375px screen", box["x"] >= 0 and box["x"] + box["width"] <= 375, str(box))
    check("mobile: no horizontal page overflow", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    mp.wait_for_timeout(450); mp.screenshot(path=f"{SHOTS}/mobile-panel.png")
    mp.locator(".tf-item").first.click(); mp.wait_for_selector(".tf-modal")
    mb = mp.locator(".tf-modal").bounding_box()
    check("mobile: lead details modal fits the screen", mb["x"] >= 0 and mb["x"] + mb["width"] <= 375, str(mb))
    mp.wait_for_timeout(450); mp.screenshot(path=f"{SHOTS}/mobile-modal.png")
    mob.close()
    check("no uncaught JavaScript errors in any page", not errors, str(errors[:3]))
    browser.close()

print(f"\nE2E: {sum(results)}/{len(results)} checks passed"); sys.exit(0 if all(results) else 1)
