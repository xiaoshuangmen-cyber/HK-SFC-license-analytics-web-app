/**
 * HKSFC 持牌公司名单数据分析引擎
 * 严格遵循 SYSTEM_DESIGN_RULES.md
 */

// 全局应用状态
const AppState = {
  rawRecords: [],       // 全量解析记录
  filteredRecords: [],  // 当前条件过滤后的记录
  isDefaultData: true,
  currentFilename: 'SFC_持牌公司名单_20261015_161728.xlsx',
  lastUpdateTime: '2026-10-15 16:17',
  
  // 过滤控制
  filterLicenseType: 'all', // all, type1, type9, both, bank, no_asset, va
  filterDateMetric: 'df',   // df: 综合首次获批, d1: 1号牌获批, d9: 9号牌获批
  filterYearSpan: 'all',    // all, 10y, 5y, 3y
  searchKeyword: '',
  
  // 分页状态
  currentPage: 1,
  pageSize: 15,
  
  // 图表实例
  charts: {
    annualTrend: null,
    compareTrend: null,
    monthlyTrend: null,
    licensePie: null,
    seasonalityBar: null
  }
};

// 页面加载入口
document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  initEventListeners();
  loadInitialData();
});

// 初始化 Lucide 图标 (如果可用)
function initIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// 事件监听绑定
function initEventListeners() {
  // 文件选择与拖拽
  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('upload-btn');
  const dropzone = document.getElementById('upload-dropzone');
  const resetBtn = document.getElementById('reset-btn');
  const vercelBtn = document.getElementById('vercel-guide-btn');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalClose = document.getElementById('modal-close');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleExcelUpload(file);
    });
  }

  if (dropzone) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleExcelUpload(file);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      loadInitialData();
      showToast('已恢复预置的 2026-10-15 全量数据', 'success');
    });
  }

  if (vercelBtn) {
    vercelBtn.addEventListener('click', showVercelGuide);
  }

  if (modalClose && modalOverlay) {
    modalClose.addEventListener('click', () => modalOverlay.classList.remove('active'));
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.remove('active');
    });
  }

  // 过滤控件交互
  const licenseTypeSelect = document.getElementById('filter-license-type');
  if (licenseTypeSelect) {
    licenseTypeSelect.addEventListener('change', (e) => {
      AppState.filterLicenseType = e.target.value;
      AppState.currentPage = 1;
      applyFiltersAndRender();
    });
  }

  const dateMetricSelect = document.getElementById('filter-date-metric');
  if (dateMetricSelect) {
    dateMetricSelect.addEventListener('change', (e) => {
      AppState.filterDateMetric = e.target.value;
      applyFiltersAndRender();
    });
  }

  // 时间跨度分段控制
  const spanButtons = document.querySelectorAll('.segmented-btn');
  spanButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      spanButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.filterYearSpan = btn.dataset.span;
      applyFiltersAndRender();
    });
  });

  // 搜索框
  const searchInput = document.getElementById('table-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      AppState.searchKeyword = e.target.value.trim().toLowerCase();
      AppState.currentPage = 1;
      renderTable();
    });
  }

  // 每页条数
  const pageSizeSelect = document.getElementById('page-size-select');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      AppState.pageSize = parseInt(e.target.value, 10);
      AppState.currentPage = 1;
      renderTable();
    });
  }

  // 导出 CSV
  const exportBtn = document.getElementById('export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportFilteredCSV);
  }

  // 窗口 Resize 自适应 ECharts
  window.addEventListener('resize', () => {
    Object.values(AppState.charts).forEach(chart => {
      if (chart) chart.resize();
    });
  });
}

// 加载初始数据
function loadInitialData() {
  if (window.SFC_DEFAULT_DATA && Array.isArray(window.SFC_DEFAULT_DATA)) {
    AppState.rawRecords = window.SFC_DEFAULT_DATA;
    AppState.isDefaultData = true;
    AppState.currentFilename = 'SFC_持牌公司名单_20261015_161728.xlsx';
    updateSourceBadge();
    applyFiltersAndRender();
  } else {
    // 降级尝试从本地抓取 json
    fetch('sfc_default_data.json')
      .then(res => res.json())
      .then(data => {
        AppState.rawRecords = data.map(normalizeRawRecord);
        AppState.isDefaultData = true;
        updateSourceBadge();
        applyFiltersAndRender();
      })
      .catch(err => {
        console.warn('默认数据加载中，请导入 Excel 文件', err);
      });
  }
}

// 规范化字段格式
function normalizeRawRecord(r) {
  const d1 = r.d1 || r['一号牌（证券交易）拿牌时间'] || '';
  const d9 = r.d9 || r['九号牌（资产管理）拿牌时间'] || '';
  const dates = [d1, d9].filter(d => d && d !== 'None' && d !== 'null');
  const df = dates.length > 0 ? dates.sort()[0] : '';

  return {
    c: r.c || r['中央编号 (CEREF)'] || r['中央编号'] || '',
    en: r.en || r['英文名称'] || '',
    zh: r.zh || r['中文名称'] || r['简体中文名称'] || r.en || '',
    u: r.u || r['公司详情网页 Link'] || '',
    l: r.l || r['持有的牌照类别 (匹配条件内)'] || r['持有的牌照类别'] || '',
    d1: d1,
    d9: d9,
    df: df,
    bk: (r.bk === 1 || (r['是否银行系券商'] && r['是否银行系券商'].includes('是'))) ? 1 : 0,
    na: (r.na === 1 || (r['持牌人不得持有客戶資產状态'] && r['持牌人不得持有客戶資產状态'].includes('Yes'))) ? 1 : 0,
    va: (r.va === 1 || (r['虚拟资产服务字段'] && String(r['虚拟资产服务字段']).trim() !== '' && String(r['虚拟资产服务字段']) !== 'None')) ? 1 : 0,
    act: r.act || r['受规管活动'] || ''
  };
}

// 处理用户上传的 Excel 文件
function handleExcelUpload(file) {
  const dropzoneText = document.querySelector('.dropzone-text');
  const originalText = dropzoneText ? dropzoneText.textContent : '';
  if (dropzoneText) dropzoneText.textContent = `正在智能解析 ${file.name} 中...`;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!jsonRows || jsonRows.length === 0) {
        throw new Error('未在 Excel 中读取到有效数据行');
      }

      // 提取转换
      AppState.rawRecords = jsonRows.map(row => {
        // 查找键名容错
        const findVal = (keywords) => {
          for (let k of Object.keys(row)) {
            for (let kw of keywords) {
              if (k.toLowerCase().includes(kw.toLowerCase())) return row[k];
            }
          }
          return '';
        };

        const ceref = String(findVal(['中央编号', 'ceref'])).trim();
        const en = String(findVal(['英文名称', 'english'])).trim();
        const zh = String(findVal(['中文名称', '简体中文名称', 'chinese'])).trim();
        const lic = String(findVal(['持有的牌照类别', '牌照类别'])).trim();
        const act = String(findVal(['受规管活动'])).trim();
        const url = String(findVal(['公司详情网页 Link', '网页', 'link', 'url'])).trim();
        const bankVal = String(findVal(['银行系'])).trim();
        const noAstVal = String(findVal(['客戶資產', '客户资产', '不得持有'])).trim();
        const vaVal = String(findVal(['虚拟资产', 'va'])).trim();

        // 拿牌时间格式化
        const parseDate = (raw) => {
          if (!raw) return '';
          if (typeof raw === 'number') {
            // Excel serial date number
            const jsDate = new Date(Math.round((raw - 25569) * 86400 * 1000));
            return jsDate.toISOString().slice(0, 10);
          }
          const str = String(raw).trim();
          const match = str.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
          if (match) {
            return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          }
          return str;
        };

        const d1 = parseDate(findVal(['一号牌', '1号牌']));
        const d9 = parseDate(findVal(['九号牌', '9号牌']));
        const dates = [d1, d9].filter(d => d && d !== 'None');
        const df = dates.length > 0 ? dates.sort()[0] : '';

        return {
          c: ceref,
          en: en,
          zh: zh || en,
          u: url,
          l: lic,
          d1: d1,
          d9: d9,
          df: df,
          bk: bankVal.includes('是') ? 1 : 0,
          na: (noAstVal.includes('Yes') || noAstVal.includes('是')) ? 1 : 0,
          va: (vaVal && vaVal !== 'None' && vaVal !== '0') ? 1 : 0,
          act: act
        };
      });

      AppState.isDefaultData = false;
      AppState.currentFilename = file.name;
      AppState.lastUpdateTime = new Date().toLocaleString();
      AppState.currentPage = 1;

      updateSourceBadge();
      applyFiltersAndRender();
      showToast(`成功解析导入 ${AppState.rawRecords.length} 家持牌公司数据！`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`Excel 解析失败: ${err.message}`, 'error');
    } finally {
      if (dropzoneText) dropzoneText.textContent = originalText;
    }
  };
  reader.readAsArrayBuffer(file);
}

// 更新数据源标识
function updateSourceBadge() {
  const fileBadge = document.getElementById('current-file-badge');
  const countBadge = document.getElementById('current-count-badge');
  const timeBadge = document.getElementById('current-time-badge');
  
  if (fileBadge) fileBadge.textContent = AppState.currentFilename;
  if (countBadge) countBadge.textContent = `${AppState.rawRecords.length.toLocaleString()} 家`;
  if (timeBadge) timeBadge.textContent = AppState.lastUpdateTime;
}

// 统一过滤与全量图表渲染
function applyFiltersAndRender() {
  const typeFilter = AppState.filterLicenseType;

  AppState.filteredRecords = AppState.rawRecords.filter(item => {
    if (typeFilter === 'type1' && (!item.d1 || !item.l.includes('1'))) return false;
    if (typeFilter === 'type9' && (!item.d9 || !item.l.includes('9'))) return false;
    if (typeFilter === 'both' && (!item.d1 || !item.d9)) return false;
    if (typeFilter === 'bank' && item.bk !== 1) return false;
    if (typeFilter === 'no_asset' && item.na !== 1) return false;
    if (typeFilter === 'va' && item.va !== 1) return false;
    return true;
  });

  renderKPIs();
  renderAnnualChart();
  renderCompareChart();
  renderMonthlyChart();
  renderLicensePieChart();
  renderSeasonalityChart();
  renderTable();
}

// 渲染顶部 KPI 指标
function renderKPIs() {
  const records = AppState.filteredRecords;
  const total = records.length;
  
  const count1 = records.filter(r => r.d1 || r.l.includes('1')).length;
  const count9 = records.filter(r => r.d9 || r.l.includes('9')).length;
  const countBoth = records.filter(r => (r.d1 || r.l.includes('1')) && (r.d9 || r.l.includes('9'))).length;
  const countBank = records.filter(r => r.bk === 1).length;
  const countVA = records.filter(r => r.va === 1).length;
  const countNoAsset = records.filter(r => r.na === 1).length;

  // 找峰值年份
  const metric = AppState.filterDateMetric;
  const yearCounts = {};
  records.forEach(r => {
    const d = r[metric];
    if (d && d.length >= 4) {
      const y = d.slice(0, 4);
      yearCounts[y] = (yearCounts[y] || 0) + 1;
    }
  });

  let peakYear = '—';
  let peakCount = 0;
  for (let [y, cnt] of Object.entries(yearCounts)) {
    if (cnt > peakCount) {
      peakCount = cnt;
      peakYear = y;
    }
  }

  // 2026年拿牌数量
  const year2026Count = yearCounts['2026'] || 0;
  const year2025Count = yearCounts['2025'] || 0;

  // DOM 设值
  setText('kpi-total-companies', total.toLocaleString());
  setText('kpi-type1-count', count1.toLocaleString());
  setText('kpi-type9-count', count9.toLocaleString());
  setText('kpi-both-count', countBoth.toLocaleString());
  setText('kpi-peak-year', `${peakYear}年 (${peakCount}家)`);
  setText('kpi-recent-count', `${year2026Count} 家`);
  setText('kpi-va-count', countVA.toLocaleString());
  setText('kpi-noasset-ratio', total > 0 ? `${((countNoAsset / total) * 100).toFixed(1)}%` : '0%');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// 维度一：历年新发牌照总数量走势复合图
function renderAnnualChart() {
  const chartDom = document.getElementById('chart-annual-trend');
  if (!chartDom) return;
  if (!AppState.charts.annualTrend) {
    AppState.charts.annualTrend = echarts.init(chartDom);
  }
  const chart = AppState.charts.annualTrend;

  const metric = AppState.filterDateMetric;
  const records = AppState.filteredRecords;

  // 年份统计
  const yearMap = {};
  records.forEach(r => {
    const d = r[metric];
    if (d && d.length >= 4) {
      const y = d.slice(0, 4);
      yearMap[y] = (yearMap[y] || 0) + 1;
    }
  });

  let years = Object.keys(yearMap).sort();
  if (AppState.filterYearSpan === '10y') {
    years = years.slice(-10);
  } else if (AppState.filterYearSpan === '5y') {
    years = years.slice(-5);
  } else if (AppState.filterYearSpan === '3y') {
    years = years.slice(-3);
  }

  const yearlyCounts = years.map(y => yearMap[y] || 0);
  
  // 累计走势
  let cum = 0;
  const cumulativeData = yearlyCounts.map(cnt => {
    cum += cnt;
    return cum;
  });

  // YoY 同比变化
  const yoyData = yearlyCounts.map((cnt, i) => {
    if (i === 0 || yearlyCounts[i - 1] === 0) return 0;
    return Number((((cnt - yearlyCounts[i - 1]) / yearlyCounts[i - 1]) * 100).toFixed(1));
  });

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: '#9CA3AF' } },
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(6, 182, 212, 0.3)',
      textStyle: { color: '#F3F4F6' }
    },
    legend: {
      data: ['新获批持牌公司数', '累计持牌总数', '同比增幅 (YoY %)'],
      textStyle: { color: '#9CA3AF' },
      top: 0
    },
    grid: {
      left: '2%',
      right: '2%',
      bottom: '8%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: years,
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.15)' } },
      axisTick: { alignWithLabel: true },
      axisLabel: {
        color: '#9CA3AF',
        interval: 0,
        fontSize: 12,
        margin: 12
      }
    },
    yAxis: [
      {
        type: 'value',
        name: '新获批公司数',
        nameTextStyle: { color: '#9CA3AF' },
        axisLabel: { color: '#9CA3AF' },
        splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } }
      },
      {
        type: 'value',
        name: '累计总数',
        nameTextStyle: { color: '#9CA3AF' },
        axisLabel: { color: '#9CA3AF' },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '新获批持牌公司数',
        type: 'bar',
        barMaxWidth: 32,
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#06B6D4' },
            { offset: 1, color: 'rgba(6, 182, 212, 0.2)' }
          ])
        },
        label: {
          show: true,
          position: 'top',
          color: '#38BDF8',
          fontSize: 11,
          fontWeight: 500
        },
        data: yearlyCounts
      },
      {
        name: '累计持牌总数',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        lineStyle: { width: 3, color: '#10B981' },
        itemStyle: { color: '#10B981' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(16, 185, 129, 0.25)' },
            { offset: 1, color: 'rgba(16, 185, 129, 0.01)' }
          ])
        },
        data: cumulativeData
      }
    ]
  };

  chart.setOption(option);
}

// 维度二：1号牌（券商） vs 9号牌（资管） 历年获批对比走势
function renderCompareChart() {
  const chartDom = document.getElementById('chart-compare-trend');
  if (!chartDom) return;
  if (!AppState.charts.compareTrend) {
    AppState.charts.compareTrend = echarts.init(chartDom);
  }
  const chart = AppState.charts.compareTrend;

  const records = AppState.filteredRecords;
  const yearsSet = new Set();
  const t1Map = {};
  const t9Map = {};

  records.forEach(r => {
    if (r.d1 && r.d1.length >= 4) {
      const y1 = r.d1.slice(0, 4);
      yearsSet.add(y1);
      t1Map[y1] = (t1Map[y1] || 0) + 1;
    }
    if (r.d9 && r.d9.length >= 4) {
      const y9 = r.d9.slice(0, 4);
      yearsSet.add(y9);
      t9Map[y9] = (t9Map[y9] || 0) + 1;
    }
  });

  let years = Array.from(yearsSet).sort();
  if (AppState.filterYearSpan === '10y') {
    years = years.slice(-10);
  } else if (AppState.filterYearSpan === '5y') {
    years = years.slice(-5);
  } else if (AppState.filterYearSpan === '3y') {
    years = years.slice(-3);
  }

  const t1Data = years.map(y => t1Map[y] || 0);
  const t9Data = years.map(y => t9Map[y] || 0);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(6, 182, 212, 0.3)',
      textStyle: { color: '#F3F4F6' }
    },
    legend: {
      data: ['1号牌 (证券交易)', '9号牌 (资产管理)'],
      textStyle: { color: '#9CA3AF' },
      top: 0
    },
    grid: {
      left: '2%',
      right: '2%',
      bottom: '8%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: years,
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.15)' } },
      axisTick: { alignWithLabel: true },
      axisLabel: {
        color: '#9CA3AF',
        interval: 0,
        fontSize: 12,
        margin: 12
      }
    },
    yAxis: {
      type: 'value',
      name: '获批公司数',
      nameTextStyle: { color: '#9CA3AF' },
      axisLabel: { color: '#9CA3AF' },
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } }
    },
    series: [
      {
        name: '1号牌 (证券交易)',
        type: 'bar',
        barMaxWidth: 20,
        barGap: '15%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: '#38BDF8'
        },
        label: {
          show: true,
          position: 'top',
          color: '#38BDF8',
          fontSize: 10
        },
        data: t1Data
      },
      {
        name: '9号牌 (资产管理)',
        type: 'bar',
        barMaxWidth: 20,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: '#10B981'
        },
        label: {
          show: true,
          position: 'top',
          color: '#34D399',
          fontSize: 10
        },
        data: t9Data
      }
    ]
  };

  chart.setOption(option);
}

// 维度三：高精度月度获批时间序列走势
function renderMonthlyChart() {
  const chartDom = document.getElementById('chart-monthly-trend');
  if (!chartDom) return;
  if (!AppState.charts.monthlyTrend) {
    AppState.charts.monthlyTrend = echarts.init(chartDom);
  }
  const chart = AppState.charts.monthlyTrend;

  const metric = AppState.filterDateMetric;
  const records = AppState.filteredRecords;

  const monthCounts = {};
  records.forEach(r => {
    const d = r[metric];
    if (d && d.length >= 7) {
      const ym = d.slice(0, 7); // YYYY-MM
      monthCounts[ym] = (monthCounts[ym] || 0) + 1;
    }
  });

  let months = Object.keys(monthCounts).sort();

  // 根据选中的年份跨度截取月份
  if (AppState.filterYearSpan === '3y') {
    months = months.slice(-36);
  } else if (AppState.filterYearSpan === '5y') {
    months = months.slice(-60);
  } else if (AppState.filterYearSpan === '10y') {
    months = months.slice(-120);
  } else {
    // 默认展示近5年以保持视觉优雅，提供 DataZoom 支持全量缩放
    months = months.filter(m => m >= '2018-01');
  }

  const values = months.map(m => monthCounts[m] || 0);

  // 计算 3个月移动平均线 (3-MA) 平滑趋势
  const maData = values.map((val, idx, arr) => {
    if (idx < 2) return val;
    return Number(((arr[idx] + arr[idx - 1] + arr[idx - 2]) / 3).toFixed(1));
  });

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(6, 182, 212, 0.3)',
      textStyle: { color: '#F3F4F6' }
    },
    legend: {
      data: ['当月获发牌照数', '3个月移动平均 (3-MA)'],
      textStyle: { color: '#9CA3AF' },
      top: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '12%',
      top: '15%',
      containLabel: true
    },
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100
      },
      {
        type: 'slider',
        height: 18,
        bottom: 4,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        fillerColor: 'rgba(6, 182, 212, 0.2)',
        handleStyle: { color: '#06B6D4' },
        textStyle: { color: '#9CA3AF' }
      }
    ],
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.15)' } },
      axisLabel: {
        color: '#9CA3AF',
        interval: Math.max(1, Math.floor(months.length / 15))
      }
    },
    yAxis: {
      type: 'value',
      name: '月度获批数量',
      nameTextStyle: { color: '#9CA3AF' },
      axisLabel: { color: '#9CA3AF' },
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } }
    },
    series: [
      {
        name: '当月获发牌照数',
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#38BDF8' },
            { offset: 1, color: 'rgba(56, 189, 248, 0.1)' }
          ])
        },
        data: values
      },
      {
        name: '3个月移动平均 (3-MA)',
        type: 'line',
        smooth: true,
        lineStyle: { width: 2.5, color: '#F59E0B' },
        itemStyle: { color: '#F59E0B' },
        data: maData
      }
    ]
  };

  chart.setOption(option);
}

// 维度四：持牌类别分布 (环形图)
function renderLicensePieChart() {
  const chartDom = document.getElementById('chart-license-pie');
  if (!chartDom) return;
  if (!AppState.charts.licensePie) {
    AppState.charts.licensePie = echarts.init(chartDom);
  }
  const chart = AppState.charts.licensePie;

  const records = AppState.filteredRecords;
  let type1 = 0, type9 = 0, both = 0, other = 0;

  records.forEach(r => {
    const has1 = r.d1 || r.l.includes('1');
    const has9 = r.d9 || r.l.includes('9');
    if (has1 && has9) {
      both++;
    } else if (has1) {
      type1++;
    } else if (has9) {
      type9++;
    } else {
      other++;
    }
  });

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(6, 182, 212, 0.3)',
      textStyle: { color: '#F3F4F6' },
      formatter: '{b}: {c} 家 ({d}%)'
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: { color: '#9CA3AF' }
    },
    series: [
      {
        name: '持牌组合结构',
        type: 'pie',
        radius: ['45%', '72%'],
        center: ['40%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 8,
          borderColor: '#111827',
          borderWidth: 2
        },
        label: { show: false },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold',
            color: '#F3F4F6'
          }
        },
        data: [
          { value: both, name: '1+9号 综合双牌', itemStyle: { color: '#06B6D4' } },
          { value: type9, name: '纯9号 资产管理', itemStyle: { color: '#10B981' } },
          { value: type1, name: '纯1号 证券交易', itemStyle: { color: '#38BDF8' } },
          { value: other, name: '其他规管牌照', itemStyle: { color: '#A855F7' } }
        ]
      }
    ]
  };

  chart.setOption(option);
}

// 维度五：发牌季节性规律 (1~12月分布)
function renderSeasonalityChart() {
  const chartDom = document.getElementById('chart-seasonality-bar');
  if (!chartDom) return;
  if (!AppState.charts.seasonalityBar) {
    AppState.charts.seasonalityBar = echarts.init(chartDom);
  }
  const chart = AppState.charts.seasonalityBar;

  const metric = AppState.filterDateMetric;
  const records = AppState.filteredRecords;

  const monthDist = Array(12).fill(0);
  records.forEach(r => {
    const d = r[metric];
    if (d && d.length >= 7) {
      const m = parseInt(d.slice(5, 7), 10);
      if (m >= 1 && m <= 12) {
        monthDist[m - 1]++;
      }
    }
  });

  const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(6, 182, 212, 0.3)',
      textStyle: { color: '#F3F4F6' },
      formatter: '{b}: 历史累计获批 {c} 家'
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '10%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: monthLabels,
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.15)' } },
      axisLabel: { color: '#9CA3AF' }
    },
    yAxis: {
      type: 'value',
      name: '累计获批家数',
      nameTextStyle: { color: '#9CA3AF' },
      axisLabel: { color: '#9CA3AF' },
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } }
    },
    series: [
      {
        name: '累计获批',
        type: 'bar',
        barMaxWidth: 20,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: function(params) {
            // 高亮峰值月份
            const maxVal = Math.max(...monthDist);
            return params.value === maxVal
              ? '#10B981'
              : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: '#06B6D4' },
                  { offset: 1, color: 'rgba(6, 182, 212, 0.15)' }
                ]);
          }
        },
        data: monthDist
      }
    ]
  };

  chart.setOption(option);
}

// 维度六：分页明细表格渲染
function renderTable() {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  const keyword = AppState.searchKeyword;
  let rows = AppState.filteredRecords;

  if (keyword) {
    rows = rows.filter(r => {
      return (
        r.c.toLowerCase().includes(keyword) ||
        r.en.toLowerCase().includes(keyword) ||
        r.zh.toLowerCase().includes(keyword) ||
        r.l.toLowerCase().includes(keyword)
      );
    });
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / AppState.pageSize));
  if (AppState.currentPage > totalPages) AppState.currentPage = totalPages;

  const startIdx = (AppState.currentPage - 1) * AppState.pageSize;
  const endIdx = Math.min(startIdx + AppState.pageSize, total);
  const pageItems = rows.slice(startIdx, endIdx);

  tbody.innerHTML = '';
  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-secondary);">暂无匹配的持牌公司记录</td></tr>`;
  } else {
    pageItems.forEach((r, idx) => {
      const tr = document.createElement('tr');
      
      // 牌照类别微型徽章
      let licBadges = '';
      if (r.l.includes('1')) licBadges += `<span class="table-badge badge-cyan">1号</span>`;
      if (r.l.includes('2')) licBadges += `<span class="table-badge badge-purple">2号</span>`;
      if (r.l.includes('4')) licBadges += `<span class="table-badge badge-amber">4号</span>`;
      if (r.l.includes('9')) licBadges += `<span class="table-badge badge-green">9号</span>`;
      if (r.va) licBadges += `<span class="table-badge badge-purple">VA</span>`;

      tr.innerHTML = `
        <td style="font-family: monospace; font-weight: 600; color: var(--primary-cyan);">${r.c || '—'}</td>
        <td>
          <div style="font-weight: 600; color: #F3F4F6;">${r.zh || r.en}</div>
          <div style="font-size: 0.72rem; color: #9CA3AF;">${r.en}</div>
        </td>
        <td>${licBadges || r.l || '—'}</td>
        <td style="font-family: monospace;">${r.d1 || '—'}</td>
        <td style="font-family: monospace;">${r.d9 || '—'}</td>
        <td>
          ${r.bk ? '<span class="table-badge badge-amber">银行系</span>' : '<span style="color: #64748B;">非银行</span>'}
          ${r.na ? '<span class="table-badge badge-purple" title="不得持有客户资产">资产受限</span>' : ''}
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="showCompanyDetail('${r.c}')">详情</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 渲染分页按钮
  renderPagination(total, totalPages, startIdx, endIdx);
}

// 分页条控制
function renderPagination(total, totalPages, startIdx, endIdx) {
  const infoEl = document.getElementById('pagination-info');
  const controlsEl = document.getElementById('pagination-controls');
  if (!infoEl || !controlsEl) return;

  infoEl.textContent = `显示第 ${total === 0 ? 0 : startIdx + 1} - ${endIdx} 条，共 ${total.toLocaleString()} 条公司记录`;

  controlsEl.innerHTML = '';

  const createBtn = (text, disabled, onClick, active = false) => {
    const btn = document.createElement('button');
    btn.className = `page-btn ${active ? 'active' : ''}`;
    btn.innerHTML = text;
    btn.disabled = disabled;
    if (!disabled && onClick) btn.addEventListener('click', onClick);
    return btn;
  };

  // 上一页
  controlsEl.appendChild(createBtn('‹', AppState.currentPage === 1, () => {
    AppState.currentPage--;
    renderTable();
  }));

  // 页码逻辑 (最多展示 5 个页码)
  let startPage = Math.max(1, AppState.currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  if (startPage > 1) {
    controlsEl.appendChild(createBtn('1', false, () => {
      AppState.currentPage = 1;
      renderTable();
    }));
    if (startPage > 2) {
      const span = document.createElement('span');
      span.style.color = '#64748B';
      span.style.padding = '0 4px';
      span.textContent = '...';
      controlsEl.appendChild(span);
    }
  }

  for (let p = startPage; p <= endPage; p++) {
    controlsEl.appendChild(createBtn(p, false, () => {
      AppState.currentPage = p;
      renderTable();
    }, p === AppState.currentPage));
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const span = document.createElement('span');
      span.style.color = '#64748B';
      span.style.padding = '0 4px';
      span.textContent = '...';
      controlsEl.appendChild(span);
    }
    controlsEl.appendChild(createBtn(totalPages, false, () => {
      AppState.currentPage = totalPages;
      renderTable();
    }));
  }

  // 下一页
  controlsEl.appendChild(createBtn('›', AppState.currentPage === totalPages || totalPages === 0, () => {
    AppState.currentPage++;
    renderTable();
  }));
}

// 查看公司详情模态框
window.showCompanyDetail = function(ceref) {
  const item = AppState.rawRecords.find(r => r.c === ceref);
  if (!item) return;

  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  if (modalTitle) modalTitle.textContent = `${item.zh || item.en} (${item.c})`;
  if (modalBody) {
    modalBody.innerHTML = `
      <div class="detail-list">
        <div class="detail-row">
          <div class="detail-label">中央编号 (CEREF)</div>
          <div class="detail-value" style="font-family: monospace; font-size: 1.1rem; color: var(--primary-cyan); font-weight: 700;">${item.c}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">英文名称</div>
          <div class="detail-value">${item.en}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">中文名称</div>
          <div class="detail-value">${item.zh}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">持牌类别组合</div>
          <div class="detail-value">${item.l || '—'}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">受规管活动详情</div>
          <div class="detail-value" style="line-height: 1.6; color: #CBD5E1;">${item.act || '—'}</div>
        </div>
        <div class="detail-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div>
            <div class="detail-label">1号牌拿牌时间</div>
            <div class="detail-value" style="font-family: monospace;">${item.d1 || '未持有或未获批'}</div>
          </div>
          <div>
            <div class="detail-label">9号牌拿牌时间</div>
            <div class="detail-value" style="font-family: monospace;">${item.d9 || '未持有或未获批'}</div>
          </div>
        </div>
        <div class="detail-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div>
            <div class="detail-label">是否银行系</div>
            <div class="detail-value">${item.bk ? '是 (银行附属券商/资管)' : '否 (独立非银行机构)'}</div>
          </div>
          <div>
            <div class="detail-label">客户资产受限状态</div>
            <div class="detail-value">${item.na ? '<span style="color:#F87171;">不得持有客户资产</span>' : '无受限 (可持有资产)'}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">虚拟资产 (VA) 服务</div>
          <div class="detail-value">${item.va ? '<span style="color:#A855F7; font-weight: 600;">已涉足/获批虚拟资产活动</span>' : '未涉足'}</div>
        </div>
        <div class="detail-row" style="margin-top: 0.5rem;">
          <div class="detail-label">SFC 官方记录直达</div>
          <div class="detail-value">
            <a href="${item.u || `https://apps.sfc.hk/publicregWeb/corp/${item.c}/details`}" target="_blank" rel="noopener noreferrer" class="table-link">
              打开香港证监会持牌人公众纪录册 ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }

  if (modalOverlay) modalOverlay.classList.add('active');
};

// 弹出 Vercel 部署指引
function showVercelGuide() {
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  if (modalTitle) modalTitle.textContent = '🚀 Vercel 零配置秒级部署指引';
  if (modalBody) {
    modalBody.innerHTML = `
      <div style="font-size: 0.875rem; line-height: 1.6; color: #E2E8F0;">
        <p style="margin-bottom: 0.75rem;">本系统采用<strong>纯静态现代化单页架构 (SPA)</strong>，内置所有核心数据，完全符合 Vercel 静态托管规范。</p>
        
        <h4 style="color: var(--primary-cyan); margin: 1rem 0 0.25rem 0;">第 1 步：提交到本地 Git 仓库</h4>
        <div class="code-block">git init
git add .
git commit -m "feat: HK SFC license analytics web app"</div>

        <h4 style="color: var(--primary-cyan); margin: 1rem 0 0.25rem 0;">第 2 步：推送到 GitHub 或 GitLab</h4>
        <div class="code-block">git remote add origin &lt;YOUR_GITHUB_REPO_URL&gt;
git branch -M main
git push -u origin main</div>

        <h4 style="color: var(--primary-cyan); margin: 1rem 0 0.25rem 0;">第 3 步：在 Vercel 导入并一键发布</h4>
        <ol style="margin-left: 1.25rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem;">
          <li>登录 <a href="https://vercel.com" target="_blank" class="table-link">Vercel 官网</a>，点击 <strong>Add New Project</strong>；</li>
          <li>选择刚刚推送的 GitHub 仓库；</li>
          <li><strong>Framework Preset</strong> 保持默认的 <strong>Other / Static</strong>；</li>
          <li>点击 <strong>Deploy</strong>，30 秒后即刻获得全球免费 HTTPS CDN 域名！</li>
        </ol>
      </div>
    `;
  }

  if (modalOverlay) modalOverlay.classList.add('active');
}

// 导出当前筛选过滤后的 CSV
function exportFilteredCSV() {
  const records = AppState.filteredRecords;
  if (!records || records.length === 0) {
    showToast('无可用数据可供导出', 'warning');
    return;
  }

  const headers = ['中央编号', '中文名称', '英文名称', '持牌类别', '1号牌拿牌时间', '9号牌拿牌时间', '最早持牌时间', '是否银行系', '不得持有资产', '虚拟资产'];
  const rows = records.map(r => [
    `"${r.c}"`,
    `"${(r.zh || '').replace(/"/g, '""')}"`,
    `"${(r.en || '').replace(/"/g, '""')}"`,
    `"${(r.l || '').replace(/"/g, '""')}"`,
    `"${r.d1 || ''}"`,
    `"${r.d9 || ''}"`,
    `"${r.df || ''}"`,
    `"${r.bk ? '是' : '否'}"`,
    `"${r.na ? 'Yes' : 'No'}"`,
    `"${r.va ? 'Yes' : 'No'}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SFC_持牌公司分析导出_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('已导出当前筛选的 CSV 文件', 'success');
}

// 轻量级 Toast 提示
function showToast(msg, type = 'info') {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '2rem';
    toast.style.right = '2rem';
    toast.style.padding = '0.75rem 1.25rem';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '0.875rem';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.4)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    document.body.appendChild(toast);
  }

  if (type === 'success') {
    toast.style.background = '#065F46';
    toast.style.color = '#34D399';
    toast.style.border = '1px solid #10B981';
  } else if (type === 'error') {
    toast.style.background = '#7F1D1D';
    toast.style.color = '#F87171';
    toast.style.border = '1px solid #EF4444';
  } else {
    toast.style.background = '#1E293B';
    toast.style.color = '#38BDF8';
    toast.style.border = '1px solid #06B6D4';
  }

  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 3000);
}
