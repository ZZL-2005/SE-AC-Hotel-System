"""队列抽象接口，定义数据操作，具体存储实现由 Infrastructure 层提供。

设计原则：
- Queue 只负责数据的增删改查，不包含业务逻辑
- 抢占逻辑、优先级选择等业务规则在 Scheduler 中实现
- Queue 提供 list_all() 让 Scheduler 获取数据进行业务处理
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .service_object import ServiceObject


class ServiceQueue(ABC):
    """服务队列抽象接口 - 只提供数据操作，不含业务逻辑"""

    @abstractmethod
    def add(self, service: "ServiceObject") -> None:
        """添加服务对象到队列"""
        pass

    @abstractmethod
    def remove(self, room_id: str) -> None:
        """根据房间 ID 移除服务对象"""
        pass

    @abstractmethod
    def get(self, room_id: str) -> Optional["ServiceObject"]:
        """根据房间 ID 获取服务对象"""
        pass

    @abstractmethod
    def list_all(self) -> List["ServiceObject"]:
        """获取队列中所有服务对象（供 Scheduler 进行业务筛选）"""
        pass

    @abstractmethod
    def update(self, service: "ServiceObject") -> None:
        """更新服务对象"""
        pass

    @abstractmethod
    def size(self) -> int:
        """获取队列长度"""
        pass

    @abstractmethod
    def clear(self) -> None:
        """清空队列"""
        pass


class WaitingQueue(ServiceQueue):
    """等待队列抽象接口 - 与 ServiceQueue 接口相同，类型区分用"""
    pass
