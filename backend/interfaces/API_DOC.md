# 酒店空调管理系统 - 后端接口文档

> 版本：v1.0  
> 协议：HTTP REST API  
> 基础路径：`http://<host>:<port>`

---

## 目录

1. [数据模型定义](#1-数据模型定义)
2. [空调控制接口 (AC Router)](#2-空调控制接口-ac-router)
3. [前台业务接口 (Frontdesk Router)](#3-前台业务接口-frontdesk-router)
4. [监控接口 (Monitor Router)](#4-监控接口-monitor-router)
5. [报表接口 (Report Router)](#5-报表接口-report-router)

---

## 1. 数据模型定义

### 1.1 RoomState（房间空调状态）

| 字段 | 类型 | 说明 |
|------|------|------|
| `roomId` | string | 房间号 |
| `status` | string | 状态：`"idle"` \| `"occupied"` \| `"serving"` \| `"waiting"` |
| `currentTemp` | number | 当前温度（℃） |
| `targetTemp` | number | 目标温度（℃） |
| `speed` | string | 风速：`"LOW"` \| `"MID"` \| `"HIGH"` |
| `isServing` | boolean | 是否正在服务中 |
| `isWaiting` | boolean | 是否在等待队列中 |
| `currentFee` | number | 当前服务费用（元） |
| `totalFee` | number | 累计总费用（元） |
| `mode` | string | 空调模式：`"cool"` \| `"heat"` |

**示例：**
```json
{
  "roomId": "101",
  "status": "serving",
  "currentTemp": 26.5,
  "targetTemp": 24.0,
  "speed": "MID",
  "isServing": true,
  "isWaiting": false,
  "currentFee": 3.5,
  "totalFee": 12.0,
  "mode": "cool"
}
```

### 1.2 MonitorRoomStatus（监控房间状态）

| 字段 | 类型 | 说明 |
|------|------|------|
| `roomId` | string | 房间号 |
| `status` | string | 状态：`"idle"` \| `"occupied"` \| `"serving"` \| `"waiting"` |
| `currentTemp` | number | 当前温度（℃） |
| `targetTemp` | number | 目标温度（℃） |
| `speed` | string | 房间设置的风速 |
| `isServing` | boolean | 是否正在服务中 |
| `isWaiting` | boolean | 是否在等待队列中 |
| `currentFee` | number | 当前服务费用 |
| `totalFee` | number | 累计总费用 |
| `servedSeconds` | number | 已服务时长（秒） |
| `waitedSeconds` | number | 已等待时长（秒） |
| `serviceSpeed` | string \| null | 服务中的风速（如正在服务） |
| `serviceStartedAt` | string \| null | 服务开始时间（ISO 8601） |
| `waitSpeed` | string \| null | 等待时请求的风速 |

### 1.3 CheckInRequest（入住请求）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `custId` | string | ✅ | 顾客身份证号 |
| `custName` | string | ✅ | 顾客姓名 |
| `guestCount` | number | ❌ | 入住人数（默认 1） |
| `checkInDate` | string | ✅ | 入住日期（格式：`YYYY-MM-DD`） |
| `roomId` | string | ✅ | 房间号 |
| `deposit` | number | ❌ | 押金（默认 0） |

### 1.4 ReportSummary（报表摘要）

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalRevenue` | number | 总收入 |
| `acRevenue` | number | 空调收入 |
| `roomRevenue` | number | 住宿收入 |
| `totalKwh` | number | 总耗电量（kWh） |

---

## 2. 空调控制接口 (AC Router)

> 路由前缀：`/rooms`  
> 标签：`ac`

### 2.1 开启空调

**POST** `/rooms/{room_id}/ac/power-on`

开启指定房间的空调并设置初始参数。

**路径参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间号 |

**请求体：**
```json
{
  "mode": "cool",
  "targetTemp": 24.0,
  "speed": "MID"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | string | ✅ | 模式：`"cool"` 或 `"heat"` |
| `targetTemp` | number | ✅ | 目标温度（18-30℃） |
| `speed` | string | ✅ | 风速：`"LOW"` \| `"MID"` \| `"HIGH"` |

**响应示例：**
```json
{
  "roomId": "101",
  "status": "waiting",
  "currentTemp": 28.0,
  "targetTemp": 24.0,
  "speed": "MID",
  "isServing": false,
  "isWaiting": true,
  "currentFee": 0.0,
  "totalFee": 0.0,
  "mode": "cool"
}
```

---

### 2.2 关闭空调

**POST** `/rooms/{room_id}/ac/power-off`

关闭指定房间的空调。

**路径参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间号 |

**请求体：** 无

**响应示例：**
```json
{
  "roomId": "101",
  "status": "occupied",
  "currentTemp": 25.0,
  "targetTemp": 24.0,
  "speed": "MID",
  "isServing": false,
  "isWaiting": false,
  "currentFee": 0.0,
  "totalFee": 5.5,
  "mode": "cool"
}
```

---

### 2.3 调整目标温度

**POST** `/rooms/{room_id}/ac/change-temp`

调整指定房间的目标温度。

**路径参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间号 |

**请求体：**
```json
{
  "targetTemp": 22.0
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `targetTemp` | number | ✅ | 新的目标温度 |

**响应：** 返回更新后的 `RoomState`

---

### 2.4 调整风速

**POST** `/rooms/{room_id}/ac/change-speed`

调整指定房间的风速档位。

**路径参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间号 |

**请求体：**
```json
{
  "speed": "HIGH"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `speed` | string | ✅ | 风速：`"LOW"` \| `"MID"` \| `"HIGH"` |

**错误响应：**
- `400 Bad Request`：风速值无效

---

### 2.5 获取空调状态

**GET** `/rooms/{room_id}/ac/state`

获取指定房间的空调当前状态。

**路径参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间号 |

**响应：** 返回 `RoomState`

**错误响应：**
- `404 Not Found`：房间不存在

---

## 3. 前台业务接口 (Frontdesk Router)

> 标签：`frontdesk`

### 3.1 办理入住

**POST** `/checkin`

为顾客办理入住登记。

**请求体：**
```json
{
  "custId": "110101199901010001",
  "custName": "张三",
  "guestCount": 2,
  "checkInDate": "2025-12-10",
  "roomId": "101",
  "deposit": 500.0
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `custId` | string | ✅ | 顾客身份证号 |
| `custName` | string | ✅ | 顾客姓名 |
| `guestCount` | number | ❌ | 入住人数（默认 1，最小 1） |
| `checkInDate` | string | ✅ | 入住日期 |
| `roomId` | string | ✅ | 房间号 |
| `deposit` | number | ❌ | 押金金额（默认 0） |

**响应示例：**
```json
{
  "success": true,
  "orderId": "ORD-20251210-001",
  "roomId": "101",
  "message": "入住成功"
}
```

---

### 3.2 办理退房

**POST** `/checkout`

为顾客办理退房结账。

**请求体：**
```json
{
  "roomId": "101"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `roomId` | string | ✅ | 房间号 |

**响应示例：**
```json
{
  "success": true,
  "roomId": "101",
  "totalFee": 850.0,
  "acFee": 150.0,
  "roomFee": 700.0,
  "message": "退房成功"
}
```

**错误响应：**
- `400 Bad Request`：退房失败（如房间未入住）

---

### 3.3 获取房间账单

**GET** `/rooms/{room_id}/bills`

获取指定房间的账单信息。

**路径参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间号 |

**响应示例：**
```json
{
  "roomId": "101",
  "acBills": [
    {
      "billId": "AC-001",
      "periodStart": "2025-12-10T14:00:00",
      "periodEnd": "2025-12-10T18:00:00",
      "totalFee": 25.5
    }
  ],
  "accommodationBill": {
    "billId": "ACC-001",
    "totalFee": 700.0,
    "createdAt": "2025-12-11T12:00:00"
  }
}
```

---

### 3.4 前台状态检查

**GET** `/frontdesk/status`

检查前台 API 服务状态。

**响应：**
```json
{
  "message": "Front desk API ready"
}
```

---

## 4. 监控接口 (Monitor Router)

> 路由前缀：`/monitor`  
> 标签：`monitor`

### 4.1 获取所有房间状态

**GET** `/monitor/rooms`

获取所有房间的实时状态（用于监控界面）。

**响应示例：**
```json
{
  "rooms": [
    {
      "roomId": "101",
      "status": "serving",
      "currentTemp": 26.5,
      "targetTemp": 24.0,
      "speed": "MID",
      "isServing": true,
      "isWaiting": false,
      "currentFee": 3.5,
      "totalFee": 12.0,
      "servedSeconds": 300,
      "waitedSeconds": 0,
      "serviceSpeed": "MID",
      "serviceStartedAt": "2025-12-10T14:30:00",
      "waitSpeed": null
    },
    {
      "roomId": "102",
      "status": "waiting",
      "currentTemp": 28.0,
      "targetTemp": 22.0,
      "speed": "HIGH",
      "isServing": false,
      "isWaiting": true,
      "currentFee": 0.0,
      "totalFee": 8.0,
      "servedSeconds": 0,
      "waitedSeconds": 45,
      "serviceSpeed": null,
      "serviceStartedAt": null,
      "waitSpeed": "HIGH"
    },
    {
      "roomId": "103",
      "status": "idle",
      "currentTemp": 25.0,
      "targetTemp": 25.0,
      "speed": "MID",
      "isServing": false,
      "isWaiting": false,
      "currentFee": 0.0,
      "totalFee": 0.0,
      "servedSeconds": 0,
      "waitedSeconds": 0,
      "serviceSpeed": null,
      "serviceStartedAt": null,
      "waitSpeed": null
    }
  ]
}
```

**状态说明：**
| 状态 | 含义 |
|------|------|
| `idle` | 空闲（未入住） |
| `occupied` | 已入住但空调未开 |
| `serving` | 空调正在服务中 |
| `waiting` | 空调在等待队列中 |

---

## 5. 报表接口 (Report Router)

> 路由前缀：`/report`  
> 标签：`report`

### 5.1 获取统计报表

**GET** `/report`

获取指定时间范围内的统计报表（经理报表）。

**查询参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | string | ✅ | 开始时间（ISO 8601 格式） |
| `to` | string | ✅ | 结束时间（ISO 8601 格式） |

**请求示例：**
```
GET /report?from=2025-12-01T00:00:00&to=2025-12-10T23:59:59
```

**响应示例：**
```json
{
  "summary": {
    "totalRevenue": 15680.50,
    "acRevenue": 2180.50,
    "roomRevenue": 13500.00,
    "totalKwh": 45.6
  },
  "trend": [
    {
      "time": "2025-12-01 14:00",
      "fee": 125.50,
      "kwh": 2.5
    },
    {
      "time": "2025-12-01 15:00",
      "fee": 98.00,
      "kwh": 1.8
    }
  ],
  "speedRate": {
    "high": 0.25,
    "mid": 0.55,
    "low": 0.20
  },
  "rooms": [
    {
      "roomId": "101",
      "minutes": 480.5,
      "highCount": 5,
      "midCount": 12,
      "lowCount": 3,
      "kwh": 8.5,
      "fee": 425.00
    },
    {
      "roomId": "102",
      "minutes": 320.0,
      "highCount": 2,
      "midCount": 8,
      "lowCount": 5,
      "kwh": 5.2,
      "fee": 260.00
    }
  ],
  "hourlySpeed": [
    {
      "hour": "2025-12-01 14:00",
      "high": 30.5,
      "mid": 45.0,
      "low": 15.0
    }
  ],
  "kpi": {
    "avgKwh": 4.56,
    "avgFee": 218.05,
    "peakHour": "2025-12-01 14:00",
    "highRate": 0.25,
    "avgSession": 25.5
  }
}
```

**响应字段说明：**

| 字段 | 说明 |
|------|------|
| `summary` | 总体统计摘要 |
| `summary.totalRevenue` | 总收入（元） |
| `summary.acRevenue` | 空调服务收入（元） |
| `summary.roomRevenue` | 住宿收入（元） |
| `summary.totalKwh` | 总耗电量（kWh） |
| `trend` | 按小时统计的费用和耗电趋势 |
| `speedRate` | 各风速档位使用时长占比 |
| `rooms` | 各房间的详细统计 |
| `rooms[].minutes` | 空调使用总时长（分钟） |
| `rooms[].highCount` | 高风速使用次数 |
| `rooms[].midCount` | 中风速使用次数 |
| `rooms[].lowCount` | 低风速使用次数 |
| `hourlySpeed` | 每小时各风速使用时长 |
| `kpi` | 关键绩效指标 |
| `kpi.avgKwh` | 平均每房间耗电量 |
| `kpi.avgFee` | 平均每房间空调费用 |
| `kpi.peakHour` | 用电高峰时段 |
| `kpi.highRate` | 高风速使用占比 |
| `kpi.avgSession` | 平均每次服务时长（分钟） |

**错误响应：**
- `400 Bad Request`：时间格式无效

---

## 错误响应格式

所有接口的错误响应遵循统一格式：

```json
{
  "detail": "错误描述信息"
}
```

**常见 HTTP 状态码：**
| 状态码 | 说明 |
|--------|------|
| `200` | 请求成功 |
| `400` | 请求参数错误 |
| `404` | 资源不存在 |
| `500` | 服务器内部错误 |

---

## 附录：枚举值参考

### 房间状态 (status)
| 值 | 说明 |
|----|------|
| `idle` | 空闲（未入住） |
| `occupied` | 已入住（空调未开） |
| `serving` | 正在服务 |
| `waiting` | 等待服务 |

### 风速 (speed)
| 值 | 说明 | 费率倍数 |
|----|------|----------|
| `LOW` | 低风速 | 0.8x |
| `MID` | 中风速 | 1.0x |
| `HIGH` | 高风速 | 1.2x |

### 空调模式 (mode)
| 值 | 说明 |
|----|------|
| `cool` | 制冷模式 |
| `heat` | 制热模式 |

