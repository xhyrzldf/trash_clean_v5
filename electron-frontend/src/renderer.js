/* =======================
   1) BEGIN: 全局扫描状态
======================= */

// ============ [新增] ============
// 专门存每个 itemName 的详情数据和选中状态
// 比如 detailDataMap['cache_files'] = { headers: [...], categories: [...], files: [...] }
const detailDataMap = {};

// 当前查看的模块
let currentDetailItemName = '';

// 用于记住“垃圾清理”扫描结果
const globalCleanState = {
    scanned: false,    // 是否已扫描过？
    totalSize: 0       // 扫描到的总大小
};

// 用于记住“大文件检索”扫描结果
const globalBigfilesState = {
    scanned: false,
    scannedDirs: 0,
    scannedFiles: 0,
    foundBigFiles: 0,
    fileList: []
};

/* =======================
   1) END: 全局扫描状态
======================= */

// ① 引入 ipcRenderer
const {ipcRenderer} = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    // 初始化首页评分显示
    const initialScore = 100; // 或从后端获取实际初始分数
    updateScoreDisplay(initialScore, 'homeScoreContainer');
    updateScoreDisplay(initialScore, 'cleanScoreContainer');

    // 打开弹窗，并可传入标题和内容
    function openModal(title, content) {
        document.querySelector('#myModal .custom-modal-header').textContent = title || '提示';
        document.querySelector('#myModal .custom-modal-body').textContent = content || '';
        // 让遮罩层显示
        document.getElementById('myModal').style.display = 'flex';
    }

    function closeModal() {
        document.getElementById('myModal').style.display = 'none';
    }

    function confirmModal() {
        // do something
        closeModal();
    }

    // 如果需要让这三个函数在其他模块中调用，可以挂在 window 上
    window.openModal = openModal;
    window.closeModal = closeModal;
    window.confirmModal = confirmModal;

    const minimizeBtn = document.getElementById("minimizeBtn");
    const closeBtn = document.getElementById("closeBtn");

    // 首页默认评分显示
    loadLastCleanInfo();

    // 调用加载上次清理信息接口（考虑第一次执行时没有记录）
    loadLastCleanInfo();

    if (minimizeBtn) {
        minimizeBtn.addEventListener("click", () => {
            // 发送给 main 进程
            ipcRenderer.send('minimize-window');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            ipcRenderer.send('close-window');
        });
    }

    // 全面清理的全局状态，避免切页后丢失
    window.fullCleanState = {
        scanning: false,       // 是否正在扫描
        completed: false,      // 是否已完成
        // 存储扫描结果
        cacheSize: 0,
        logSize: 0,
        tempSize: 0,
        appSize: 0,
        foundBigFiles: 0,
        memoryOptimizeVal: 0
    };

    const sidebarLinks = document.querySelectorAll('.sidebar-item a');

    // 页面块（新增：首页相关）
    const homePage = document.getElementById('homePage');
    const homeCleanPage = document.getElementById('homeCleanPage');

    // 已有页面块
    const cleanPage = document.getElementById('cleanPage');
    const memoryAccelerationPage = document.getElementById('memoryAccelerationPage');
    const bigfilesPage = document.getElementById('bigfilesPage');
    const cleanDetailPage = document.getElementById('cleanDetailPage');
    const processDetailPage = document.getElementById('processDetailPage');
    const bigfilesDetailPage = document.getElementById('bigfilesDetailPage');

    // 垃圾清理页面按钮
    const restartScanBtn = document.getElementById('restartScanBtn');
    const cleanScanProgress = document.getElementById('cleanScanProgress');
    const cleanCurrentPath = document.getElementById('cleanCurrentPath');
    const cleanProgressBar = document.getElementById('cleanProgressBar');
    // 垃圾清理卡片
    const totalSizeInfo = document.getElementById('totalSize');
    const cacheSizeInfo = document.getElementById('cacheSizeInfo');
    const logSizeInfo = document.getElementById('logSizeInfo');
    const tempSizeInfo = document.getElementById('tempSizeInfo');
    const otherSizeInfo = document.getElementById('otherSizeInfo');

    // 内存加速页面
    const viewProcessBtn = document.getElementById('viewProcessBtn');
    const optimizeBtn = document.getElementById('optimizeBtn');
    let memoryInterval = null; // 用于自动刷新监控数据的定时器

    // CPU/内存/网络/磁盘 监控显示
    const cpuUserPercentEl = document.getElementById('cpuUserPercent');
    const cpuSystemPercentEl = document.getElementById('cpuSystemPercent');
    const cpuIdlePercentEl = document.getElementById('cpuIdlePercent');
    const pressurePercentEl = document.getElementById('pressurePercent');
    const usedMemoryEl = document.getElementById('usedMemory');
    const totalMemoryEl = document.getElementById('totalMemory');
    const memoryProgressBar = document.getElementById('memoryProgress');
    const uploadSpeedEl = document.getElementById('uploadSpeed');
    const downloadSpeedEl = document.getElementById('downloadSpeed');
    const diskReadEl = document.getElementById('diskRead');
    const diskWriteEl = document.getElementById('diskWrite');

    // 大文件检索页面
    const startBigfilesScanBtn = document.getElementById('startBigfilesScanBtn');
    const bigfilesProgressSection = document.getElementById('bigfilesProgressSection');
    const bigfilesProgressBar = document.getElementById('bigfilesProgressBar');
    const scannedDirsEl = document.getElementById('scannedDirs');
    const scannedFilesEl = document.getElementById('scannedFiles');
    const foundBigFilesEl = document.getElementById('foundBigFiles');
    const scanCompleteMsg = document.getElementById('scanCompleteMsg');
    const scanCompleteInfo = document.getElementById('scanCompleteInfo');
    const bigfilesTitle = document.getElementById('bigfilesTitle');
    const currentScanningPath = document.getElementById('currentScanningPath');
    const checkBigFilesBtn = document.getElementById('checkBigFilesBtn');

    // 大文件详情相关 DOM
    const bigfilesDetailBackBtn = document.getElementById('bigfilesDetailBackBtn');
    const bigfilesDetailTitle = document.getElementById('bigfilesDetailTitle');
    const bigfilesDetailSearchInput = document.getElementById('bigfilesDetailSearchInput');
    const bigfilesDetailSearchBtn = document.getElementById('bigfilesDetailSearchBtn');
    const bigfilesDetailCategoryTitle = document.getElementById('bigfilesDetailCategoryTitle');
    const bigfilesDetailTableHead = document.getElementById('bigfilesDetailTableHead');
    const bigfilesDetailTableBody = document.getElementById('bigfilesDetailTableBody');
    const bigfilesDetailSelectedInfo = document.getElementById('bigfilesDetailSelectedInfo');
    const bigfilesDeleteSelectedBtn = document.getElementById('bigfilesDeleteSelectedBtn');

    // 存储大文件列表
    let globalBigFilesData = [];

    // 详情页 相关 DOM
    const detailBackBtn = document.getElementById('detailBackBtn');
    const detailTitle = document.getElementById('detailTitle');
    const detailCategoryTabs = document.getElementById('detailCategoryTabs');
    const detailCategoryTitle = document.getElementById('detailCategoryTitle');
    const detailTableHead = document.getElementById('detailTableHead');
    const detailTableBody = document.getElementById('detailTableBody');
    // 搜索/删除/统计
    const detailSearchInput = document.getElementById('detailSearchInput');
    const detailSearchBtn = document.getElementById('detailSearchBtn');
    const detailSelectedInfo = document.getElementById('detailSelectedInfo');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

    // 当前选中的分类
    let currentCategoryFilter = '';
    // 当前搜索关键字
    let searchKeyword = '';
    // 大小列排序方向：'asc' or 'desc'
    let sizeSortOrder = 'desc';

    /**
     * 显示垃圾清理详情页（支持跨页面记忆）
     * @param {string} itemName 后端接口对应项，如 'cache_files'、'log_files' 等
     * @param {string} fromPage 来源页面标识，如 'clean' 或 'homeClean'
     */
    function showCleanDetailPage(itemName, fromPage = 'clean') {
        previousPage = fromPage;
        currentDetailItemName = itemName;

        // 重置一些UI
        searchKeyword = '';
        sizeSortOrder = 'asc';
        if (detailSearchInput) {
            detailSearchInput.value = '';
        }
        detailTitle.textContent = '加载中...';
        detailTableHead.innerHTML = '';
        detailTableBody.innerHTML = '';
        detailCategoryTabs.innerHTML = '';
        detailSelectedInfo.textContent = '已选中 0 项，总大小 0 B';

        // 如果从首页进入，则隐藏右下角删除按钮
        if (fromPage === 'homeClean') {
            deleteSelectedBtn.style.display = 'none';
        } else {
            deleteSelectedBtn.style.display = 'block';
        }

        // 先检查 detailDataMap 里是否有数据
        if (!detailDataMap[itemName]) {
            // 没有则请求接口
            fetch(`http://localhost:53421/item_details?item_name=${itemName}`)
                .then(res => res.json())
                .then(data => {
                    // 新建数据结构
                    detailDataMap[itemName] = {
                        headers: data.headers || [],
                        categories: data.categories || [],
                        files: []
                    };
                    // 默认全选后端返回的 files
                    const newFiles = data.files || [];
                    newFiles.forEach(file => file.selected = true);

                    detailDataMap[itemName].files = newFiles;

                    // 渲染详情
                    renderCleanDetailPage(itemName);
                })
                .catch(err => {
                    console.error('获取详情出错:', err);
                    detailTitle.textContent = '加载失败';
                });
        } else {
            // 如果已有数据(说明看过这个模块了)，直接渲染
            renderCleanDetailPage(itemName);
        }

        // 切换页面可见
        cleanPage.style.display = 'none';
        memoryAccelerationPage.style.display = 'none';
        bigfilesPage.style.display = 'none';
        homePage.style.display = 'none';
        homeCleanPage.style.display = 'none';
        cleanDetailPage.style.display = 'block';
    }

    // 记录进入详情页前的页面标识，比如 'clean'、'homeClean' 或其他
    let previousPage = '';

    /**
     * 加载后端保存的上次清理信息，并更新首页系统信息显示
     */
    function loadLastCleanInfo() {
        fetch('http://localhost:53421/last_clean_info')
            .then(res => res.json())
            .then(data => {
                const infoLines = document.querySelectorAll('.system-info .info-line');
                // 第1行显示上次清理时间
                if (data.last_clean_time) {
                    infoLines[0].textContent = "上次清理时间: " + data.last_clean_time;
                } else {
                    infoLines[0].textContent = "上次清理时间: 无记录";
                }
                // 第2行显示累计清理大小
                if (data.cumulative_clean_size) {
                    infoLines[1].textContent = "累计清理大小: " + formatBytes(data.cumulative_clean_size);
                } else {
                    infoLines[1].textContent = "累计清理大小: 0 B";
                }
            })
            .catch(err => {
                console.error("获取清理记录失败:", err);
            });
    }

    /**
     * 渲染详情页(分类tabs + 文件列表)
     */
    function renderCleanDetailPage(itemName) {
        const detailData = detailDataMap[itemName];
        if (!detailData) {
            console.error("renderCleanDetailPage: detailData 不存在:", itemName);
            return;
        }

        // 设置页面标题
        let humanTitle = '';
        switch (itemName) {
            case 'cache_files':
                humanTitle = '缓存文件详情';
                break;
            case 'log_files':
                humanTitle = '日志文件详情';
                break;
            case 'temp_files':
                humanTitle = '临时文件详情';
                break;
            case 'app_files':
                humanTitle = '应用文件详情';
                break;
            default:
                humanTitle = '文件详情';
                break;
        }
        detailTitle.textContent = humanTitle;

        // 渲染分类 Tabs
        detailCategoryTabs.innerHTML = '';
        if (detailData.categories && detailData.categories.length > 0) {
            // 这里假设 detailData.categories[0] 里有 items
            const catItems = detailData.categories[0].items || [];
            catItems.forEach((catObj, idx) => {
                const li = document.createElement('li');
                li.className = 'nav-item';

                const a = document.createElement('a');
                a.className = 'nav-link';
                a.href = 'javascript:void(0)';
                // 例如 "缓存文件 (1.17GB)"
                a.textContent = `${catObj.name} (${catObj.size})`;
                if (idx === 0) {
                    a.classList.add('active');
                    currentCategoryFilter = catObj.name;
                }

                a.onclick = () => {
                    document.querySelectorAll('#detailCategoryTabs .nav-link')
                        .forEach(x => x.classList.remove('active'));
                    a.classList.add('active');
                    currentCategoryFilter = catObj.name;
                    renderDetailFilesForCategory(itemName, catObj.name);
                };

                li.appendChild(a);
                detailCategoryTabs.appendChild(li);
            });

            // 默认渲染第一个分类
            if (catItems.length > 0) {
                renderDetailFilesForCategory(itemName, catItems[0].name);
            }
        } else {
            detailCategoryTabs.innerHTML = '<li class="nav-item"><a class="nav-link active">暂无分类</a></li>';
        }
    }

    /**
     * 渲染指定分类的文件列表
     * @param {string} itemName - 比如 'cache_files'
     * @param {string} catName - 比如 '系统日志'
     */
    function renderDetailFilesForCategory(itemName, catName) {
        const detailData = detailDataMap[itemName];
        if (!detailData) return;

        let files = detailData.files || [];
        // 先按分类名过滤
        files = files.filter(f => f.category_name === catName);
        // 搜索关键字过滤
        if (searchKeyword) {
            const kw = searchKeyword.toLowerCase();
            files = files.filter(f => {
                const fileNameMatch = f.file_name.toLowerCase().includes(kw);
                const pathMatch = f.path.toLowerCase().includes(kw);
                return (fileNameMatch || pathMatch);
            });
        }
        // 排序
        if (sizeSortOrder === 'asc') {
            files.sort((a, b) => a.size - b.size);
        } else {
            files.sort((a, b) => b.size - a.size);
        }

        detailTableHead.innerHTML = '';
        detailTableBody.innerHTML = '';

        const thCheckbox = document.createElement('th');
        thCheckbox.innerHTML = `<input type="checkbox" id="selectAllBox" />`;
        detailTableHead.appendChild(thCheckbox);

        const thFilename = document.createElement('th');
        thFilename.textContent = '文件名称';
        detailTableHead.appendChild(thFilename);

        const thPath = document.createElement('th');
        thPath.textContent = '文件位置';
        detailTableHead.appendChild(thPath);

        const thSize = document.createElement('th');
        thSize.innerHTML = `大小 <span id="sizeSortIcon">${sizeSortOrder === 'asc' ? '▲' : '▼'}</span>`;
        thSize.style.cursor = 'pointer';
        thSize.onclick = () => toggleSizeSortOrder(itemName, catName);
        detailTableHead.appendChild(thSize);

        const thMtime = document.createElement('th');
        thMtime.textContent = '修改时间';
        detailTableHead.appendChild(thMtime);

        // 渲染行
        files.forEach(fileObj => {
            const tr = document.createElement('tr');

            const tdBox = document.createElement('td');
            tdBox.innerHTML = `<input type="checkbox" class="file-check" ${fileObj.selected ? 'checked' : ''} />`;
            const inputEl = tdBox.querySelector('input');
            inputEl.dataset.filePath = `${fileObj.path}/${fileObj.file_name}`;
            inputEl.dataset.fileSize = fileObj.size;

            inputEl.addEventListener('change', function () {
                fileObj.selected = this.checked;
                updateSelectedInfo(itemName);
            });
            tr.appendChild(tdBox);

            const tdFilename = document.createElement('td');
            tdFilename.textContent = fileObj.file_name || '—';
            tr.appendChild(tdFilename);

            const tdPath = document.createElement('td');
            tdPath.textContent = fileObj.path || '—';
            tr.appendChild(tdPath);

            const tdSizeVal = document.createElement('td');
            tdSizeVal.textContent = fileObj.readable_size || formatBytes(fileObj.size);
            tr.appendChild(tdSizeVal);

            const tdMtimeVal = document.createElement('td');
            tdMtimeVal.textContent = fileObj.mtime || '—';
            tr.appendChild(tdMtimeVal);

            detailTableBody.appendChild(tr);
        });

        // 全选
        const selectAllBox = document.getElementById('selectAllBox');
        if (selectAllBox) {
            selectAllBox.checked = files.length > 0 && files.every(f => f.selected);
            selectAllBox.onchange = () => {
                const checked = selectAllBox.checked;
                files.forEach(f => f.selected = checked);
                detailTableBody.querySelectorAll('.file-check').forEach(chk => {
                    chk.checked = checked;
                });
                updateSelectedInfo(itemName);
            };
        }

        updateSelectedInfo(itemName);
    }

    /**
     * 切换大小排序
     */
    function toggleSizeSortOrder(itemName, catName) {
        sizeSortOrder = (sizeSortOrder === 'asc') ? 'desc' : 'asc';
        renderDetailFilesForCategory(itemName, catName);
    }

    /**
     * 更新详情页右下角的“已选中”状态
     */
    function updateSelectedInfo(itemName) {
        const detailData = detailDataMap[itemName];
        if (!detailData || !detailData.files) {
            detailSelectedInfo.textContent = `已选中 0 项，总大小 0 B`;
            return;
        }

        let count = 0;
        let totalBytes = 0;
        detailData.files.forEach(file => {
            if (file.selected) {
                count++;
                totalBytes += file.size;
            }
        });
        detailSelectedInfo.textContent = `已选中 ${count} 项，总大小 ${formatBytes(totalBytes)}`;
    }

    /**
     * 更新首页 / 全面清理页 对应模块的“已选择大小”
     */
    function updateModuleSelectedSize(itemName) {
        let totalSelectedSize = 0;
        // 如果全局保存了该模块的选中大小，则直接使用
        if (window.savedModuleSelectedSizes && window.savedModuleSelectedSizes[itemName] != null) {
            totalSelectedSize = window.savedModuleSelectedSizes[itemName];
        } else if (detailDataMap[itemName] && detailDataMap[itemName].files) {
            // 如果用户曾进入过详情，则按照详情中各文件的 selected 属性计算
            detailDataMap[itemName].files.forEach(f => {
                if (f.selected) {
                    totalSelectedSize += f.size;
                }
            });
        } else {
            // 如果详情数据不存在，则回退到扫描时记录的全选大小
            switch (itemName) {
                case 'cache_files':
                    totalSelectedSize = window.fullCleanState.cacheSize;
                    break;
                case 'log_files':
                    totalSelectedSize = window.fullCleanState.logSize;
                    break;
                case 'temp_files':
                    totalSelectedSize = window.fullCleanState.tempSize;
                    break;
                case 'app_files':
                    totalSelectedSize = window.fullCleanState.appSize;
                    break;
            }
        }

        // 根据不同模块更新对应的DOM显示
        if (itemName === 'cache_files') {
            document.getElementById('homeCacheSize').textContent =
                '已选择 ' + formatBytes(totalSelectedSize);
        } else if (itemName === 'log_files') {
            document.getElementById('homeLogSize').textContent =
                '已选择 ' + formatBytes(totalSelectedSize);
        } else if (itemName === 'temp_files') {
            document.getElementById('homeTempSize').textContent =
                '已选择 ' + formatBytes(totalSelectedSize);
        } else if (itemName === 'app_files') {
            document.getElementById('homeAppSize').textContent =
                '已选择 ' + formatBytes(totalSelectedSize);
        }
    }

    // 点击“删除已选”按钮
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async () => {
            const checkedRows = detailTableBody.querySelectorAll('.file-check:checked');
            if (!checkedRows.length) {
                alert('请先勾选要删除的文件！');
                return;
            }

            for (let chk of checkedRows) {
                const filePath = chk.dataset.filePath;
                try {
                    const res = await fetch('http://localhost:53421/delete_file', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({path: filePath})
                    });
                    const data = await res.json();
                    if (!data.success) {
                        console.error(`删除失败: ${filePath}`, data.error);
                    }
                } catch (e) {
                    console.error('删除出错：', filePath, e);
                }
            }

            alert('删除操作完成');
            // 重新加载本模块详情
            showCleanDetailPage(currentDetailItemName, previousPage);
        });
    }

    // 点击“搜索”按钮
    if (detailSearchBtn) {
        detailSearchBtn.addEventListener('click', () => {
            searchKeyword = detailSearchInput.value.trim();
            // 再次渲染当前分类
            renderDetailFilesForCategory(currentDetailItemName, currentCategoryFilter);
        });
    }

    // 详情页返回按钮事件
    detailBackBtn.addEventListener('click', () => {
        // 计算当前模块已选中文件的总大小
        let selectedSize = 0;
        if (detailDataMap[currentDetailItemName] && detailDataMap[currentDetailItemName].files) {
            detailDataMap[currentDetailItemName].files.forEach(file => {
                if (file.selected) {
                    selectedSize += file.size;
                }
            });
        }
        // 将计算得到的已选大小保存到全局变量中
        window.savedModuleSelectedSizes = window.savedModuleSelectedSizes || {};
        window.savedModuleSelectedSizes[currentDetailItemName] = selectedSize;

        // 更新“全面清理”界面中该模块的大小
        updateModuleSelectedSize(currentDetailItemName);
        // 隐藏详情页，回到上一个页面
        cleanDetailPage.style.display = 'none';
        showPage(previousPage);
    });

    // 对应其它页面（垃圾清理卡片）的“检查”按钮
    const detailCheckBtns = document.querySelectorAll('.detail-check-btn');
    detailCheckBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.dataset.item;
            showCleanDetailPage(item, 'clean');
        });
    });

    // 绑定"清理所有"按钮点击事件
    const cleanAllBtn = document.getElementById('cleanAllBtn');
    if (cleanAllBtn) {
        // 修改cleanAllBtn的点击事件处理函数
        cleanAllBtn.addEventListener('click', async () => {
            // 收集所有选中的文件并计算总大小
            const selectedFiles = {
                garbage_files: [],
                big_files: []
            };

            let totalSize = 0;

            // 处理垃圾清理模块
            ['cache_files', 'log_files', 'temp_files', 'app_files'].forEach(module => {
                if (detailDataMap[module] && detailDataMap[module].files) {
                    detailDataMap[module].files.forEach(file => {
                        if (file.selected) {
                            totalSize += file.size;
                            selectedFiles.garbage_files.push({
                                path: `${file.path}/${file.file_name}`,
                                size: file.size,
                                type: module
                            });
                        }
                    });
                }
            });

            // 处理大文件
            if (globalBigFilesData) {
                globalBigFilesData.forEach(file => {
                    if (file.selected) {
                        totalSize += file.size;
                        selectedFiles.big_files.push({
                            path: file.path,
                            size: file.size
                        });
                    }
                });
            }

            if (totalSize === 0) {
                alert('请先选择要清理的文件！');
                return;
            }

            // 显示确认对话框，使用总大小而不是文件数
            const modalTitle = "清理确认";
            const modalContent = `本次将清理 ${formatBytes(totalSize)} 的文件，是否继续？`;

            // 自定义确认框的确认回调
            // 在cleanAllBtn的点击事件中修改window.confirmModal函数
            window.confirmModal = async function () {
                closeModal();

                const loadingModal = document.createElement('div');
                loadingModal.className = 'loading-modal';
                loadingModal.innerHTML = `
    <div class="loading-content">
        <div class="spinner"></div>
        <p>正在进行系统清理，请稍候...</p>
        <p class="loading-details">
            • 清理系统垃圾文件<br>
            • 优化系统内存使用<br>
            • 提升系统运行效率
        </p>
    </div>
    `;

                document.body.appendChild(loadingModal);

                try {
                    const response = await fetch('http://localhost:53421/full_clean', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(selectedFiles)
                    });

                    const result = await response.json();
                    document.body.removeChild(loadingModal);

                    if (result.success) {
                        // 显示成功结果，不带取消按钮
                        openModalWithoutCancel("清理完成",
                            `清理完成！\n` +
                            `- 删除文件大小：${formatBytes(result.freed_space)}\n` +
                            `- 优化内存：${formatBytes(result.freed_memory)}\n` +
                            `- 系统得分：${result.new_score}分`
                        );

                        // 更新首页数据
                        updateHomePageData(result);

                        // 关键修改：直接加载最新的清理信息
                        loadLastCleanInfo();

                        // 使用正确的ID选择器并添加存在性检查
                        const reScanBtn = document.getElementById('reScanBtn');
                        if (reScanBtn) {
                            reScanBtn.click();
                        } else {
                            console.error('重新扫描按钮未找到');
                        }
                    } else {
                        openModalWithoutCancel("清理失败", result.error || "清理过程中发生错误");
                    }
                } catch (error) {
                    // 安全地移除loadingModal
                    if (document.body.contains(loadingModal)) {
                        document.body.removeChild(loadingModal);
                    }
                    openModalWithoutCancel("错误", "清理过程中发生错误，请重试");
                    console.error('清理错误:', error);
                }
            };

            openModal(modalTitle, modalContent);
        });

    }

    function closeModalWithoutCancel() {
        const modal = document.getElementById('modalWithoutCancel');
        if (modal) {
            modal.remove();
        }
    }

    function openModalWithoutCancel(title, content) {
        const modalHTML = `
    <div class="custom-modal-overlay" id="modalWithoutCancel">
        <div class="custom-modal">
            <button class="custom-modal-close" onclick="closeModalWithoutCancel()">×</button>
            <div class="custom-modal-header">${title}</div>
            <div class="custom-modal-body">${content}</div>
            <div class="custom-modal-footer">
                <button class="custom-modal-button" onclick="closeModalWithoutCancel()">确定</button>
            </div>
        </div>
    </div>
    `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        document.getElementById('modalWithoutCancel').style.display = 'flex';
    }

    // 将函数挂载到window对象上
    window.closeModalWithoutCancel = closeModalWithoutCancel;
    window.openModalWithoutCancel = openModalWithoutCancel;


    // 更新首页数据的函数
    function updateHomePageData(result) {
        // 更新系统得分
        updateScoreDisplay(result.new_score, 'homeScoreContainer');

        // 更新上次清理时间
        const lastCleanTimeElement = document.getElementById('lastCleanTime');
        if (lastCleanTimeElement) {
            lastCleanTimeElement.textContent = new Date().toLocaleString();
        }

        // 更新累计清理数量
        const totalCleanSizeElement = document.getElementById('totalCleanSize');
        if (totalCleanSizeElement) {
            totalCleanSizeElement.textContent = formatBytes(result.cumulative_clean_size);
        }
    }


    // ========== 下面的 showPage / checkFullCleanState / ... 代码不变 ==========
    // ============================
    // 4. 页面切换逻辑 showPage()
    // ============================
    function showPage(action) {
        cleanPage.style.display = 'none';
        memoryAccelerationPage.style.display = 'none';
        bigfilesPage.style.display = 'none';
        cleanDetailPage.style.display = 'none';
        processDetailPage.style.display = 'none';
        bigfilesDetailPage.style.display = 'none';
        homePage.style.display = 'none';
        homeCleanPage.style.display = 'none';

        updateSidebarActive(action);

        switch (action) {
            case 'home':
                stopMemoryUpdate();
                checkFullCleanState();
                break;
            case 'clean':
                cleanPage.style.display = 'block';
                stopMemoryUpdate();

                // 检查是否已通过全面扫描获取了数据
                if (globalCleanState.scanned) {
                    totalSizeInfo.textContent = formatBytes(globalCleanState.totalSize);
                    // 调用新函数更新各分类显示
                    updateCleanModuleDisplay();
                } else {
                    totalSizeInfo.textContent = '等待扫描';
                }

                restartScanBtn.textContent = '启动扫描';
                break;
            case 'homeClean':
                homeCleanPage.style.display = 'block';
                // 添加这一行来更新内存加速和大文件检索模块
                updateHomeCleanPageUI();
                // 更新其它模块
                updateModuleSelectedSize('cache_files');
                updateModuleSelectedSize('log_files');
                updateModuleSelectedSize('temp_files');
                updateModuleSelectedSize('app_files');
                break;
            case 'memory':
                memoryAccelerationPage.style.display = 'block';
                startMemoryUpdate();
                break;
            case 'bigfiles':
                bigfilesPage.style.display = 'block';
                stopMemoryUpdate();
                if (globalBigfilesState.scanned) {
                    bigfilesTitle.textContent = '扫描完成';
                    // 这里改成显示并设置为满进度
                    bigfilesProgressSection.style.display = 'block';
                    bigfilesProgressBar.style.width = '100%';
                    bigfilesProgressBar.setAttribute('aria-valuenow', '100');

                    scannedDirsEl.textContent = globalBigfilesState.scannedDirs;
                    scannedFilesEl.textContent = globalBigfilesState.scannedFiles;
                    foundBigFilesEl.textContent = globalBigfilesState.foundBigFiles;

                    scanCompleteMsg.style.display = 'block';
                    scanCompleteInfo.textContent = `上次扫描找到 ${globalBigfilesState.fileList.length} 个大文件`;
                } else {
                    bigfilesTitle.textContent = '等待扫描大文件...';
                    startBigfilesScanBtn.textContent = '启动扫描';
                    bigfilesProgressSection.style.display = 'none';
                    bigfilesProgressBar.style.width = '0%';
                    scannedDirsEl.textContent = '0';
                    scannedFilesEl.textContent = '0';
                    foundBigFilesEl.textContent = '0';
                    scanCompleteMsg.style.display = 'none';
                    currentScanningPath.textContent = '';
                }
                break;
            default:
                cleanPage.style.display = 'block';
                stopMemoryUpdate();
        }
    }

    function checkFullCleanState() {
        const st = window.fullCleanState;
        if (st.scanning) {
            homePage.style.display = 'block';
            document.getElementById('homeFullCleanProgress').style.display = 'block';
            document.getElementById('homeFullCleanStatus').textContent = '正在扫描...';
        } else if (st.completed) {
            showPage('homeClean');
            updateHomeCleanPageUI();
        } else {
            homePage.style.display = 'block';
            document.getElementById('homeFullCleanProgress').style.display = 'none';
        }
    }

    function updateSidebarActive(action) {
        document.querySelectorAll('.sidebar-item').forEach(item => {
            if (item.getAttribute('data-action') === action) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const action = link.parentElement.getAttribute('data-action');
            updateSidebarActive(action);
            showPage(action);
        });
    });


    // ============================
    // 新增：首页界面事件绑定
    // ============================
    // 快捷入口按钮点击事件
    // 在 DOMContentLoaded 内立即绑定“查看文件列表”按钮的点击事件
    if (checkBigFilesBtn) {
        checkBigFilesBtn.addEventListener('click', () => {
            if (!globalBigfilesState.scanned) {
                alert("大文件扫描尚未完成，请稍后再试！");
                return;
            }
            showBigfilesDetailPage();
        });
    }

    document.querySelectorAll('.home-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            showPage(target);
        });
    });

    document.getElementById('reScanBtn').addEventListener('click', () => {
        const st = window.fullCleanState;
        // 重置
        st.scanning = false;
        st.completed = false;
        // 跳回首页 or 直接 startFullCleanScan() ...
        showPage('home');
    });

    // “全面清理”按钮点击事件：切换到全面清理界面
    const fullCleanBtn = document.getElementById('fullCleanBtn');
    if (fullCleanBtn) {
        fullCleanBtn.addEventListener('click', () => {
            document.getElementById('homeScoreCircle').classList.add('spin');
            startFullCleanScan();
        });
    }

    // 全面清理界面中的按钮事件：处理 data-detail 与 data-target
    document.querySelectorAll('#homeCleanPage button').forEach(btn => {
        if (btn.hasAttribute('data-detail')) {
            const detailType = btn.getAttribute('data-detail');
            btn.addEventListener('click', () => {
                if (detailType === 'bigfiles') {
                    // 如果大文件扫描已经完成，则直接跳转到大文件详情界面
                    if (globalBigfilesState.scanned) {
                        showBigfilesDetailPage('homeClean');
                    } else {
                        // 否则，跳转到大文件扫描页面，等待扫描完成后再进入详情
                        showPage('bigfiles');
                    }
                } else {
                    // 其它模块（例如 cache_files、log_files、temp_files、app_files）走原来的详情页逻辑
                    showCleanDetailPage(detailType, 'homeClean');
                }
            });
        } else if (btn.hasAttribute('data-target')) {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-target');
                showPage(target);
            });
        }
    });

    // 先在顶部定义几个全局变量用于存储扫描结果
    let homeCleanScanResult = {
        cacheSize: 0,
        logSize: 0,
        tempSize: 0,
        appSize: 0,
        foundBigFiles: 0,
        memoryOptimizeVal: 0  // 随机可优化内存
    };

    /**
     * 根据垃圾和大文件总字节数计算分数（百分制），最低不低于60分
     * @param {number} garbageBytes 垃圾文件总字节数
     * @param {number} bigfileBytes 大文件总字节数
     * @returns {number} 计算后的分数
     */
    function computeScoreJS(garbageBytes, bigfileBytes) {
        // 转换为MB便于计算
        const garbageMB = garbageBytes / (1024 * 1024);
        const bigfileMB = bigfileBytes / (1024 * 1024);

        // 基础分数100分
        let score = 100;

        // 垃圾文件扣分：每100MB扣1分
        score -= (garbageMB / 100);

        // 大文件扣分：每500MB扣1分
        score -= (bigfileMB / 500);

        // 限制最低10分，最高100分
        score = Math.max(10, Math.min(100, score));

        return Math.round(score);
    }

    /**
     * 开始全面清理扫描
     */
    // 在startFullCleanScan函数中添加同步逻辑
    function startFullCleanScan() {
        const st = window.fullCleanState;
        if (st.scanning || st.completed) {
            console.log('已在扫描或已完成，无需重复开始');
            return;
        }

        // 重置全面清理状态
        st.scanning = true;
        st.completed = false;
        st.cacheSize = 0;
        st.logSize = 0;
        st.tempSize = 0;
        st.appSize = 0;
        st.foundBigFiles = 0;
        st.memoryOptimizeVal = 0;

        const homeFullCleanProgress = document.getElementById('homeFullCleanProgress');
        const homeFullCleanProgressBar = document.getElementById('homeFullCleanProgressBar');
        const homeFullCleanStatus = document.getElementById('homeFullCleanStatus');

        homeFullCleanProgress.style.display = 'block';
        homeFullCleanProgressBar.style.width = '0%';
        homeFullCleanProgressBar.setAttribute('aria-valuenow', '0');
        homeFullCleanStatus.textContent = '开始扫描垃圾文件...';

        // 重置本地扫描结果记录
        homeCleanScanResult = {
            cacheSize: 0,
            logSize: 0,
            tempSize: 0,
            appSize: 0,
            foundBigFiles: 0,
            memoryOptimizeVal: 0
        };

        // 开始垃圾扫描
        fetchTrashScan()
            .then(() => {
                homeFullCleanStatus.textContent = '开始扫描大文件...';
                return fetchBigfilesScan();
            })
            .then((bigfilesData) => {
                // 设置内存优化的随机值
                homeCleanScanResult.memoryOptimizeVal = Math.floor(Math.random() * 41) + 10;

                // 更新进度条到100%
                homeFullCleanProgressBar.style.width = '100%';
                homeFullCleanProgressBar.setAttribute('aria-valuenow', '100');
                homeFullCleanStatus.textContent = '扫描完成，正在加载结果...';

                // 标记扫描完成
                st.scanning = false;
                st.completed = true;
                // 更新各模块垃圾大小
                st.cacheSize = homeCleanScanResult.cacheSize;
                st.logSize = homeCleanScanResult.logSize;
                st.tempSize = homeCleanScanResult.tempSize;
                st.appSize = homeCleanScanResult.appSize;
                st.foundBigFiles = bigfilesData.foundFiles;
                st.memoryOptimizeVal = homeCleanScanResult.memoryOptimizeVal;

                // 同步大文件扫描结果
                globalBigfilesState.scanned = true;
                globalBigfilesState.scannedDirs = bigfilesData.scannedDirs;
                globalBigfilesState.scannedFiles = bigfilesData.scannedFiles;
                globalBigfilesState.foundBigFiles = bigfilesData.foundFiles;
                globalBigfilesState.fileList = bigfilesData.files || [];
                globalBigFilesData = bigfilesData.files || [];

                // 计算垃圾总大小，并保存到全局状态中
                window.fullCleanState.totalSize = homeCleanScanResult.cacheSize +
                    homeCleanScanResult.logSize +
                    homeCleanScanResult.tempSize +
                    homeCleanScanResult.appSize;

                // 关键修改：同步全面扫描结果到垃圾清理模块的全局状态
                globalCleanState.scanned = true;
                globalCleanState.totalSize = window.fullCleanState.totalSize;

                // 更新垃圾清理模块各项目的大小显示
                updateCleanModuleDisplay();

                // 计算分数
                var garbage_total = window.fullCleanState.totalSize;
                var bigfile_total = 0;
                if (globalBigfilesState.fileList && globalBigfilesState.fileList.length > 0) {
                    bigfile_total = globalBigfilesState.fileList.reduce(function (sum, file) {
                        return sum + file.size;
                    }, 0);
                }
                var newScore = computeScoreJS(garbage_total, bigfile_total);
                updateScoreDisplay(newScore, 'homeScoreContainer');
                updateScoreDisplay(newScore, 'cleanScoreContainer');

                // 停止首页评分球的旋转
                const homeCircle = document.querySelector('#homeScoreContainer .score-circle');
                if (homeCircle) {
                    homeCircle.classList.remove('spin');
                }

                // 隐藏进度条并跳转到"全面清理"界面
                setTimeout(() => {
                    homeFullCleanProgress.style.display = 'none';
                    showPage('homeClean');
                }, 500);
            })
            .catch(err => {
                console.error("首页全面扫描出错:", err);
                alert("扫描过程中出错，请查看控制台日志");
                homeFullCleanProgress.style.display = 'none';
                const homeCircle = document.querySelector('#homeScoreContainer .score-circle');
                if (homeCircle) {
                    homeCircle.classList.remove('spin');
                }
            });
    }

    // 新增一个函数来更新垃圾清理模块的显示
    function updateCleanModuleDisplay() {
        if (globalCleanState.scanned && globalCleanState.totalSize > 0) {
            // 更新总大小显示
            if (totalSizeInfo) {
                totalSizeInfo.textContent = formatBytes(globalCleanState.totalSize);
            }

            // 更新各分类大小显示
            if (cacheSizeInfo && window.fullCleanState.cacheSize) {
                cacheSizeInfo.textContent = formatBytes(window.fullCleanState.cacheSize);
            }
            if (logSizeInfo && window.fullCleanState.logSize) {
                logSizeInfo.textContent = formatBytes(window.fullCleanState.logSize);
            }
            if (tempSizeInfo && window.fullCleanState.tempSize) {
                tempSizeInfo.textContent = formatBytes(window.fullCleanState.tempSize);
            }
            const appSizeInfo = document.getElementById('appSizeInfo');
            if (appSizeInfo && window.fullCleanState.appSize) {
                appSizeInfo.textContent = formatBytes(window.fullCleanState.appSize);
            }
        }
    }

    function updateScoreDisplay(score, containerId) {
        const circleEl = document.querySelector(`#${containerId} .score-circle`);
        const waterEl = document.querySelector(`#${containerId} .water-layer`);
        const textEl = document.querySelector(`#${containerId} .score-text`);

        // 更新分数文字
        if (textEl) {
            textEl.textContent = Math.round(score) + '分';
        }

        // 设置水层高度（与分数成正比）
        if (waterEl) {
            waterEl.style.height = score + '%';
        }

        // 根据分数设置颜色
        let borderColor, textColor, gradient;

        if (score < 60) {
            // 红色系
            borderColor = '#ff4d4d';
            textColor = '#ff4d4d';
            gradient = 'linear-gradient(to top, #ff4d4d, #ffcccc)';
        } else if (score < 75) {
            // 黄色系
            borderColor = '#ffc107';
            textColor = '#ffc107';
            gradient = 'linear-gradient(to top, #ffc107, #fff3cd)';
        } else if (score < 90) {
            // 蓝色系
            borderColor = '#3a9ff0';
            textColor = '#3a9ff0';
            gradient = 'linear-gradient(to top, #3a9ff0, #cce2ff)';
        } else {
            // 绿色系
            borderColor = '#28a745';
            textColor = '#28a745';
            gradient = 'linear-gradient(to top, #28a745, #c3e6cb)';
        }

        // 更新样式
        if (circleEl) {
            circleEl.style.borderColor = borderColor;
        }
        if (textEl) {
            textEl.style.color = textColor;
        }
        if (waterEl) {
            waterEl.style.setProperty('--wave-bg', gradient);
            waterEl.style.background = gradient;
        }
    }

// 分别封装两个扫描函数
    function fetchTrashScan() {
        // 映射 /scan 的进度 0% ~ 50%
        // 注意: 垃圾扫描返回流式 JSON，每行可能包含 "status: scanning" / "complete"
        return new Promise((resolve, reject) => {
            fetch('http://localhost:53421/scan')
                .then(response => {
                    if (!response.body) {
                        return reject("垃圾扫描接口无返回流");
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let partialData = '';
                    let overallDone = false;

                    const homeFullCleanProgressBar = document.getElementById('homeFullCleanProgressBar');
                    const updateProgress = (p) => {
                        // 最大只能到50%
                        const val = Math.min(50, p / 2);
                        homeFullCleanProgressBar.style.width = val + '%';
                        homeFullCleanProgressBar.setAttribute('aria-valuenow', val);
                    };

                    function readStream() {
                        reader.read().then(({value, done}) => {
                            if (done) {
                                if (!overallDone) {
                                    // 如果流提前结束，但还没拿到complete
                                    reject("垃圾扫描意外结束");
                                }
                                return;
                            }
                            partialData += decoder.decode(value, {stream: true});
                            const lines = partialData.split('\n');
                            partialData = lines.pop(); // 保留最后一行(不完整的)

                            for (let line of lines) {
                                if (!line.trim()) continue;
                                try {
                                    const json = JSON.parse(line);
                                    if (json.status === 'scanning') {
                                        // 更新进度
                                        if (typeof json.progress === 'number') {
                                            updateProgress(json.progress);
                                        }
                                    } else if (json.status === 'complete') {
                                        overallDone = true;
                                        // 最终结果里有 total_size 和 items
                                        if (Array.isArray(json.items)) {
                                            json.items.forEach(item => {
                                                switch (item.title) {
                                                    case '缓存文件':
                                                        homeCleanScanResult.cacheSize = item.size || 0;
                                                        break;
                                                    case '日志文件':
                                                        homeCleanScanResult.logSize = item.size || 0;
                                                        break;
                                                    case '临时文件':
                                                        homeCleanScanResult.tempSize = item.size || 0;
                                                        break;
                                                    case '应用文件':
                                                        homeCleanScanResult.appSize = item.size || 0;
                                                        break;
                                                }
                                            });
                                        }
                                        // 直接进度拉到50%
                                        updateProgress(100);
                                        resolve();
                                    }
                                } catch (e) {
                                    console.warn("解析垃圾扫描流出错", e, line);
                                }
                            }

                            readStream(); // 继续读下一批
                        }).catch(err => reject(err));
                    }

                    readStream();
                })
                .catch(err => reject(err));
        });
    }

    function fetchBigfilesScan() {
        return new Promise((resolve, reject) => {
            fetch('http://localhost:53421/scan_bigfiles')
                .then(response => {
                    if (!response.body) {
                        return reject("大文件扫描接口无返回流");
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let partialData = '';
                    let overallDone = false;

                    // 用于存最终结果
                    let finalFiles = [];
                    let finalScannedDirs = 0;
                    let finalScannedFiles = 0;
                    let finalFoundFiles = 0;

                    const homeFullCleanProgressBar = document.getElementById('homeFullCleanProgressBar');
                    const updateProgress = (p) => {
                        // p从0~100，映射到 50~100
                        const val = 50 + (p / 2);
                        homeFullCleanProgressBar.style.width = val + '%';
                        homeFullCleanProgressBar.setAttribute('aria-valuenow', val);
                    };

                    function readStream() {
                        reader.read().then(({value, done}) => {
                            if (done) {
                                if (!overallDone) {
                                    reject("大文件扫描意外结束");
                                }
                                return;
                            }
                            partialData += decoder.decode(value, {stream: true});
                            const lines = partialData.split('\n');
                            partialData = lines.pop(); // 剩下不完整行

                            for (let line of lines) {
                                if (!line.trim()) continue;
                                try {
                                    const json = JSON.parse(line);
                                    if (json.status === 'scanning') {
                                        // 可以根据 found_files 做一个简易进度
                                        const foundCount = (json.stats && json.stats.found_files) || 0;
                                        let approx = Math.min(100, foundCount);
                                        updateProgress(approx);

                                        // 同时记录下当前统计
                                        finalScannedDirs = (json.stats && json.stats.scanned_dirs) || 0;
                                        finalScannedFiles = (json.stats && json.stats.scanned_files) || 0;
                                        finalFoundFiles = (json.stats && json.stats.found_files) || 0;

                                    } else if (json.status === 'complete') {
                                        overallDone = true;
                                        const stats = json.stats || {};
                                        finalScannedDirs = stats.scanned_dirs || 0;
                                        finalScannedFiles = stats.scanned_files || 0;
                                        finalFoundFiles = stats.found_files || 0;
                                        finalFiles = json.files || [];

                                        updateProgress(100);
                                        // 返回扫描到的所有数据
                                        resolve({
                                            scannedDirs: finalScannedDirs,
                                            scannedFiles: finalScannedFiles,
                                            foundFiles: finalFoundFiles,
                                            files: finalFiles
                                        });
                                    }
                                } catch (e) {
                                    console.warn("解析大文件扫描流出错", e, line);
                                }
                            }
                            readStream();
                        }).catch(err => reject(err));
                    }

                    readStream();
                })
                .catch(err => reject(err));
        });
    }

    /**
     * 更新“全面清理”页面中各模块的显示
     */
    function updateHomeCleanPageUI() {
        // 更新其它模块的“已选择大小”
        updateModuleSelectedSize('cache_files');
        updateModuleSelectedSize('log_files');
        updateModuleSelectedSize('temp_files');
        updateModuleSelectedSize('app_files');

        // 更新内存优化信息
        document.getElementById('homeMemoryScore').textContent = `可优化 ${window.fullCleanState.memoryOptimizeVal}MB`;

        // 计算大文件模块的总大小
        // 注意：如果 file.selected 未定义，则视为默认选中
        let totalBigfilesSize = 0;
        if (globalBigFilesData && globalBigFilesData.length > 0) {
            totalBigfilesSize = globalBigFilesData.reduce((sum, file) => {
                return ((typeof file.selected === 'undefined' || file.selected) ? sum + file.size : sum);
            }, 0);
        }
        document.getElementById('homeBigfilesInfo').textContent = '已选择 ' + formatBytes(totalBigfilesSize);
    }

    // 一个简单的格式化函数，和你已有的 formatBytes 类似
    function formatBytes(bytes) {
        if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return bytes.toFixed(2) + ' ' + units[i];
    }

    // ============================
    // 5. 内存加速：自动刷新(2.5s)
    // ============================
    function startMemoryUpdate() {
        updateMemoryAccelerationData();
        if (!memoryInterval) {
            memoryInterval = setInterval(updateMemoryAccelerationData, 2500);
        }
    }

    function stopMemoryUpdate() {
        if (memoryInterval) {
            clearInterval(memoryInterval);
            memoryInterval = null;
        }
    }

    function updateMemoryAccelerationData() {
        fetch('http://localhost:53421/monitor_data')
            .then(res => res.json())
            .then(data => {
                if (data.cpu) {
                    cpuUserPercentEl.textContent = data.cpu.user.toFixed(1) + '%';
                    cpuSystemPercentEl.textContent = data.cpu.system.toFixed(1) + '%';
                    cpuIdlePercentEl.textContent = data.cpu.idle.toFixed(1) + '%';

                    const now = new Date().toLocaleTimeString().slice(0, 8);
                    const labels = cpuChart.data.labels;
                    labels.push(now);
                    if (labels.length > 20) labels.shift();

                    cpuChart.data.datasets[0].data.push(data.cpu.user);
                    cpuChart.data.datasets[1].data.push(data.cpu.system);
                    cpuChart.data.datasets[2].data.push(data.cpu.idle);
                    cpuChart.data.datasets.forEach(ds => {
                        while (ds.data.length > 20) ds.data.shift();
                    });
                    cpuChart.update();
                }

                if (data.memory) {
                    const {total, used, percent} = data.memory;
                    usedMemoryEl.textContent = formatBytes(used);
                    totalMemoryEl.textContent = formatBytes(total);
                    memoryProgressBar.style.width = percent + '%';
                    memoryProgressBar.setAttribute('aria-valuenow', percent);

                    const usageVal = Math.round(percent);
                    pressureChart.data.datasets[0].data = [usageVal, 100 - usageVal];
                    pressureChart.update();
                    pressurePercentEl.textContent = `${usageVal}%`;
                }

                if (data.network) {
                    const sentKB = (data.network.sent_mbs || 0) * 1024;
                    const recvKB = (data.network.recv_mbs || 0) * 1024;
                    uploadSpeedEl.textContent = `${sentKB.toFixed(2)}KB`;
                    downloadSpeedEl.textContent = `${recvKB.toFixed(2)}KB`;
                    networkChart.data.datasets[0].data = [sentKB, recvKB];
                    networkChart.update();
                }

                if (data.disk) {
                    const readKB = (data.disk.read_mbs || 0) * 1024;
                    const writeKB = (data.disk.write_mbs || 0) * 1024;
                    diskReadEl.textContent = `${readKB.toFixed(2)}KB`;
                    diskWriteEl.textContent = `${writeKB.toFixed(2)}KB`;

                    diskChart.data.datasets[0].data = [readKB, writeKB];
                    diskChart.update();
                }
            })
            .catch(err => console.error('Error fetching /monitor_data:', err));
    }

    if (viewProcessBtn) {
        viewProcessBtn.addEventListener('click', () => {
            showProcessDetailPage();
        });
    }

    if (optimizeBtn) {
        const spinnerEl = document.getElementById('optimizeSpinner');
        const optimizeBtnText = document.getElementById('optimizeBtnText');

        optimizeBtn.addEventListener('click', () => {
            optimizeBtn.disabled = true;
            spinnerEl.style.display = 'inline-block';
            optimizeBtnText.textContent = '优化中...';

            fetch('http://localhost:53421/optimize', {method: 'POST'})
                .then(res => res.json())
                .then(data => {
                    optimizeBtn.disabled = false;
                    spinnerEl.style.display = 'none';
                    optimizeBtnText.textContent = '一键优化内存';

                    if (data.status === 'success') {
                        openModalWithoutCancel(`优化完成`, `释放内存：${formatBytes(data.freed_memory)}`);
                    } else {
                        openModalWithoutCancel(`优化部分失败`, `释放内存：${formatBytes(data.freed_memory || 0)}`);
                    }
                })
                .catch(err => {
                    optimizeBtn.disabled = false;
                    spinnerEl.style.display = 'none';
                    optimizeBtnText.textContent = '一键优化内存';

                    console.error('Optimize error:', err);
                    alert('优化出错！');
                });
        });
    }

    // ============================
    // 6. Chart.js 初始化
    // ============================
    let cpuChart, pressureChart, networkChart, diskChart;

    function initCharts() {
        cpuChart = new Chart(document.getElementById('cpuChart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {label: '用户', data: [], borderColor: '#3a9ff0', fill: false, tension: 0.2},
                    {label: '系统', data: [], borderColor: '#f0cc3a', fill: false, tension: 0.2},
                    {label: '空闲', data: [], borderColor: '#82d079', fill: false, tension: 0.2}
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {duration: 1000},
                scales: {y: {beginAtZero: true, max: 100}}
            }
        });

        pressureChart = new Chart(document.getElementById('pressureChart'), {
            type: 'doughnut',
            data: {
                labels: ['使用', '空闲'],
                datasets: [{data: [0, 100], backgroundColor: ['#3a9ff0', '#e5f1fb']}]
            },
            options: {
                cutout: '70%',
                responsive: true,
                plugins: {legend: {display: false}}
            }
        });

        networkChart = new Chart(document.getElementById('networkChart'), {
            type: 'doughnut',
            data: {
                labels: ['上行', '下行'],
                datasets: [{data: [0, 0], backgroundColor: ['#3a9ff0', '#f0cc3a']}]
            },
            options: {
                cutout: '70%',
                responsive: true,
                plugins: {legend: {display: false}}
            }
        });

        diskChart = new Chart(document.getElementById('diskChart'), {
            type: 'doughnut',
            data: {
                labels: ['读', '写'],
                datasets: [{data: [0, 0], backgroundColor: ['#3a9ff0', '#82d079']}]
            },
            options: {
                cutout: '70%',
                responsive: true,
                plugins: {legend: {display: false}}
            }
        });
    }

    initCharts();

    // ============================
    // 7. 新增：进程管理 详情
    // ============================
    let allProcesses = [];
    let processSearchKeyword = '';
    let processSortColumn = '';
    let processSortOrder = 'asc';
    let processRefreshInterval = 5000;
    let processRefreshTimer = null;
    let selectedPids = new Set();

    const processTableHead = document.getElementById('processTableHead');
    const processTableBody = document.getElementById('processTableBody');
    const processSelectedInfo = document.getElementById('processSelectedInfo');
    const killSelectedBtn = document.getElementById('killSelectedBtn');
    const processRefreshRange = document.getElementById('processRefreshRange');
    const processRefreshValue = document.getElementById('processRefreshValue');
    const processSearchInput = document.getElementById('processSearchInput');
    const processSearchBtn = document.getElementById('processSearchBtn');
    const processDetailBackBtn = document.getElementById('processDetailBackBtn');
    const processDetailTitle = document.getElementById('processDetailTitle');

    function showProcessDetailPage() {
        processDetailTitle.textContent = '进程列表';
        processSelectedInfo.textContent = '';
        processSearchKeyword = '';
        if (processSearchInput) processSearchInput.value = '';
        stopProcessAutoRefresh();
        processSortColumn = 'memory';
        processSortOrder = 'desc';
        fetchProcesses()
            .then(data => {
                allProcesses = data;
                selectedPids.clear();
                renderProcessTable();
                startProcessAutoRefresh();
            })
            .catch(err => console.error('获取进程列表失败:', err));
        cleanPage.style.display = 'none';
        memoryAccelerationPage.style.display = 'none';
        bigfilesPage.style.display = 'none';
        if (cleanDetailPage) cleanDetailPage.style.display = 'none';
        processDetailPage.style.display = 'block';
    }

    function fetchProcesses() {
        return fetch('http://localhost:53421/processes')
            .then(res => res.json());
    }

    function startProcessAutoRefresh() {
        processRefreshTimer = setInterval(async () => {
            try {
                const data = await fetchProcesses();
                allProcesses = data;
                renderProcessTable();
            } catch (e) {
                console.error('自动刷新获取进程失败:', e);
            }
        }, processRefreshInterval);
    }

    function stopProcessAutoRefresh() {
        if (processRefreshTimer) {
            clearInterval(processRefreshTimer);
            processRefreshTimer = null;
        }
    }

    function renderProcessTable() {
        let filtered = allProcesses;

        // 搜索过滤
        if (processSearchKeyword) {
            const kw = processSearchKeyword.toLowerCase();
            filtered = allProcesses.filter(p => {
                return String(p.pid).includes(kw) ||
                    (p.name && p.name.toLowerCase().includes(kw)) ||
                    (p.username && p.username.toLowerCase().includes(kw)) ||
                    (p.description && p.description.toLowerCase().includes(kw));
            });
        }

        // 排序处理
        if (processSortColumn) {
            filtered.sort((a, b) => {
                let aVal = a[processSortColumn];
                let bVal = b[processSortColumn];

                // 确保数值比较
                if (processSortColumn === 'memory' || processSortColumn === 'memory_percent') {
                    aVal = Number(aVal) || 0;
                    bVal = Number(bVal) || 0;
                }

                if (processSortOrder === 'asc') {
                    return aVal > bVal ? 1 : -1;
                } else {
                    return aVal < bVal ? 1 : -1;
                }
            });
        }

        // 默认按内存占用降序排序
        if (!processSortColumn) {
            processSortColumn = 'memory';
            processSortOrder = 'desc';
            filtered.sort((a, b) => (b.memory || 0) - (a.memory || 0));
        }

        // 渲染表头
        processTableHead.innerHTML = `
        <th><input type="checkbox" id="procSelectAll"/></th>
        <th>PID</th>
        <th>进程</th>
        <th data-col="memory" style="cursor:pointer;">内存 ${getSortIcon('memory')}</th>
        <th data-col="memory_percent" style="cursor:pointer;">内存占比 ${getSortIcon('memory_percent')}</th>
        <th>用户</th>
        <th>描述</th>
    `;

        // 渲染表格内容
        processTableBody.innerHTML = '';
        filtered.forEach(proc => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
            <td><input type="checkbox" class="proc-check" data-pid="${proc.pid}" /></td>
            <td>${proc.pid}</td>
            <td>${proc.name || '—'}</td>
            <td>${formatBytes(proc.memory)}</td>
            <td>${(proc.memory_percent || 0).toFixed(1)}%</td>
            <td>${proc.username || '—'}</td>
            <td>${proc.description || '—'}</td>
        `;
            processTableBody.appendChild(tr);
        });

        // 绑定表头排序事件
        processTableHead.querySelectorAll('th[data-col]').forEach(th => {
            th.onclick = () => {
                const col = th.getAttribute('data-col');
                if (processSortColumn === col) {
                    processSortOrder = processSortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    processSortColumn = col;
                    processSortOrder = 'desc';
                }
                renderProcessTable();
            };
        });

        // 更新选中状态
        updateProcessSelectedInfo();
    }

// 辅助函数：获取排序图标
    function getSortIcon(column) {
        if (processSortColumn !== column) return '↕️';
        return processSortOrder === 'asc' ? '↑' : '↓';
    }


    function updateProcessSelectedInfo() {
        const count = selectedPids.size;
        processSelectedInfo.textContent = `已选中 ${count} 个进程`;
    }

    async function killProcess(pid) {
        try {
            const res = await fetch('http://localhost:53421/end_process', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({pid})
            });
            const data = await res.json();
            if (data.error) {
                alert(`结束进程失败: ${data.error}`);
            } else {
                alert(`进程 ${pid} 已终止`);
            }
        } catch (e) {
            console.error('结束进程出错:', e);
        }
        selectedPids.delete(String(pid));
        try {
            const data = await fetchProcesses();
            allProcesses = data;
            renderProcessTable();
        } catch (e) {
            console.error('刷新进程列表出错:', e);
        }
    }

    if (killSelectedBtn) {
        killSelectedBtn.addEventListener('click', async () => {
            if (!selectedPids.size) {
                alert('请先勾选要结束的进程！');
                return;
            }
            const pidsArr = Array.from(selectedPids);
            for (let p of pidsArr) {
                await killProcess(p);
            }
        });
    }

    if (processSearchBtn) {
        processSearchBtn.addEventListener('click', () => {
            processSearchKeyword = processSearchInput.value.trim().toLowerCase();
            renderProcessTable();
        });
    }

    if (processDetailBackBtn) {
        processDetailBackBtn.addEventListener('click', () => {
            stopProcessAutoRefresh();
            processDetailPage.style.display = 'none';
            showPage('memory');
        });
    }

    if (processRefreshRange) {
        processRefreshRange.addEventListener('input', e => {
            const val = parseInt(e.target.value, 10);
            processRefreshInterval = val * 1000;
            if (processRefreshValue) {
                processRefreshValue.textContent = val + 's';
            }
            stopProcessAutoRefresh();
            startProcessAutoRefresh();
        });
    }

    function stopProcessAutoRefresh() {
        if (processRefreshTimer) {
            clearInterval(processRefreshTimer);
            processRefreshTimer = null;
        }
    }

    function startProcessAutoRefresh() {
        if (processRefreshTimer) {
            clearInterval(processRefreshTimer);
        }
        processRefreshTimer = setInterval(async () => {
            try {
                const data = await fetchProcesses();
                allProcesses = data;
                renderProcessTable();
            } catch (e) {
                console.error('自动刷新进程失败:', e);
            }
        }, processRefreshInterval);
    }

    // ============================
    // 8. 垃圾清理：扫描逻辑(已有)
    // ============================
    function fetchCleanDataAndProgress() {
        cleanScanProgress.style.display = 'block';
        cleanCurrentPath.textContent = '...';
        cleanProgressBar.style.width = '0%';
        cleanProgressBar.setAttribute('aria-valuenow', 0);

        fetch('http://localhost:53421/scan')
            .then(async response => {
                totalSizeInfo.textContent = '正在扫描';
                if (!response.body) return;
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let partial = '';

                while (true) {
                    const {value, done} = await reader.read();
                    if (done) break;
                    partial += decoder.decode(value, {stream: true});
                    let lines = partial.split('\n');
                    partial = lines.pop();
                    for (const line of lines) {
                        try {
                            const json = JSON.parse(line);
                            if (json.status === 'scanning') {
                                cleanCurrentPath.textContent = json.current_path || '';
                                let prog = json.progress || 0;
                                if (prog < 0) prog = 0;
                                if (prog > 100) prog = 100;
                                cleanProgressBar.style.width = prog + '%';
                                cleanProgressBar.setAttribute('aria-valuenow', prog);
                            } else if (json.status === 'complete') {
                                updateCleanUI(json);
                                cleanScanProgress.style.display = 'none';
                            }
                        } catch (e) {
                        }
                    }
                }
            })
            .catch(err => {
                console.error('Error in fetchCleanDataAndProgress:', err);
            });
    }

    function updateCleanUI(data) {
        totalSizeInfo.textContent = formatBytes(data.total_size || 0);
        if (Array.isArray(data.items)) {
            data.items.forEach(item => {
                switch (item.title) {
                    case '缓存文件':
                        cacheSizeInfo.textContent = formatBytes(item.size);
                        break;
                    case '日志文件':
                        logSizeInfo.textContent = formatBytes(item.size);
                        break;
                    case '临时文件':
                        tempSizeInfo.textContent = formatBytes(item.size);
                        break;
                    case '应用文件':
                        const appSizeInfo = document.getElementById('appSizeInfo');
                        if (appSizeInfo) {
                            appSizeInfo.textContent = formatBytes(item.size);
                        }
                        break;
                }
            });
        }
        globalCleanState.scanned = true;
        globalCleanState.totalSize = data.total_size || 0;
    }

    if (restartScanBtn) {
        restartScanBtn.addEventListener('click', () => {
            globalCleanState.scanned = false;
            globalCleanState.totalSize = 0;
            fetchCleanDataAndProgress();
        });
    }

    // -------------------------------
    // 6. 大文件检索：自动扫描 + “重新扫描”按钮
    // -------------------------------
    function startBigfilesScan() {
        globalBigfilesState.scanned = false;
        globalBigfilesState.scannedDirs = 0;
        globalBigfilesState.scannedFiles = 0;
        globalBigfilesState.foundBigFiles = 0;
        globalBigfilesState.fileList = [];

        bigfilesTitle.textContent = '正在扫描大文件...';
        currentScanningPath.textContent = '';
        bigfilesProgressSection.style.display = 'block';
        bigfilesProgressBar.style.width = '0%';
        bigfilesProgressBar.setAttribute('aria-valuenow', '0');
        scannedDirsEl.textContent = '0';
        scannedFilesEl.textContent = '0';
        foundBigFilesEl.textContent = '0';
        scanCompleteMsg.style.display = 'none';

        const startTime = Date.now();

        fetch('http://localhost:53421/scan_bigfiles')
            .then(async response => {
                if (!response.body) return;
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let partialData = '';

                while (true) {
                    const {value, done} = await reader.read();
                    if (done) break;
                    partialData += decoder.decode(value, {stream: true});
                    let lines = partialData.split('\n');
                    partialData = lines.pop();
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const dataObj = JSON.parse(line);
                            handleBigfilesScanData(dataObj, startTime);
                        } catch (e) {
                            console.error('JSON parse error:', e, line);
                        }
                    }
                }

                if (partialData.trim()) {
                    try {
                        const dataObj = JSON.parse(partialData);
                        handleBigfilesScanData(dataObj, startTime);
                    } catch (e) {
                        console.error('JSON parse error:', e, partialData);
                    }
                }
            })
            .catch(err => {
                console.error('scan_bigfiles error:', err);
            });
    }

    function handleBigfilesScanData(dataObj, startTime) {
        if (dataObj.status === 'scanning') {
            currentScanningPath.textContent = dataObj.current_path || '';
            const stats = dataObj.stats || {};
            scannedDirsEl.textContent = stats.scanned_dirs || 0;
            scannedFilesEl.textContent = stats.scanned_files || 0;
            foundBigFilesEl.textContent = stats.found_files || 0;

            let progress = 0;
            if (stats.scanned_files) {
                progress = Math.min(100, Math.floor(stats.scanned_files / 500000 * 100));
            }
            bigfilesProgressBar.style.width = progress + '%';
            bigfilesProgressBar.setAttribute('aria-valuenow', progress);

        } else if (dataObj.status === 'complete') {
            const endTime = Date.now();
            const costSecs = ((endTime - startTime) / 1000).toFixed(1);

            bigfilesTitle.textContent = '扫描完成';
            bigfilesProgressBar.style.width = '100%';
            bigfilesProgressBar.setAttribute('aria-valuenow', '100');

            scannedDirsEl.textContent = dataObj.stats.scanned_dirs || 0;
            scannedFilesEl.textContent = dataObj.stats.scanned_files || 0;
            foundBigFilesEl.textContent = dataObj.stats.found_files || 0;

            globalBigfilesState.scanned = true;
            globalBigfilesState.scannedDirs = dataObj.stats.scanned_dirs || 0;
            globalBigfilesState.scannedFiles = dataObj.stats.scanned_files || 0;
            globalBigfilesState.foundBigFiles = dataObj.stats.found_files || 0;
            globalBigfilesState.fileList = dataObj.files || [];

            globalBigFilesData = dataObj.files || [];

            scanCompleteMsg.style.display = 'block';
            scanCompleteInfo.textContent = `耗时${costSecs}秒，共找到${dataObj.files ? dataObj.files.length : 0}个大文件`;

            checkBigFilesBtn.onclick = () => {
                showBigfilesDetailPage();
            };

        } else if (dataObj.status === 'error') {
            bigfilesTitle.textContent = '扫描出错';
            console.error('Bigfile scan error:', dataObj.error);
        }
    }

    if (startBigfilesScanBtn) {
        startBigfilesScanBtn.addEventListener('click', () => {
            globalBigfilesState.scanned = false;
            globalBigfilesState.scannedDirs = 0;
            globalBigfilesState.scannedFiles = 0;
            globalBigfilesState.foundBigFiles = 0;
            globalBigfilesState.fileList = [];

            startBigfilesScan();
        });
    }

    /**
     * 显示大文件详情页
     * @param {string} fromPage 来源页面（例如 'clean' 或 'homeClean'）
     */
    function showBigfilesDetailPage(fromPage = 'clean') {
        // 记录来源，方便返回时判断
        previousPage = fromPage;

        // 隐藏其它页面
        homePage.style.display = 'none';
        homeCleanPage.style.display = 'none';
        cleanPage.style.display = 'none';
        memoryAccelerationPage.style.display = 'none';
        bigfilesPage.style.display = 'none';
        cleanDetailPage.style.display = 'none';
        processDetailPage.style.display = 'none';

        // 显示大文件详情页
        bigfilesDetailPage.style.display = 'block';

        // 初始化 globalBigFilesData 中每个文件的选中状态，默认为 true
        globalBigFilesData.forEach(file => {
            if (typeof file.selected === 'undefined') {
                file.selected = true;
            }
        });

        // 重绘表头 & 渲染大文件列表
        bigfilesDetailTableHead.innerHTML = `
        <th><input type="checkbox" id="bigfilesSelectAll" /></th>
        <th>文件名称</th>
        <th>文件位置</th>
        <th>文件大小</th>
        <th>修改时间</th>
    `;
        renderBigfilesTable(globalBigFilesData);

        // 如果是从“全面清理”进来，就隐藏删除按钮
        if (fromPage === 'homeClean') {
            bigfilesDeleteSelectedBtn.style.display = 'none';
        } else {
            bigfilesDeleteSelectedBtn.style.display = 'block';
        }
    }

    /**
     * 渲染大文件详情表格
     * @param {Array} files 大文件数据列表
     */
    function renderBigfilesTable(files) {
        // 保证每个文件都有 selected 属性（如果没有则默认 true）
        files.forEach(file => {
            if (typeof file.selected === 'undefined') {
                file.selected = true;
            }
        });
        // 按文件大小降序排序
        const sorted = [...files].sort((a, b) => b.size - a.size);
        bigfilesDetailTableBody.innerHTML = '';

        sorted.forEach(fileObj => {
            const tr = document.createElement('tr');

            const tdBox = document.createElement('td');
            // 根据 fileObj.selected 决定复选框是否选中
            const isChecked = fileObj.selected;
            tdBox.innerHTML = `<input type="checkbox" class="bigfile-check" ${isChecked ? 'checked' : ''} />`;
            const inputEl = tdBox.querySelector('input');
            inputEl.dataset.filePath = fileObj.path;
            inputEl.dataset.fileSize = fileObj.size;
            tr.appendChild(tdBox);

            const tdFilename = document.createElement('td');
            tdFilename.textContent = fileObj.name;
            tdFilename.title = fileObj.name;
            tr.appendChild(tdFilename);

            const tdPath = document.createElement('td');
            tdPath.textContent = fileObj.path;
            tdPath.title = fileObj.path;
            tr.appendChild(tdPath);

            const tdSize = document.createElement('td');
            tdSize.textContent = formatBytes(fileObj.size);
            tdSize.title = formatBytes(fileObj.size);
            tr.appendChild(tdSize);

            const tdMtime = document.createElement('td');
            tdMtime.textContent = fileObj.mtime;
            tr.appendChild(tdMtime);

            bigfilesDetailTableBody.appendChild(tr);
        });

        // 设置全选复选框
        const selectAllBox = document.getElementById('bigfilesSelectAll');
        if (selectAllBox) {
            // 如果所有文件都被选中，则全选复选框选中
            selectAllBox.checked = globalBigFilesData.every(file => file.selected);
            selectAllBox.onchange = () => {
                const allChecks = bigfilesDetailTableBody.querySelectorAll('.bigfile-check');
                allChecks.forEach(chk => {
                    chk.checked = selectAllBox.checked;
                    const filePath = chk.dataset.filePath;
                    const file = globalBigFilesData.find(f => f.path === filePath);
                    if (file) {
                        file.selected = selectAllBox.checked;
                    }
                });
                updateBigfilesSelectedInfo();
            };
        }

        // 为每个复选框绑定事件，更新对应文件的 selected 状态
        const fileChecks = bigfilesDetailTableBody.querySelectorAll('.bigfile-check');
        fileChecks.forEach(chk => {
            chk.addEventListener('change', function () {
                const filePath = this.dataset.filePath;
                const file = globalBigFilesData.find(f => f.path === filePath);
                if (file) {
                    file.selected = this.checked;
                }
                updateBigfilesSelectedInfo();
            });
        });
        updateBigfilesSelectedInfo();
    }

    /**
     * 更新大文件详情页底部显示的“已选文件大小”
     * 修改前原显示为：已选中 X 个文件，总大小 XX
     * 现统一修改为：已选择 XX
     */
    function updateBigfilesSelectedInfo() {
        let totalBytes = 0;
        globalBigFilesData.forEach(file => {
            if (file.selected) {
                totalBytes += file.size;
            }
        });
        bigfilesDetailSelectedInfo.textContent = `已选择 ${formatBytes(totalBytes)}`;
    }

    bigfilesDeleteSelectedBtn.addEventListener('click', async () => {
        const checkedRows = bigfilesDetailTableBody.querySelectorAll('.bigfile-check:checked');
        if (!checkedRows.length) {
            alert('请先勾选要删除的文件！');
            return;
        }

        if (!confirm('确定要删除选中的文件吗？此操作无法撤销。')) {
            return;
        }

        for (let chk of checkedRows) {
            const filePath = chk.dataset.filePath;
            try {
                const res = await fetch('http://localhost:53421/delete_file', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({path: filePath})
                });
                const data = await res.json();
                if (!data.success) {
                    console.error(`删除失败: ${filePath}`, data.error);
                    alert(`删除失败: ${filePath}\n原因: ${data.error}`);
                } else {
                    console.log(`删除成功: ${filePath}`);
                }
            } catch (e) {
                console.error('删除出错：', filePath, e);
                alert(`删除出错: ${filePath}\n原因: ${e}`);
            }
        }

        alert('删除操作完成');
        globalBigFilesData = globalBigFilesData.filter(file => {
            return !Array.from(checkedRows).some(chk => chk.dataset.filePath === file.path);
        });
        renderBigfilesTable(globalBigFilesData);
    });

    bigfilesDetailBackBtn.addEventListener('click', () => {
        bigfilesDetailPage.style.display = 'none';
        updateHomeCleanPageUI();
        // 如果上次是从“homeClean”过来，就回到“homeClean”
        if (previousPage === 'homeClean') {
            showPage('homeClean');
        } else {
            showPage('bigfiles');
        }
    });

    bigfilesDetailSearchBtn.addEventListener('click', () => {
        const keyword = bigfilesDetailSearchInput.value.trim().toLowerCase();
        if (!keyword) {
            renderBigfilesTable(globalBigFilesData);
            return;
        }

        const filtered = globalBigFilesData.filter(file => {
            return file.name.toLowerCase().includes(keyword) || file.path.toLowerCase().includes(keyword);
        });

        renderBigfilesTable(filtered);
    });

    // ============================
    // 10. 初始：默认进入首页
    // ============================
    showPage('home');

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
});