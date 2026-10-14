#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""QA 第2轮回归：提权防护 + 长度上限 + 核心回归。"""
import json
import time
import urllib.request
import urllib.error

BASE = "http://localhost:4000"
ADMIN = ("qa_admin_r2@qatest.local", "QaPass123")
GRANTER = ("qa_granter_r2@qatest.local", "QaPass123")
TARGET = ("qa_target_r2@qatest.local", "QaPass123")
RID = str(int(time.time()))
results = []


def record(cid, name, ok, ev):
    results.append((cid, name, ok, ev))
    print(f"[{'PASS' if ok else 'FAIL'}] {cid} {name} :: {ev}")


def http(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return e.code, {}
    except Exception as e:
        return -1, {"error": str(e)}


def login(cred):
    st, js = http("POST", "/api/auth/login", body={"email": cred[0], "password": cred[1]})
    if st == 200 and js.get("success"):
        return js["data"]["token"], js["data"]["user"]["id"]
    print("LOGIN FAIL", cred[0], st, js)
    return None, None


def main():
    atok, aid = login(ADMIN)
    gtok, gid = login(GRANTER)
    ttok, tid = login(TARGET)

    # 角色 id
    st, js = http("GET", "/api/role/list", token=atok)
    roles = {r["code"]: r["id"] for r in js.get("data", [])}
    admin_role, user_role = roles.get("admin"), roles.get("user")
    # 菜单 id
    st, js = http("GET", "/api/menu/tree", token=atok)
    menus = {m["code"]: m["id"] for m in js.get("data", [])}

    # 确认 granter 确有能力访问该接口（前置：不为 403）
    st0, js0 = http("GET", "/api/user/list", token=gtok)
    record("A0", "granter 持有 system:user 权限（前置校验）", st0 == 200,
           f"GET /api/user/list as granter -> {st0}（应 200，证明能进入该接口）")

    # A1 非 admin(持 grant) 给他人分配 admin → 400
    st, js = http("PUT", f"/api/user/{tid}/roles", token=gtok, body={"roleIds": [admin_role]})
    A1 = st == 400 and "管理员" in (js.get("message") or "")
    record("A1", "非 admin 分配 admin 角色 → 400", A1, f"status={st} msg={js.get('message')}")

    # A1b 伪造 operatorId=admin 传参 → 仍 400（证明取会话而非前端传参）
    st, js = http("PUT", f"/api/user/{tid}/roles", token=gtok, body={"roleIds": [admin_role], "operatorId": aid})
    A1b = st == 400
    record("A1b", "granter 伪造 operatorId=admin 传参 → 仍 400", A1b, f"status={st} msg={js.get('message')}")

    # A2 同一用户改传普通角色 user → 200（未误伤正常授权）
    st, js = http("PUT", f"/api/user/{tid}/roles", token=gtok, body={"roleIds": [user_role]})
    record("A2", "granter 分配普通 user 角色 → 200（未误伤）", st == 200, f"status={st} msg={js.get('message')}")

    # A3 admin 本人给他人分配 admin → 200（未误伤 admin 自己）
    #   目标用 granter 之外的 target；分配后 target 变 admin，故放在最后（见 A3 位置调整）
    # --- 先跑核心回归 C（此时 target 仍是普通 user）---

    # C8 admin menu/my 全量
    st, js = http("GET", "/api/menu/my", token=atok)
    d = js.get("data", {})
    roots = d.get("menus", [])
    def cnt(ns):
        return sum(1 + cnt(x.get("children", []) or []) for x in ns)
    total = cnt(roots)
    perms = len(d.get("permissions", []))
    record("C8", "admin GET /api/menu/my 全量(10节点/20权限码)",
           st == 200 and len(roots) == 6 and total == 10 and perms == 20,
           f"status={st} 根={len(roots)} 总节点={total} perms={perms}")

    # C9 普通用户 menu/my=5 + 管理接口 403
    st, js = http("GET", "/api/menu/my", token=ttok)
    codes = sorted(m["code"] for m in js.get("data", {}).get("menus", []))
    st2, js2 = http("POST", "/api/menu", token=ttok, body={"parentId": None, "type": "menu", "code": "x", "name": "x", "path": "/x"})
    record("C9", "普通用户 menu/my=5 且管理接口 403",
           st == 200 and codes == ["dashboard", "history", "jobs", "profile", "resume"] and st2 == 403,
           f"menu={codes} POST /api/menu={st2}/{js2.get('code')}")

    # B4 70字符权限码 → 400
    st, js = http("POST", "/api/menu", token=atok, body={"parentId": None, "type": "menu", "code": "a" * 70, "name": "QA-R2-long70", "path": "/x"})
    record("B4", "新增菜单 70 字符权限码 → 400", st == 400, f"status={st} msg={js.get('message')}")

    # B5 60字符权限码 → 200（随后清理）
    c60 = "qa_r2_" + "a" * 54  # 6+54=60
    st, js = http("POST", "/api/menu", token=atok, body={"parentId": None, "type": "menu", "code": c60, "name": "QA-R2-len60", "path": "/x"})
    mid = js.get("data", {}).get("id")
    record("B5", "新增菜单 60 字符权限码 → 200", st == 200 and mid, f"status={st} code={c60} id={'有' if mid else '无'}")

    # B6 新增角色超长 code(70) → 400
    st, js = http("POST", "/api/role", token=atok, body={"code": "a" * 70, "name": "QA-R2"})
    record("B6", "新增角色 70 字符 code → 400", st == 400, f"status={st} msg={js.get('message')}")

    # 边界：正好 64 字符菜单码 → 200（确认上限含等号边界）
    c64 = "qa_r2_" + "b" * 58  # 6+58=64
    st, js = http("POST", "/api/menu", token=atok, body={"parentId": None, "type": "menu", "code": c64, "name": "QA-R2-len64", "path": "/x"})
    mid64 = js.get("data", {}).get("id")
    record("B7", "边界：菜单码正好 64 字符 → 200", st == 200, f"status={st} id={'有' if mid64 else '无'}")

    # C10 停用流程
    du = f"qa_disable_r2_{RID}@qatest.local"
    st, js = http("POST", "/api/auth/register", body={"email": du, "password": "QaPass123", "name": "停用测试"})
    dtoken = js.get("data", {}).get("token")
    duid = js.get("data", {}).get("user", {}).get("id")
    st_pre, _ = http("GET", "/api/menu/my", token=dtoken)
    http("PUT", f"/api/user/{duid}/status", token=atok, body={"status": "disabled"})
    stl, jsl = http("POST", "/api/auth/login", body={"email": du, "password": "QaPass123"})
    st_post, jspost = http("GET", "/api/menu/my", token=dtoken)
    record("C10", "停用：登录403 USER_DISABLED + 旧token 401 踢下线",
           st_pre == 200 and stl == 403 and jsl.get("code") == "USER_DISABLED" and st_post == 401 and jspost.get("code") == "USER_DISABLED",
           f"注册后={st_pre} 停用后登录={stl}/{jsl.get('code')} 旧token={st_post}/{jspost.get('code')}")

    # C11 端到端：建角色→绑 dashboard+jobs→分配→重登菜单变化
    e2e_email = f"qa_e2e_r2_{RID}@qatest.local"
    st, js = http("POST", "/api/auth/register", body={"email": e2e_email, "password": "QaPass123", "name": "E2E"})
    e2e_token = js.get("data", {}).get("token")
    e2e_uid = js.get("data", {}).get("user", {}).get("id")
    st, js = http("POST", "/api/role", token=atok, body={"code": f"qa_r2_e2e_{RID}", "name": "QA-R2-E2E"})
    e2e_role = js.get("data", {}).get("id")
    http("PUT", f"/api/role/{e2e_role}/menus", token=atok, body={"menuIds": [menus["dashboard"], menus["jobs"]]})
    http("PUT", f"/api/user/{e2e_uid}/roles", token=atok, body={"roleIds": [e2e_role]})
    stl, jsl = http("POST", "/api/auth/login", body={"email": e2e_email, "password": "QaPass123"})
    nt = jsl.get("data", {}).get("token")
    stm, jsm = http("GET", "/api/menu/my", token=nt)
    em = sorted(m["code"] for m in jsm.get("data", {}).get("menus", []))
    record("C11", "端到端：建角色→绑菜单→分配→重登菜单随之变化",
           stl == 200 and em == ["dashboard", "jobs"], f"角色={e2e_role} 重登后菜单={em}")

    # A3（放最后：会把目标提升为 admin）
    st, js = http("PUT", f"/api/user/{gid}/roles", token=atok, body={"roleIds": [admin_role]})
    record("A3", "admin 本人给他人分配 admin 角色 → 200（未误伤）", st == 200, f"status={st} msg={js.get('message')}")

    # 清理（API 可清理的部分）
    if mid:
        http("DELETE", f"/api/menu/{mid}", token=atok)
    if mid64:
        http("DELETE", f"/api/menu/{mid64}", token=atok)
    if e2e_role:
        http("PUT", f"/api/user/{e2e_uid}/roles", token=atok, body={"roleIds": []})
        http("DELETE", f"/api/role/{e2e_role}", token=atok)
    with open("/tmp/qa_r2_cleanup.txt", "w") as f:
        f.write("\n".join([du, e2e_email]))
    print("-" * 80)
    print("需 DB 清理的用户：", du, e2e_email, "；granter 角色、granter/target/admin 账号见 qa-r2.ts cleanup")

    total = len(results)
    passed = sum(1 for r in results if r[2])
    print("=" * 80)
    print(f"第2轮用例 {total} | PASS {passed} | FAIL {total - passed}")
    for cid, name, ok, ev in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {cid:4s} {name}")


if __name__ == "__main__":
    main()
