import { useEffect, useMemo, useState } from "react";
import { frontdeskClient, type CheckOutResponse } from "../api/frontdeskClient";
import { monitorClient } from "../api/monitorClient";
import type { RoomStatus } from "../types/rooms";

type TabType = "checkin" | "checkout";
type FilterType = "all" | "available" | "occupied" | "reserved";

const defaultReservationEta = (() => {
  const d = new Date();
  d.setHours(d.getHours() + 2);
  return d.toISOString().slice(0, 16);
})();

type Reservation = {
  roomId: string;
  guestName: string;
  contact: string;
  eta: string;
  note?: string;
  createdAt: string;
};

// SSD 入住流程步骤
type CheckinStep = 1 | 2 | 3 | 4 | 5;

export function FrontDeskPage() {
  const [activeTab, setActiveTab] = useState<TabType>("checkin");
const [roomFilter, setRoomFilter] = useState<FilterType>("all");

// ========== SSD 分步入住状态 ==========
// 当前步骤：1-登记顾客 → 2-查询房态 → 3-创建订单 → 4-押金(可选) → 5-门卡(可选)
const [checkinStep, setCheckinStep] = useState<CheckinStep>(1);

// 预定匹配辅助
const normalizeText = (val: string) => val?.trim().toLowerCase() ?? "";
const matchReservationWithCustomer = (reservation?: Reservation | null, name?: string, contact?: string) => {
  if (!reservation) return false;
  const nameOk = reservation.guestName ? normalizeText(reservation.guestName) === normalizeText(name ?? "") : false;
  const contactOk =
    !reservation.contact?.trim() ||
    reservation.contact.trim() === (contact ?? "") ||
    normalizeText(reservation.contact) === normalizeText(name ?? "");
  return nameOk && contactOk;
};
  
  // Step 1: Registe_CustomerInfo(Cust_Id, Cust_name, number, date)
  const [customerInfo, setCustomerInfo] = useState({
    custId: "",
    custName: "",
    guestCount: 1,
    checkInDate: new Date().toISOString().slice(0, 16),
  });
  const [customerRegistered, setCustomerRegistered] = useState(false);
  
  // Step 2: Check_RoomState(date) - 房态查询结果
  const [roomStateChecked, setRoomStateChecked] = useState(false);
  
  // Step 3: Create_Accommodation_Order(Customer_id, Room_id)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [orderCreated, setOrderCreated] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  
  // Step 4: deposite(amount) - 可选
  const [deposit, setDeposit] = useState(200);
  const [depositConfirmed, setDepositConfirmed] = useState(false);
  
  // Step 5: Create_DoorCard(RoomId, date) - 可选
  const [doorCardCreated, setDoorCardCreated] = useState(false);

  // 预定：持久化在 localStorage，避免重复分配
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    if (typeof window === "undefined") return [];
    const cached = window.localStorage.getItem("frontdesk-reservations");
    if (!cached) return [];
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item?.roomId && item?.guestName && item?.eta);
      }
    } catch (err) {
      console.warn("Failed to parse cached reservations", err);
    }
    return [];
  });
  const [reservationForm, setReservationForm] = useState({
    roomId: "",
    guestName: "",
    contact: "",
    eta: defaultReservationEta,
    note: "",
  });
  const [reservationMessage, setReservationMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // 消息状态
  const [checkinMessage, setCheckinMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ========== SSD 退房流程状态 ==========
  // 退房步骤：1-选择房间 → 2-开始结账(Process_CheckOut) → 3-确认支付(ProcessPayment)
  type CheckoutStep = 1 | 2 | 3;
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>(1);
  const [checkoutRoomId, setCheckoutRoomId] = useState("");
  const [checkoutSummary, setCheckoutSummary] = useState<CheckOutResponse | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ========== 共享状态 ==========
  const [roomStatuses, setRoomStatuses] = useState<RoomStatus[]>([]);

  // 内部使用的真实房态（用于退房等）
  const occupiedSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of roomStatuses) {
      const st = String(r.status || "").toLowerCase();
      if (st === "serving" || st === "waiting" || st === "occupied") set.add(String(r.roomId));
    }
    return set;
  }, [roomStatuses]);

  // 入住时：只有查询房态后才显示；退房时：始终显示
  const displayOccupiedSet = useMemo(() => {
    if (activeTab === "checkin" && !roomStateChecked) {
      return new Set<string>();
    }
    return occupiedSet;
  }, [occupiedSet, activeTab, roomStateChecked]);

  const reservedSet = useMemo(() => new Set(reservations.map((r) => String(r.roomId))), [reservations]);
  const unavailableSet = useMemo(() => {
    const set = new Set<string>(reservedSet);
    displayOccupiedSet.forEach((id) => set.add(id));
    return set;
  }, [reservedSet, displayOccupiedSet]);

  // 缓存预定信息，避免刷新后丢失
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("frontdesk-reservations", JSON.stringify(reservations));
  }, [reservations]);

  const loadStatuses = () => {
    monitorClient.fetchRooms().then(({ data }) => {
      setRoomStatuses(data?.rooms ?? []);
    });
  };

  // 退房时需要加载房态，入住时不自动加载
  useEffect(() => {
    if (activeTab === "checkout") {
      loadStatuses();
    }
  }, [activeTab]);

  // 重置退房流程
  function resetCheckoutFlow() {
    setCheckoutStep(1);
    setCheckoutRoomId("");
    setCheckoutSummary(null);
    setCheckoutLoading(false);
    setPaymentLoading(false);
    setPaymentSuccess(false);
    setCheckoutMessage(null);
  }

  // 重置入住流程
  function resetCheckinFlow() {
    setCheckinStep(1);
    setCustomerInfo({ custId: "", custName: "", guestCount: 1, checkInDate: new Date().toISOString().slice(0, 16) });
    setCustomerRegistered(false);
    setRoomStateChecked(false);
    setSelectedRoomId(null);
    setOrderCreated(false);
    setOrderId(null);
    setDeposit(200);
    setDepositConfirmed(false);
    setDoorCardCreated(false);
    setCheckinMessage(null);
    setReservationMessage(null);
  }

  const handleTabChange = (nextTab: TabType) => {
    if (nextTab === activeTab) return;
    if (nextTab === "checkin") resetCheckinFlow();
    else resetCheckoutFlow();
    setActiveTab(nextTab);
  };

  // ========== SSD 系统事件处理 ==========

  // 事件1: Registe_CustomerInfo(Cust_Id, Cust_name, number, date)
  const handleRegisterCustomer = () => {
    if (!customerInfo.custId.trim()) {
      setCheckinMessage({ type: "error", text: "请填写身份证号" });
      return;
    }
    if (!customerInfo.custName.trim()) {
      setCheckinMessage({ type: "error", text: "请填写住客姓名" });
      return;
    }
    if (customerInfo.guestCount < 1) {
      setCheckinMessage({ type: "error", text: "入住人数至少为 1" });
      return;
    }
    if (!customerInfo.checkInDate) {
      setCheckinMessage({ type: "error", text: "请选择入住日期" });
      return;
    }
    
    // 模拟系统事件调用
    console.log("🔔 系统事件: Registe_CustomerInfo", customerInfo);
    setCustomerRegistered(true);
    setCheckinStep(2);
    setCheckinMessage({ type: "success", text: `顾客 ${customerInfo.custName} 信息已登记` });
  };

  // 事件2: Check_RoomState(date)
  const handleCheckRoomState = () => {
    console.log("🔔 系统事件: Check_RoomState", { date: customerInfo.checkInDate });
    loadStatuses();
    setRoomStateChecked(true);
    setCheckinStep(3);
    setCheckinMessage({ type: "success", text: "房态查询完成，请选择房间" });
  };

  // 预定房间（不办理入住）
  const handleReserveRoom = () => {
    setReservationMessage(null);

    if (!reservationForm.roomId.trim()) {
      setReservationMessage({ type: "error", text: "请输入要预定的房间号" });
      return;
    }
    if (activeTab === "checkin" && !roomStateChecked) {
      setReservationMessage({ type: "error", text: "请先完成房态查询，再进行预定" });
      return;
    }

    const roomId = reservationForm.roomId.trim();
    const existingReservation = reservations.find((r) => r.roomId === roomId);
    if (reservedSet.has(roomId)) {
      setReservationMessage({ type: "error", text: `房间 ${roomId} 已被预定，提交后会覆盖原预定人信息` });
    }
    if (occupiedSet.has(roomId)) {
      setReservationMessage({ type: "error", text: `房间 ${roomId} 已在使用中，无法预定` });
      return;
    }

    const record: Reservation = {
      roomId,
      guestName: reservationForm.guestName.trim() || "未留名",
      contact: reservationForm.contact.trim(),
      eta: reservationForm.eta,
      note: reservationForm.note.trim(),
      createdAt: new Date().toISOString(),
    };

    setReservations((prev) => [...prev.filter((r) => r.roomId !== roomId), record]);
    setReservationMessage({
      type: "success",
      text: `房间 ${roomId} 已为 ${record.guestName} 预留${existingReservation ? "（已覆盖旧预定）" : ""}`,
    });
  };

  const handleCancelReservation = (roomId: string) => {
    setReservations((prev) => prev.filter((r) => r.roomId !== roomId));
    setReservationMessage({ type: "success", text: `已释放房间 ${roomId} 的预定` });
  };

  const fillReservationRoom = () => {
    if (!selectedRoomId) {
      setReservationMessage({ type: "error", text: "请先在右侧选中一个房间" });
      return;
    }
    setReservationForm((prev) => ({ ...prev, roomId: selectedRoomId }));
    setReservationMessage(null);
  };

  // 选择房间（为 Step 3 准备）
  const handleSelectRoom = (id: string) => {
    if (activeTab === "checkin") {
      if (!roomStateChecked) {
        setCheckinMessage({ type: "error", text: "请先查询房态" });
        return;
      }
      const reservation = reservations.find((r) => r.roomId === id);
      const reservationMatched = matchReservationWithCustomer(reservation, customerInfo.custName, customerInfo.custId);
      if (reservedSet.has(id) && !reservationMatched) {
        setCheckinMessage({ type: "error", text: "该房间已被预定，需与预定姓名/联系方式匹配后才能办理" });
        return;
      }
      setSelectedRoomId(id);
      setCheckinMessage(
        reservation && reservationMatched
          ? { type: "success", text: `与预定信息匹配，可继续办理入住（房间 ${id}）` }
          : null
      );
    } else {
      // 退房：只有在 Step 1 才能选择房间
      if (checkoutStep !== 1) return;
      setCheckoutRoomId(id);
      setCheckoutMessage(null);
    }
  };

  // 事件3: Create_Accommodation_Order(Customer_id, Room_id)
  const handleCreateOrder = async () => {
    if (!selectedRoomId) {
      setCheckinMessage({ type: "error", text: "请先选择房间" });
      return;
    }
    const reservation = reservations.find((r) => r.roomId === selectedRoomId);
    const reservationMatched = matchReservationWithCustomer(reservation, customerInfo.custName, customerInfo.custId);
    if (reservation && !reservationMatched) {
      setCheckinMessage({ type: "error", text: "该房间有预定，请输入与预定一致的姓名/联系方式" });
      return;
    }
    if (reservedSet.has(selectedRoomId)) {
      setCheckinMessage({ type: "success", text: "预定匹配成功，正在为预定客人办理入住" });
    }
    if (occupiedSet.has(selectedRoomId)) {
      setCheckinMessage({ type: "error", text: "该房间已入住，请重新选择" });
      return;
    }

    console.log("🔔 系统事件: Create_Accommodation_Order", { 
      customerId: customerInfo.custId, 
      roomId: selectedRoomId 
    });

    const { data, error } = await frontdeskClient.checkIn({
      custId: customerInfo.custId.trim(),
      custName: customerInfo.custName.trim(),
      guestCount: customerInfo.guestCount,
      checkInDate: customerInfo.checkInDate,
      roomId: selectedRoomId,
      deposit: 0, // 押金在 Step 4 单独处理
    });

    if (error) {
      setCheckinMessage({ type: "error", text: error });
      return;
    }

    if (data) {
      setOrderId(data.orderId);
      setOrderCreated(true);
      setCheckinStep(4);
      setCheckinMessage({ type: "success", text: `住宿订单已创建，订单号：${data.orderId}` });
      // 入住成功后，释放该房间的预定记录
      if (reservation) {
        setReservations((prev) => prev.filter((r) => r.roomId !== reservation.roomId));
      }
      loadStatuses();
    }
  };

  // 事件4: deposite(amount) - 可选
  const handleDeposit = async () => {
    if (deposit < 0) {
      setCheckinMessage({ type: "error", text: "押金不能为负数" });
      return;
    }

    console.log("🔔 系统事件: deposite", { amount: deposit, orderId });
    // TODO: 调用后端押金接口（如果有的话）
    setDepositConfirmed(true);
    setCheckinStep(5);
    setCheckinMessage({ type: "success", text: `押金 ¥${deposit} 已确认` });
  };

  // 事件5: Create_DoorCard(RoomId, date) - 可选
  const handleCreateDoorCard = () => {
    console.log("🔔 系统事件: Create_DoorCard", { 
      roomId: selectedRoomId, 
      date: customerInfo.checkInDate 
    });
    setDoorCardCreated(true);
    setCheckinMessage({ type: "success", text: `房间 ${selectedRoomId} 门卡已生成，入住流程完成！` });
  };

  // 跳过可选步骤
  const handleSkipDeposit = () => {
    setCheckinStep(5);
    setCheckinMessage({ type: "success", text: "已跳过押金步骤" });
  };

  const handleSkipDoorCard = () => {
    setCheckinMessage({ type: "success", text: `房间 ${selectedRoomId} 入住流程完成！` });
  };

  // ========== SSD 退房系统事件处理 ==========

  // 事件1: Process_CheckOut(Room_id)
  // 系统自动执行: query_FeeRecords → calculate_Accommodation_Fee → calculate_AC_Fee 
  //              → Create_Accomo_Bill → Create_AC_Bill → Create_DetailRecords_AC
  const handleProcessCheckOut = async () => {
    if (!checkoutRoomId.trim()) {
      setCheckoutMessage({ type: "error", text: "请选择房间" });
      return;
    }
    if (!occupiedSet.has(checkoutRoomId)) {
      setCheckoutMessage({ type: "error", text: "该房间未入住，无法退房" });
      return;
    }

    console.log("🔔 系统事件: Process_CheckOut", { roomId: checkoutRoomId });
    console.log("  ├─ 1.1 query_FeeRecords(RoomId, date_out)");
    console.log("  ├─ 1.3 calculate_Accommodation_Fee(days, fee_of_day)");
    console.log("  ├─ 1.5 calculate_AC_Fee(list_of_Detail_Records)");
    console.log("  ├─ 1.7 Create_Accomo_Bill(RoomId, date)");
    console.log("  ├─ 1.9 Create_AC_Bill(RoomId, date)");
    console.log("  └─ 1.10 Create_DetailRecords_AC(RoomId, date_in, date_out)");

    setCheckoutLoading(true);
    setCheckoutMessage(null);
    
    const { data, error } = await frontdeskClient.checkOut(checkoutRoomId);
    setCheckoutLoading(false);
    
    if (error) {
      setCheckoutMessage({ type: "error", text: error });
      return;
    }
    
    setCheckoutSummary(data ?? null);
    setCheckoutStep(2);
    setCheckoutMessage({ type: "success", text: "账单已生成，请确认支付" });
  };

  // 事件2: ProcessPayment(RoomId, Total_fee_of_Accommodation, Total_Fee_of_AC)
  // 系统执行: 更新账单状态 → 扣款 → Set_RoomState(RoomId)
  const handleProcessPayment = async () => {
    if (!checkoutSummary) return;

    const accommodationFee = checkoutSummary.accommodationBill?.roomFee ?? 0;
    const acFee = checkoutSummary.acBill?.totalFee ?? 0;

    console.log("🔔 系统事件: ProcessPayment", {
      roomId: checkoutRoomId,
      Total_fee_of_Accommodation: accommodationFee,
      Total_Fee_of_AC: acFee,
    });
    console.log("  ├─ 更新账单状态");
    console.log("  ├─ 处理支付");
    console.log("  └─ 1.11 Set_RoomState(RoomId) → 空闲");

    setPaymentLoading(true);
    
    // 模拟支付处理（实际项目中可以调用支付接口）
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setPaymentLoading(false);
    setPaymentSuccess(true);
    setCheckoutStep(3);
    setCheckoutMessage({ type: "success", text: "支付成功！房间已恢复空闲状态" });
    
    // 刷新房态
    loadStatuses();
  };

  const downloadCsv = (filename: string, rows: string[][]) => {
    const csv = "\uFEFF" + rows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").slice(0, 19);
  };

  const formatLogicTime = (seconds?: number | null) => {
    if (seconds == null || !Number.isFinite(seconds)) return "--";
    const total = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `T+${mm}:${ss}`;
  };

  const calcDurationSeconds = (start?: string | null, end?: string | null) => {
    if (!start || !end) return 0;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 0;
    return Math.round((e - s) / 1000);
  };

  const exportAcBill = () => {
    if (!checkoutSummary?.acBill) {
      setCheckoutMessage({ type: "error", text: "暂无空调账单可导出" });
      return;
    }
    const bill = checkoutSummary.acBill;
    const accommodationSeconds = checkoutSummary.accommodationBill?.accommodationSeconds;
    const startTime = typeof accommodationSeconds === "number" ? formatLogicTime(0) : formatDate(bill.periodStart);
    const endTime = typeof accommodationSeconds === "number" ? formatLogicTime(accommodationSeconds) : formatDate(bill.periodEnd);
    const rows = [
      ["房间号", "入住时间", "离开时间", "空调总费用"],
      [bill.roomId, startTime, endTime, bill.totalFee.toFixed(2)],
    ];
    downloadCsv(`ac-bill-${bill.roomId}.csv`, rows);
    setCheckoutMessage({ type: "success", text: "空调账单已下载 (CSV)" });
  };

  const exportAcDetails = () => {
    if (!checkoutSummary?.detailRecords?.length) {
      setCheckoutMessage({ type: "error", text: "暂无空调详单可导出" });
      return;
    }
    const rows: string[][] = [];
    let cumulative = 0;
    rows.push(["房间号", "请求时间", "服务开始时间", "服务结束时间", "服务时长(秒)", "风速", "当前费用", "累积费用"]);
    checkoutSummary.detailRecords.forEach((rec) => {
      const requestTime = rec.logicStartSeconds != null ? formatLogicTime(rec.logicStartSeconds) : formatDate(rec.startedAt);
      const start = rec.logicStartSeconds != null ? formatLogicTime(rec.logicStartSeconds) : formatDate(rec.startedAt);
      const end = rec.logicEndSeconds != null ? formatLogicTime(rec.logicEndSeconds) : formatDate(rec.endedAt);
      const duration =
        typeof rec.durationSeconds === "number"
          ? rec.durationSeconds
          : rec.logicStartSeconds != null && rec.logicEndSeconds != null
            ? Math.max(0, Math.round(rec.logicEndSeconds - rec.logicStartSeconds))
            : calcDurationSeconds(rec.startedAt, rec.endedAt);
      const currentFee = rec.feeValue ?? 0;
      cumulative += currentFee;
      rows.push([
        rec.roomId,
        requestTime,
        start,
        end,
        String(duration),
        rec.speed,
        currentFee.toFixed(2),
        cumulative.toFixed(2),
      ]);
    });
    downloadCsv(`ac-detail-${checkoutSummary.roomId}.csv`, rows);
    setCheckoutMessage({ type: "success", text: "空调详单已下载 (CSV)" });
  };

  return (
    <div className="space-y-10 animate-fade-in">
      {/* 页面标题 */}
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-[#1d1d1f]">
          前台服务
        </h1>
        <p className="mt-3 text-[#86868b]">办理入住与退房</p>
      </header>

      {/* Tab 切换 */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-full bg-[#f5f5f7] p-1">
          <button
            type="button"
            onClick={() => handleTabChange("checkin")}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
              activeTab === "checkin"
                ? "bg-white text-[#1d1d1f] shadow-sm"
                : "text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            办理入住
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("checkout")}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
              activeTab === "checkout"
                ? "bg-white text-[#1d1d1f] shadow-sm"
                : "text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            办理退房
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* 左侧表单 */}
        <div className="lg:col-span-2">
          {activeTab === "checkin" ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-black/[0.04] bg-white p-8">
              {/* 步骤指示器 */}
              <div className="mb-6">
                <div className="flex items-center justify-between text-xs mb-3">
                  {[
                    { step: 1, label: "登记顾客" },
                    { step: 2, label: "查询房态" },
                    { step: 3, label: "创建订单" },
                    { step: 4, label: "押金" },
                    { step: 5, label: "门卡" },
                  ].map((item, idx) => (
                    <div key={item.step} className="flex items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all ${
                        checkinStep > item.step 
                          ? "bg-[#34c759] text-white" 
                          : checkinStep === item.step 
                            ? "bg-[#0071e3] text-white" 
                            : "bg-[#f5f5f7] text-[#86868b]"
                      }`}>
                        {checkinStep > item.step ? "✓" : item.step}
                      </div>
                      <span className={`ml-1.5 hidden sm:inline ${
                        checkinStep >= item.step ? "text-[#1d1d1f]" : "text-[#86868b]"
                      }`}>{item.label}</span>
                      {idx < 4 && <div className={`w-4 h-0.5 mx-2 ${
                        checkinStep > item.step ? "bg-[#34c759]" : "bg-[#e5e5e5]"
                      }`} />}
                    </div>
                  ))}
                </div>
              </div>

              <h2 className="text-xl font-semibold text-[#1d1d1f]">入住登记</h2>
              <p className="mt-1 text-xs text-[#86868b]">按 SSD 系统事件顺序逐步完成入住</p>

              {/* 消息提示 */}
              {checkinMessage && (
                <div className={`mt-5 rounded-xl px-4 py-3 text-sm ${
                  checkinMessage.type === "success" 
                    ? "bg-[#34c759]/10 text-[#34c759]" 
                    : "bg-[#ff3b30]/10 text-[#ff3b30]"
                }`}>
                  {checkinMessage.text}
                </div>
              )}

              <div className="mt-6 space-y-6">
                {/* ========== Step 1: Registe_CustomerInfo ========== */}
                <div className={`p-4 rounded-xl border transition-all ${
                  checkinStep === 1 
                    ? "border-[#0071e3] bg-[#0071e3]/5" 
                    : customerRegistered 
                      ? "border-[#34c759]/30 bg-[#34c759]/5" 
                      : "border-black/[0.06] bg-[#f5f5f7]/50"
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#1d1d1f]">
                      ① Registe_CustomerInfo
                    </span>
                    {customerRegistered && (
                      <span className="text-[10px] text-[#34c759] font-medium">✓ 已完成</span>
                    )}
                  </div>
                  
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="身份证号 (Cust_Id)"
                        disabled={customerRegistered}
                        className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        value={customerInfo.custId}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, custId: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="姓名 (Cust_name)"
                        disabled={customerRegistered}
                        className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        value={customerInfo.custName}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, custName: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        placeholder="人数 (number)"
                        min={1}
                        disabled={customerRegistered}
                        className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        value={customerInfo.guestCount}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, guestCount: Number(e.target.value) })}
                      />
                      <input
                        type="datetime-local"
                        disabled={customerRegistered}
                        className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        value={customerInfo.checkInDate}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, checkInDate: e.target.value })}
                      />
                    </div>
                    
                    {!customerRegistered && (
                      <button
                        type="button"
                        onClick={handleRegisterCustomer}
                        className="w-full rounded-lg bg-[#0071e3] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0077ed] active:scale-[0.98] transition-all"
                      >
                        登记顾客信息
                      </button>
                    )}
                  </div>
                </div>

                {/* ========== Step 2: Check_RoomState ========== */}
                <div className={`p-4 rounded-xl border transition-all ${
                  checkinStep === 2 
                    ? "border-[#0071e3] bg-[#0071e3]/5" 
                    : roomStateChecked 
                      ? "border-[#34c759]/30 bg-[#34c759]/5" 
                      : "border-black/[0.06] bg-[#f5f5f7]/50 opacity-50"
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#1d1d1f]">
                      ② Check_RoomState
                    </span>
                    {roomStateChecked && (
                      <span className="text-[10px] text-[#34c759] font-medium">✓ 已完成</span>
                    )}
                  </div>
                  
                  <p className="text-xs text-[#86868b] mb-3">
                    查询日期 {customerInfo.checkInDate.slice(0, 10)} 的房间状态
                  </p>
                  
                  {checkinStep >= 2 && !roomStateChecked && (
                    <button
                      type="button"
                      onClick={handleCheckRoomState}
                      className="w-full rounded-lg bg-[#0071e3] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0077ed] active:scale-[0.98] transition-all"
                    >
                      查询房态
                    </button>
                  )}
                </div>

                {/* ========== Step 3: Create_Accommodation_Order ========== */}
                <div className={`p-4 rounded-xl border transition-all ${
                  checkinStep === 3 
                    ? "border-[#0071e3] bg-[#0071e3]/5" 
                    : orderCreated 
                      ? "border-[#34c759]/30 bg-[#34c759]/5" 
                      : "border-black/[0.06] bg-[#f5f5f7]/50 opacity-50"
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#1d1d1f]">
                      ③ Create_Accommodation_Order
                    </span>
                    {orderCreated && (
                      <span className="text-[10px] text-[#34c759] font-medium">✓ 已完成</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#86868b] mb-3">
                    已预定的房间需与预定姓名/联系方式一致才能办理入住。
                  </p>
                  
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs text-[#86868b]">已选房间：</span>
                    <span className={`text-sm font-semibold ${selectedRoomId ? "text-[#0071e3]" : "text-[#86868b]"}`}>
                      {selectedRoomId ?? "请在右侧选择"}
                    </span>
                  </div>
                  
                  {checkinStep >= 3 && !orderCreated && (
                    <button
                      type="button"
                      onClick={handleCreateOrder}
                      disabled={!selectedRoomId}
                      className="w-full rounded-lg bg-[#0071e3] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0077ed] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      创建住宿订单
                    </button>
                  )}
                </div>

                {/* ========== Step 4: deposite (可选) ========== */}
                <div className={`p-4 rounded-xl border transition-all ${
                  checkinStep === 4 
                    ? "border-[#ff9500] bg-[#ff9500]/5" 
                    : depositConfirmed 
                      ? "border-[#34c759]/30 bg-[#34c759]/5" 
                      : "border-black/[0.06] bg-[#f5f5f7]/50 opacity-50"
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#1d1d1f]">
                      ④ deposite <span className="text-[#ff9500]">(可选)</span>
                    </span>
                    {depositConfirmed && (
                      <span className="text-[10px] text-[#34c759] font-medium">✓ 已完成</span>
                    )}
                  </div>
                  
                  {checkinStep >= 4 && !depositConfirmed && (
                    <div className="space-y-3">
                      <input
                        type="number"
                        placeholder="押金金额 (amount)"
                        min={0}
                        className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm"
                        value={deposit}
                        onChange={(e) => setDeposit(Number(e.target.value))}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleDeposit}
                          className="rounded-lg bg-[#ff9500] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#ff9500]/90 active:scale-[0.98] transition-all"
                        >
                          确认押金
                        </button>
                        <button
                          type="button"
                          onClick={handleSkipDeposit}
                          className="rounded-lg bg-[#f5f5f7] px-4 py-2.5 text-sm font-medium text-[#86868b] hover:bg-[#e5e5e5] active:scale-[0.98] transition-all"
                        >
                          跳过
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ========== Step 5: Create_DoorCard (可选) ========== */}
                <div className={`p-4 rounded-xl border transition-all ${
                  checkinStep === 5 
                    ? "border-[#ff9500] bg-[#ff9500]/5" 
                    : doorCardCreated 
                      ? "border-[#34c759]/30 bg-[#34c759]/5" 
                      : "border-black/[0.06] bg-[#f5f5f7]/50 opacity-50"
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#1d1d1f]">
                      ⑤ Create_DoorCard <span className="text-[#ff9500]">(可选)</span>
                    </span>
                    {doorCardCreated && (
                      <span className="text-[10px] text-[#34c759] font-medium">✓ 已完成</span>
                    )}
                  </div>
                  
                  {checkinStep >= 5 && !doorCardCreated && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleCreateDoorCard}
                        className="rounded-lg bg-[#ff9500] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#ff9500]/90 active:scale-[0.98] transition-all"
                      >
                        生成门卡
                      </button>
                      <button
                        type="button"
                        onClick={handleSkipDoorCard}
                        className="rounded-lg bg-[#f5f5f7] px-4 py-2.5 text-sm font-medium text-[#86868b] hover:bg-[#e5e5e5] active:scale-[0.98] transition-all"
                      >
                        跳过
                      </button>
                    </div>
                  )}
                </div>

                {/* 重新开始按钮 */}
                {(orderCreated || doorCardCreated) && (
                  <button
                    type="button"
                    onClick={resetCheckinFlow}
                    className="w-full rounded-xl bg-[#1d1d1f] px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-[#424245] active:scale-[0.98]"
                  >
                    办理下一位顾客
                  </button>
                )}
              </div>
              </div>

              <div className="rounded-2xl border border-black/[0.04] bg-white p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-[#1d1d1f]">预定房间</h3>
                    <p className="mt-1 text-xs text-[#86868b]">预定后房间不可再被选择，需解除预定才能办理入住。</p>
                  </div>
                  <span className="px-2 py-1 rounded-md bg-[#fef3c7] text-[10px] text-[#92400e] font-medium border border-[#fcd34d]/70">
                    预留
                  </span>
                </div>

                {reservationMessage && (
                  <div
                    className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                      reservationMessage.type === "success"
                        ? "bg-[#fef3c7] text-[#92400e] border border-[#fcd34d]/70"
                        : "bg-[#ff3b30]/10 text-[#ff3b30]"
                    }`}
                  >
                    {reservationMessage.text}
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="房间号"
                      value={reservationForm.roomId}
                      onChange={(e) => setReservationForm({ ...reservationForm, roomId: e.target.value })}
                      className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={fillReservationRoom}
                      className="rounded-lg border border-[#fcd34d]/70 bg-[#fef3c7] px-3 py-2 text-sm font-medium text-[#92400e] transition-all hover:bg-[#fde68a] active:scale-[0.98]"
                    >
                      用右侧选中填充
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="预定人姓名"
                      value={reservationForm.guestName}
                      onChange={(e) => setReservationForm({ ...reservationForm, guestName: e.target.value })}
                      className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="联系方式（可选）"
                      value={reservationForm.contact}
                      onChange={(e) => setReservationForm({ ...reservationForm, contact: e.target.value })}
                      className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="datetime-local"
                      value={reservationForm.eta}
                      onChange={(e) => setReservationForm({ ...reservationForm, eta: e.target.value })}
                      className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="备注（可选）"
                      value={reservationForm.note}
                      onChange={(e) => setReservationForm({ ...reservationForm, note: e.target.value })}
                      className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleReserveRoom}
                      className="rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#424245] active:scale-[0.98]"
                    >
                      确认预定
                    </button>
                    <p className="text-[11px] text-[#86868b]">同一房间再次提交会覆盖旧预定</p>
                  </div>

                  <div className="rounded-xl bg-[#f7f7f8] p-3 border border-black/[0.04]">
                    {reservations.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-auto pr-1">
                        {reservations.map((r) => (
                          <div
                            key={`${r.roomId}-${r.createdAt}`}
                            className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs border border-[#ececec] shadow-sm"
                          >
                            <div className="space-y-0.5">
                              <p className="text-[#1d1d1f] font-semibold">房间 {r.roomId} · {r.guestName}</p>
                              <p className="text-[#86868b]">
                                {(r.eta || "").replace("T", " ")}{r.contact ? ` · ${r.contact}` : ""}
                              </p>
                              {r.note && <p className="text-[#b45309]">{r.note}</p>}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCancelReservation(r.roomId)}
                              className="text-[10px] px-2 py-1 rounded-md bg-[#fef3c7] text-[#92400e] border border-[#fcd34d]/70 hover:bg-[#fde68a] active:scale-95"
                            >
                              解除
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-[#86868b] italic">暂无预定记录</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-black/[0.04] bg-white p-8 space-y-6">
              {/* 步骤指示器 */}
              <div className="mb-2">
                <div className="flex items-center justify-between text-xs">
                  {[
                    { step: 1, label: "选择房间" },
                    { step: 2, label: "确认账单" },
                    { step: 3, label: "支付完成" },
                  ].map((item, idx) => (
                    <div key={item.step} className="flex items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all ${
                        checkoutStep > item.step 
                          ? "bg-[#34c759] text-white" 
                          : checkoutStep === item.step 
                            ? "bg-[#1d1d1f] text-white" 
                            : "bg-[#f5f5f7] text-[#86868b]"
                      }`}>
                        {checkoutStep > item.step ? "✓" : item.step}
                      </div>
                      <span className={`ml-2 ${
                        checkoutStep >= item.step ? "text-[#1d1d1f]" : "text-[#86868b]"
                      }`}>{item.label}</span>
                      {idx < 2 && <div className={`w-8 h-0.5 mx-3 ${
                        checkoutStep > item.step ? "bg-[#34c759]" : "bg-[#e5e5e5]"
                      }`} />}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-xl font-semibold text-[#1d1d1f]">退房结账</h2>
                <p className="mt-1 text-xs text-[#86868b]">按 SSD 系统事件顺序完成退房流程</p>
              </div>

              {/* 消息提示 */}
              {checkoutMessage && (
                <div className={`rounded-xl px-4 py-3 text-sm ${
                  checkoutMessage.type === "success" 
                    ? "bg-[#34c759]/10 text-[#34c759]" 
                    : "bg-[#ff3b30]/10 text-[#ff3b30]"
                }`}>
                  {checkoutMessage.text}
                </div>
              )}

              {/* ========== Step 1: 选择房间 + Process_CheckOut ========== */}
              <div className={`p-4 rounded-xl border transition-all ${
                checkoutStep === 1 
                  ? "border-[#1d1d1f] bg-[#1d1d1f]/5" 
                  : "border-[#34c759]/30 bg-[#34c759]/5"
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#1d1d1f]">
                    ① Process_CheckOut(Room_id)
                  </span>
                  {checkoutStep > 1 && (
                    <span className="text-[10px] text-[#34c759] font-medium">✓ 已完成</span>
                  )}
                </div>
                
                <p className="text-[10px] text-[#86868b] mb-3">
                  系统自动执行: query_FeeRecords → calculate_Fees → Create_Bills
                </p>
                
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-[#86868b]">已选房间：</span>
                  <span className={`text-sm font-semibold ${checkoutRoomId ? "text-[#1d1d1f]" : "text-[#86868b]"}`}>
                    {checkoutRoomId || "请在右侧选择已入住房间"}
                  </span>
                </div>
                
                {checkoutStep === 1 && (
                  <button
                    type="button"
                    onClick={handleProcessCheckOut}
                    disabled={checkoutLoading || !checkoutRoomId}
                    className="w-full rounded-lg bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#424245] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checkoutLoading ? "正在生成账单..." : "开始结账"}
                  </button>
                )}
              </div>

              {/* Step 2 状态显示 */}
              {checkoutStep >= 2 && (
                <div className={`p-4 rounded-xl border transition-all ${
                  paymentSuccess 
                    ? "border-[#34c759]/30 bg-[#34c759]/5" 
                    : "border-[#0071e3] bg-[#0071e3]/5"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#1d1d1f]">
                      ② ProcessPayment(RoomId, Total_fees)
                    </span>
                    {paymentSuccess && (
                      <span className="text-[10px] text-[#34c759] font-medium">✓ 已完成</span>
                    )}
                  </div>
                  
                  {!paymentSuccess ? (
                    <p className="text-xs text-[#0071e3]">
                      账单已生成，请在弹窗中查看并确认支付
                    </p>
                  ) : (
                    <div className="text-center py-2">
                      <p className="text-sm font-medium text-[#34c759]">✓ 支付成功！</p>
                      <p className="text-xs text-[#86868b] mt-1">房间 {checkoutRoomId} 已恢复空闲状态</p>
                    </div>
                  )}
                </div>
              )}

              {/* 重新开始按钮 */}
              {paymentSuccess && (
                <button
                  type="button"
                  onClick={resetCheckoutFlow}
                  className="w-full rounded-xl bg-[#1d1d1f] px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-[#424245] active:scale-[0.98]"
                >
                  办理下一位退房
                </button>
              )}
            </div>
          )}
        </div>

        {/* ========== 账单弹窗 - OpenAI DeepResearch 风格 ========== */}
        {checkoutStep >= 2 && checkoutSummary && !paymentSuccess && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-[fadeIn_200ms_ease-out]"
            onKeyDown={(e) => e.key === "Escape" && setCheckoutStep(1)}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            {/* 蒙层 - 半透明深色 + 轻微模糊 */}
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-[12px] animate-[fadeIn_200ms_ease-out]"
              onClick={() => setCheckoutStep(1)}
            />
            
            {/* 主卡片容器 - DeepResearch 风格 */}
            <div 
              className="relative w-full max-w-[460px] max-h-[90vh] flex flex-col
                         bg-white/95 backdrop-blur-xl
                         rounded-[20px] 
                         shadow-[0_4px_24px_rgba(0,0,0,0.12),0_12px_48px_rgba(0,0,0,0.08)]
                         border border-white/20
                         animate-[modalSlideIn_180ms_cubic-bezier(0.16,1,0.3,1)]
                         overflow-hidden"
              style={{
                // @ts-expect-error CSS custom property
                "--tw-shadow-color": "rgba(0,0,0,0.1)",
              }}
            >
              
              {/* ===== 标题区域 ===== */}
              <div className="flex-shrink-0 px-7 pt-7 pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="animate-[contentFadeIn_300ms_ease-out_50ms_both]">
                    {/* 状态标签 */}
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-md bg-[#10a37f] text-white shadow-sm">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span className="text-[13px] font-medium text-[#10a37f]">账单已生成</span>
                    </div>
                    {/* 主标题 */}
                    <h2 className="text-[22px] font-semibold text-[#0d0d0d] leading-tight tracking-[-0.01em]">
                      房间 {checkoutRoomId} · 退房结算
                    </h2>
                    <p className="mt-1.5 text-[14px] text-[#6e6e80] leading-relaxed">
                      请确认以下费用明细后完成支付
                    </p>
                  </div>
                  {/* 关闭按钮 */}
                  <button
                    onClick={() => setCheckoutStep(1)}
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-[10px] 
                               text-[#8e8ea0] hover:text-[#0d0d0d] hover:bg-[#f4f4f5] 
                               transition-all duration-150 active:scale-95"
                    aria-label="关闭"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* ===== 内容区域（可滚动）===== */}
              <div className="flex-1 overflow-y-auto px-7 pb-5 space-y-4">
                
                {/* Section 1: 住宿费用 */}
                <div className="p-5 rounded-2xl bg-[#f7f7f8]/80 border border-[#e5e5e5]/50 animate-[contentFadeIn_300ms_ease-out_100ms_both]">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-9 h-9 rounded-xl bg-[#fff4e5] flex items-center justify-center text-[18px]">🏨</span>
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#0d0d0d]">住宿费用</h3>
                      <p className="text-[12px] text-[#8e8ea0]">Accommodation</p>
                    </div>
                    <span className="ml-auto text-[17px] font-semibold text-[#0d0d0d] tabular-nums">
                      ¥{checkoutSummary.accommodationBill?.roomFee?.toFixed(2) ?? "0.00"}
                    </span>
                  </div>
                  <div className="space-y-2.5 text-[13px] leading-[1.7]">
                    <div className="flex justify-between">
                      <span className="text-[#6e6e80]">房费单价</span>
                      <span className="text-[#0d0d0d] tabular-nums">¥{checkoutSummary.accommodationBill?.ratePerNight?.toFixed(2) ?? "0.00"}/晚</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6e6e80]">入住天数</span>
                      <span className="text-[#0d0d0d]">{checkoutSummary.accommodationBill?.nights ?? 1} 晚</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6e6e80]">押金抵扣</span>
                      <span className="text-[#10a37f] font-medium tabular-nums">-¥{checkoutSummary.accommodationBill?.deposit?.toFixed(2) ?? "0.00"}</span>
                    </div>
                  </div>
                </div>

                {/* Section 2: 空调费用 */}
                <div className="p-5 rounded-2xl bg-[#f7f7f8]/80 border border-[#e5e5e5]/50 animate-[contentFadeIn_300ms_ease-out_150ms_both]">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-9 h-9 rounded-xl bg-[#e5f4ff] flex items-center justify-center text-[18px]">❄️</span>
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#0d0d0d]">空调费用</h3>
                      <p className="text-[12px] text-[#8e8ea0]">Air Conditioning</p>
                    </div>
                    <span className="ml-auto text-[17px] font-semibold text-[#0d0d0d] tabular-nums">
                      ¥{checkoutSummary.acBill?.totalFee?.toFixed(2) ?? "0.00"}
                    </span>
                  </div>
                  
                  {checkoutSummary.acBill ? (
                    <div className="space-y-2.5 text-[13px] leading-[1.7]">
                      <div className="flex justify-between">
                        <span className="text-[#6e6e80]">计费周期</span>
                        <span className="text-[#0d0d0d]">
                          {typeof checkoutSummary.accommodationBill?.accommodationSeconds === "number"
                            ? `${formatLogicTime(0)} → ${formatLogicTime(checkoutSummary.accommodationBill.accommodationSeconds)}`
                            : `${formatDate(checkoutSummary.acBill.periodStart)} → ${formatDate(checkoutSummary.acBill.periodEnd)}`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#8e8ea0] italic">本次入住未产生空调费用</p>
                  )}
                </div>

                {/* Section 3: 使用明细（可折叠）*/}
                {checkoutSummary.detailRecords && checkoutSummary.detailRecords.length > 0 && (
                  <details className="group animate-[contentFadeIn_300ms_ease-out_200ms_both]">
                    <summary className="flex items-center gap-2.5 cursor-pointer py-2.5 px-4 rounded-xl 
                                        text-[13px] font-medium text-[#6e6e80] 
                                        hover:bg-[#f4f4f5] hover:text-[#0d0d0d] 
                                        transition-all duration-150 select-none">
                      <svg 
                        className="w-4 h-4 transition-transform duration-200 group-open:rotate-90 text-[#8e8ea0]" 
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                      >
                        <path d="M9 5l7 7-7 7" />
                      </svg>
                      <span>查看 {checkoutSummary.detailRecords.length} 条空调使用记录</span>
                    </summary>
                    <div className="mt-3 space-y-2 pl-2 pr-1 max-h-[180px] overflow-y-auto">
                      {checkoutSummary.detailRecords.map((rec, idx) => (
                        <div 
                          key={rec.recordId || idx} 
                          className="flex items-center gap-3 text-[12px] py-2.5 px-4 rounded-xl 
                                     bg-white border border-[#ececec] shadow-sm"
                        >
                          <span className="text-[#8e8ea0] tabular-nums font-mono text-[11px]">
                            {rec.logicStartSeconds != null ? formatLogicTime(rec.logicStartSeconds) : formatDate(rec.startedAt)} →{" "}
                            {rec.logicEndSeconds != null ? formatLogicTime(rec.logicEndSeconds) : rec.endedAt ? formatDate(rec.endedAt) : "进行中"}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-[#f0f0f0] text-[#0d0d0d] text-[10px] font-medium">
                            {rec.speed}
                          </span>
                          <span className="ml-auto text-[#0d0d0d] font-semibold tabular-nums">
                            ¥{rec.feeValue?.toFixed(2) ?? "0.00"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {/* ===== 底部操作区 ===== */}
              <div className="flex-shrink-0 px-7 py-6 bg-gradient-to-t from-[#fafafa] to-[#fafafa]/80 border-t border-[#ececec]">
                {/* 总金额展示 */}
                <div className="flex items-end justify-between mb-5 animate-[contentFadeIn_300ms_ease-out_250ms_both]">
                  <div>
                    <p className="text-[13px] text-[#8e8ea0] mb-0.5">应付总额</p>
                    <p className="text-[11px] text-[#acacac]">
                      住宿 ¥{checkoutSummary.accommodationBill?.roomFee?.toFixed(2) ?? "0"} + 空调 ¥{checkoutSummary.acBill?.totalFee?.toFixed(2) ?? "0"}
                    </p>
                  </div>
                  <span className="text-[32px] font-bold text-[#0d0d0d] tabular-nums tracking-tight leading-none">
                    ¥{checkoutSummary.totalDue?.toFixed(2) ?? "0.00"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4 text-[12px]">
                  <button
                    type="button"
                    onClick={exportAcBill}
                    className="h-[38px] rounded-lg bg-[#f4f4f5] text-[#0d0d0d] border border-black/[0.06] hover:bg-[#e8e8e9] active:scale-[0.98]"
                  >
                    导出空调账单 (CSV)
                  </button>
                  <button
                    type="button"
                    onClick={exportAcDetails}
                    className="h-[38px] rounded-lg bg-[#f4f4f5] text-[#0d0d0d] border border-black/[0.06] hover:bg-[#e8e8e9] active:scale-[0.98]"
                  >
                    导出空调详单 (CSV)
                  </button>
                </div>

                {/* 按钮组 */}
                <div className="flex gap-3 animate-[contentFadeIn_300ms_ease-out_300ms_both]">
                  <button
                    type="button"
                    onClick={() => setCheckoutStep(1)}
                    className="flex-1 h-[50px] rounded-[14px] 
                               bg-[#f4f4f5] text-[15px] font-medium text-[#0d0d0d]
                               transition-all duration-150 
                               hover:bg-[#e8e8e9] active:scale-[0.98]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleProcessPayment}
                    disabled={paymentLoading}
                    className="flex-[2] h-[50px] rounded-[14px] 
                               bg-[#10a37f] text-[15px] font-medium text-white
                               shadow-[0_2px_8px_rgba(16,163,127,0.3)]
                               transition-all duration-150 
                               hover:bg-[#0e9470] hover:shadow-[0_4px_12px_rgba(16,163,127,0.4)]
                               active:scale-[0.98] 
                               disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                               flex items-center justify-center gap-2"
                  >
                    {paymentLoading ? (
                      <>
                        <span className="w-[18px] h-[18px] border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>处理中...</span>
                      </>
                    ) : (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span>确认支付</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* 自定义动画 keyframes - 通过 style 标签注入 */}
            <style>{`
              @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes modalSlideIn {
                from { 
                  opacity: 0; 
                  transform: scale(0.95) translateY(10px); 
                }
                to { 
                  opacity: 1; 
                  transform: scale(1) translateY(0); 
                }
              }
              @keyframes contentFadeIn {
                from { 
                  opacity: 0; 
                  transform: translateY(6px); 
                }
                to { 
                  opacity: 1; 
                  transform: translateY(0); 
                }
              }
            `}</style>
          </div>
        )}

        {/* 右侧房间选择 - 楼层式布局 */}
        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-black/[0.04] bg-white p-6">
            {/* 头部：标题 + 筛选 */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-[#1d1d1f]">房间选择</h3>
                <p className="mt-1 text-xs text-[#86868b]">
                  {activeTab === "checkin" 
                    ? (roomStateChecked 
                        ? "选择空闲房间创建订单" 
                        : "请先完成步骤①②后选择房间")
                    : "选择已入住房间办理退房"}
                </p>
              </div>
              {/* 筛选按钮组 */}
              <div className="flex rounded-lg bg-[#f5f5f7] p-0.5">
                {[
                  { key: "all", label: "全部" },
                  { key: "available", label: "空闲" },
                  { key: "occupied", label: "入住" },
                  { key: "reserved", label: "已预定" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setRoomFilter(item.key as FilterType)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      roomFilter === item.key
                        ? "bg-white text-[#1d1d1f] shadow-sm"
                        : "text-[#86868b] hover:text-[#1d1d1f]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 入住时：未完成查询房态时显示提示遮罩 */}
            {activeTab === "checkin" && !roomStateChecked && (
              <div className="mb-4 p-4 rounded-xl bg-[#ff9500]/10 border border-[#ff9500]/20">
                <p className="text-sm text-[#ff9500] font-medium">
                  ⚠️ 请先完成「登记顾客信息」和「查询房态」步骤
                </p>
                <p className="text-xs text-[#ff9500]/70 mt-1">
                  按照 SSD 系统事件顺序，需要先调用 Check_RoomState 才能选择房间
                </p>
              </div>
            )}

            {/* 图例 */}
            <div className="flex items-center gap-5 mb-5 pb-4 border-b border-black/[0.04]">
              {activeTab === "checkin" && !roomStateChecked ? (
                // 未查询房态时显示"未知"图例
                <span className="flex items-center gap-2 text-xs text-[#86868b]">
                  <span className="w-6 h-6 rounded-lg bg-[#e5e5e5] border border-black/[0.04] flex items-center justify-center text-[10px] text-[#86868b]">?</span>
                  未查询（请先执行 Check_RoomState）
                </span>
              ) : (
                <>
                  <span className="flex items-center gap-2 text-xs text-[#86868b]">
                    <span className="w-6 h-6 rounded-lg bg-[#f5f5f7] border border-black/[0.06] flex items-center justify-center text-[10px] text-[#86868b]">1</span>
                    空闲
                  </span>
                  <span className="flex items-center gap-2 text-xs text-[#86868b]">
                    <span className="w-6 h-6 rounded-lg bg-[#1d1d1f] flex items-center justify-center text-[10px] text-white">1</span>
                    已入住
                  </span>
                  <span className="flex items-center gap-2 text-xs text-[#86868b]">
                    <span className="w-6 h-6 rounded-lg bg-[#fef3c7] border border-[#fcd34d] flex items-center justify-center text-[10px] text-[#92400e]">1</span>
                    已预定
                  </span>
                  <span className="flex items-center gap-2 text-xs text-[#86868b]">
                    <span className="w-6 h-6 rounded-lg bg-[#0071e3] flex items-center justify-center text-[10px] text-white ring-2 ring-[#0071e3]/30 ring-offset-1">1</span>
                    已选中
                  </span>
                </>
              )}
            </div>

            {/* 楼层式房间网格 */}
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2 scrollbar-thin">
              {[9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((floor) => {
                const floorRooms = Array.from({ length: 10 }, (_, i) => String(floor * 10 + i + 1));
                const floorReserved = floorRooms.filter((id) => reservedSet.has(id)).length;
                const floorUnavailable = floorRooms.filter((id) => unavailableSet.has(id)).length;
                
                // 根据筛选条件决定是否显示该楼层
                const hasVisibleRooms = floorRooms.some(id => {
                  const isOccupied = displayOccupiedSet.has(id);
                  const isReserved = reservedSet.has(id);
                  const isUnavailable = isOccupied || isReserved;
                  if (roomFilter === "available") return !isUnavailable;
                  if (roomFilter === "occupied") return isOccupied;
                  if (roomFilter === "reserved") return isReserved;
                  return true;
                });

                if (!hasVisibleRooms) return null;

                return (
                  <div key={floor} className="flex items-center gap-3">
                    {/* 楼层标识 */}
                    <div className="w-10 shrink-0 text-right">
                      <span className="text-xs font-semibold text-[#86868b]">{floor + 1}F</span>
                      <span className="block text-[10px] text-[#c7c7cc]">
                        {activeTab === "checkin" && !roomStateChecked ? "?" : floorUnavailable}/10
                      </span>
                      {floorReserved > 0 && (
                        <span className="block text-[10px] text-[#d97706]">预定 {floorReserved}</span>
                      )}
                    </div>
                    
                    {/* 房间按钮 */}
                    <div className="flex-1 grid grid-cols-10 gap-1.5">
                      {floorRooms.map((id) => {
                        const isSelectedCheckin = activeTab === "checkin" && selectedRoomId === id;
                        const isSelectedCheckout = activeTab === "checkout" && checkoutRoomId === id;
                        const isSelected = isSelectedCheckin || isSelectedCheckout;
                        const reservation = reservations.find((r) => r.roomId === id);
                        const isReserved = !!reservation;
                        const reservationMatched = matchReservationWithCustomer(reservation, customerInfo.custName, customerInfo.custId);
                        const isOccupied = displayOccupiedSet.has(id);
                        const isUnavailable = isOccupied || (isReserved && !reservationMatched);
                        // 入住时：需要完成查询房态步骤才能选择
                        const canSelectForCheckin =
                          activeTab === "checkin" &&
                          roomStateChecked &&
                          !orderCreated &&
                          ((isReserved && reservationMatched) || (!isReserved && !isOccupied));
                        // 退房时：只有 Step 1 且房间已入住才能选择
                        const canSelectForCheckout = activeTab === "checkout" && isOccupied && checkoutStep === 1;
                        const isSelectable = canSelectForCheckin || canSelectForCheckout;
                        
                        // 根据筛选隐藏房间
                        const isHidden = 
                          (roomFilter === "available" && isUnavailable) ||
                          (roomFilter === "occupied" && !isOccupied) ||
                          (roomFilter === "reserved" && !isReserved);

                        if (isHidden) {
                          return <div key={id} className="h-8" />; // 占位保持布局
                        }

                        // 入住流程中未查询房态时，显示为未知状态
                        const showUnknown = activeTab === "checkin" && !roomStateChecked && !isReserved;
                        const buttonTitle = isReserved
                          ? reservationMatched
                            ? `匹配预定 · ${reservation?.guestName ?? ""}${reservation?.eta ? ` · ${reservation.eta}` : ""}`
                            : `已预定${reservation?.guestName ? ` · ${reservation.guestName}` : ""}${reservation?.eta ? ` · ${reservation.eta}` : ""}`
                          : isOccupied
                          ? "已入住/空调运行中"
                          : "可选房间";

                        return (
                          <button
                            key={id}
                            type="button"
                            title={buttonTitle}
                            disabled={!isSelectable}
                            onClick={() => isSelectable && handleSelectRoom(id)}
                            className={[
                              "group relative h-8 rounded-lg text-[11px] font-medium transition-all duration-200",
                              isSelected
                                ? "bg-[#0071e3] text-white ring-2 ring-[#0071e3]/30 ring-offset-1 scale-110 z-10"
                              : showUnknown
                                ? "bg-[#e5e5e5] text-[#86868b] border border-black/[0.04]"  // 未知状态：灰色
                                : isReserved
                                ? reservationMatched
                                  ? "bg-[#ecfdf3] text-[#166534] border border-[#86efac]"
                                  : "bg-[#fef3c7] text-[#92400e] border border-[#fcd34d]"
                                : isOccupied
                                ? "bg-[#1d1d1f] text-white/90"
                                : "bg-[#f5f5f7] text-[#1d1d1f] border border-black/[0.06]",
                              isSelectable && !isSelected
                                ? "hover:scale-110 hover:shadow-md hover:z-10 cursor-pointer"
                                : "",
                              !isSelectable
                                ? "opacity-30 cursor-not-allowed"
                                : "",
                            ].join(" ")}
                          >
                            {isReserved && (
                              <span
                                className={`absolute -top-1 -right-1 rounded-md text-white text-[9px] px-[6px] py-[1px] leading-none shadow-sm ${
                                  reservationMatched ? "bg-[#16a34a]" : "bg-[#f59e0b]"
                                }`}
                              >
                                预
                              </span>
                            )}
                            {id}
                            {/* 悬浮提示 */}
                            {isSelectable && (
                              <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-[#1d1d1f] text-white text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                {activeTab === "checkout" ? "点击退房" : "点击选择"}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部统计卡片 */}
            <div className="mt-6 pt-5 border-t border-black/[0.04]">
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-xl bg-[#fef3c7] p-3 text-center border border-[#fcd34d]/60">
                  <p className="text-2xl font-semibold text-[#d97706]">
                    {reservedSet.size}
                  </p>
                  <p className="text-[10px] text-[#b45309] mt-0.5">已预定</p>
                </div>
                <div className="rounded-xl bg-[#f5f5f7] p-3 text-center">
                  <p className="text-2xl font-semibold text-[#1d1d1f]">
                    {activeTab === "checkin" && !roomStateChecked ? "?" : displayOccupiedSet.size}
                  </p>
                  <p className="text-[10px] text-[#86868b] mt-0.5">已入住</p>
                </div>
                <div className="rounded-xl bg-[#f5f5f7] p-3 text-center">
                  <p className="text-2xl font-semibold text-[#34c759]">
                    {activeTab === "checkin" && !roomStateChecked ? "?" : 100 - unavailableSet.size}
                  </p>
                  <p className="text-[10px] text-[#86868b] mt-0.5">可选房间</p>
                </div>
                <div className="rounded-xl bg-[#0071e3]/10 p-3 text-center">
                  <p className="text-2xl font-semibold text-[#0071e3]">{selectedRoomId ?? "—"}</p>
                  <p className="text-[10px] text-[#86868b] mt-0.5">当前选中</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
