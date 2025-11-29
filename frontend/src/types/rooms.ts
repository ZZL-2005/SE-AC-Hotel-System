export type RoomStatus = {
  roomId: string;
  status: string;
  currentTemp: number;
  targetTemp: number;
  speed: string | null;
  isServing: boolean;
  isWaiting: boolean;
  currentFee: number;
  totalFee: number;
  servedSeconds: number;
  waitedSeconds: number;
  serviceSpeed?: string | null;
  serviceStartedAt?: string | null;
  waitSpeed?: string | null;
  mode?: string | null;
};
