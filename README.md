# 酒店中央空调计费系统 (SE-AC-Hotel-System)

一个分布式的酒店中央空调管理与计费系统。该系统负责管理房间温度，基于优先级和时间片调度空调资源，并为住客计算详细的账单。

## 🚀 快速开始

### 环境要求
-   **Python 3.10+**
-   **Node.js 18+**

### 1. 启动后端
后端负责核心逻辑、数据库交互和调度算法。

```bash
cd backend

# 创建并激活虚拟环境
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
# source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动服务
uvicorn app.main:app --reload
uvicorn app.main:socket_app --reload
```
*后端运行在 `http://localhost:8000`*

### 2. 启动前端
前端为住客和工作人员提供 Web 操作界面。

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```
*前端运行在 `http://localhost:5173`*

---

## ✨ 功能特性

### 🏨 住客端 (房间控制)
-   **控制面板**: 开关空调、设定目标温度、调节风速（高/中/低）。
-   **实时反馈**: 查看当前室温、累计费用和空调状态（服务中/等待中）。
-   **智能调度**: 请求会根据优先级（风速）和时间片进入队列进行调度。

### 🛎️ 前台端 (入住/退房)
-   **入住办理**: 登记住客信息并分配房间。
-   **退房结账**: 生成包含住宿费和详细空调使用费的综合账单。
-   **详单打印**: 查看并打印详细的空调使用记录。

### 📊 经理端 (监控与报表)
-   **实时监控**: 查看所有房间的状态，包括当前温度、风速和队列状态。
-   **队列可视化**: 直观展示哪些房间正在服务，哪些正在等待。
-   **统计报表**: 通过交互式图表分析收入、能耗和使用趋势。

---

## 🏗️ 系统架构

本项目分为 Python FastAPI 后端和 React 前端。

-   **后端**: 实现“时间片 + 优先级”调度算法、计费逻辑和温度模拟。
    -   [阅读后端架构文档](./backend/ARCHITECTURE.md)
-   **前端**: 基于 React, Vite 和 Tailwind CSS 构建的现代单页应用。
    -   [阅读前端架构文档](./frontend/ARCHITECTURE.md)

## ⚙️ 系统配置

系统参数（定价、温度限制、调度规则）定义在 `backend/app/app_config.yaml` 文件中。
-   **默认最大并发空调数**: 3
-   **时间片长度**: 60 秒
-   **计费单价**: 1.0 元/度

## 📝 文档
-   **API 文档**: 启动后端后访问 `http://localhost:8000/docs`。
