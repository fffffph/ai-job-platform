#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
QA 独立验证脚本 —— 角色-菜单权限体系（RBAC + 动态菜单）
作者：严过关（QA Engineer）
说明：不依赖第三方库，使用 urllib 直连后端 API；所有临时数据自行创建并清理。
用法：python qa_api.py
"""
import json
import time
import urllib.request
import urllib.error

BASE = "http://localhost:4000"
ADMIN_EMAIL = "qa_admin@qatest.local"
ADMIN_PASS = "QaPass123"
USER_EMAIL = "qa_user@qatest.local"
USER_PASS = "QaPass123"

RID = str(int(time.time()))
# 临时数据命名
TMP_USER_DISABLE = f"qa_disable_{RID}@qatest.local"
TMP_USER_E2E = f"qa_e2e_{RID}@qatest.local"
TMP_ROLE = f"qa_role_{RID}"
TMP_MENU_CODE = f"qa:tmp:{RID}"
TMP_MENU_CODE2 = f"qa:tmp2:{RID}"
TMP_CONFIG_KEY = f"qa.tmp.k{RID}"

results = []  # (case_id, name, pass_bool, evidence)
created = {"users": [], "roles": [], "menus": [], "configs": []}


def count_nodes(nodes):
    """递归统计菜单树节点总数。"""
    n = 0
    for x in nodes:
        n += 1
        n += count_nodes(x.get("children", []) or [])
    return n


def record(case_id, name, passed, evidence):
    results.append((case_id, name, passed, evidence))
    flag = "PASS" if passed else "FAIL"
    print(f"[{flag}] {case_id} {name} :: {evidence}")


def http(method, path, token=None, body=None, raw_url=False):
    url = path if raw_url else BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            txt = resp.read().decode("utf-8", "replace")
            return resp.status, _parse(txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        return e.code, _parse(txt)
    except Exception as e:
        return -1, {"error": str(e)}


def _parse(txt):
    try:
        return json.loads(txt)
    except Exception:
        return {"_raw": txt[:500]}


def login(email, password):
    st, js = http("POST", "/api/auth/login", body={"email": email, "password": password})
    if st == 200 and js.get("success"):
        return js["data"]["token"], js["data"]["user"]["id"]
    return None, None


def register(email, password, name="QA"):
    st, js = http("POST", "/api/auth/register", body={"email": email, "password": password, "name": name})
    return st, js


def main():
    print("=" * 90)
    print("QA API 验证开始  RID =", RID)
    print("=" * 90)

    admin_token, admin_id = login(ADMIN_EMAIL, ADMIN_PASS)
    if not admin_token:
        print("!! 无法登录 QA admin，终止")
        return
    user_token, user_id = login(USER_EMAIL, USER_PASS)
    if not user_token:
        print("!! 无法登录 QA user，终止")
        return

    # ---------------- A. 鉴权正确性 ----------------
    st, js = http("GET", "/api/menu/my", token=admin_token)
    d = js.get("data", {})
    menus = d.get("menus", [])
    perms = d.get("permissions", [])
    total_nodes = count_nodes(menus)
    system_node = next((m for m in menus if m.get("code") == "system"), None)
    sys_children = len((system_node or {}).get("children", []) or [])
    # admin 侧边栏：6 个根(5 业务 + system 目录) + system 下 4 子菜单 = 10 个节点；权限码 = 全量 20 个节点 code
    A1_ok = st == 200 and len(menus) == 6 and total_nodes == 10 and sys_children == 4 and len(perms) == 20
    record("A1", "admin GET /api/menu/my 返回全量树 + 全量权限码",
           A1_ok, f"status={st} 根节点={len(menus)} 总节点={total_nodes} system子菜单={sys_children} permissions={len(perms)} (期望 根=6,总=10,子=4,权限=20)")

    st, js = http("GET", "/api/menu/my", token=user_token)
    d = js.get("data", {})
    umenus = d.get("menus", [])
    uperms = d.get("permissions", [])
    ucodes = sorted([m["code"] for m in umenus])
    has_button = any(":" in p and p.count(":") >= 2 for p in uperms)
    A2_ok = st == 200 and ucodes == ["dashboard", "history", "jobs", "profile", "resume"] and len(uperms) == 5
    record("A2", "普通用户 GET /api/menu/my 仅 5 业务菜单、无 button 权限码",
           A2_ok, f"status={st} menus={ucodes} permissions={uperms} 含button={has_button}")

    # A3 普通用户调管理接口 → 403
    a3_checks = []
    for m, p, b in [("POST", "/api/menu", {"parentId": None, "type": "menu", "code": f"qa:noauth:{RID}", "name": "x", "path": "/x"}),
                    ("POST", "/api/role", {"code": f"qa_noauth_{RID}", "name": "x"}),
                    ("GET", "/api/user/list", None)]:
        st, js = http(m, p, token=user_token, body=b)
        a3_checks.append(f"{m} {p} -> {st}/{js.get('code')}")
    A3_ok = all("-> 403/FORBIDDEN" in c for c in a3_checks)
    record("A3", "普通用户调 POST /api/menu、POST /api/role、GET /api/user/list → 403",
           A3_ok, " ; ".join(a3_checks))

    # A4 无 token → 401
    a4_checks = []
    for m, p, b in [("POST", "/api/menu", {"parentId": None, "type": "menu", "code": "x", "name": "x", "path": "/x"}),
                    ("POST", "/api/role", {"code": "x", "name": "x"}),
                    ("GET", "/api/user/list", None)]:
        st, js = http(m, p, body=b)
        a4_checks.append(f"{m} {p} -> {st}/{js.get('code')}")
    A4_ok = all("-> 401/UNAUTHORIZED" in c for c in a4_checks)
    record("A4", "无 token 调管理接口 → 401", A4_ok, " ; ".join(a4_checks))

    # ---------------- B. admin 强制全权与内置角色保护 ----------------
    st, js = http("GET", "/api/role/list", token=admin_token)
    roles = {r["code"]: r for r in js.get("data", [])}
    admin_role_id = roles.get("admin", {}).get("id")
    user_role_id = roles.get("user", {}).get("id")
    admin_menu_count_null = roles.get("admin", {}).get("menuCount") is None
    record("B0", "GET /api/role/list 返回 admin(userCount, menuCount=null) 与 user",
           st == 200 and admin_role_id and user_role_id and admin_menu_count_null,
           f"status={st} admin.menuCount={roles.get('admin',{}).get('menuCount')} user.menuCount={roles.get('user',{}).get('menuCount')} user.userCount={roles.get('user',{}).get('userCount')}")

    # B5 改 admin 角色权限 → 400
    st, js = http("PUT", f"/api/role/{admin_role_id}/menus", token=admin_token, body={"menuIds": []})
    B5_ok = st == 400
    record("B5", "PUT /api/role/:adminId/menus → 400 拒绝", B5_ok, f"status={st} code={js.get('code')} msg={js.get('message')}")

    # B6 删除 admin / user 角色 → 400 (isSystem)
    st1, js1 = http("DELETE", f"/api/role/{admin_role_id}", token=admin_token)
    st2, js2 = http("DELETE", f"/api/role/{user_role_id}", token=admin_token)
    B6_ok = st1 == 400 and st2 == 400
    record("B6", "DELETE admin / user 内置角色 → 400(isSystem 保护)", B6_ok,
           f"deleteAdmin={st1}/{js1.get('message')} deleteUser={st2}/{js2.get('message')}")

    # B7 改 code → 400（用临时角色验证，避免动内置角色）
    st, js = http("POST", "/api/role", token=admin_token, body={"code": TMP_ROLE, "name": "QA临时角色"})
    tmp_role_id = js.get("data", {}).get("id")
    created["roles"].append(TMP_ROLE)
    st2, js2 = http("PUT", f"/api/role/{tmp_role_id}", token=admin_token, body={"code": TMP_ROLE + "_new", "name": "改名"})
    B7_ok = st2 == 400
    record("B7", "PUT /api/role/:id 试图改 code → 400", B7_ok,
           f"create={st} updateCode={st2}/{js2.get('code')} msg={js2.get('message')}")

    # ---------------- C. 菜单约束 ----------------
    # 先取全量菜单，找 system 目录 id 与 dashboard id
    st, js = http("GET", "/api/menu/tree", token=admin_token)
    tree = js.get("data", [])
    by_code = {m["code"]: m for m in tree}
    system_id = by_code.get("system", {}).get("id")
    dashboard_id = by_code.get("dashboard", {}).get("id")

    # C8 删除含子节点的菜单 → 400
    st, js = http("DELETE", f"/api/menu/{system_id}", token=admin_token)
    C8_ok = st == 400 and "子菜单" in (js.get("message") or "")
    record("C8", "DELETE 含子节点菜单(system) → 400 请先删除子菜单", C8_ok,
           f"status={st} msg={js.get('message')}")

    # C9 非法权限码（大写）→ 400
    st, js = http("POST", "/api/menu", token=admin_token,
                  body={"parentId": None, "type": "menu", "code": "System:Role", "name": "非法", "path": "/x"})
    C9_ok = st == 400
    record("C9", "POST 菜单用非法权限码 System:Role → 400", C9_ok,
           f"status={st} code={js.get('code')} msg={js.get('message')}")

    # C10 已存在的 code → 400
    st, js = http("POST", "/api/menu", token=admin_token,
                  body={"parentId": None, "type": "menu", "code": "dashboard", "name": "重复", "path": "/dup"})
    C10_ok = st == 400 and "已存在" in (js.get("message") or "")
    record("C10", "POST 菜单用已存在 code(dashboard) → 400", C10_ok,
           f"status={st} msg={js.get('message')}")

    # C11 改 menu code → 400
    st, js = http("PUT", f"/api/menu/{dashboard_id}", token=admin_token, body={"code": "dashboard2"})
    C11_ok = st == 400
    record("C11", "PUT /api/menu/:id 试图改 code → 400", C11_ok,
           f"status={st} code={js.get('code')} msg={js.get('message')}")

    # 额外边界：空 code / 超长 / 特殊字符
    st, js = http("POST", "/api/menu", token=admin_token,
                  body={"parentId": None, "type": "menu", "code": "", "name": "空", "path": "/x"})
    e1 = st == 400
    st2, js2 = http("POST", "/api/menu", token=admin_token,
                    body={"parentId": None, "type": "menu", "code": "a" * 300, "name": "超长", "path": "/x"})
    # 超长小写字符串符合正则 => 会创建成功（正则不限长度），需清理；验证「是否被接受」这一事实
    created_long_id = js2.get("data", {}).get("id")
    if created_long_id:
        created["menus"].append(("id", created_long_id))
    st3, js3 = http("POST", "/api/menu", token=admin_token,
                    body={"parentId": None, "type": "menu", "code": "qa:bad:!@#", "name": "特殊", "path": "/x"})
    e3 = st3 == 400
    record("C12", "菜单 code 边界：空/超长/特殊字符",
           e1 and e3, f"空->{st} 超长(300字符)->{st2}(创建id={'有' if created_long_id else '无'}) 特殊字符->{st3}")

    # 非法类型
    st, js = http("POST", "/api/menu", token=admin_token,
                  body={"parentId": None, "type": "xxx", "code": f"qa:type:{RID}", "name": "类型非法"})
    record("C13", "POST 菜单非法 type → 400", st == 400, f"status={st} msg={js.get('message')}")

    # 父级不存在 → 404
    st, js = http("POST", "/api/menu", token=admin_token,
                  body={"parentId": "00000000-0000-0000-0000-000000000000", "type": "menu",
                        "code": f"qa:badparent:{RID}", "name": "坏父级", "path": "/x"})
    record("C14", "POST 菜单父级不存在 → 404", st == 404, f"status={st} code={js.get('code')} msg={js.get('message')}")

    # ---------------- D. 用户管理与停用 ----------------
    # D12 注册新用户 → 自动绑定 user 角色
    st, js = register(TMP_USER_DISABLE, "QaPass123", "待停用")
    created["users"].append(TMP_USER_DISABLE)
    D12_reg_ok = st == 201
    st2, js2 = http("GET", "/api/user/list?keyword=" + TMP_USER_DISABLE, token=admin_token)
    items = js2.get("data", {}).get("items", [])
    target = next((i for i in items if i["email"] == TMP_USER_DISABLE), None)
    roles_of = [r["code"] for r in (target or {}).get("roles", [])]
    D12_ok = D12_reg_ok and target is not None and "user" in roles_of
    record("D12", "注册新用户 → 自动绑定 user 角色", D12_ok,
           f"register={st} userRoles={roles_of} status={(target or {}).get('status')}")
    disable_user_id = target["id"] if target else None

    # D13 停用后登录 → 403 USER_DISABLED
    st, js = http("PUT", f"/api/user/{disable_user_id}/status", token=admin_token, body={"status": "disabled"})
    stl, jsl = http("POST", "/api/auth/login", body={"email": TMP_USER_DISABLE, "password": "QaPass123"})
    D13_ok = st == 200 and stl == 403 and jsl.get("code") == "USER_DISABLED"
    record("D13", "停用用户后登录 → 403 USER_DISABLED", D13_ok,
           f"setStatus={st} login={stl}/{jsl.get('code')} msg={jsl.get('message')}")

    # D14 停用后旧 token 调接口 → 401 USER_DISABLED（踢下线，P1-4）
    # 注意：被停用用户必须在停用前拿到 token。注册时返回了 token，用那个 token 验证。
    reg_token = None
    st, js = register(TMP_USER_E2E, "QaPass123", "端到端")
    created["users"].append(TMP_USER_E2E)
    reg_token = js.get("data", {}).get("token")
    e2e_user_id = js.get("data", {}).get("user", {}).get("id")
    # 先用有效 token 访问一次确认可用
    st_pre, _ = http("GET", "/api/menu/my", token=reg_token)
    http("PUT", f"/api/user/{e2e_user_id}/status", token=admin_token, body={"status": "disabled"})
    st_post, js_post = http("GET", "/api/menu/my", token=reg_token)
    D14_ok = st_pre == 200 and st_post == 401 and js_post.get("code") == "USER_DISABLED"
    record("D14", "停用后旧 token 调接口 → 401 USER_DISABLED（踢下线）", D14_ok,
           f"停用前={st_pre} 停用后={st_post}/{js_post.get('code')}")

    # D15 恢复启用 → 可正常登录
    http("PUT", f"/api/user/{e2e_user_id}/status", token=admin_token, body={"status": "active"})
    st, js = http("POST", "/api/auth/login", body={"email": TMP_USER_E2E, "password": "QaPass123"})
    D15_ok = st == 200 and js.get("success")
    record("D15", "恢复启用后可正常登录", D15_ok, f"login={st}")

    # 重新停用 e2e 用户，供 F19 前状态一致（F 流程会重新启用/重置角色）
    # D16 停用自己 → 400
    st, js = http("PUT", f"/api/user/{admin_id}/status", token=admin_token, body={"status": "disabled"})
    record("D16", "停用自己(admin) → 400", st == 400,
           f"status={st} code={js.get('code')} msg={js.get('message')}")

    # ---------------- E. 配置权限升级 ----------------
    st, js = http("POST", "/api/config", token=user_token,
                  body={"key": TMP_CONFIG_KEY, "type": "string", "value": "x"})
    E17_ok = st == 403
    record("E17", "非 admin 用户 POST /api/config → 403", E17_ok, f"status={st} code={js.get('code')}")

    st, js = http("POST", "/api/config", token=admin_token,
                  body={"key": TMP_CONFIG_KEY, "type": "string", "value": "qa-hi", "label": "QA临时"})
    created["configs"].append(TMP_CONFIG_KEY)
    E18_ok = st == 200 and js.get("success")
    record("E18", "admin POST /api/config → 200", E18_ok, f"status={st} msg={js.get('message')}")

    # ---------------- F. 角色绑定闭环（端到端） ----------------
    # 取 dashboard / jobs 两个菜单 id
    dash_id = by_code.get("dashboard", {}).get("id")
    jobs_id = by_code.get("jobs", {}).get("id")
    st, js = http("PUT", f"/api/role/{tmp_role_id}/menus", token=admin_token, body={"menuIds": [dash_id, jobs_id]})
    F19_set_ok = st == 200
    # 读回
    st2, js2 = http("GET", f"/api/role/{tmp_role_id}/menus", token=admin_token)
    read_back = sorted(js2.get("data", {}).get("menuIds", []))
    F20_ok = F19_set_ok and read_back == sorted([dash_id, jobs_id])
    record("F20", "GET /api/role/:id/menus 与保存一致", F20_ok,
           f"set={st} readBack={read_back} expect={sorted([dash_id, jobs_id])}")

    # 把临时角色分配给 e2e 用户（全量重写，移除 user 角色）
    st, js = http("PUT", f"/api/user/{e2e_user_id}/roles", token=admin_token, body={"roleIds": [tmp_role_id]})
    # 该用户重新登录
    stl, jsl = http("POST", "/api/auth/login", body={"email": TMP_USER_E2E, "password": "QaPass123"})
    new_token = jsl.get("data", {}).get("token")
    stm, jsm = http("GET", "/api/menu/my", token=new_token)
    e2e_menus = sorted([m["code"] for m in jsm.get("data", {}).get("menus", [])])
    F19_ok = st == 200 and stl == 200 and e2e_menus == ["dashboard", "jobs"]
    record("F19", "角色-菜单-用户闭环：绑定 dashboard+jobs → 分配给用户 → 重登仅见这两项",
           F19_ok, f"assignRoles={st} login={stl} userMenus={e2e_menus}")

    # ---------------- 清理 ----------------
    print("-" * 90)
    print("开始清理临时数据 ...")
    # 删除临时菜单（长 code）
    for kind, mid in created["menus"]:
        if kind == "id":
            http("DELETE", f"/api/menu/{mid}", token=admin_token)
    # 删除临时配置
    for k in created["configs"]:
        http("DELETE", f"/api/config/{k}", token=admin_token)
    # 删除临时角色（先解绑用户）
    if tmp_role_id:
        http("PUT", f"/api/user/{e2e_user_id}/roles", token=admin_token, body={"roleIds": []})
        http("DELETE", f"/api/role/{tmp_role_id}", token=admin_token)
    # 删除临时用户
    for u in created["users"]:
        # 通过 DB 清理更可靠（接口无删除用户端点）
        pass
    with open("/tmp/qa_cleanup_users.txt", "w") as f:
        f.write("\n".join(created["users"]))
    print("需通过 DB 清理的用户：", created["users"])
    print("需通过 DB 清理的角色：", created["roles"])
    print("-" * 90)

    # ---------------- 汇总 ----------------
    total = len(results)
    passed = sum(1 for r in results if r[2])
    print("=" * 90)
    print(f"用例总数 {total} | PASS {passed} | FAIL {total - passed}")
    for cid, name, ok, ev in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {cid:5s} {name}")
    print("=" * 90)


if __name__ == "__main__":
    main()
