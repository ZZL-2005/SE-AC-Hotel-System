import { RoomSelectorPage } from "./RoomSelectorPage";

export function CustomerPage() {
  // 顾客页面：复用房间选择器，只能看到和控制自己的房间
  return <RoomSelectorPage />;
}
