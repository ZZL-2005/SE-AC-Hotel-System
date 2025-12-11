# 适配器模块使用说明

## 概述

本适配器模块为外部前端系统(如 group_a)提供统一的 HTTP 和 SocketIO 接入点，实现协议转换和数据模型映射。

## 架构设计

```
外部前端 (group_a)
    ↓
/adapter 统一入口
    ├── HTTP: /adapter/export/*
    └── SocketIO: io('/adapter')
    ↓
适配层转换
    ├── adapter_router.py (HTTP 适配)
    └── adapter_sio.py (SocketIO 适配)
    ↓
内部 HTTP API 调用
    ├── /rooms/{id}/ac/*
    ├── /checkin, /checkout
    └── /monitor/*
```

## 文件说明

### 1. `adapter_router.py` - HTTP 适配器

**职责**: 处理 group_a 的 HTTP 请求,转换为我们的内部 API 调用

**支持的接口**:

- `GET /adapter/export/bill/{room_id}` - 导出房间综合账单(文本格式)
  - 内部调用: `GET /rooms/{room_id}/bills`
  - 返回格式: `text/plain; charset=utf-8`
  - 包含: 房间号、住户姓名、入住时间、空调费用、住宿费用、总计

- `GET /adapter/export/detail/{room_id}` - 导出房间空调详单(CSV 格式)
  - 内部调用: `GET /rooms/{room_id}/bills`
  - 返回格式: `text/csv; charset=utf-8`
  - CSV 表头: 房间号,请求时间,服务开始时间,服务结束时间,服务时长(秒),风速,本段费用(元),累积费用(元)

### 2. `adapter_sio.py` - SocketIO 适配器

**职责**: 处理 group_a 的 SocketIO 消息,转换为我们的内部 HTTP API 调用

**接收事件**: `client_action`

支持的 action:

| action | 含义 | 映射到内部 API | 说明 |
|--------|------|---------------|------|
| power | 空调开关 | POST /rooms/{id}/ac/power-on/off | value: true/false |
| speed | 调整风速 | POST /rooms/{id}/ac/change-speed | value: low/medium/high |
| temp | 调整温度 | POST /rooms/{id}/ac/change-temp | value: 18-30 |
| submit_checkin | 提交入住申请 | POST /checkin | value: {name, idCard} |
| approve_checkin | 批准入住 | (幂等操作) | value: true |
| request_checkout | 请求结账 | (日志记录) | value: true |
| confirm_checkout | 确认结账 | POST /checkout | value: true |
| update_settings | 更新系统配置 | PUT /monitor/hyperparams | value: {mode, maxServices, ...} |

**发送事件**:

- `sync_data` - 房间状态同步 (连接时 + 每次操作后)
  - 包含: rooms[], config, stats
  
- `log_history` - 历史日志 (连接时发送)
  - 最近 50 条操作日志

- `new_log` - 新日志 (每次操作时实时推送)
  - 格式: {type, title, desc, time}

## 数据模型映射

### 房间状态映射

| group_a 字段 | 我们的字段 | 映射规则 |
|-------------|-----------|---------|
| id | roomId | 直接映射 |
| status | status | occupied/serving/waiting → "occupied"; 其他 → "free" |
| temp | currentTemp | 直接映射 |
| target | targetTemp | 直接映射 |
| speed | speed | HIGH→"high", MID→"medium", LOW→"low" |
| currentCost | totalFee | 直接映射 |
| isOn | isServing | 直接映射 |
| isRunning | isServing | 直接映射 |

### 系统配置映射

| group_a 字段 | 我们的字段 | 映射规则 |
|-------------|-----------|---------|
| mode | temperature.mode | 直接映射 |
| maxServices | scheduler.max_concurrent | 直接映射 |
| timeSlice | scheduler.time_slice_seconds | 直接映射 |
| tempLimit.min/max | temperature.cool_range/heat_range | 根据 mode 选择 |

## 外部前端接入指南

### HTTP 接入

```javascript
// 修改 baseURL
axios.defaults.baseURL = 'http://你的后端地址/adapter';

// 调用账单接口
const bill = await axios.get('/export/bill/101');
console.log(bill.data); // 文本账单

// 调用详单接口
const detail = await axios.get('/export/detail/101');
console.log(detail.data); // CSV 详单
```

### SocketIO 接入

```javascript
import { io } from 'socket.io-client';

// 连接到适配器 SocketIO
const socket = io('http://你的后端地址/adapter');

// 监听事件
socket.on('connect', () => {
    console.log('连接成功:', socket.id);
});

socket.on('sync_data', (data) => {
    console.log('房间状态:', data.rooms);
    console.log('系统配置:', data.config);
    console.log('统计信息:', data.stats);
});

socket.on('log_history', (logs) => {
    console.log('历史日志:', logs);
});

socket.on('new_log', (log) => {
    console.log('新日志:', log);
});

// 发送操作指令
socket.emit('client_action', {
    roomId: '101',
    action: 'power',
    value: true
});

socket.emit('client_action', {
    roomId: '101',
    action: 'temp',
    value: 24
});

socket.emit('client_action', {
    roomId: '101',
    action: 'submit_checkin',
    value: {
        name: '张三',
        idCard: '110101199901010000'
    }
});
```

## 错误处理

### HTTP 错误

- `404 Not Found` - 房间不存在或无数据
  - 返回: `"无数据"` (text/plain)

- `500 Internal Server Error` - 适配器内部错误
  - 返回: `{"detail": "适配器错误: ..."}`

### SocketIO 错误

- 操作失败时会发送 `new_log` 事件,type 为 "system",描述错误信息
- 不会中断连接,前端可以继续操作

## 调试技巧

### 查看适配器日志

后端控制台会输出:
```
[Adapter SIO] Client connected: xxx
[Adapter SIO] Client disconnected: xxx
[Adapter SIO] HTTP error: ...
```

### 验证 HTTP 适配器

```bash
# 测试账单接口
curl http://localhost:8000/adapter/export/bill/101

# 测试详单接口
curl http://localhost:8000/adapter/export/detail/101
```

### 验证 SocketIO 适配器

使用浏览器开发者工具查看 WebSocket 连接和消息:
1. 打开 Network 选项卡
2. 筛选 WS (WebSocket)
3. 查看消息内容

## 扩展指南

### 添加新的 HTTP 接口

在 `adapter_router.py` 中:

```python
@router.get("/adapter/your-new-endpoint")
async def your_new_endpoint():
    # 调用内部 API
    data = await _call_internal_api("GET", "/your/internal/api")
    # 转换数据格式
    # 返回
```

### 添加新的 SocketIO action

在 `adapter_sio.py` 的 `client_action` 函数中:

```python
elif action == "your_new_action":
    # 处理新 action
    await _call_internal_api("POST", "/your/api", json={...})
    _add_log("request", f"{room_id} 新操作", "描述")
```

## 注意事项

1. **端口配置**: 适配器内部调用使用 `http://127.0.0.1:8000`,如果后端端口不是 8000,需要修改 `INTERNAL_BASE_URL`

2. **CORS 配置**: 如果外部前端域名不在 CORS 白名单中,需要在 `main.py` 中添加

3. **性能考虑**: 每次 SocketIO 操作都会触发完整的 sync_data 推送,如果房间数很多可能影响性能,可以优化为只推送变化的房间

4. **数据一致性**: 适配器通过 HTTP 调用内部 API,保证与原有业务逻辑完全一致

5. **日志管理**: 日志缓冲器最多保留 50 条,超出会自动丢弃最旧的

## 联调流程

1. 启动后端服务: `uvicorn app.main:app --reload --port 8000`
2. 外部前端修改配置指向适配器入口
3. 测试 HTTP 接口: 访问 `/adapter/export/bill/101`
4. 测试 SocketIO: 连接 `io('http://localhost:8000/adapter')`
5. 查看后端日志确认请求被正确处理
6. 逐个测试各个 action 的功能

## 故障排查

### 问题: HTTP 接口返回 500 错误

**原因**: 内部 API 调用失败

**排查步骤**:
1. 检查后端日志
2. 确认内部 API 路径是否正确
3. 确认房间是否存在、是否有入住记录

### 问题: SocketIO 连接失败

**原因**: 路径配置错误或 CORS 限制

**排查步骤**:
1. 确认连接 URL 是 `http://host/adapter` 而不是 `http://host`
2. 检查浏览器控制台的 CORS 错误
3. 在 `adapter_sio.py` 中修改 `cors_allowed_origins`

### 问题: client_action 没有响应

**原因**: action 名称或数据格式不匹配

**排查步骤**:
1. 检查后端日志,查看 "Unknown action" 提示
2. 确认 action 名称拼写正确
3. 确认 value 数据格式符合要求

## 版本历史

- v1.0 (2025-12-12): 初始版本,支持 group_a 基础接口
