document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const searchAllCheckbox = document.getElementById('search-all-letters');
    const singleLetterContainer = document.getElementById('single-letter-container');
    const singleLetterSelect = document.getElementById('single-letter-select');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const progressBar = document.getElementById('progress-bar');
    const statusBadge = document.getElementById('task-status-badge');
    const statusText = document.getElementById('task-status-text');
    const logConsole = document.getElementById('log-console');
    const filesTbody = document.getElementById('files-tbody');
    const threadCountSlider = document.getElementById('thread-count-slider');
    const threadCountDisplay = document.getElementById('thread-count-display');
    const listThreadCountSlider = document.getElementById('list-thread-count-slider');
    const listThreadCountDisplay = document.getElementById('list-thread-count-display');

    let eventSource = null;
    let totalLettersToSearch = 36; // A-Z (26) + 0-9 (10)

    // --- Custom Checkbox Pill Class Toggle ---
    document.querySelectorAll('input[name="ratypes"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const label = e.target.closest('.checkbox-label-pill');
            if (label) {
                if (e.target.checked) {
                    label.classList.add('checked');
                } else {
                    label.classList.remove('checked');
                }
            }
        });
    });

    // --- Hide/Show Single Letter Selector ---
    searchAllCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            singleLetterContainer.classList.add('hidden');
        } else {
            singleLetterContainer.classList.remove('hidden');
        }
    });

    // --- Load Excel Files ---
    function loadFileList() {
        fetch('/api/files')
            .then(res => res.json())
            .then(files => {
                if (files.length === 0) {
                    filesTbody.innerHTML = `
                        <tr>
                            <td colspan="4" class="no-data">暂无已生成的 Excel 文件</td>
                        </tr>
                    `;
                    return;
                }

                filesTbody.innerHTML = files.map(file => `
                    <tr>
                        <td>${file.name}</td>
                        <td>${file.size}</td>
                        <td>${file.ctime}</td>
                        <td>
                            <a href="/api/download/${file.name}" class="btn-table btn-download">下载</a>
                            <button class="btn-table btn-delete" data-filename="${file.name}">删除</button>
                        </td>
                    </tr>
                `).join('');

                // Re-bind delete buttons
                document.querySelectorAll('.btn-delete').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const filename = e.target.getAttribute('data-filename');
                        if (confirm(`确定要删除文件 ${filename} 吗？`)) {
                            deleteFile(filename);
                        }
                    });
                });
            })
            .catch(err => {
                console.error("加载文件列表失败:", err);
                addLogLine("加载本地 Excel 文件列表失败", "error");
            });
    }

    // --- Delete File ---
    function deleteFile(filename) {
        fetch(`/api/delete/${filename}`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    addLogLine(`文件 ${filename} 删除成功`, "info");
                    loadFileList();
                } else {
                    addLogLine(`删除失败: ${data.message}`, "error");
                }
            })
            .catch(err => {
                addLogLine(`删除出错: ${err}`, "error");
            });
    }

    // --- Console Logger Helpers ---
    function addLogLine(text, level = "info") {
        const line = document.createElement('div');
        line.classList.add('log-line', `${level}-line`);
        line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        logConsole.appendChild(line);
        logConsole.scrollTop = logConsole.scrollHeight;
    }

    // --- SSE Progress Stream ---
    function startProgressStream() {
        if (eventSource) {
            eventSource.close();
        }

        addLogLine("连接数据流通道中...", "system");
        eventSource = new EventSource('/api/progress');

        eventSource.onmessage = (event) => {
            const dataStr = event.data;
            const sepIndex = dataStr.indexOf('|');
            if (sepIndex === -1) return;

            const message = dataStr.slice(0, sepIndex).trim();
            const level = dataStr.slice(sepIndex + 1).trim();

            // Print log line
            addLogLine(message, level);

            // Parse progress percentage if available in the log
            // Format example: "[5/36] 正在查询首字母..."
            const progressMatch = message.match(/^\[(\d+)\/(\d+)\]/);
            const detailMatch = message.match(/^\[详情抓取\s+(\d+)\/(\d+)\]/);
            
            if (progressMatch) {
                const current = parseInt(progressMatch[1], 10);
                const total = parseInt(progressMatch[2], 10);
                const percent = Math.min(50, Math.round((current / total) * 50));
                progressBar.style.width = `${percent}%`;
                statusText.textContent = `获取名单进度: ${current}/${total} (已完成 ${percent}%)`;
            } else if (detailMatch) {
                const current = parseInt(detailMatch[1], 10);
                const total = parseInt(detailMatch[2], 10);
                const percent = Math.min(100, 50 + Math.round((current / total) * 50));
                progressBar.style.width = `${percent}%`;
                statusText.textContent = `获取详情进度: ${current}/${total} (已完成 ${percent}%)`;
            }

            // If success message comes through, finish up
            if (level === 'success') {
                finishTask(true, "抓取成功！数据已妥善保存。");
            } else if (level === 'warning' && (message.includes("停止") || message.includes("终止") || message.includes("中断"))) {
                finishTask(false, message, true);
            } else if (level === 'error') {
                finishTask(false, "抓取失败！查看控制台日志了解详情。");
            }
        };

        eventSource.onerror = (err) => {
            console.error("SSE Connection Error:", err);
            // We only show error if the task is still running
            fetch('/api/status')
                .then(res => res.json())
                .then(status => {
                    if (status.isRunning) {
                        addLogLine("进度通道链接丢失，正在尝试重连...", "warning");
                    }
                });
        };
    }

    function finishTask(success, message, isWarning = false) {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }

        btnStart.disabled = false;
        btnStop.disabled = true;
        progressBar.style.width = success ? "100%" : progressBar.style.width;
        
        statusBadge.className = 'status-badge';
        if (isWarning) {
            statusBadge.classList.add('warning');
            statusBadge.textContent = '已停止';
        } else if (success) {
            statusBadge.classList.add('success');
            statusBadge.textContent = '完成';
        } else {
            statusBadge.classList.add('error');
            statusBadge.textContent = '失败';
        }
        
        statusText.textContent = message;
        
        loadFileList();
    }

    // --- Check Current Task Status on load ---
    function checkCurrentTaskStatus() {
        fetch('/api/status')
            .then(res => res.json())
            .then(status => {
                if (status.isRunning) {
                    btnStart.disabled = true;
                    btnStop.disabled = false;
                    statusBadge.className = 'status-badge running';
                    statusBadge.textContent = '运行中';
                    statusText.textContent = '有抓取任务正在进行中...';
                    
                    // Reconnect to stream
                    startProgressStream();
                } else {
                    btnStart.disabled = false;
                    btnStop.disabled = true;
                    statusBadge.className = 'status-badge';
                    statusBadge.textContent = '空闲';
                    statusText.textContent = '就绪，等待启动...';
                }
            })
            .catch(err => {
                console.error("无法获取系统状态:", err);
            });
    }

    // --- Project Local & LocalStorage Parameter Persistence ---
    let saveTimeout = null;
    function saveParams() {
        const licstatus = document.querySelector('input[name="licstatus"]:checked')?.value || 'active';
        const roleType = document.querySelector('input[name="roleType"]:checked')?.value || 'corporation';
        const ratypes = Array.from(document.querySelectorAll('input[name="ratypes"]:checked')).map(el => el.value);
        const searchAll = searchAllCheckbox.checked;
        const singleLetter = singleLetterSelect.value;
        const threadCount = parseInt(threadCountSlider.value, 10);
        const listThreadCount = parseInt(listThreadCountSlider.value, 10);
        
        const params = { licstatus, roleType, ratypes, searchAll, singleLetter, threadCount, listThreadCount };
        
        // Save to browser localStorage as fallback
        localStorage.setItem('sfc_scraper_params', JSON.stringify(params));
        
        // Debounce POST request to /api/config
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            }).catch(err => console.error("保存本地项目配置失败:", err));
        }, 300);
    }

    function applyParamsToUI(params) {
        if (!params) return;
        
        if (params.licstatus) {
            const radio = document.querySelector(`input[name="licstatus"][value="${params.licstatus}"]`);
            if (radio) radio.checked = true;
        }
        if (params.roleType) {
            const radio = document.querySelector(`input[name="roleType"][value="${params.roleType}"]`);
            if (radio) radio.checked = true;
        }
        if (params.ratypes && Array.isArray(params.ratypes)) {
            document.querySelectorAll('input[name="ratypes"]').forEach(cb => {
                cb.checked = params.ratypes.includes(cb.value);
                const label = cb.closest('.checkbox-label-pill');
                if (label) {
                    if (cb.checked) {
                        label.classList.add('checked');
                    } else {
                        label.classList.remove('checked');
                    }
                }
            });
        }
        if (params.hasOwnProperty('searchAll')) {
            searchAllCheckbox.checked = params.searchAll;
            if (params.searchAll) {
                singleLetterContainer.classList.add('hidden');
            } else {
                singleLetterContainer.classList.remove('hidden');
            }
        }
        if (params.singleLetter) {
            singleLetterSelect.value = params.singleLetter;
        }
        if (params.threadCount) {
            threadCountSlider.value = params.threadCount;
            threadCountDisplay.textContent = params.threadCount;
        }
        if (params.listThreadCount) {
            listThreadCountSlider.value = params.listThreadCount;
            listThreadCountDisplay.textContent = params.listThreadCount;
        }
    }

    function loadParams() {
        // Fetch config from server (project root config.json)
        fetch('/api/config')
            .then(res => res.json())
            .then(config => {
                applyParamsToUI(config);
            })
            .catch(err => {
                console.warn("未获取到项目本地配置，使用浏览器缓存加载:", err);
                try {
                    const data = localStorage.getItem('sfc_scraper_params');
                    if (data) {
                        applyParamsToUI(JSON.parse(data));
                    }
                } catch (e) {
                    console.error("加载本地存储参数失败:", e);
                }
            });
    }

    // --- Bind Parameter Change Listeners ---
    threadCountSlider.addEventListener('input', (e) => {
        threadCountDisplay.textContent = e.target.value;
        saveParams();
    });

    listThreadCountSlider.addEventListener('input', (e) => {
        listThreadCountDisplay.textContent = e.target.value;
        saveParams();
    });

    document.querySelectorAll('input[name="licstatus"], input[name="roleType"], input[name="ratypes"], #search-all-letters, #single-letter-select').forEach(input => {
        input.addEventListener('change', saveParams);
    });

    // --- Start Scraping Handler ---
    btnStart.addEventListener('click', () => {
        const licstatus = document.querySelector('input[name="licstatus"]:checked').value;
        const roleType = document.querySelector('input[name="roleType"]:checked').value;
        
        // Collect all checked RA types
        const ratypes = Array.from(document.querySelectorAll('input[name="ratypes"]:checked')).map(el => el.value);
        if (ratypes.length === 0) {
            alert("请至少选择一种牌照类别！");
            return;
        }
        
        const isAll = searchAllCheckbox.checked;
        const threadCount = parseInt(threadCountSlider.value, 10);
        const listThreadCount = parseInt(listThreadCountSlider.value, 10);

        const requestData = {
            licstatus,
            roleType,
            ratypes,
            searchType: isAll ? 'all' : 'single',
            singleLetter: singleLetterSelect.value,
            threadCount: threadCount,
            listThreadCount: listThreadCount
        };

        // Save current parameters
        saveParams();

        // Reset UI
        progressBar.style.width = "0%";
        logConsole.innerHTML = "";
        btnStart.disabled = true;
        btnStop.disabled = false;
        statusBadge.className = 'status-badge running';
        statusBadge.textContent = '运行中';
        statusText.textContent = '抓取已开始，正在初始化...';

        addLogLine(`发起请求，查询条件: 牌照状况=${licstatus}, 类别=${roleType}, 牌照类型数=${ratypes.length}, 名单并发=${listThreadCount}, 详情并发=${threadCount}, 范围=${isAll ? '全部首字母' : '首字母 ' + requestData.singleLetter}`, "system");

        fetch('/api/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                addLogLine(data.message, "system");
                startProgressStream();
            } else {
                finishTask(false, data.message);
            }
        })
        .catch(err => {
            finishTask(false, `启动失败: ${err}`);
        });
    });

    // --- Stop Scraping Handler ---
    btnStop.addEventListener('click', () => {
        btnStop.disabled = true;
        addLogLine("正在发送停止请求...", "warning");
        fetch('/api/stop', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    addLogLine(data.message, "warning");
                } else {
                    addLogLine(`停止出错: ${data.message}`, "error");
                    btnStop.disabled = false;
                }
            })
            .catch(err => {
                addLogLine(`停止请求失败: ${err}`, "error");
                btnStop.disabled = false;
            });
    });

    // --- Init ---
    loadParams();
    loadFileList();
    checkCurrentTaskStatus();
});
