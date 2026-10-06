import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  GetEntranceBoardParams,
  GetEntranceBoardResponse,
  GetParkingLocationParams,
  GetParkingLocationResponse,
  ListParkingLocationsQueryParams,
  ListParkingLocationsResponse,
  UpdateBayStatusBody,
  UpdateBayStatusParams,
  UpdateBayStatusResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  baysTable,
  locationsTable,
} from "@workspace/db/schema";
import { getAuth } from "@clerk/express";
import { getParklyUser } from "../lib/users";
import { publishBayUpdate } from "../lib/realtime";

const router: IRouter = Router();
const allowedBayStatuses = new Set(["free", "reserved", "occupied", "out_of_service"]);

async function toLocation(location: typeof locationsTable.$inferSelect) {
  const bayRows = await db
    .select({ status: baysTable.status })
    .from(baysTable)
    .where(eq(baysTable.locationId, location.id));
  const freeBays = bayRows.filter((bay) => bay.status === "free").length;
  const distanceIndex = Math.abs(
    location.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 11,
  );

  return GetParkingLocationResponse.parse({
    id: location.id,
    name: location.name,
    address: location.address,
    city: location.city,
    country: location.country,
    latitude: location.latitude,
    longitude: location.longitude,
    description: location.description,
    rate: location.rate,
    currency: location.currency,
    rating: location.rating,
    totalBays: bayRows.length,
    freeBays,
    amenities: location.amenities,
    imageUrl: location.imageUrl,
    driveMinutes: 8 + distanceIndex * 2,
    walkMinutes: 4 + distanceIndex,
    estimateOnly: true,
  });
}

router.get("/parking/locations", async (req, res): Promise<void> => {
  const query = ListParkingLocationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { city, q, covered, evCharging, accessible } = query.data;
  const allLocations = await db.select().from(locationsTable);
  const filtered = allLocations.filter((location) => {
    const searchText = `${location.name} ${location.address} ${location.city}`.toLowerCase();
    if (city && !location.city.toLowerCase().includes(city.toLowerCase())) return false;
    if (q && !searchText.includes(q.toLowerCase())) return false;
    if (covered && !location.amenities.some((item) => item.toLowerCase().includes("covered"))) return false;
    if (evCharging && !location.amenities.some((item) => item.toLowerCase().includes("ev"))) return false;
    if (accessible && !location.amenities.some((item) => item.toLowerCase().includes("accessible"))) return false;
    return true;
  });
  const response = await Promise.all(filtered.map(toLocation));
  res.json(ListParkingLocationsResponse.parse(response));
});

router.get("/parking/locations/:locationId", async (req, res): Promise<void> => {
  const params = GetParkingLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [location] = await db
    .select()
    .from(locationsTable)
    .where(eq(locationsTable.id, params.data.locationId))
    .limit(1);
  if (!location) {
    res.status(404).json({ error: "Parking location not found" });
    return;
  }
  res.json(await toLocation(location));
});

router.get("/display/:locationId", async (req, res): Promise<void> => {
  const params = GetEntranceBoardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [location] = await db
    .select({ id: locationsTable.id, name: locationsTable.name })
    .from(locationsTable)
    .where(eq(locationsTable.id, params.data.locationId))
    .limit(1);
  if (!location) {
    res.status(404).json({ error: "Parking location not found" });
    return;
  }
  const bays = await db
    .select({
      id: baysTable.id,
      level: baysTable.level,
      code: baysTable.code,
      type: baysTable.type,
      status: baysTable.status,
    })
    .from(baysTable)
    .where(eq(baysTable.locationId, location.id))
    .orderBy(baysTable.level, baysTable.code);
  const freeBays = bays.filter((bay) => bay.status === "free").length;
  res.json(
    GetEntranceBoardResponse.parse({
      locationId: location.id,
      locationName: location.name,
      updatedAt: new Date().toISOString(),
      freeBays,
      totalBays: bays.length,
      bays,
    }),
  );
});

router.patch(
  "/display/:locationId/bays/:bayId",
  async (req, res): Promise<void> => {
    const auth = getAuth(req);
    if (!auth.userId) {
      res.status(401).json({ error: "Sign in as a car-park owner to update bays." });
      return;
    }
    const params = UpdateBayStatusParams.safeParse(req.params);
    const body = UpdateBayStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid bay status update." });
      return;
    }
    if (!allowedBayStatuses.has(body.data.status)) {
      res.status(400).json({ error: "Unsupported bay status." });
      return;
    }
    const user = await getParklyUser(req);
    if (!user || user.role !== "owner") {
      res.status(403).json({ error: "Owner access is required." });
      return;
    }
    const [location] = await db
      .select({ id: locationsTable.id })
      .from(locationsTable)
      .where(and(eq(locationsTable.id, params.data.locationId), eq(locationsTable.ownerId, user.id)))
      .limit(1);
    if (!location) {
      res.status(404).json({ error: "Owned parking location not found." });
      return;
    }
    const [bay] = await db
      .update(baysTable)
      .set({ status: body.data.status, lastStatusAt: new Date() })
      .where(and(eq(baysTable.id, params.data.bayId), eq(baysTable.locationId, location.id)))
      .returning({
        id: baysTable.id,
        level: baysTable.level,
        code: baysTable.code,
        type: baysTable.type,
        status: baysTable.status,
      });
    if (!bay) {
      res.status(404).json({ error: "Bay not found." });
      return;
    }
    publishBayUpdate(location.id, bay);
    res.json(UpdateBayStatusResponse.parse(bay));
  },
);

router.get("/owner/locations", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in to view owner locations." });
    return;
  }
  const user = await getParklyUser(req);
  if (!user || user.role !== "owner") {
    res.status(403).json({ error: "Owner access is required." });
    return;
  }
  const locations = await db
    .select()
    .from(locationsTable)
    .where(eq(locationsTable.ownerId, user.id));
  const response = await Promise.all(locations.map(toLocation));
  res.json(ListParkingLocationsResponse.parse(response));
});

export default router;
