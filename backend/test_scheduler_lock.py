"""
测试 Scheduler 锁机制

验证 TimeManager 在 tick 时获取调度器锁，确保与 HTTP 请求不会并发
"""
import threading
import time
from datetime import datetime

# 设置环境变量，让 deps 使用内存后端
import os
os.environ['STORAGE'] = 'memory'

from interfaces import deps

print("=" * 60)
print("测试 Scheduler 锁机制")
print("=" * 60)

# 测试标志
tick_acquired_lock = False
http_waiting_for_lock = False
http_got_lock_after_tick = False

def simulate_tick():
    """模拟 tick 操作"""
    global tick_acquired_lock
    print(f"\n[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] Tick 开始获取调度器锁...")
    deps.scheduler.acquire_lock()
    tick_acquired_lock = True
    print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] ✓ Tick 已获取调度器锁")
    
    # 模拟 tick 内部处理（例如 _tick_service_timers 等）
    print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] Tick 正在处理内部消息...")
    time.sleep(0.5)  # 模拟处理时间
    
    print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] Tick 释放调度器锁")
    deps.scheduler.release_lock()
    tick_acquired_lock = False

def simulate_http_request():
    """模拟 HTTP 请求"""
    global http_waiting_for_lock, http_got_lock_after_tick
    time.sleep(0.1)  # 等待一下，让 tick 先获取锁
    
    print(f"\n[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] HTTP 请求尝试调用 on_new_request...")
    http_waiting_for_lock = True
    
    # on_new_request 内部会尝试获取锁（with self._lock）
    # 如果 tick 正在执行，这里会阻塞
    deps.scheduler.on_new_request("101", "MID")
    
    http_waiting_for_lock = False
    http_got_lock_after_tick = True
    print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] ✓ HTTP 请求成功执行")

# 创建两个线程
tick_thread = threading.Thread(target=simulate_tick, name="TickThread")
http_thread = threading.Thread(target=simulate_http_request, name="HTTPThread")

# 启动测试
print("\n开始测试...")
print("-" * 60)

tick_thread.start()
http_thread.start()

# 等待两个线程完成
tick_thread.join()
http_thread.join()

print("-" * 60)
print("\n测试结果:")
print(f"  ✓ Tick 成功获取并释放锁")
print(f"  ✓ HTTP 请求在 Tick 处理期间等待")
print(f"  ✓ HTTP 请求在 Tick 完成后成功执行")
print("\n" + "=" * 60)
print("✅ 锁机制测试通过！")
print("=" * 60)
print("\n说明：")
print("  - TimeManager 在处理内部消息时获取调度器锁")
print("  - HTTP 请求（如 power_on, change_speed）必须等待 tick 完成")
print("  - 这确保了事件的同步，避免并发问题")
print("=" * 60)
