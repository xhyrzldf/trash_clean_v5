import os
import sys
import psutil
import shutil
import time
import json
import re
import pwd
import stat
import logging
import math
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from collections import deque
import mmap
import resource
import ctypes
import platform
import subprocess
from datetime import datetime

app = Flask(__name__)
CORS(app)

log_dir = '/usr/local/system-clean/log'
os.makedirs(log_dir, exist_ok=True)
subprocess.run(['chmod', '777', log_dir])

logging.basicConfig(
    filename=os.path.join(log_dir, 'backend.log'),
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

logging.getLogger('werkzeug').setLevel(logging.ERROR)
logging.info("后端服务启动")

# 用于保存上次清理信息的文件路径
LAST_CLEAN_INFO_FILE = os.path.join(log_dir, 'last_clean_info.json')

MODULES = {
    'cache_files': [("用户缓存", os.path.expanduser('~/.cache')), ("系统缓存", '/var/cache')],
    'log_files': [("系统日志", '/var/log')],
    'temp_files': [("临时文件夹", '/var/tmp')],
    'app_files': [("应用文件目录", '')]  # 您可自定义实际扫描路径或留空
}


def compute_score(garbage_bytes, bigfile_bytes):
    """
    计算系统得分
    :param garbage_bytes: 垃圾文件总字节数
    :param bigfile_bytes: 大文件总字节数
    :return: 10-100之间的整数分数
    """
    # 转换为MB
    garbage_mb = garbage_bytes / (1024 * 1024)
    bigfile_mb = bigfile_bytes / (1024 * 1024)

    # 基础分数100分
    score = 100

    # 垃圾文件扣分：每100MB扣1分
    score -= (garbage_mb / 100)

    # 大文件扣分：每500MB扣1分
    score -= (bigfile_mb / 500)

    # 限制最低10分，最高100分
    score = max(10, min(100, score))

    return round(score)


def get_bigfiles_total_size():
    """
    遍历预设目录，统计所有大于100MB的文件总大小
    """
    min_size = 100 * 1024 * 1024  # 100 MB
    total = 0
    scan_dirs = ['/home', '/usr', '/var', '/opt']
    for base_dir in scan_dirs:
        if not os.path.exists(base_dir):
            continue
        for root, dirs, files in os.walk(base_dir):
            # 跳过系统特殊目录
            if any(x in root for x in ['/proc', '/sys', '/dev', '/run']):
                continue
            for file in files:
                try:
                    file_path = os.path.join(root, file)
                    if os.path.isfile(file_path):
                        size = os.path.getsize(file_path)
                        if size >= min_size:
                            total += size
                except Exception as e:
                    logging.error(f"Error getting size for {file_path}: {e}")
    return total


def read_last_clean_info():
    if os.path.exists(LAST_CLEAN_INFO_FILE):
        try:
            with open(LAST_CLEAN_INFO_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"读取 last_clean_info 文件失败: {e}")
    return {}


def write_last_clean_info(info):
    try:
        with open(LAST_CLEAN_INFO_FILE, 'w') as f:
            json.dump(info, f)
    except Exception as e:
        logging.error(f"写入 last_clean_info 文件失败: {e}")


def run_command(command):
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            logging.error(f"命令 '{command}' 执行失败，返回代码 {result.returncode}")
            logging.error(f"错误输出: {result.stderr}")
            return None
        return result.stdout.strip()
    except:
        return None


def parse_size(size_str):
    try:
        if isinstance(size_str, (int, float)):
            return float(size_str)
        size_str = str(size_str).strip().replace(',', '')
        if size_str == '0' or size_str == '-':
            return 0
        match = re.match(r'^([\d.]+)\s*([KMGTPB])?B?$', size_str, re.IGNORECASE)
        if match:
            size, unit = match.groups()
            size = float(size)
            if unit:
                unit = unit.upper()
                if unit == 'K':
                    return size * 1024
                elif unit == 'M':
                    return size * 1024 ** 2
                elif unit == 'G':
                    return size * 1024 ** 3
                elif unit == 'T':
                    return size * 1024 ** 4
                elif unit == 'P':
                    return size * 1024 ** 5
            return size
        return 0
    except:
        return 0


def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} PB"


def get_directory_size(path):
    total = 0
    if path and os.path.exists(path):
        for dirpath, dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    try:
                        total += os.path.getsize(fp)
                    except:
                        pass
    return total


def get_file_size(path):
    try:
        if path and os.path.exists(path) and not os.path.islink(path):
            return os.path.getsize(path)
    except:
        pass
    return 0


def get_module_total_size(module_name):
    entries = MODULES.get(module_name, [])
    total = 0
    for (cat_name, p) in entries:
        if p and os.path.isdir(p):
            total += get_directory_size(p)
        elif p and os.path.isfile(p):
            total += get_file_size(p)
    return total


@app.route('/scan', methods=['GET'])
def scan():
    dirs_to_scan = [os.path.expanduser('~/.cache'), '/var/cache', '/var/log', '/var/tmp']

    def generate():
        all_items = []
        for d in dirs_to_scan:
            if os.path.exists(d):
                for root, dirs, files in os.walk(d):
                    all_items.append(root)
                    for dd in dirs:
                        all_items.append(os.path.join(root, dd))
                    for ff in files:
                        all_items.append(os.path.join(root, ff))

        total = len(all_items)
        if total == 0:
            total = 1
        processed = 0
        desired_scan = 3.0
        sleep_time = desired_scan / total

        for item in all_items:
            processed += 1
            if processed % 5 == 0 or processed == total:
                progress = int(processed / total * 100)
                yield json.dumps({
                    "status": "scanning",
                    "current_path": item,
                    "progress": progress
                }) + "\n"
            time.sleep(sleep_time)

        # 原来的 3 大模块
        cache_size = get_module_total_size('cache_files')
        log_size = get_module_total_size('log_files')
        temp_size = get_module_total_size('temp_files')

        # 现在不再调用 get_module_total_size('app_files'), 而是用 get_wechat_total_size()
        app_size = get_wechat_total_size()

        total_size = cache_size + log_size + temp_size + app_size
        data = {
            "status": "complete",
            "total_size": total_size,
            "items": [
                {
                    "title": "缓存文件",
                    "desc": "用户和系统的缓存文件。",
                    "size": cache_size,
                    "actions": ["检查"]
                },
                {
                    "title": "日志文件",
                    "desc": "系统日志文件可能变得很大。",
                    "size": log_size,
                    "actions": ["检查"]
                },
                {
                    "title": "临时文件",
                    "desc": "临时文件目录内容。",
                    "size": temp_size,
                    "actions": ["检查"]
                },
                {
                    "title": "应用文件",
                    "desc": "针对常见应用的垃圾文件。",
                    "size": app_size,
                    "actions": ["检查"]
                }
            ]
        }
        yield json.dumps(data) + "\n"

    return Response(generate(), mimetype='application/json')


def get_wechat_total_size():
    """
    扫描“微信垃圾”的总大小，逻辑跟 handle_app_files 类似，
    但只返回 total_size，不返回具体文件列表。
    """
    logging.info("开始统计微信垃圾总大小(get_wechat_total_size) ...")

    # 先收集 xwechat_files 目录
    wechat_dirs = []

    # 1) 优先检查
    priority_paths = [
        "/home/Documents/xwechat_files",
        "/media/psf/Home/Documents/xwechat_files"
    ]
    for p in priority_paths:
        if os.path.exists(p) and os.path.isdir(p):
            wechat_dirs.append(p)

    # 2) 如果都没找到, 在 /home 和 /media 下搜索
    if not wechat_dirs:
        found_any = search_xwechat_in_home_and_media(wechat_dirs)
        if not found_any:
            logging.info("get_wechat_total_size: 未找到任何 xwechat_files，返回 0")
            return 0

    # 遍历 wechat_dirs，统计 wxid_*/msg 下的所有文件大小
    total_size = 0
    for base_dir in wechat_dirs:
        logging.info(f"统计目录: {base_dir}")
        if os.path.isdir(base_dir):
            for subdir in os.listdir(base_dir):
                if subdir.startswith("wxid_"):
                    msg_path = os.path.join(base_dir, subdir, "msg")
                    if os.path.exists(msg_path) and os.path.isdir(msg_path):
                        # 这儿可以直接用 get_directory_size(msg_path)，
                        # 或者跟 handle_app_files 同样 get_directory_details_with_mtime 后 sum size
                        total_size += get_directory_size(msg_path)
    logging.info(f"get_wechat_total_size 统计结果: {format_size(total_size)}")
    return total_size


def get_directory_details_with_mtime(path):
    details = []
    if path and os.path.exists(path):
        for root, dirs, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                if not os.path.islink(fp):
                    try:
                        st = os.stat(fp)
                        size = st.st_size
                        try:
                            owner = pwd.getpwuid(st.st_uid).pw_name
                        except KeyError:
                            # 无法解析UID对应用户，则用 "unknown"
                            owner = "unknown"
                            logging.error(f"解析用户UID {st.st_uid} 失败，使用 unknown: {fp}")
                        try:
                            permissions = stat.filemode(st.st_mode)
                        except Exception as e:
                            permissions = "---------"
                            logging.error(f"解析权限时出错: {fp}, {e}")
                        mtime = datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
                        details.append([f, root, format_size(size), owner, permissions, size, mtime])
                    except Exception as e:
                        # 记录出错原因，不要只pass
                        logging.error(f"处理文件 {fp} 时出错: {e}")
                        pass
    else:
        logging.info(f"路径不存在或为空: {path}")
    return details


@app.route('/item_details', methods=['GET'])
def item_details():
    item_name = request.args.get('item_name')
    if not item_name:
        return jsonify({"error": "no item_name"}), 400

    if item_name == 'app_files':
        return handle_app_files()
    else:
        # 走您已有的逻辑
        entries = MODULES.get(item_name, [])
        cat_list = []
        all_files = []
        for (cat_name, p) in entries:
            cat_size = 0
            cat_files = []
            if p and os.path.exists(p):
                cat_files = get_directory_details_with_mtime(p)
                cat_size = sum(x[5] for x in cat_files)
            cat_list.append({
                "name": cat_name,
                "size": format_size(cat_size),
                "item_name": item_name + "::" + cat_name
            })

            for c in cat_files:
                all_files.append({
                    "file_name": c[0],
                    "readable_size": c[2],
                    "size": c[5],
                    "path": c[1],
                    "mtime": c[6],
                    "category_name": cat_name
                })

        headers = ["文件名称", "文件位置", "文件大小", "所属用户", "权限", "大小(字节)", "修改时间"]
        total_bytes = sum(f["size"] for f in all_files)

        return jsonify({
            "data": [],
            "headers": headers,
            "categories": [{"name": "清理分类", "items": cat_list}],
            "files": all_files
        })


def handle_app_files():
    """
    针对"应用文件" -> 细分为:
      - 微信-附件 (msg/attach)
      - 微信-文件 (msg/file)
      - 微信-媒体 (msg/video)
    如果都没找到 xwechat_files，就返回空。
    """
    logging.info("开始处理 app_files (微信垃圾,细分3个子分类)...")

    wechat_dirs = []

    # 1) 优先检查
    priority_paths = [
        "/home/Documents/xwechat_files",
        "/media/psf/Home/Documents/xwechat_files"
    ]
    for p in priority_paths:
        if os.path.exists(p) and os.path.isdir(p):
            wechat_dirs.append(p)

    # 2) 如果都没找到, 在 /home 和 /media 下搜索
    if not wechat_dirs:
        logging.info("未在优先目录找到 xwechat_files, 开始在 /home 和 /media 下搜索...")
        found_any = search_xwechat_in_home_and_media(wechat_dirs)
        if not found_any:
            logging.info("在 /home 和 /media 下也未找到 xwechat_files 目录, 判定为 0 MB")
            # 返回空
            return generate_wechat_subcategories_response([], [])

    # -------------------------------
    # 收集分类: "微信-附件","微信-文件","微信-媒体"
    # 我们要构造 categories = [
    #   { name="微信-附件", size=?, item_name="app_files::wechat_attach" },
    #   { name="微信-文件", size=?, item_name="app_files::wechat_file" },
    #   { name="微信-媒体", size=?, item_name="app_files::wechat_video" },
    # ]
    # 同时收集 files[] -> 其中每个文件带 "category_name" = "微信-附件"/"微信-文件"/"微信-媒体"
    # -------------------------------
    subcategories = [
        {"cat_name": "微信-附件", "sub_folder": "attach", "total_size": 0},
        {"cat_name": "微信-文件", "sub_folder": "file", "total_size": 0},
        {"cat_name": "微信-媒体", "sub_folder": "video", "total_size": 0},
    ]
    all_files = []  # 存放所有文件(附件/文件/媒体)

    for base_dir in wechat_dirs:
        logging.info(f"处理 xwechat_files 目录: {base_dir}")
        for subdir in os.listdir(base_dir):
            if subdir.startswith("wxid_"):
                msg_path = os.path.join(base_dir, subdir, "msg")
                if os.path.exists(msg_path) and os.path.isdir(msg_path):
                    # 分别扫描 attach, file, video 三个子文件夹
                    for sc in subcategories:
                        cat_label = sc["cat_name"]
                        subf = sc["sub_folder"]
                        folder_path = os.path.join(msg_path, subf)
                        if os.path.exists(folder_path) and os.path.isdir(folder_path):
                            cat_files = get_directory_details_with_mtime(folder_path)
                            cat_size = sum(x[5] for x in cat_files)
                            sc["total_size"] += cat_size

                            # 将文件逐个添加进 all_files
                            for c in cat_files:
                                all_files.append({
                                    "file_name": c[0],
                                    "readable_size": c[2],
                                    "size": c[5],
                                    "path": c[1],
                                    "mtime": c[6],
                                    "category_name": cat_label  # 标记为 "微信-附件"/"微信-文件"/"微信-媒体"
                                })

    # 现在 subcategories 里每个都统计了 total_size
    # all_files 里包含了所有文件，并且带 "category_name"区分
    return generate_wechat_subcategories_response(subcategories, all_files)


def generate_wechat_subcategories_response(subcategories, all_files):
    """
    生成包含3个子分类(附件/文件/媒体) 的 JSON
    前端会在 `categories` 字段看到:
      - "微信-附件" (size=xx)
      - "微信-文件" (size=yy)
      - "微信-媒体" (size=zz)
    并在 files[] 里每个文件的 "category_name" 区分归属
    """
    headers = ["文件名称", "文件位置", "文件大小", "所属用户", "权限", "大小(字节)", "修改时间"]

    # 将 subcategories 转化成 "name/size/item_name"
    cat_items = []
    for sc in subcategories:
        cat_items.append({
            "name": sc["cat_name"],
            "size": format_size(sc["total_size"]),
            # 这里 item_name 可根据需求, 也可写 "app_files::wechat_attach" 之类
            "item_name": "app_files::" + sc["sub_folder"]
        })

    return jsonify({
        "data": [],
        "headers": headers,
        # categories -> ["name": "清理分类","items": cat_items]
        "categories": [
            {
                "name": "清理分类",
                "items": cat_items
            }
        ],
        "files": all_files
    })


def search_xwechat_in_home_and_media(wechat_dirs):
    """
    在 /home 和 /media 这两个目录下搜索名为 'xwechat_files' 的文件夹
    如果找到, 放进 wechat_dirs 列表, 返回 True; 否则 False
    """
    # 要扫描的根目录
    search_roots = ["/home", "/media"]
    found = False

    # 可以跳过的系统子目录(如 hidden?), 看情况
    skip_paths = ["/home/.config", "/home/.local"]  # 仅示例

    for root_dir in search_roots:
        if not os.path.exists(root_dir):
            continue

        for current_root, dirs, files in os.walk(root_dir, followlinks=False):
            # 如有需要, 也可以跳过某些子目录
            if any(current_root.startswith(sp) for sp in skip_paths):
                continue

            if "xwechat_files" in dirs:
                found_path = os.path.join(current_root, "xwechat_files")
                logging.info(f"在 {root_dir} 下找到 xwechat_files: {found_path}")
                wechat_dirs.append(found_path)
                found = True
                # 如果只要找一个, break; 如果可能有多个, 不 break
                # break

    return found


def generate_wechat_response(all_files, total_size):
    headers = ["文件名称", "文件位置", "文件大小", "所属用户", "权限", "大小(字节)", "修改时间"]
    cat_name = "微信垃圾"
    cat_list = [{
        "name": cat_name,
        "size": format_size(total_size),
        "item_name": "app_files::wechat"
    }]

    return jsonify({
        "data": [],
        "headers": headers,
        "categories": [
            {
                "name": "清理分类",
                "items": cat_list
            }
        ],
        "files": all_files
    })


@app.route('/last_clean_info', methods=['GET'])
def last_clean_info():
    info = read_last_clean_info()
    return jsonify(info)


@app.route('/clean', methods=['POST'])
def clean():
    data = request.json
    freed = 0
    err = False
    for category, selection in data.items():
        for item in selection['items']:
            fp = os.path.join(item['file_path'], item['file_name']) if not item['file_path'].endswith(
                item['file_name']) else item['file_path']
            if os.path.exists(fp):
                try:
                    if os.path.isfile(fp):
                        os.remove(fp)
                        freed += item['size']
                    elif os.path.isdir(fp):
                        dir_size = get_directory_size(fp)
                        shutil.rmtree(fp)
                        freed += dir_size
                except Exception as e:
                    logging.error(f"删除 {fp} 时出错: {e}")
                    err = True
    if err:
        return jsonify({"error": "清理过程中发生错误", "freed_space": freed}), 500

    # 更新清理记录
    clean_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    info = read_last_clean_info()
    cumulative = info.get("cumulative_clean_size", 0)
    cumulative += freed

    # 计算垃圾文件总大小（调用已有函数）
    garbage_total = (get_module_total_size('cache_files') +
                     get_module_total_size('log_files') +
                     get_module_total_size('temp_files') +
                     get_wechat_total_size())
    # 计算大文件总大小
    bigfile_total = get_bigfiles_total_size()

    new_score = compute_score(garbage_total, bigfile_total)

    new_info = {
        "last_clean_time": clean_time,
        "cumulative_clean_size": cumulative,
        "last_score": new_score
    }
    write_last_clean_info(new_info)

    return jsonify({"freed_space": freed, "new_score": new_score})


# 全局变量或放在 global 里都行
last_net_sent = 0
last_net_recv = 0
last_disk_read = 0
last_disk_write = 0
last_check_time = time.time()


@app.route('/monitor_data', methods=['GET'])
def monitor_data():
    global last_net_sent, last_net_recv, last_disk_read, last_disk_write, last_check_time

    current_time = time.time()
    delta_time = current_time - last_check_time
    if delta_time < 0.001:  # 避免极端情况下除0
        delta_time = 0.001

    net_io = psutil.net_io_counters()
    disk_io = psutil.disk_io_counters()

    # 做差分，求上行/下行速率
    net_sent_diff = net_io.bytes_sent - last_net_sent
    net_recv_diff = net_io.bytes_recv - last_net_recv
    disk_read_diff = disk_io.read_bytes - last_disk_read
    disk_write_diff = disk_io.write_bytes - last_disk_write

    net_sent_speed_bps = net_sent_diff / delta_time
    net_recv_speed_bps = net_recv_diff / delta_time
    disk_read_speed_bps = disk_read_diff / delta_time
    disk_write_speed_bps = disk_write_diff / delta_time

    # 更新全局存储
    last_net_sent = net_io.bytes_sent
    last_net_recv = net_io.bytes_recv
    last_disk_read = disk_io.read_bytes
    last_disk_write = disk_io.write_bytes
    last_check_time = current_time

    # 将速率换算为 MB/s (你也可改成 KB/s)
    net_sent_speed_mbs = net_sent_speed_bps / 1024 / 1024
    net_recv_speed_mbs = net_recv_speed_bps / 1024 / 1024
    disk_read_speed_mbs = disk_read_speed_bps / 1024 / 1024
    disk_write_speed_mbs = disk_write_speed_bps / 1024 / 1024

    # 重新获取 CPU、内存、swap 等
    ctimes = psutil.cpu_times_percent(interval=0.0, percpu=False)
    cpu_percent = psutil.cpu_percent(interval=0.0, percpu=False)
    cpu_per_core = psutil.cpu_percent(interval=0.0, percpu=True)
    memory = psutil.virtual_memory()
    swap = psutil.swap_memory()

    data = {
        "cpu": {
            "overall_percent": cpu_percent,  # CPU 总占用
            "per_core": cpu_per_core,  # 按核心
            "user": ctimes.user,  # 用户态 CPU
            "system": ctimes.system,  # 内核态 CPU
            "idle": ctimes.idle  # 空闲
        },
        "memory": {
            "total": memory.total,
            "used": memory.used,
            "percent": memory.percent,
            "swap_total": swap.total,
            "swap_used": swap.used
        },
        "network": {
            # 这里传递"实时速率"给前端
            "sent_mbs": net_sent_speed_mbs,
            "recv_mbs": net_recv_speed_mbs
        },
        "disk": {
            "read_mbs": disk_read_speed_mbs,
            "write_mbs": disk_write_speed_mbs
        }
    }

    return jsonify(data)


@app.route('/processes', methods=['GET'])
def get_processes():
    processes = []
    for proc in psutil.process_iter(['pid', 'name', 'username', 'memory_percent', 'cmdline']):
        try:
            process_info = proc.as_dict(attrs=['pid', 'name', 'username', 'memory_percent', 'cmdline'])
            memory = proc.memory_info().rss
            cmdline = process_info.get('cmdline') or []
            if isinstance(cmdline, list):
                description = ' '.join(cmdline) or "N/A"
            else:
                description = "N/A"
            processes.append({
                'pid': process_info['pid'],
                'name': process_info['name'],
                'memory': memory,
                'memory_percent': process_info['memory_percent'],
                'username': process_info['username'],
                'description': description
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return jsonify(processes)


@app.route('/end_process', methods=['POST'])
def end_process():
    data = request.json
    pid = data.get('pid')
    if pid:
        try:
            process = psutil.Process(pid)
            process.terminate()
            return jsonify({"message": "进程已终止"})
        except psutil.NoSuchProcess:
            return jsonify({"error": "进程不存在"}), 404
        except psutil.AccessDenied:
            return jsonify({"error": "没有权限终止该进程"}), 403
    else:
        return jsonify({"error": "未提供PID"}), 400


@app.route('/optimize', methods=['POST'])
def optimize():
    optimizer = MemoryOptimizer()
    results = optimizer.optimize()
    if results['success']:
        return jsonify({
            'status': 'success',
            'freed_memory': results['freed_memory'],
            'optimization_details': results['optimization_details'],
            'steps_completed': results['steps_completed']
        })
    else:
        return jsonify({
            'status': 'partial_success' if results['freed_memory'] > 0 else 'failed',
            'error': '部分优化步骤失败',
            'freed_memory': results['freed_memory'],
            'optimization_details': results['optimization_details'],
            'steps_completed': results['steps_completed']
        }), 500


@app.route('/scan_bigfiles')
def scan_bigfiles():
    def generate():
        min_size = 100 * 1024 * 1024  # 100MB
        big_files = []
        scanned_dirs = 0
        scanned_files = 0
        found_files = 0

        # 要扫描的目录列表（根据实际需求修改）
        scan_dirs = ['/home', '/usr', '/var', '/opt']  # 示例目录列表

        def send_status(current_path):
            return json.dumps({
                "status": "scanning",
                "current_path": current_path,
                "stats": {
                    "scanned_dirs": scanned_dirs,
                    "scanned_files": scanned_files,
                    "found_files": found_files
                }
            }) + "\n"

        yield send_status("正在开始扫描...")

        try:
            for base_dir in scan_dirs:
                if not os.path.exists(base_dir):
                    continue

                for root, dirs, files in os.walk(base_dir, followlinks=False):
                    try:
                        # 跳过特定系统目录
                        if any(p in root for p in ['/proc', '/sys', '/dev', '/run']):
                            continue

                        scanned_dirs += 1
                        current_dir_files = 0

                        # 每个目录都发送更新
                        if scanned_dirs % 10 == 0:  # 每10个目录更新一次
                            yield send_status(root)

                        for file in files:
                            try:
                                file_path = os.path.join(root, file)
                                if os.path.islink(file_path):
                                    continue

                                current_dir_files += 1
                                scanned_files += 1

                                # 只检查普通文件的大小
                                if os.path.isfile(file_path):
                                    size = os.path.getsize(file_path)
                                    if size >= min_size:
                                        found_files += 1
                                        mtime = datetime.fromtimestamp(
                                            os.path.getmtime(file_path)
                                        ).strftime('%Y-%m-%d %H:%M:%S')

                                        big_files.append({
                                            "name": file,
                                            "path": file_path,
                                            "size": size,
                                            "mtime": mtime
                                        })

                                        # 每找到一个大文件就发送更新
                                        yield send_status(file_path)

                                # 每1000个文件更新一次状态
                                if current_dir_files % 1000 == 0:
                                    yield send_status(root)

                            except (OSError, IOError) as e:
                                logging.error(f"Error accessing file {file}: {e}")
                                continue

                    except (OSError, IOError) as e:
                        logging.error(f"Error accessing directory {root}: {e}")
                        continue

        except Exception as e:
            logging.error(f"Scan error: {e}")
            yield json.dumps({
                "status": "error",
                "error": str(e)
            }) + "\n"
            return

        # 发送完成状态
        yield json.dumps({
            "status": "complete",
            "files": sorted(big_files, key=lambda x: x['size'], reverse=True),
            "stats": {
                "scanned_dirs": scanned_dirs,
                "scanned_files": scanned_files,
                "found_files": found_files
            }
        }) + "\n"

    return Response(generate(), mimetype='application/json')


@app.route('/delete_file', methods=['POST'])
def delete_file():
    data = request.json
    file_path = data.get('path')

    if not file_path:
        return jsonify({"success": False, "error": "No file path provided"}), 400

    try:
        # 检查文件是否存在
        if not os.path.exists(file_path):
            return jsonify({"success": False, "error": "File does not exist"}), 404

        # 检查是否是文件而不是目录
        if not os.path.isfile(file_path):
            return jsonify({"success": False, "error": "Path is not a file"}), 400

        # 删除文件
        os.remove(file_path)
        return jsonify({"success": True})

    except Exception as e:
        logging.error(f"Error deleting file {file_path}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/full_clean', methods=['POST'])
def full_clean():
    try:
        data = request.json
        garbage_files = data.get('garbage_files', [])
        big_files = data.get('big_files', [])

        # 统计变量
        cleaned_files = 0
        freed_space = 0

        # 删除垃圾文件
        for file in garbage_files:
            try:
                path = file['path']
                if os.path.exists(path):
                    if os.path.isfile(path):
                        os.remove(path)
                        cleaned_files += 1
                        freed_space += file['size']
                    elif os.path.isdir(path):
                        dir_size = get_directory_size(path)
                        shutil.rmtree(path)
                        cleaned_files += 1
                        freed_space += dir_size
            except Exception as e:
                logging.error(f"删除文件失败: {path}, 错误: {str(e)}")

        # 删除大文件
        for file in big_files:
            try:
                path = file['path']
                if os.path.exists(path) and os.path.isfile(path):
                    os.remove(path)
                    cleaned_files += 1
                    freed_space += file['size']
            except Exception as e:
                logging.error(f"删除大文件失败: {path}, 错误: {str(e)}")

        # 执行内存优化
        optimizer = MemoryOptimizer()
        optimize_result = optimizer.optimize()
        freed_memory = optimize_result.get('freed_memory', 0)

        # 计算新的系统得分
        garbage_total = (get_module_total_size('cache_files') +
                         get_module_total_size('log_files') +
                         get_module_total_size('temp_files') +
                         get_wechat_total_size())
        bigfile_total = get_bigfiles_total_size()
        new_score = compute_score(garbage_total, bigfile_total)

        # 更新清理记录
        clean_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        info = read_last_clean_info()
        cumulative = info.get("cumulative_clean_size", 0) + freed_space

        new_info = {
            "last_clean_time": clean_time,
            "cumulative_clean_size": cumulative,
            "last_score": new_score
        }
        write_last_clean_info(new_info)

        return jsonify({
            "success": True,
            "cleaned_files": cleaned_files,
            "freed_space": freed_space,
            "freed_memory": freed_memory,
            "new_score": new_score,
            "cumulative_clean_size": cumulative
        })

    except Exception as e:
        logging.error(f"全面清理失败: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"清理失败: {str(e)}"
        }), 500


class MemoryOptimizer:
    def __init__(self):
        # 基础配置
        self.libc = ctypes.CDLL('libc.so.6')
        self.PAGE_SIZE = resource.getpagesize()
        self.last_available = psutil.virtual_memory().available

        # 性能监控
        self.memory_samples = deque(maxlen=10)
        self.pressure_history = deque(maxlen=5)

        # 配置参数
        self.config = {
            'aggressive_threshold': 80,  # 激进优化阈值
            'sample_interval': 0.5,  # 采样间隔
            'sample_count': 3,  # 采样次数
            'large_process_threshold': 20,  # 大进程判定阈值(%)
            'min_free_memory': 131072,  # 最小空闲内存(KB)
        }

        # 初始化日志
        self._setup_logging()

    def _setup_logging(self):
        """配置日志系统"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(),
                logging.FileHandler('memory_optimizer.log')
            ]
        )
        self.logger = logging.getLogger('MemoryOptimizer')

    def optimize(self):
        """执行内存优化的主函数"""
        if os.geteuid() != 0:
            return {
                'success': False,
                'error': '需要root权限来执行内存优化',
                'freed_memory': 0
            }

        # 初始化结果
        results = {
            'success': True,
            'steps_completed': [],
            'freed_memory': 0,
            'optimization_details': {}
        }

        try:
            # 记录初始状态
            initial_state = self._capture_system_state()
            initial_memory = psutil.virtual_memory()
            self.logger.info(f"开始内存优化，初始使用率: {initial_memory.percent}%, "
                             f"可用内存: {initial_memory.available / 1024 / 1024:.1f}MB")

            # 分析内存压力
            memory_pressure = self._analyze_memory_pressure()
            self.logger.info(f"当前内存压力: {memory_pressure}%")

            # 选择优化策略
            if memory_pressure > self.config['aggressive_threshold']:
                self.logger.info("使用激进优化策略")
                optimization_steps = [
                    (self._aggressive_cache_clean, "激进缓存清理"),
                    (self._optimize_huge_pages, "大页面优化"),
                    (self._force_compact, "强制内存紧凑化"),
                    (self._aggressive_swap_clean, "交换空间清理"),
                    (self._optimize_kernel_memory, "内核内存优化"),
                    (self._optimize_slab, "Slab优化")
                ]
            else:
                self.logger.info("使用标准优化策略")
                optimization_steps = [
                    (self._normal_cache_clean, "标准缓存清理"),
                    (self._optimize_memory, "内存优化"),
                    (self._optimize_swap, "交换空间优化"),
                    (self._trim_caches, "缓存整理")
                ]

            # 记录总的释放内存
            total_freed = 0
            step_results = []

            # 执行每个优化步骤
            for step_func, step_name in optimization_steps:
                self.logger.info(f"执行 {step_name}...")
                try:
                    # 记录步骤前的内存状态
                    before_step = psutil.virtual_memory().available

                    # 执行优化步骤
                    step_freed = step_func()

                    # 等待系统状态稳定
                    time.sleep(0.5)

                    # 记录步骤后的内存状态
                    after_step = psutil.virtual_memory().available
                    actual_freed = after_step - before_step

                    # 使用实际释放的内存量
                    step_freed = max(actual_freed, step_freed)

                    success = step_freed > 0
                    total_freed += step_freed

                    step_result = {
                        'step': step_name,
                        'success': success,
                        'freed_memory': step_freed,
                        'error': None
                    }

                    self.logger.info(f"{step_name} 完成，释放了 {self.format_size(step_freed)}")

                except Exception as e:
                    self.logger.error(f"{step_name} 失败: {str(e)}")
                    step_result = {
                        'step': step_name,
                        'success': False,
                        'freed_memory': 0,
                        'error': str(e)
                    }

                step_results.append(step_result)

            # 等待系统状态完全稳定
            time.sleep(2)

            # 捕获最终状态
            final_state = self._capture_system_state()
            final_memory = psutil.virtual_memory()

            # 计算实际释放的内存（使用可用内存的差值）
            actual_freed = final_memory.available - initial_memory.available
            self.logger.info(f"优化完成，最终内存使用率: {final_memory.percent}%, "
                             f"可用内存: {final_memory.available / 1024 / 1024:.1f}MB")
            self.logger.info(f"实际释放内存: {self.format_size(actual_freed)}")

            # 收集性能指标
            performance_metrics = self._collect_performance_metrics()

            # 更新结果
            results.update({
                'freed_memory': actual_freed,
                'steps_completed': step_results,
                'optimization_details': {
                    'initial_state': initial_state,
                    'final_state': final_state,
                    'memory_pressure': memory_pressure,
                    'performance_metrics': performance_metrics,
                    'memory_before': {
                        'total': initial_memory.total,
                        'available': initial_memory.available,
                        'percent': initial_memory.percent,
                        'used': initial_memory.used,
                        'free': initial_memory.free,
                        'cached': getattr(initial_memory, 'cached', 0),
                        'buffers': getattr(initial_memory, 'buffers', 0),
                        'swap_total': psutil.swap_memory().total,
                        'swap_used': psutil.swap_memory().used
                    },
                    'memory_after': {
                        'total': final_memory.total,
                        'available': final_memory.available,
                        'percent': final_memory.percent,
                        'used': final_memory.used,
                        'free': final_memory.free,
                        'cached': getattr(final_memory, 'cached', 0),
                        'buffers': getattr(final_memory, 'buffers', 0),
                        'swap_total': psutil.swap_memory().total,
                        'swap_used': psutil.swap_memory().used
                    }
                }
            })

            # 记录整体优化效果
            memory_improvement = initial_memory.percent - final_memory.percent
            self.logger.info(f"内存使用率改善: {memory_improvement:.1f}%")
            self.logger.info(f"总释放内存: {self.format_size(actual_freed)}")

            if actual_freed <= 0 and total_freed > 0:
                self.logger.warning("检测到负的内存释放值，使用步骤累计值")
                results['freed_memory'] = total_freed

            # 添加优化建议
            if memory_pressure > 80:
                results['optimization_details']['recommendations'] = [
                    "系统内存压力较大，建议关闭不必要的应用",
                    "考虑增加交换空间",
                    "定期进行内存优化"
                ]
            elif memory_pressure > 60:
                results['optimization_details']['recommendations'] = [
                    "系统内存压力中等，建议定期优化",
                    "关注大内存应用的使用情况"
                ]
            else:
                results['optimization_details']['recommendations'] = [
                    "系统内存状况良好",
                    "建议保持当前的使用习惯"
                ]

        except Exception as e:
            self.logger.error(f"优化过程中发生错误: {e}")
            results.update({
                'success': False,
                'error': str(e)
            })

        finally:
            # 确保返回结果中包含所有必要的字段
            if 'optimization_details' not in results:
                results['optimization_details'] = {}
            if 'steps_completed' not in results:
                results['steps_completed'] = []
            if 'freed_memory' not in results:
                results['freed_memory'] = 0

        return results

    def format_size(self, size):
        """格式化内存大小显示"""
        try:
            for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
                if abs(size) < 1024.0:
                    return f"{size:.2f} {unit}"
                size /= 1024.0
            return f"{size:.2f} PB"
        except Exception as e:
            self.logger.error(f"格式化大小时出错: {e}")
            return "0 B"

    def _analyze_memory_pressure(self):
        """分析系统内存压力"""
        vm = psutil.virtual_memory()
        pressure = vm.percent  # 基础压力值
        

        # 检查大进程
        for proc in psutil.process_iter(['memory_percent']):
            try:
                if proc.memory_percent() > self.config['large_process_threshold']:
                    pressure += 10
                    self.logger.info(f"发现大进程 {proc.name()} ({proc.pid}), 内存占用: {proc.memory_percent():.1f}%")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        # 检查内存增长趋势
        growth_factor = self._check_memory_growth_trend()
        pressure += growth_factor * 10

        # 检查swap使用情况
        swap = psutil.swap_memory()
        if swap.percent > 80:
            pressure += 10

        # 记录压力历史
        self.pressure_history.append(pressure)

        

        return min(pressure, 100)

    def _check_memory_growth_trend(self):
        """检查内存使用增长趋势"""
        samples = []
        for _ in range(self.config['sample_count']):
            samples.append(psutil.virtual_memory().percent)
            time.sleep(self.config['sample_interval'])

        if len(samples) >= 2:
            trend = (samples[-1] - samples[0]) / len(samples)
            return max(0, min(1, trend / 10))
        return 0

    def _aggressive_cache_clean(self):
        """激进的缓存清理"""
        freed = 0
        try:
            # 保存原始设置
            original_cache_pressure = self._get_sysctl_value('vm.vfs_cache_pressure')
            original_min_free = self._get_sysctl_value('vm.min_free_kbytes')

            # 应用激进设置
            self._write_to_proc('/proc/sys/vm/drop_caches', '3')
            self._write_to_proc('/proc/sys/vm/vfs_cache_pressure', '500')
            self._write_to_proc('/proc/sys/vm/min_free_kbytes', str(self.config['min_free_memory']))

            time.sleep(1)  # 等待系统响应

            # 恢复原始设置
            if original_cache_pressure:
                self._write_to_proc('/proc/sys/vm/vfs_cache_pressure', original_cache_pressure)
            if original_min_free:
                self._write_to_proc('/proc/sys/vm/min_free_kbytes', original_min_free)

            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"激进缓存清理失败: {e}")

        return freed

    def _force_compact(self):
        """强制内存紧凑化"""
        freed = 0
        try:
            # 设置紧凑化参数
            self._write_to_proc('/proc/sys/vm/compact_memory', '1')

            # 尝试更激进的紧凑化
            try:
                self._write_to_proc('/proc/sys/vm/compaction_proactiveness', '100')
            except:
                pass  # 某些系统可能不支持此参数

            # 使用mlock强制内存整理
            self.libc.mlockall(ctypes.c_int(3))
            time.sleep(1)
            self.libc.munlockall()

            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"内存紧凑化失败: {e}")

        return freed

    def _aggressive_swap_clean(self):
        """激进的swap清理"""
        freed = 0
        try:
            # 保存原始swappiness
            original = self._get_sysctl_value('vm.swappiness')

            # 设置临时的高swappiness
            self._write_to_proc('/proc/sys/vm/swappiness', '100')

            # 清理swap
            subprocess.run(['swapoff', '-a'], check=True)
            time.sleep(1)
            subprocess.run(['swapon', '-a'], check=True)

            # 恢复原始swappiness
            if original:
                self._write_to_proc('/proc/sys/vm/swappiness', original)

            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"Swap清理失败: {e}")

        return freed

    def _optimize_huge_pages(self):
        """优化大页面内存"""
        freed = 0
        try:
            # 临时禁用透明大页面
            if os.path.exists('/sys/kernel/mm/transparent_hugepage/enabled'):
                with open('/sys/kernel/mm/transparent_hugepage/enabled', 'w') as f:
                    f.write('never')

                # 压缩现有大页面
                self._write_to_proc('/proc/sys/vm/compact_memory', '1')
                time.sleep(1)

                # 重新启用大页面
                with open('/sys/kernel/mm/transparent_hugepage/enabled', 'w') as f:
                    f.write('madvise')

            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"大页面优化失败: {e}")

        return freed

    def _normal_cache_clean(self):
        """标准缓存清理"""
        freed = 0
        try:
            # 仅清理页面缓存
            self._write_to_proc('/proc/sys/vm/drop_caches', '1')
            time.sleep(0.5)

            # 适度调整缓存压力
            self._write_to_proc('/proc/sys/vm/vfs_cache_pressure', '200')

            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"标准缓存清理失败: {e}")

        return freed

    def _optimize_memory(self):
        """基础内存优化"""
        freed = 0
        try:
            # 调整内核内存参数
            self._write_to_proc('/proc/sys/vm/zone_reclaim_mode', '1')
            self._write_to_proc('/proc/sys/vm/dirty_background_ratio', '5')
            self._write_to_proc('/proc/sys/vm/dirty_ratio', '10')

            time.sleep(0.5)
            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"基础内存优化失败: {e}")

        return freed

    def _optimize_swap(self):
        """标准交换空间优化"""
        freed = 0
        try:
            # 调整swappiness到适中值
            self._write_to_proc('/proc/sys/vm/swappiness', '60')

            # 如果swap使用率很高，执行温和的swap清理
            swap = psutil.swap_memory()
            if swap.percent > 80:
                subprocess.run(['swapoff', '-a'], check=True)
                time.sleep(1)
                subprocess.run(['swapon', '-a'], check=True)

            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"交换空间优化失败: {e}")

        return freed

    def _optimize_kernel_memory(self):
        """优化内核内存参数"""
        freed = 0
        try:
            # 调整内核内存管理参数
            params = {
                'vm.min_free_kbytes': '65536',
                'vm.dirty_background_ratio': '5',
                'vm.dirty_ratio': '10',
                'vm.swappiness': '60',
                'vm.overcommit_memory': '0',
                'vm.overcommit_ratio': '50',
                'vm.zone_reclaim_mode': '1'
            }

            # 应用参数
            for param, value in params.items():
                try:
                    subprocess.run(['sysctl', '-w', f'{param}={value}'],
                                   check=True, capture_output=True)
                except:
                    continue

            time.sleep(0.5)
            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"内核参数优化失败: {e}")

        return freed

    def _optimize_slab(self):
        """优化Slab分配器"""
        freed = 0
        try:
            # 触发slab回收
            self._write_to_proc('/proc/sys/vm/drop_caches', '2')

            # 尝试设置slab回收参数
            try:
                self._write_to_proc('/proc/sys/vm/min_slab_ratio', '5')
            except:
                pass  # 某些系统可能不支持此参数

            freed = self._calculate_freed_memory()

        except Exception as e:
            self.logger.error(f"Slab优化失败: {e}")

        return freed

    def _trim_caches(self):
        """缓存整理"""
        freed = 0
        try:
            initial_cached = psutil.virtual_memory().cached

            # 获取当前系统负载
            load_avg = os.getloadavg()[0]

            # 根据负载选择清理策略
            if load_avg < 1.0:
                self._write_to_proc('/proc/sys/vm/drop_caches', '3')
                self._write_to_proc('/proc/sys/vm/vfs_cache_pressure', '200')
            else:
                self._write_to_proc('/proc/sys/vm/drop_caches', '1')
                self._write_to_proc('/proc/sys/vm/vfs_cache_pressure', '100')

            final_cached = psutil.virtual_memory().cached
            freed = initial_cached - final_cached

        except Exception as e:
            self.logger.error(f"缓存整理失败: {e}")

        return max(0, freed)

    def _calculate_freed_memory(self):
        """计算释放的内存大小"""
        current_available = psutil.virtual_memory().available
        freed = current_available - self.last_available
        self.last_available = current_available
        return max(0, freed)

    def _capture_system_state(self):
        """捕获系统状态"""
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()

        return {
            'memory_before': {
                'total': vm.total,
                'available': vm.available,
                'used': vm.used,
                'free': vm.free,
                'percent': vm.percent,
                'cached': vm.cached,
                'buffers': getattr(vm, 'buffers', 0),
                'swap_total': swap.total,
                'swap_used': swap.used,
                'swap_free': swap.free,
                'swap_percent': swap.percent
            }
        }

    def _collect_performance_metrics(self):
        """收集性能指标"""
        try:
            metrics = {
                'memory_throughput': self._measure_memory_throughput(),
                'page_faults': self._get_page_faults(),
                'swap_activity': self._get_swap_activity()
            }
            return metrics
        except Exception as e:
            self.logger.error(f"收集性能指标失败: {e}")
            return {}

    def _measure_memory_throughput(self):
        try:
            # 创建100MB的测试数据
            size = 100 * 1024 * 1024  # 100MB in bytes
            data = b'0' * size

            # 记录开始时间
            start_time = time.time()

            # 执行内存复制操作
            _ = data * 2  # 复制数据块

            # 记录结束时间
            end_time = time.time()

            # 计算吞吐量（MB/s）
            throughput = size / (end_time - start_time) / 1024 / 1024
            return throughput
        except:
            # 发生任何错误时返回0
            return 0

    def _get_page_faults(self):
        """获取页面错误统计"""
        try:
            with open('/proc/vmstat', 'r') as f:
                content = f.read()
            pgfault = re.search(r'pgfault (\d+)', content)
            pgmajfault = re.search(r'pgmajfault (\d+)', content)
            return {
                'minor': int(pgfault.group(1)) if pgfault else 0,
                'major': int(pgmajfault.group(1)) if pgmajfault else 0
            }
        except:
            return {'minor': 0, 'major': 0}

    def _get_swap_activity(self):
        """获取交换空间活动情况"""
        try:
            with open('/proc/vmstat', 'r') as f:
                content = f.read()
            pswpin = re.search(r'pswpin (\d+)', content)
            pswpout = re.search(r'pswpout (\d+)', content)
            return {
                'swap_in': int(pswpin.group(1)) if pswpin else 0,
                'swap_out': int(pswpout.group(1)) if pswpout else 0
            }
        except:
            return {'swap_in': 0, 'swap_out': 0}

    def _get_sysctl_value(self, key):
        """获取系统参数值"""
        try:
            result = subprocess.run(['sysctl', '-n', key],
                                    capture_output=True,
                                    text=True,
                                    check=True)
            return result.stdout.strip()
        except:
            return None

    def _write_to_proc(self, path, value):
        """安全写入proc文件系统"""
        try:
            with open(path, 'w') as f:
                f.write(value)
            return True
        except Exception as e:
            self.logger.error(f"写入 {path} 失败: {e}")
            return False

    def _format_size(self, size):
        """格式化内存大小显示"""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024.0:
                return f"{size:.2f} {unit}"
            size /= 1024.0
        return f"{size:.2f} PB"


if __name__ == '__main__':
    if os.geteuid() != 0:
        print("此程序需要 root 权限运行。")
        sys.exit(1)
    app.run(debug=True, host='0.0.0.0', port=53421)
