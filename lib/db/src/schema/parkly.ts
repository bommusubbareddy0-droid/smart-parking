import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "parkly_users",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id").unique(),
    name: text("name").notNull(),
    email: text("email").unique(),
    phone: text("phone").unique(),
    role: text("role").notNull().default("driver"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("parkly_users_role_idx").on(table.role)],
);

export const vehiclesTable = pgTable("parkly_vehicles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  plateNumber: text("plate_number").notNull(),
  type: text("type").notNull().default("car"),
  make: text("make"),
  colour: text("colour"),
});

export const locationsTable = pgTable(
  "parkly_locations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull().default("India"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    description: text("description").notNull().default(""),
    openingHours: jsonb("opening_hours").notNull().default({}),
    rate: numeric("rate", { precision: 9, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    amenities: text("amenities").array().notNull().default([]),
    rating: numeric("rating", { precision: 2, scale: 1, mode: "number" }).notNull().default(4.5),
    imageUrl: text("image_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("parkly_locations_city_idx").on(table.city)],
);

export const baysTable = pgTable(
  "parkly_bays",
  {
    id: text("id").primaryKey(),
    locationId: text("location_id").notNull().references(() => locationsTable.id, { onDelete: "cascade" }),
    level: text("level").notNull(),
    code: text("code").notNull(),
    type: text("type").notNull().default("standard"),
    status: text("status").notNull().default("free"),
    sensorId: text("sensor_id"),
    lastStatusAt: timestamp("last_status_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("parkly_bays_location_code_idx").on(table.locationId, table.code),
    index("parkly_bays_location_status_idx").on(table.locationId, table.status),
  ],
);

export const reservationsTable = pgTable(
  "parkly_reservations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    locationId: text("location_id").notNull().references(() => locationsTable.id),
    bayId: text("bay_id").notNull().references(() => baysTable.id),
    vehiclePlate: text("vehicle_plate"),
    arrivalAt: timestamp("arrival_at", { withTimezone: true }).notNull(),
    departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
    duration: integer("duration").notNull(),
    status: text("status").notNull().default("upcoming"),
    amount: numeric("amount", { precision: 10, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    passCode: text("pass_code").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("parkly_reservations_user_arrival_idx").on(table.userId, table.arrivalAt),
    index("parkly_reservations_location_idx").on(table.locationId),
  ],
);

export const paymentsTable = pgTable("parkly_payments", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id").notNull().references(() => reservationsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("demo"),
  providerReference: text("provider_reference"),
  amount: numeric("amount", { precision: 10, scale: 2, mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("paid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewsTable = pgTable("parkly_reviews", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locationsTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sensorEventsTable = pgTable("parkly_sensor_events", {
  id: text("id").primaryKey(),
  sensorId: text("sensor_id").notNull(),
  bayId: text("bay_id").notNull().references(() => baysTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  signatureValid: boolean("signature_valid").notNull().default(false),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull().default({}),
});

export const auditEventsTable = pgTable(
  "parkly_audit_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("parkly_audit_events_created_idx").on(table.createdAt)],
);

export const phoneChallengesTable = pgTable(
  "parkly_phone_challenges",
  {
    id: text("id").primaryKey(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [index("parkly_phone_challenges_phone_created_idx").on(table.phone, table.createdAt)],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export const insertLocationSchema = createInsertSchema(locationsTable).omit({ createdAt: true, updatedAt: true });
export const insertBaySchema = createInsertSchema(baysTable).omit({ lastStatusAt: true });
export const insertReservationSchema = createInsertSchema(reservationsTable).omit({ createdAt: true });
export type User = typeof usersTable.$inferSelect;
export type ParkingLocation = typeof locationsTable.$inferSelect;
export type ParkingBay = typeof baysTable.$inferSelect;
export type Reservation = typeof reservationsTable.$inferSelect;
export const userRoleSchema = z.enum(["driver", "owner", "admin"]);
export const bayStatusSchema = z.enum(["free", "reserved", "occupied", "out_of_service"]);

export const locationsRelations = relations(locationsTable, ({ many }) => ({
  bays: many(baysTable),
  reservations: many(reservationsTable),
  reviews: many(reviewsTable),
}));
