#!/usr/bin/env python
"""Aholo Lux3D 客户端（nt2 资产管线专用）。

用法：
  python tools/aholo_lux3d.py create "提示词" [--style photorealistic] [--version G1] [--faces 300000] [--formats zip,glb]
  python tools/aholo_lux3d.py poll <taskId>
  python tools/aholo_lux3d.py wait <taskId> [--out 目录]     # 轮询到终态并下载全部产物
  python tools/aholo_lux3d.py list

纪律：
  - key 从环境变量 AHOLO_KEY 读，不写进代码/日志/仓库。
  - 每次创建与终态都追加记账到 reports/aholo-ledger.jsonl。
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

API = "https://api.aholo3d.cn"
LEDGER = os.path.join(os.path.dirname(__file__), "..", "reports", "aholo-ledger.jsonl")


def key() -> str:
    k = os.environ.get("AHOLO_KEY", "").strip()
    if not k:
        print("FATAL: AHOLO_KEY 未设置", file=sys.stderr)
        sys.exit(2)
    return k


def req(method: str, path: str, body=None) -> dict:
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", key())
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode("utf-8", "replace")[:500], file=sys.stderr)
        sys.exit(1)


def ledger(entry: dict) -> None:
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    entry = dict(entry)
    entry["ts"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(LEDGER, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def create(prompt: str, style: str, version: str, faces: int, formats: list, img: str = None) -> None:
    body = {"prompt": prompt, "style": style, "version": version,
            "faceCount": faces, "outputFormat": formats}
    if img:
        body["img"] = img
    res = req("POST", "/lux3d/v1/generate/text-to-3d/task/create", body)
    print(json.dumps(res, ensure_ascii=False))
    entry = {"op": "create", "prompt": prompt, "style": style, "version": version,
             "faceCount": faces, "outputFormat": formats, "resp_c": res.get("c"),
             "taskId": res.get("d"), "msg": res.get("m")}
    ledger(entry)
    if res.get("c") != "0":
        sys.exit(1)


def poll(task_id: str) -> dict:
    res = req("GET", "/lux3d/v1/generate/task/get?taskid=" + urllib.parse.quote(str(task_id)))
    print(json.dumps(res, ensure_ascii=False))
    return res


def wait(task_id: str, out_dir: str) -> None:
    STATUS = {0: "初始化", 1: "运行中", 3: "成功", 4: "失败", 6: "已取消"}
    while True:
        res = req("GET", "/lux3d/v1/generate/task/get?taskid=" + urllib.parse.quote(str(task_id)))
        d = res.get("d") or {}
        st = d.get("status")
        print("status", st, STATUS.get(st, "?"))
        if st in (3, 4, 6):
            ledger({"op": "final", "taskId": task_id, "status": STATUS.get(st),
                    "outputs": [o.get("content") for o in d.get("outputs", [])]})
            break
        time.sleep(20)
    if st != 3:
        sys.exit(1)
    os.makedirs(out_dir, exist_ok=True)
    for i, o in enumerate(d.get("outputs", [])):
        url = o.get("content", "")
        if not url.startswith("http"):
            print("skip non-url:", url[:80])
            continue
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".bin"
        dst = os.path.join(out_dir, "lux3d-%s-%d%s" % (task_id, i, ext))
        print("download", url[:90], "->", dst)
        urllib.request.urlretrieve(url, dst)
    print("DONE", out_dir)


def list_tasks() -> None:
    res = req("GET", "/lux3d/v1/generate/task/list")
    print(json.dumps(res, ensure_ascii=False)[:4000])


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    cmd, rest = args[0], args[1:]
    def opt(name, default=None):
        if "--" + name in rest:
            i = rest.index("--" + name)
            return rest[i + 1]
        return default
    if cmd == "create":
        create(rest[0], opt("style", "photorealistic"), opt("version", "G1"),
               int(opt("faces", "300000")), opt("formats", "zip,glb").split(","),
               opt("img"))
    elif cmd == "poll":
        poll(rest[0])
    elif cmd == "wait":
        wait(rest[0], opt("out", os.path.join(os.path.dirname(__file__), "..", "reports", "aholo")))
    elif cmd == "list":
        list_tasks()
    else:
        print("unknown cmd", cmd)
        sys.exit(2)
