# 香港 SFC 持牌公司新拿牌与趋势分析大屏 (HK SFC License Analytics Hub)

基于香港证监会 (HKSFC) 持牌法团公开名录数据构建的专业数据智能分析系统。深入追踪自 2003 年《证券及期货条例》(SFO) 实施以来，全港 3,600+ 持牌机构按年、按月的获牌节奏、牌照结构变迁与宏观金融周期演进。

![Glassmorphism UI](https://img.shields.io/badge/UI-Dark%20Glassmorphism-06B6D4)
![License](https://img.shields.io/badge/License-MIT-10B981)
![Platform](https://img.shields.io/badge/Platform-Vercel%20Ready-000000)

---

## 🌟 核心特性

- **🚀 零配置 Vercel 静态托管**：纯静态现代单页应用 (SPA)，无需后端数据库或运行时，零构建依赖，秒级全球 CDN 部署。
- **📊 预置全量真实数据**：开箱即用，已内置香港 SFC 2026 年最新全量 3,672 家持牌公司完整字段。
- **📥 Excel 动态解析引擎**：集成 SheetJS 前端流式解析，支持拖拽或选择任意版本的 `SFC_持牌公司名单_*.xlsx` 文件，毫秒级自适应识别并重绘全站图表。
- **📈 深度周期与趋势分析**：
  - **按年维度 (Annual Trend)**：历年新发牌照总数量柱状走势、累计存量总规模曲线、同比增减幅 (YoY)。
  - **1号券商牌 vs 9号资管牌 对比**：清晰呈现香港由传统证券经纪向国际资产管理枢纽的战略重心变迁。
  - **按月维度 (Monthly Granularity)**：月度获批时间序列波动、3个月移动均线 (3-MA) 平滑、交互式区域缩放 (DataZoom)。
  - **审批季节性规律 (Seasonality)**：1~12月各自然月份累计获批聚合，揭示监管机构全年审批节奏。
- **🔍 全维度明细透视与分页检索**：
  - 支持按中央编号 (CEREF)、公司中英文名实时模糊搜索。
  - 支持 1号牌、9号牌、双牌机构、银行系、资产受限机构等多条件过滤。
  - 严格遵循现代 UI 规范的分页组件（支持 10/15/20/50 条每页），支持一键导出过滤后的 CSV。
- **💎 高端暗黑毛玻璃设计**：严格遵循深色模式、Glassmorphism 微光质感、青绿科技渐变色与平滑微动画。

---

## 📁 项目结构

```text
├── index.html          # 主页面 HTML
├── analytics.css       # 现代暗黑毛玻璃 UI/UX 样式规范
├── analytics.js        # 数据分析引擎、Excel 解析与 ECharts 交互逻辑
├── default_data.js     # 预置 3,672 家持牌法团全量真实数据集
├── vercel.json         # Vercel 静态托管与路由安全标头配置
├── data/               # 抓取的 SFC 持牌公司名单 Excel 数据归档
└── README.md           # 项目说明文档
```

---

## 🚀 本地运行

无需安装任何繁重依赖，以下任意一种方式均可：

### 方式 1：双击直接运行
直接在浏览器中打开 `index.html` 即可运行。

### 方式 2：使用本地轻量 HTTP 服务
```bash
python3 -m http.server 8080
```
在浏览器中访问 [http://localhost:8080](http://localhost:8080)。

---

## ☁️ 部署到 Vercel 指南

1. 登录 [Vercel 官网](https://vercel.com)。
2. 点击 **Add New Project**，导入本 GitHub 仓库。
3. **Framework Preset** 选择 **Other**（静态应用）。
4. 点击 **Deploy**，约 30 秒即可获得专属全球 HTTPS 加速域名！

---

## 📄 数据与版权声明

本项目数据源自香港证券及期货事务监察委员会 (HKSFC) 持牌人及注册机构公众纪录册之公开信息。本工具仅供行业研究、合规分析与技术交流使用。
