import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";
import {
  CheckInPage,
  CheckOutPage,
  Home,
  MonitorPage,
  ReportPage,
  RoomControlPage,
  RoomSelectorPage,
} from "./pages";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "room-control", element: <RoomSelectorPage /> },
      { path: "room-control/:roomId", element: <RoomControlPage /> },
      { path: "checkin", element: <CheckInPage /> },
      { path: "checkout", element: <CheckOutPage /> },
      { path: "monitor", element: <MonitorPage /> },
      { path: "report", element: <ReportPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
