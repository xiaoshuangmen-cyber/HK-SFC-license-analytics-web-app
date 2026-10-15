import time
import random
import os
import requests
import json
import re
import pandas as pd
import zhconv
import threading
import html
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# SFC API URL
SFC_API_URL = "https://apps.sfc.hk/publicregWeb/searchByRaJson"

# Default request headers to simulate a normal browser request
DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://apps.sfc.hk/publicregWeb/searchByRa?locale=zh'
}

# RA Type display mapping
RA_MAP = {
    '1': '类别 1: 证券交易',
    '2': '类别 2: 期货合约交易',
    '3': '类别 3: 杠杆式外汇交易',
    '4': '类别 4: 就证券提供意见',
    '5': '类别 5: 就期货合约提供意见',
    '6': '类别 6: 就机构融资提供意见',
    '7': '类别 7: 提供自动化交易服务',
    '8': '类别 8: 提供证券保证金融资',
    '9': '类别 9: 提供资产管理',
    '10': '类别 10: 提供信贷评级服务',
    '13': '类别 13: 为相关集体投资计划提供存管服务',
    '101': '经营虚拟资产交易平台'
}

# Mapping integer keys just in case
RA_MAP_INT = {int(k): v for k, v in RA_MAP.items()}

def clean_unicode_nulls(text):
    if not text:
        return ""
    return str(text).replace('\u0000', '').strip()

def parse_date(date_str):
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%b %d, %Y %I:%M:%S %p")
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return date_str

def extract_js_var(html, var_name):
    # Try line-based pattern first since each variable assignment is on its own single line
    pattern = rf'var\s+{var_name}\s*=\s*(.*?)\r?\n'
    match = re.search(pattern, html)
    if match:
        val = match.group(1).strip()
        if val.endswith(';'):
            val = val[:-1]
        try:
            return json.loads(val)
        except Exception:
            pass
            
    # Fallback to matching up to semicolon (non-greedy)
    pattern_fallback = rf'var\s+{var_name}\s*=\s*(.*?);'
    match_fallback = re.search(pattern_fallback, html, re.DOTALL)
    if match_fallback:
        try:
            return json.loads(match_fallback.group(1).strip())
        except Exception:
            pass
            
    return None

def fetch_with_retry(session, url, headers, timeout=15, retries=4):
    for i in range(retries):
        try:
            resp = session.get(url, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                if "PrAppUtil" in resp.text or "var " in resp.text:
                    return resp.text
        except Exception:
            pass
        time.sleep(1.5 + i * 2 + random.uniform(0.1, 1.0))
    return None

def post_with_retry(session, url, data, headers, timeout=15, retries=4):
    for i in range(retries):
        try:
            resp = session.post(url, data=data, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                return resp
        except Exception:
            pass
        time.sleep(1.5 + i * 2 + random.uniform(0.1, 1.0))
    return None

def fetch_ba_va_cerefs(session):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://apps.sfc.hk/publicregWeb/searchByBa?locale=zh'
    }
    url = "https://apps.sfc.hk/publicregWeb/searchByBaJson"
    
    omnibus_cerefs = set()
    intro_cerefs = set()
    
    # 1. Fetch Omnibus Account CEREFs (batype=1, basubtype=7)
    resp_omnibus = post_with_retry(session, url, data={'batype': '1', 'basubtype': '7', 'nameStartLetter': '', 'page': '1', 'start': '0', 'limit': '1000'}, headers=headers)
    if resp_omnibus and resp_omnibus.status_code == 200:
        try:
            for item in resp_omnibus.json().get('items', []):
                if item and isinstance(item, dict) and item.get('ceref'):
                    omnibus_cerefs.add(item['ceref'].strip())
        except Exception:
            pass
            
    # 2. Fetch Introducing Agent CEREFs (batype=1, basubtype=9)
    resp_intro = post_with_retry(session, url, data={'batype': '1', 'basubtype': '9', 'nameStartLetter': '', 'page': '1', 'start': '0', 'limit': '1000'}, headers=headers)
    if resp_intro and resp_intro.status_code == 200:
        try:
            for item in resp_intro.json().get('items', []):
                if item and isinstance(item, dict) and item.get('ceref'):
                    intro_cerefs.add(item['ceref'].strip())
        except Exception:
            pass
            
    return omnibus_cerefs, intro_cerefs

def is_bank_broker(item):
    """
    Determines if a broker is bank-affiliated (Registered Institution) based on isRi flag.
    """
    return "是" if item and isinstance(item, dict) and item.get('isRi') == True else "否"

def get_company_details(session, ceref, is_ri=False, progress_callback=None):
    """
    Fetches the details pages for a corporate entity and extracts key fields.
    """
    entity_type = "ri" if is_ri else "corp"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': f'https://apps.sfc.hk/publicregWeb/{entity_type}/{ceref}/details?locale=zh'
    }
    
    details_url = f"https://apps.sfc.hk/publicregWeb/{entity_type}/{ceref}/details?locale=zh"
    addresses_url = f"https://apps.sfc.hk/publicregWeb/{entity_type}/{ceref}/addresses?locale=zh"
    prev_name_url = f"https://apps.sfc.hk/publicregWeb/{entity_type}/{ceref}/prev_name?locale=zh"
    
    res = {
        '受规管活动': '',
        '一号牌（证券交易）拿牌时间': '',
        '九号牌（资产管理）拿牌时间': '',
        '虚拟资产服务字段': '',
        '营业地址': '',
        '电邮地址': '',
        '网站地址': '',
        '前称记录中文': '',
        '前称记录英文': '',
        '证券期货 SFO-条件': '',
        '打击洗钱 SFO-条件': '',
        '持牌人不得持有客戶資產状态': 'No'
    }
    
    # 1. Fetch details page (Regulated Activities, VASP)
    html_details = fetch_with_retry(session, details_url, headers)
    if html_details:
        ra_data = extract_js_var(html_details, "raDetailData") or []
        amlo_data = extract_js_var(html_details, "amloDetailData") or []
        
        active_ras = []
        type1_date = ""
        type9_date = ""
        for item in ra_data:
            if item and isinstance(item, dict) and not item.get('endDate'): # Only active
                act_type = item.get('actType')
                mapped_name = RA_MAP.get(str(act_type), RA_MAP_INT.get(act_type, item.get('cactDesc') or f"类别 {act_type}"))
                active_ras.append(mapped_name)
                if act_type == 1:
                    type1_date = parse_date(item.get('effDate'))
                elif act_type == 9:
                    type9_date = parse_date(item.get('effDate'))
        
        vasp_services = []
        for item in amlo_data:
            if item and isinstance(item, dict) and not item.get('endDate'):
                act_type = item.get('actType')
                mapped_name = RA_MAP.get(str(act_type), RA_MAP_INT.get(act_type, item.get('cactDesc') or f"虚拟资产服务 {act_type}"))
                active_ras.append(mapped_name)
                vasp_services.append(mapped_name)
                
        res['受规管活动'] = ", ".join(active_ras)
        res['一号牌（证券交易）拿牌时间'] = type1_date
        res['九号牌（资产管理）拿牌时间'] = type9_date
        res['虚拟资产服务字段'] = ", ".join(vasp_services)
    
    # 2. Fetch addresses page (Address, Email, Website)
    html_addresses = fetch_with_retry(session, addresses_url, headers)
    if html_addresses:
        address_data = extract_js_var(html_addresses, "addressData") or []
        email_data = extract_js_var(html_addresses, "emailData") or []
        website_data = extract_js_var(html_addresses, "websiteData") or []
        
        business_addr = ""
        for addr in address_data:
            if addr and isinstance(addr, dict) and addr.get('addrPrin') == 'Y':
                business_addr = clean_unicode_nulls(addr.get('fullAddressChin')) or clean_unicode_nulls(addr.get('fullAddress'))
                break
        if not business_addr and address_data:
            first_addr = address_data[0]
            if first_addr and isinstance(first_addr, dict):
                business_addr = clean_unicode_nulls(first_addr.get('fullAddressChin')) or clean_unicode_nulls(first_addr.get('fullAddress'))
            
        emails = [clean_unicode_nulls(item.get('email')) for item in email_data if item and isinstance(item, dict) and item.get('email')]
        websites = [clean_unicode_nulls(item.get('website')) for item in website_data if item and isinstance(item, dict) and item.get('website')]
        
        res['营业地址'] = business_addr
        res['电邮地址'] = ", ".join(emails)
        res['网站地址'] = ", ".join(websites)
        
    # 3. Fetch previous names
    html_prev_name = fetch_with_retry(session, prev_name_url, headers)
    if html_prev_name:
        prev_data = extract_js_var(html_prev_name, "prevNameData") or []
        
        chin_names = [clean_unicode_nulls(item.get('chineseName')) for item in prev_data if item and isinstance(item, dict) and clean_unicode_nulls(item.get('chineseName'))]
        eng_names = [clean_unicode_nulls(item.get('englishName')) for item in prev_data if item and isinstance(item, dict) and clean_unicode_nulls(item.get('englishName'))]
        
        res['前称记录中文'] = ", ".join(chin_names)
        res['前称记录英文'] = ", ".join(eng_names)
        
    # 4. Fetch conditions (SFO / AMLO)
    conditions_url = f"https://apps.sfc.hk/publicregWeb/{entity_type}/{ceref}/conditions?locale=zh"
    html_conditions = fetch_with_retry(session, conditions_url, headers)
    if html_conditions:
        cond_data = extract_js_var(html_conditions, "condData") or []
        acond_data = extract_js_var(html_conditions, "acondData") or []
        
        sfo_conds = []
        for item in cond_data:
            dtl = item.get('conditionCDtl') or item.get('conditionDtl') or ''
            if dtl:
                sfo_conds.append(clean_unicode_nulls(html.unescape(dtl).strip()))
                
        amlo_conds = []
        for item in acond_data:
            dtl = item.get('conditionCDtl') or item.get('conditionDtl') or ''
            if dtl:
                amlo_conds.append(clean_unicode_nulls(html.unescape(dtl).strip()))
                
        res['证券期货 SFO-条件'] = " &&& ".join(sfo_conds)
        res['打击洗钱 SFO-条件'] = " &&& ".join(amlo_conds)
        
        # Determine client asset holding status
        has_no_holding = "No"
        for cond in sfo_conds:
            cond_lower = cond.lower()
            
            has_not_hold = (("不得持有" in cond or "不准持有" in cond) and ("客戶" in cond or "客户" in cond)) or \
                           (("shall not hold" in cond_lower or "not hold" in cond_lower) and ("client" in cond_lower or "customer" in cond_lower))
                           
            is_introducing = ("介紹" in cond) or \
                             ("介绍" in cond) or \
                             ("introducing" in cond_lower) or \
                             ("introduction" in cond_lower)
                             
            if has_not_hold and not is_introducing:
                has_no_holding = "Yes"
                break
                
        res['持牌人不得持有客戶資產状态'] = has_no_holding
        
    return res

def scrape_sfc_data(licstatus='active', role_type='corporation', ratypes=None, name_start_letters=None, progress_callback=None, thread_count=20, list_thread_count=10, stop_checker=None):
    """
    Scrapes SFC licensed corporation data based on search criteria.
    Supports cancellation via stop_checker function.
    """
    session = requests.Session()
    
    if progress_callback is None:
        progress_callback = lambda msg, level="info": print(f"[{level.upper()}] {msg}")

    # Process ratypes
    if not ratypes:
        ratypes = ['1']
    elif isinstance(ratypes, str):
        ratypes = [ratypes]
    
    # Check if there is an AMLO type (VASP=101) and handle it
    sfo_ratypes = []
    has_amlo = False
    for r in ratypes:
        if r == '101':
            has_amlo = True
        else:
            sfo_ratypes.append(r)
            
    # Default to A-Z and 0-9 if not specified
    if not name_start_letters:
        name_start_letters = [chr(i) for i in range(ord('A'), ord('Z')+1)] + [str(i) for i in range(10)]
    
    # Store companies: ceref -> {item_details, matched_ras: set}
    companies_dict = {}
    limit = 100  # Number of items per page
    
    total_letters = len(name_start_letters)
    
    # We will build a list of query tasks to execute
    tasks = []
    for ra in sfo_ratypes:
        for letter in name_start_letters:
            tasks.append(('sfo', ra, RA_MAP.get(ra, f"类别 {ra}"), letter))
    if has_amlo:
        for letter in name_start_letters:
            tasks.append(('amlo', '101', '虚拟资产服务: 经营虚拟资产交易平台', letter))
            
    total_steps = len(tasks)
    progress_callback(f"开始抓取SFC持牌名单。条件: 状态={licstatus}, 类型={role_type}, 总查询任务数={total_steps}", "info")
    
    step_idx = 0
    step_lock = threading.Lock()
    companies_lock = threading.Lock()
    
    def list_worker(q_type, ra_val, ra_name, letter):
        nonlocal step_idx
        
        # Stagger the worker starts to prevent hitting the server simultaneously
        time.sleep(random.uniform(0.02, 1.0))
        
        with step_lock:
            step_idx += 1
            current_step = step_idx
            
        progress_callback(f"[{current_step}/{total_steps}] 正在查询 [{ra_name}] - 首字母/数字 '{letter}'...", "info")
        
        page = 1
        start = 0
        letter_items = []
        
        while True:
            if stop_checker and stop_checker():
                break
                
            payload = {
                'licstatus': licstatus,
                'roleType': role_type,
                'nameStartLetter': letter,
                'page': str(page),
                'start': str(start),
                'limit': str(limit)
            }
            if q_type == 'sfo':
                payload['ratype'] = ra_val
            else:
                payload['ratypeamlo'] = ra_val
            
            try:
                response = post_with_retry(session, SFC_API_URL, data=payload, headers=DEFAULT_HEADERS, timeout=15)
                if response is None:
                    progress_callback(f"请求失败 [{ra_name}] - '{letter}' 第 {page} 页 (多次尝试后均失败)", "warning")
                    break
                
                data = response.json()
                total_count = data.get('totalCount', 0)
                items = data.get('items', [])
                
                if page == 1 and total_count > 0:
                    progress_callback(f"[{ra_name}] - 首字母/数字 '{letter}' 匹配条目数: {total_count}", "info")
                
                if not items:
                    break
                    
                letter_items.extend(items)
                
                if len(letter_items) >= total_count or len(items) < limit:
                    break
                    
                page += 1
                start = (page - 1) * limit
                time.sleep(random.uniform(0.1, 0.5))
                
            except Exception as e:
                progress_callback(f"请求异常 [{ra_name}] - '{letter}': {e}", "error")
                break
                
        # Merge into global companies dictionary
        with companies_lock:
            for item in letter_items:
                ceref = item.get('ceref', '').strip()
                if not ceref:
                    continue
                
                if ceref not in companies_dict:
                    companies_dict[ceref] = {
                        'item': item,
                        'matched_ras': {ra_val}
                    }
                else:
                    companies_dict[ceref]['matched_ras'].add(ra_val)

    progress_callback(f"启动线程池抓取名单列表，并发线程数: {list_thread_count}...", "info")
    with ThreadPoolExecutor(max_workers=list_thread_count) as executor:
        # Submit all tasks
        futures = [executor.submit(list_worker, q_type, ra_val, ra_name, letter) for q_type, ra_val, ra_name, letter in tasks]
        # Wait for all to finish
        for fut in futures:
            fut.result()

    if stop_checker and stop_checker():
        progress_callback("抓取任务已被用户手动停止！", "warning")
        return None

    # Process and save results
    if not companies_dict:
        progress_callback("未抓取到任何列表数据！", "warning")
        return None

    # Step 2: Fetch detailed info for each corporate entity
    total_companies = len(companies_dict)
    progress_callback(f"列表抓取完成，共 {total_companies} 家去重公司。接下来开始抓取每家公司的详细字段...", "info")
    companies_details = {}
    completed_count = 0
    counter_lock = threading.Lock()

    def worker(ceref, entry):
        nonlocal completed_count
        if stop_checker and stop_checker():
            return
            
        comp_name = entry['item'].get('name', '') or entry['item'].get('nameChi', '')
        is_ri = entry['item'].get('isRi') == True
        
        # Stagger the worker starts to prevent hitting the server simultaneously
        time.sleep(random.uniform(0.05, 1.5))
        
        details = get_company_details(session, ceref, is_ri=is_ri, progress_callback=progress_callback)
        
        with counter_lock:
            completed_count += 1
            companies_details[ceref] = details
            if progress_callback:
                progress_callback(f"[详情抓取 {completed_count}/{total_companies}] 正在获取 [{comp_name}] ({ceref}) 的详细资料...", "info")

    progress_callback(f"启动线程池抓取详情，线程数: {thread_count}...", "info")
    with ThreadPoolExecutor(max_workers=thread_count) as executor:
        # Submit all tasks
        futures = [executor.submit(worker, ceref, entry) for ceref, entry in sorted(companies_dict.items())]
        # Wait for all to finish
        for fut in futures:
            fut.result()

    if stop_checker and stop_checker():
        progress_callback("抓取任务已被用户手动停止！", "warning")
        return None

    # Compile final data rows
    rows = []
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Fetch Business Activity Virtual Asset CEREFs (Omnibus & Introducing Agent)
    if progress_callback:
        progress_callback("正在查询业务活动搜索 (综合账户提供虚拟资产交易服务 & 介绍代理人提供虚拟资产交易服务) 名单...", "info")
    omnibus_cerefs, intro_cerefs = fetch_ba_va_cerefs(session)
    
    for ceref in sorted(companies_dict.keys()):
        entry = companies_dict[ceref]
        item = entry.get('item') or {}
        address_info = item.get('address') or {}
        
        name_chi = clean_unicode_nulls(item.get('nameChi', ''))
        name_chi_simp = zhconv.convert(name_chi, 'zh-cn') if name_chi else ""
        
        # Determine the company details URL
        is_ri = item.get('isRi') == True
        entity_type = "ri" if is_ri else "corp"
        details_link = f"https://apps.sfc.hk/publicregWeb/{entity_type}/{ceref}/details"
        
        details = companies_details.get(ceref) or {
            '受规管活动': '',
            '一号牌（证券交易）拿牌时间': '',
            '九号牌（资产管理）拿牌时间': '',
            '虚拟资产服务字段': '',
            '营业地址': '',
            '电邮地址': '',
            '网站地址': '',
            '前称记录中文': '',
            '前称记录英文': '',
            '证券期货 SFO-条件': '',
            '打击洗钱 SFO-条件': '',
            '持牌人不得持有客戶資產状态': 'No'
        }
        
        # Compile Virtual Asset Services field
        va_services = []
        raw_vasp = details.get('虚拟资产服务字段', '')
        if '经营虚拟资产交易平台' in raw_vasp or '經營虛擬資產交易平台' in raw_vasp:
            va_services.append('经营虚拟资产交易平台')
        elif raw_vasp:
            va_services.append(raw_vasp)
            
        if ceref in omnibus_cerefs:
            if '综合账户提供虚拟资产交易服务' not in va_services:
                va_services.append('综合账户提供虚拟资产交易服务')
                
        if ceref in intro_cerefs:
            if '介绍代理人提供虚拟资产交易服务' not in va_services:
                va_services.append('介绍代理人提供虚拟资产交易服务')
                
        va_services_str = ", ".join(va_services)
        
        # Format matching RAs list, e.g. "类别 1, 类别 4"
        sorted_matched_ras = sorted(list(entry['matched_ras']), key=lambda x: int(x) if x.isdigit() else 99)
        ras_str = ", ".join([f"类别 {r}" for r in sorted_matched_ras])
        
        rows.append({
            '中央编号 (CEREF)': ceref,
            '英文名称': item.get('name', ''),
            '中文名称': name_chi,
            '简体中文名称': name_chi_simp,
            '公司详情网页 Link': details_link,  # Placed right after 简体中文名称
            '活跃牌照': item.get('hasActiveLicence', ''),
            '是否银行系券商': is_bank_broker(item),
            '持有的牌照类别 (匹配条件内)': ras_str,
            
            # New condition fields
            '证券期货 SFO-条件': details.get('证券期货 SFO-条件', ''),
            '打击洗钱 SFO-条件': details.get('打击洗钱 SFO-条件', ''),
            '持牌人不得持有客戶資產状态': details.get('持牌人不得持有客戶資產状态', 'No'),
            
            '英文地址': address_info.get('fullAddress', ''),
            '中文地址': address_info.get('fullAddressChin', ''),
            
            # New detail fields
            '受规管活动': details.get('受规管活动', ''),
            '一号牌（证券交易）拿牌时间': details.get('一号牌（证券交易）拿牌时间', ''),
            '九号牌（资产管理）拿牌时间': details.get('九号牌（资产管理）拿牌时间', ''),
            '虚拟资产服务字段': va_services_str,
            '营业地址': details.get('营业地址', ''),
            '电邮地址': details.get('电邮地址', ''),
            '网站地址': details.get('网站地址', ''),
            '前称记录中文': details.get('前称记录中文', ''),
            '前称记录英文': details.get('前称记录英文', ''),
            
            '抓取时间': current_time
        })
        
    # Clean illegal characters for openpyxl
    import re
    # Regular expression for characters not allowed in XML/Excel
    ILLEGAL_CHARACTERS_RE = re.compile(r'[\000-\010]|[\013-\014]|[\016-\037]')
    
    def clean_cell(val):
        if isinstance(val, str):
            return ILLEGAL_CHARACTERS_RE.sub('', val)
        return val
        
    df = pd.DataFrame(rows)
    if hasattr(df, 'map'):
        df = df.map(clean_cell)
    else:
        df = df.applymap(clean_cell)
    
    # Ensure local directory exists
    current_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(current_dir, 'data')
    os.makedirs(data_dir, exist_ok=True)
    
    # Generate timestamped file name
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(data_dir, f"SFC_持牌公司名单_{timestamp}.xlsx")
    
    # Save to Excel
    progress_callback(f"正在保存数据到 Excel 文件 '{filename}'...", "info")
    df.to_excel(filename, index=False, engine='openpyxl')
    progress_callback(f"抓取已完成，数据已成功本地化存储，共 {len(df)} 条去重记录并提取全部详情！", "success")
    
    return filename

if __name__ == '__main__':
    # Quick simple run
    scrape_sfc_data(licstatus='active', role_type='corporation', ratypes=['1', '101'], name_start_letters=['Z'])
