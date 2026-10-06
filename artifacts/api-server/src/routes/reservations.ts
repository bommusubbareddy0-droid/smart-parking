import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import {
  CancelReservationParams,
  CancelReservationResponse,
  CreateReservationBody,
  CreateReservationResponse,
  GetAdminSummaryResponse,
  GetDashboardSummaryResponse,
  ListReservationsResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  auditEventsTable,
  baysTable,
  locationsTable,
  paymentsTable,
  reservationsTable,
} from "@workspace/db/schema";
import { getParklyUser } from "../lib/users";
import { publishBayUpdate } from "../lib/realtime";

const router: IRouter = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function reservationView(
  id: string,
  userId?: string,
  tx: typeof db | Tx = db,
): Promise<Record<string, unknown> | null> {
  const conditions = [eq(reservationsTable.id, id)];
  if (userId) conditions.push(eq(reservationsTable.userId, userId));
  const [row] = await tx
    .select({
      id: reservationsTable.id,
      locationId: reservationsTable.locationId,
      locationName: locationsTable.name,
      address: locationsTable.address,
      city: locationsTable.city,
      arrivalAt: reservationsTable.arrivalAt,
      departureAt: reservationsTable.departureAt,
      status: reservationsTable.status,
      amount: reservationsTable.amount,
      currency: reservationsTable.currency,
      passCode: reservationsTable.passCode,
      bayCode: baysTable.code,
    })
    .from(reservationsTable)
    .innerJoin(locationsTable, eq(locationsTable.id, reservationsTable.locationId))
    .innerJoin(baysTable, eq(baysTable.id, reservationsTable.bayId))
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

router.get("/reservations", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in to see your reservations." });
    return;
  }
  const user = await getParklyUser(req);
  if (!user) {
    res.status(401).json({ error: "Your Parkly profile could not be loaded." });
    return;
  }
  const rows = await db
    .select({
      id: reservationsTable.id,
      locationId: reservationsTable.locationId,
      locationName: locationsTable.name,
      address: locationsTable.address,
      city: locationsTable.city,
      arrivalAt: reservationsTable.arrivalAt,
      departureAt: reservationsTable.departureAt,
      status: reservationsTable.status,
      amount: reservationsTable.amount,
      currency: reservationsTable.currency,
      passCode: reservationsTable.passCode,
      bayCode: baysTable.code,
    })
    .from(reservationsTable)
    .innerJoin(locationsTable, eq(locationsTable.id, reservationsTable.locationId))
    .innerJoin(baysTable, eq(baysTable.id, reservationsTable.bayId))
    .where(eq(reservationsTable.userId, user.id))
    .orderBy(asc(reservationsTable.arrivalAt));
  res.json(ListReservationsResponse.parse(rows));
});

router.post("/reservations", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in before reserving a parking bay." });
    return;
  }
  const body = CreateReservationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { locationId, arrivalAt, departureAt, vehiclePlate } = body.data;
  if (departureAt <= arrivalAt || arrivalAt.getTime() < Date.now() - 60_000) {
    res.status(400).json({ error: "Choose a future arrival and a later departure time." });
    return;
  }
  const user = await getParklyUser(req);
  if (!user) {
    res.status(401).json({ error: "Your Parkly profile could not be loaded." });
    return;
  }
  const duration = Math.max(1, Math.ceil((departureAt.getTime() - arrivalAt.getTime()) / 3_600_000));
  const id = randomUUID();
  const passCode = `PK${randomBytes(3).toString("hex").toUpperCase()}`;

  try {
    const result = await db.transaction(async (tx) => {
      const [location] = await tx
        .select()
        .from(locationsTable)
        .where(eq(locationsTable.id, locationId))
        .limit(1);
      if (!location) throw new Error("PARKLY_LOCATION_NOT_FOUND");
      const [bay] = await tx
        .select()
        .from(baysTable)
        .where(and(eq(baysTable.locationId, locationId), eq(baysTable.status, "free")))
        .orderBy(baysTable.level, baysTable.code)
        .limit(1)
        .for("update");
      if (!bay) throw new Error("PARKLY_NO_BAYS");

      const amount = Math.round(location.rate * duration);
      await tx
        .update(baysTable)
        .set({ status: "reserved", lastStatusAt: new Date() })
        .where(eq(baysTable.id, bay.id));
      await tx.insert(reservationsTable).values({
        id,
        userId: user.id,
        locationId,
        bayId: bay.id,
        vehiclePlate: vehiclePlate ?? null,
        arrivalAt,
        departureAt,
        duration,
        status: "upcoming",
        amount,
        currency: location.currency,
        passCode,
      });
      await tx.insert(paymentsTable).values({
        id: randomUUID(),
        reservationId: id,
        amount,
        currency: location.currency,
        provider: "demo",
        providerReference: "PARKLY-DEMO",
        status: "paid",
      });
      await tx.insert(auditEventsTable).values({
        id: randomUUID(),
        actorId: user.id,
        action: "reservation.created",
        entityType: "reservation",
        entityId: id,
        details: { locationId, bayId: bay.id, duration },
      });
      const view = await reservationView(id, user.id, tx);
      if (!view) throw new Error("PARKLY_RESERVATION_NOT_CREATED");
      return { view, bay: { ...bay, status: "reserved" } };
    });
    publishBayUpdate(locationId, result.bay);
    res.status(201).json(CreateReservationResponse.parse(result.view));
  } catch (err) {
    if (err instanceof Error && err.message === "PARKLY_LOCATION_NOT_FOUND") {
      res.status(404).json({ error: "Parking location not found." });
      return;
    }
    if (err instanceof Error && err.message === "PARKLY_NO_BAYS") {
      res.status(409).json({ error: "No bays are currently available at this parking location." });
      return;
    }
    throw err;
  }
});

router.post("/reservations/:reservationId/cancel", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in to cancel this reservation." });
    return;
  }
  const params = CancelReservationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = await getParklyUser(req);
  if (!user) {
    res.status(401).json({ error: "Your Parkly profile could not be loaded." });
    return;
  }
  const current = await db
    .select()
    .from(reservationsTable)
    .where(and(eq(reservationsTable.id, params.data.reservationId), eq(reservationsTable.userId, user.id)))
    .limit(1);
  const reservation = current[0];
  if (!reservation) {
    res.status(404).json({ error: "Reservation not found." });
    return;
  }
  if (reservation.status !== "upcoming") {
    res.status(409).json({ error: "Only upcoming reservations can be cancelled." });
    return;
  }

  const view = await db.transaction(async (tx) => {
    await tx
      .update(reservationsTable)
      .set({ status: "cancelled" })
      .where(eq(reservationsTable.id, reservation.id));
    const [bay] = await tx
      .update(baysTable)
      .set({ status: "free", lastStatusAt: new Date() })
      .where(eq(baysTable.id, reservation.bayId))
      .returning();
    await tx.insert(auditEventsTable).values({
      id: randomUUID(),
      actorId: user.id,
      action: "reservation.cancelled",
      entityType: "reservation",
      entityId: reservation.id,
      details: {},
    });
    return { view: await reservationView(reservation.id, user.id, tx), bay };
  });
  if (view.bay) publishBayUpdate(reservation.locationId, view.bay);
  if (!view.view) {
    res.status(404).json({ error: "Reservation not found." });
    return;
  }
  res.json(CancelReservationResponse.parse(view.view));
});

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in to view your dashboard." });
    return;
  }
  const user = await getParklyUser(req);
  if (!user) {
    res.status(401).json({ error: "Your Parkly profile could not be loaded." });
    return;
  }
  const rows = await db
    .select({
      id: reservationsTable.id,
      locationId: reservationsTable.locationId,
      locationName: locationsTable.name,
      address: locationsTable.address,
      city: locationsTable.city,
      arrivalAt: reservationsTable.arrivalAt,
      departureAt: reservationsTable.departureAt,
      status: reservationsTable.status,
      amount: reservationsTable.amount,
      currency: reservationsTable.currency,
      passCode: reservationsTable.passCode,
      bayCode: baysTable.code,
    })
    .from(reservationsTable)
    .innerJoin(locationsTable, eq(locationsTable.id, reservationsTable.locationId))
    .innerJoin(baysTable, eq(baysTable.id, reservationsTable.bayId))
    .where(eq(reservationsTable.userId, user.id))
    .orderBy(asc(reservationsTable.arrivalAt));
  const upcoming = rows.filter((row) => row.status === "upcoming");
  const completed = rows.filter((row) => row.status === "completed");
  const response = {
    upcomingCount: upcoming.length,
    activeCount: rows.filter((row) => row.status === "active").length,
    completedCount: completed.length,
    savings: Math.round(completed.reduce((sum, row) => sum + row.amount * 0.15, 0)),
    nextReservation: upcoming[0] ?? null,
  };
  res.json(GetDashboardSummaryResponse.parse(response));
});

router.get("/admin/summary", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in to view platform statistics." });
    return;
  }
  const user = await getParklyUser(req);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }
  const [bookingCount] = await db.select({ value: count() }).from(reservationsTable);
  const [revenue] = await db
    .select({ value: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
    .from(paymentsTable)
    .where(eq(paymentsTable.status, "paid"));
  const [totalBays] = await db.select({ value: count() }).from(baysTable);
  const [occupiedBays] = await db
    .select({ value: count() })
    .from(baysTable)
    .where(inArray(baysTable.status, ["occupied", "reserved"]));
  const [locationCount] = await db.select({ value: count() }).from(locationsTable);
  const cityRows = await db
    .select({ city: locationsTable.city, bookings: count(reservationsTable.id) })
    .from(locationsTable)
    .leftJoin(reservationsTable, eq(reservationsTable.locationId, locationsTable.id))
    .groupBy(locationsTable.city)
    .orderBy(asc(locationsTable.city));
  res.json(
    GetAdminSummaryResponse.parse({
      bookings: bookingCount?.value ?? 0,
      revenue: Number(revenue?.value ?? 0),
      occupancy: totalBays?.value ? Math.round(((occupiedBays?.value ?? 0) / totalBays.value) * 100) : 0,
      locations: locationCount?.value ?? 0,
      cities: cityRows.map((row) => ({ city: row.city, bookings: row.bookings })),
    }),
  );
});

export default router;
