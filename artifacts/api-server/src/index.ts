import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { Server as SocketIOServer } from "socket.io";
import { ensureDemoAuthAccounts } from "./lib/demo-auth";
import { setSocketServer } from "./lib/realtime";
import { seedParklyData } from "./lib/seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await seedParklyData();
  await ensureDemoAuthAccounts();

  const server = createServer(app);
  const io = new SocketIOServer(server, {
    path: "/api/socket.io",
    cors: { origin: true, credentials: true },
  });
  setSocketServer(io);
  io.on("connection", (socket) => {
    socket.on("join-location", (locationId: unknown) => {
      if (typeof locationId === "string" && /^[a-z0-9-]{1,80}$/i.test(locationId)) {
        socket.join(`location:${locationId}`);
      }
    });
  });

  server.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

startServer().catch((err: unknown) => {
  logger.error({ err }, "API server failed to start");
  process.exit(1);
});
