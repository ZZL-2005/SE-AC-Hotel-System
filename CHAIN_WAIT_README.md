# 链式等待机制 (Chain Wait)

## 问题背景

在测试脚本中，我们需要精确控制时间推进和快照采集。之前的实现存在一个问题：

```
测试脚本发送请求 → 后端等待 60 tick → 后端采集快照 → 返回响应 
                                                   ↓
                                          （可能漏过几个 tick）
                                                   ↓
测试脚本收到响应 → 处理数据 → 发送下一个请求 → 后端开始新一轮等待
```

在响应返回和下一次请求之间，可能会漏过几个 tick，导致时间采样不连续。

## 解决方案

### 链式等待机制

新增 `chain_next` 参数，允许在快照采集完成后**立即在 tick 线程中**启动下一轮等待，确保无缝衔接：

```python
# 在快照采集的回调中
def capture_snapshot():
    # ... 采集快照 ...
    
    # 如果启用链式等待，立即启动下一轮等待（在 tick 线程中）
    if chain_next and next_count > 0:
        deps.time_manager.start_chained_wait(next_count)
        next_wait_started = True
```

### 时间线

```
测试脚本发送请求 → 后端等待 60 tick → 后端采集快照 
                                         ↓
                              （在 tick 线程中立即启动下一轮等待）
                                         ↓
                                    返回响应 
                                         ↓
                              （后端已在等待下一个 60 tick）
                                         ↓
测试脚本收到响应 → 处理数据 → 发送下一个请求 → 直接获取结果
```

## API 使用

### HTTP 接口

```http
POST /monitor/wait-tick-and-snapshot?count=60&timeout=30&chain_next=true&next_count=60
```

**参数：**
- `count`: 本轮要等待的 tick 数量
- `timeout`: 总超时时间（秒）
- `chain_next`: 是否启用链式等待（默认 false）
- `next_count`: 下一轮要等待的 tick 数量（仅当 `chain_next=true` 时生效）

**响应：**
```json
{
  "success": true,
  "tickCounter": 120,
  "message": "Waited for 60 tick(s) and captured snapshot in tick thread",
  "snapshot": { ... },
  "nextWaitStarted": true  // 表示已启动下一轮等待
}
```

### Python 测试脚本

```python
# 启用链式等待
wait_for_tick_and_snapshot(
    minute=1, 
    count=60, 
    timeout=30, 
    chain_next=True,  # 启用链式等待
    next_count=60     # 下一轮等待 60 tick
)
```

## 实现细节

### 后端 TimeManager

1. **新增字段：**
   ```python
   _chained_wait_count: int = 0  # 下一轮要等待的 tick 数
   _chained_wait_event: Optional[asyncio.Event] = None  # 下一轮等待的事件
   ```

2. **启动链式等待：**
   ```python
   def start_chained_wait(self, count: int) -> None:
       """在 tick 回调中启动链式等待，立即注册下一轮等待"""
       self._chained_wait_count = count
       self._chained_wait_event = asyncio.Event()
   ```

3. **tick 处理：**
   ```python
   def tick(self) -> None:
       # ... 原有逻辑 ...
       
       # 处理链式等待
       if self._chained_wait_event and self._chained_wait_count > 0:
           # 跳过启动链式等待的那个 tick，从下一个 tick 开始计数
           if self._tick_counter > self._chained_wait_started_tick:
               self._chained_wait_count -= 1
               if self._chained_wait_count <= 0:
                   self._chained_wait_event.set()
   ```

   **关键点**：链式等待计数从**下一个 tick** 开始，跳过启动时的当前 tick，确保精确等待 60 个 tick。

### 前端 monitor_router

```python
@router.post("/wait-tick-and-snapshot")
async def wait_for_tick_and_snapshot(
    count: int = 1,
    timeout: float = 5.0,
    chain_next: bool = False,
    next_count: int = 1
):
    def capture_snapshot():
        # ... 采集快照 ...
        
        # 启用链式等待
        if chain_next and next_count > 0:
            deps.time_manager.start_chained_wait(next_count)
            next_wait_started = True
    
    # 执行等待和回调
    success = await deps.time_manager.wait_for_ticks_with_callback(...)
    
    return TickSyncWithSnapshotResponse(
        nextWaitStarted=next_wait_started
    )
```

# 优势

1. **零 tick 丢失**：在响应返回和下一次请求之间不会漏过任何 tick
2. **原子操作**：快照采集和下一轮等待启动在同一个 tick 回调中完成
3. **高精度**：时间采样点完全连续，适合精确测试
4. **向后兼容**：`chain_next` 默认为 `false`，不影响现有代码

## 常见问题

### Q: 为什么链式等待要跳过启动时的当前 tick？

**A:** 这是为了避免"少等一个 tick"的问题。

**错误实现**（会漏过 1 个 tick）：
```python
# tick 60: 执行回调
def capture_snapshot():
    # 采集快照
    start_chained_wait(60)  # 设置 count=60

# 仍在 tick 60 的处理中
if self._chained_wait_count > 0:
    self._chained_wait_count -= 1  # 立即减 1，变成 59！

# 后续只等待了 59 个 tick，总共少等 1 个 tick
```

**正确实现**（精确等待 60 个 tick）：
```python
# tick 60: 执行回调
def capture_snapshot():
    # 采集快照
    start_chained_wait(60)  # 设置 count=60, started_tick=60

# 仍在 tick 60 的处理中
if self._tick_counter > self._chained_wait_started_tick:  # 60 > 60? False
    # 跳过，不减 1

# tick 61: 开始计数
if self._tick_counter > self._chained_wait_started_tick:  # 61 > 60? True
    self._chained_wait_count -= 1  # 第 1 次减 1，count=59

# tick 62~120: 继续减 1
# tick 120: count 减到 0，完成等待（刚好 60 个 tick）
```

### Q: 如果还是偶尔漏过一个 tick 怎么办？

**可能原因**：
1. **网络延迟**：HTTP 响应在传输过程中延迟，导致测试脚本接收到响应时已经过了几个 tick
2. **测试脚本处理时间**：测试脚本处理响应和发起下一个请求之间的延迟
3. **系统负载**：CPU 负载过高导致 tick 线程调度延迟

**解决方案**：
- 链式等待已经在后端自动启动下一轮等待，不受网络延迟影响
- 确保测试脚本使用 `chain_next=True`
- 检查 tick 计数器是否连续递增

## 使用建议

- **连续时间推进**：需要连续推进多个时间点时，启用链式等待
- **最后一轮**：最后一个时间点不需要启用 `chain_next`
- **DRY_RUN 模式**：测试脚本的 DRY_RUN 模式会自动跳过链式等待

## 示例

```python
for minute in range(1, max_minute + 1):
    chain_next = (minute < max_minute)  # 最后一分钟不需要链式等待
    
    wait_for_tick_and_snapshot(
        minute=minute,
        count=60,
        timeout=30,
        chain_next=chain_next,
        next_count=60
    )
    
    # 执行操作
    send_actions(...)
```
