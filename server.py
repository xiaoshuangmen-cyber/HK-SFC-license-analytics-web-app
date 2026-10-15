import json
import os
import threading
import queue
from datetime import datetime
from flask import Flask, render_template, jsonify, request, Response, send_from_directory
from scraper import scrape_sfc_data

app = Flask(__name__, static_folder='static', template_folder='templates')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')

DEFAULT_CONFIG = {
    "licstatus": "active",
    "roleType": "corporation",
    "ratypes": ["1"],
    "searchAll": True,
    "singleLetter": "A",
    "listThreadCount": 10,
    "threadCount": 20
}

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                merged = dict(DEFAULT_CONFIG)
                merged.update(cfg)
                return merged
        except Exception as e:
            print(f"读取本地配置失败: {e}")
    # If not exists, save default config to disk
    save_config_data(DEFAULT_CONFIG)
    return dict(DEFAULT_CONFIG)

def save_config_data(cfg):
    try:
        merged = load_config()
        merged.update(cfg)
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"保存本地配置失败: {e}")
        return False

# Create necessary directories
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, 'templates'), exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, 'static'), exist_ok=True)

# Global variables for tracking the current running task
current_task = {
    'is_running': False,
    'logs': [],
    'filename': None,
    'error': None
}
# Lock for thread safety on task state
task_lock = threading.Lock()
# Event for cancellation request
stop_event = threading.Event()
# Log listeners queue
listeners = []

def emit_progress(message, level="info"):
    formatted_msg = {"message": message, "level": level}
    with task_lock:
        current_task['logs'].append(formatted_msg)
    # Broadcast to all active SSE listeners
    for q in list(listeners):
        q.put(formatted_msg)

def run_scraper_thread(licstatus, role_type, ratypes, name_start_letters, thread_count, list_thread_count):
    global current_task
    try:
        filename = scrape_sfc_data(
            licstatus=licstatus,
            role_type=role_type,
            ratypes=ratypes,
            name_start_letters=name_start_letters,
            progress_callback=emit_progress,
            thread_count=thread_count,
            list_thread_count=list_thread_count,
            stop_checker=lambda: stop_event.is_set()
        )
        with task_lock:
            current_task['is_running'] = False
            current_task['filename'] = filename
    except Exception as e:
        emit_progress(f"任务执行异常中止: {str(e)}", "error")
        with task_lock:
            current_task['is_running'] = False
            current_task['error'] = str(e)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify(load_config())

@app.route('/api/config', methods=['POST'])
def save_config_route():
    data = request.json or {}
    if save_config_data(data):
        return jsonify({"status": "success", "message": "配置已保存到项目本地文件 (config.json)！"})
    return jsonify({"status": "error", "message": "保存本地配置文件失败。"}), 500

@app.route('/api/start', methods=['POST'])
def start_scraping():
    global current_task
    with task_lock:
        if current_task['is_running']:
            return jsonify({"status": "error", "message": "已有任务正在运行中，请等待其完成。"}), 400
        
        # Reset task status and stop event
        stop_event.clear()
        current_task['is_running'] = True
        current_task['logs'] = []
        current_task['filename'] = None
        current_task['error'] = None

    data = request.json or {}
    licstatus = data.get('licstatus', 'active')
    role_type = data.get('roleType', 'corporation')
    
    # Retrieve ratypes as list
    ratypes = data.get('ratypes', ['1'])
    if not isinstance(ratypes, list):
        ratypes = [str(ratypes)]
        
    thread_count = data.get('threadCount', 20)
    try:
        thread_count = int(thread_count)
        if thread_count < 10 or thread_count > 50:
            thread_count = 20
    except (ValueError, TypeError):
        thread_count = 20
        
    list_thread_count = data.get('listThreadCount', 10)
    try:
        list_thread_count = int(list_thread_count)
        if list_thread_count < 1 or list_thread_count > 10:
            list_thread_count = 10
    except (ValueError, TypeError):
        list_thread_count = 10
    
    # Check if user wants full letter search or specific letter
    search_type = data.get('searchType', 'all')  # 'all' or 'single'
    single_letter = data.get('singleLetter', 'A')
    if search_type == 'single':
        name_start_letters = [single_letter]
    else:
        # Loop through A-Z and 0-9
        name_start_letters = [chr(i) for i in range(ord('A'), ord('Z')+1)] + [str(i) for i in range(10)]

    # Automatically persist latest configuration to local config.json file
    save_config_data({
        'licstatus': licstatus,
        'roleType': role_type,
        'ratypes': ratypes,
        'searchAll': (search_type == 'all'),
        'singleLetter': single_letter,
        'listThreadCount': list_thread_count,
        'threadCount': thread_count
    })

    # Start scraping thread
    thread = threading.Thread(
        target=run_scraper_thread, 
        args=(licstatus, role_type, ratypes, name_start_letters, thread_count, list_thread_count)
    )
    thread.daemon = True
    thread.start()

    return jsonify({"status": "success", "message": f"抓取任务已成功启动，并行线程数: {thread_count}！"})

@app.route('/api/stop', methods=['POST'])
def stop_scraping():
    global current_task
    with task_lock:
        if not current_task['is_running']:
            return jsonify({"status": "error", "message": "当前没有正在运行的抓取任务。"}), 400
        
        stop_event.set()
        
    emit_progress("收到停止请求，正在终止抓取任务...", "warning")
    return jsonify({"status": "success", "message": "已成功向后台发送停止指令！"})

@app.route('/api/progress')
def progress():
    def event_stream():
        q = queue.Queue()
        listeners.append(q)
        
        # Send history first
        with task_lock:
            history = list(current_task['logs'])
        for msg in history:
            yield f"data: {msg['message']}|{msg['level']}\n\n"
            
        try:
            while True:
                # Wait for new log
                msg = q.get()
                yield f"data: {msg['message']}|{msg['level']}\n\n"
                # If task has finished and queue is empty, we can stop
                with task_lock:
                    if not current_task['is_running'] and q.empty():
                        break
        except GeneratorExit:
            pass
        finally:
            if q in listeners:
                listeners.remove(q)

    return Response(event_stream(), mimetype="text/event-stream")

@app.route('/api/status', methods=['GET'])
def get_status():
    with task_lock:
        return jsonify({
            "isRunning": current_task['is_running'],
            "filename": current_task['filename'],
            "error": current_task['error'],
            "logCount": len(current_task['logs'])
        })

@app.route('/api/files', methods=['GET'])
def list_files():
    files = []
    if os.path.exists(DATA_DIR):
        for f in os.listdir(DATA_DIR):
            if f.endswith('.xlsx'):
                path = os.path.join(DATA_DIR, f)
                stat = os.stat(path)
                files.append({
                    "name": f,
                    "size": f"{stat.st_size / 1024:.1f} KB",
                    "ctime": datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
                })
    # Sort files by creation time descending
    files.sort(key=lambda x: x['ctime'], reverse=True)
    return jsonify(files)

@app.route('/api/download/<filename>', methods=['GET'])
def download_file(filename):
    # Prevent directory traversal
    filename = os.path.basename(filename)
    return send_from_directory(DATA_DIR, filename, as_attachment=True)

@app.route('/api/delete/<filename>', methods=['POST'])
def delete_file(filename):
    filename = os.path.basename(filename)
    filepath = os.path.join(DATA_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
        return jsonify({"status": "success", "message": "文件删除成功！"})
    return jsonify({"status": "error", "message": "文件不存在！"}), 404

if __name__ == '__main__':
    print("SFC 持牌公司抓取服务正在启动，访问 http://127.0.0.1:5001")
    app.run(host='127.0.0.1', port=5001, debug=True)
