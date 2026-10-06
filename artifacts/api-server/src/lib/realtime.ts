import type { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | undefined;

export function setSocketServer(server: SocketIOServer): void {
  io = server;
}

export function publishBayUpdate(locationId: string, bay: unknown): void {
  io?.to(`location:${locationId}`).emit("bay:updated", {
    locationId,
    bay,
    updatedAt: new Date().toISOString(),
  });
}
