#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""QA 前端页面 & 回归验证：HTTP 层（G21/G22 + H24/H25/H26）。"""
import json
import urllib.request
import urllib.error

API = "http://localhost:4000"
WEB = "http://localhost:3000"


def req(url, method="GET", token=None, body=None, follow=True):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(r, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)
    except Exception as e:
        return -1, str(e), {}


print("=" * 80)
# H25 health
st, txt, _ = req(API + "/api/health")
print(f"[H25] GET /api/health -> {st} {txt[:80]}")

# login admin (QA admin)
st, txt, _ = req(API + "/api/auth/login", "POST", body={"email": "qa_admin@qatest.local", "password": "QaPass123"})
tok = json.loads(txt)["data"]["token"]
print(f"[login] admin -> {st}")

# H24 config count
st, txt, _ = req(API + "/api/config", token=tok)
items = json.loads(txt).get("data", [])
print(f"[H24] GET /api/config -> {st} items={len(items)} (期望 >=26)")

# H26 profile
st, txt, _ = req(API + "/api/user/profile", token=tok)
print(f"[H26] GET /api/user/profile -> {st} {txt[:100]}")

# H26 register (new temp) then login
print("-" * 80)
# G21 settings redirect
st, txt, hdr = req(WEB + "/dashboard/settings", follow=False)
loc = hdr.get("Location") or hdr.get("location")
print(f"[G21] GET /dashboard/settings -> {st} Location={loc}")

# G22 pages
for path in ["/dashboard/system/config", "/dashboard/system/menu", "/dashboard/system/role", "/dashboard/system/user"]:
    st, txt, _ = req(WEB + path)
    bad = ("Internal Server Error" in txt) or ("Build Error" in txt) or ("This page could not be found" in txt)
    print(f"[G22] GET {path} -> {st} len={len(txt)} hasError={bad}")
print("=" * 80)
