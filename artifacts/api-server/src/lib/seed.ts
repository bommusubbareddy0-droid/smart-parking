import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  auditEventsTable,
  baysTable,
  locationsTable,
  paymentsTable,
  reservationsTable,
  usersTable,
} from "@workspace/db/schema";

const cities = [
  {
    id: "blr-lavelle",
    name: "Lavelle Road Parking",
    address: "14, Lavelle Road",
    city: "Bengaluru",
    latitude: 12.9697,
    longitude: 77.6011,
    rate: 80,
    rating: 4.8,
    amenities: ["Covered", "CCTV", "EV charging", "24/7 access"],
    description: "A calm, well-lit garage a short walk from UB City and the central business district.",
  },
  {
    id: "blr-indiranagar",
    name: "100 Feet Road Garage",
    address: "612, 100 Feet Road, Indiranagar",
    city: "Bengaluru",
    latitude: 12.9784,
    longitude: 77.6408,
    rate: 55,
    rating: 4.7,
    amenities: ["Covered", "Accessible bays", "CCTV"],
    description: "Easy in-and-out parking surrounded by Indiranagar's cafés, shops, and metro links.",
  },
  {
    id: "mum-bandra",
    name: "Bandra West Central",
    address: "Pali Hill Road, Bandra West",
    city: "Mumbai",
    latitude: 19.0614,
    longitude: 72.8296,
    rate: 100,
    rating: 4.9,
    amenities: ["Covered", "CCTV", "Accessible bays", "24/7 access"],
    description: "Secure basement parking with a staffed entrance close to Linking Road.",
  },
  {
    id: "mum-fort",
    name: "Fort District Garage",
    address: "Veer Nariman Road, Fort",
    city: "Mumbai",
    latitude: 18.9322,
    longitude: 72.8264,
    rate: 90,
    rating: 4.6,
    amenities: ["Covered", "EV charging", "CCTV"],
    description: "A dependable central option for the Fort, Kala Ghoda, and Colaba-bound visits.",
  },
  {
    id: "del-connaught",
    name: "Connaught Place Pavilion",
    address: "Baba Kharak Singh Marg, Connaught Place",
    city: "New Delhi",
    latitude: 28.6304,
    longitude: 77.2177,
    rate: 75,
    rating: 4.8,
    amenities: ["Covered", "CCTV", "Accessible bays", "EV charging"],
    description: "A monitored multi-level car park in the heart of the capital's shopping district.",
  },
  {
    id: "hyd-hitec",
    name: "HITEC City Park & Charge",
    address: "Mindspace Road, Madhapur",
    city: "Hyderabad",
    latitude: 17.4483,
    longitude: 78.3908,
    rate: 65,
    rating: 4.7,
    amenities: ["Covered", "EV charging", "CCTV", "24/7 access"],
    description: "A bright, spacious garage serving Mindspace and the surrounding tech campuses.",
  },
  {
    id: "hyd-banjara",
    name: "Banjara Hills Reserve",
    address: "Road No. 1, Banjara Hills",
    city: "Hyderabad",
    latitude: 17.4156,
    longitude: 78.4347,
    rate: 60,
    rating: 4.5,
    amenities: ["Covered", "Accessible bays", "CCTV"],
    description: "Attended parking with wide bays near the main Banjara Hills restaurant district.",
  },
  {
    id: "chn-alwarpet",
    name: "Alwarpet Central Garage",
    address: "T.T.K. Road, Alwarpet",
    city: "Chennai",
    latitude: 13.0339,
    longitude: 80.2504,
    rate: 50,
    rating: 4.6,
    amenities: ["Covered", "CCTV", "Accessible bays"],
    description: "A convenient, guarded garage close to Teynampet and the Alwarpet shopping area.",
  },
  {
    id: "kol-parkstreet",
    name: "Park Street House",
    address: "56, Park Street",
    city: "Kolkata",
    latitude: 22.5526,
    longitude: 88.3528,
    rate: 55,
    rating: 4.8,
    amenities: ["Covered", "CCTV", "EV charging"],
    description: "Well-lit parking for an evening on Park Street, with attendants on every shift.",
  },
  {
    id: "pune-koregaon",
    name: "Koregaon Park Courtyard",
    address: "North Main Road, Koregaon Park",
    city: "Pune",
    latitude: 18.5362,
    longitude: 73.894,
    rate: 45,
    rating: 4.6,
    amenities: ["Covered", "CCTV", "24/7 access"],
    description: "Easy access to the neighbourhood's cafés and boutiques, with overnight availability.",
  },
  {
    id: "goa-panaji",
    name: "Fontainhas Walk Garage",
    address: "Altinho Road, Panaji",
    city: "Goa",
    latitude: 15.4952,
    longitude: 73.8278,
    rate: 40,
    rating: 4.7,
    amenities: ["Covered", "CCTV", "Accessible bays"],
    description: "Park once and walk to Fontainhas, the Mandovi riverfront, and central Panaji.",
  },
  {
    id: "goa-calangute",
    name: "Calangute Beachside Park",
    address: "Aguada-Siolim Road, Calangute",
    city: "Goa",
    latitude: 15.5437,
    longitude: 73.7553,
    rate: 60,
    rating: 4.5,
    amenities: ["Covered", "EV charging", "24/7 access"],
    description: "A staffed, covered option a few minutes from the North Goa beach strip.",
  },
];

const palettes = [
  ["#172d46", "#a9c3b7"],
  ["#384d68", "#d3b68d"],
  ["#203b52", "#c88f78"],
  ["#334b54", "#a8c0be"],
  ["#263c54", "#d2a669"],
  ["#21414c", "#97b8a9"],
];

function parkingIllustration(city: string, index: number): string {
  const [base, accent] = palettes[index % palettes.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 420"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${base}"/><stop offset="1" stop-color="#101b2b"/></linearGradient><linearGradient id="light" x2="0" y2="1"><stop stop-color="${accent}" stop-opacity=".5"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs><rect width="900" height="420" fill="url(#g)"/><circle cx="710" cy="42" r="200" fill="url(#light)"/><path d="M0 278h900v142H0z" fill="#101822"/><path d="M56 195h788v14H56zM56 196V84l86-25v136m22 0V93l92-34v137m22 0V77l83-26v145m22 0V91l99-33v134m22 0V72l96-25v149m22 0V92l96-34v142" fill="#172535" stroke="${accent}" stroke-opacity=".42" stroke-width="3"/><path d="M74 204h752v74H74z" fill="#182839"/><path d="M120 220h86v43h-86zm141 0h86v43h-86zm141 0h86v43h-86zm141 0h86v43h-86zm141 0h86v43h-86z" fill="#24384b"/><g fill="${accent}" opacity=".88"><path d="M112 309h78v34h-78z"/><path d="M269 309h78v34h-78z"/><path d="M426 309h78v34h-78z"/><path d="M583 309h78v34h-78z"/><path d="M740 309h48v34h-48z"/></g><g fill="#d9e2dc" opacity=".8"><path d="M122 302h56v12h-56zm157 0h56v12h-56zm157 0h56v12h-56zm157 0h56v12h-56zm157 0h29v12h-29z"/></g><path d="M0 359h900" stroke="#c3d5cf" stroke-opacity=".18" stroke-width="2"/><text x="62" y="386" fill="#f5f2eb" font-family="Arial,sans-serif" font-size="19" letter-spacing="4">${city.toUpperCase()} · PARKLY</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export async function seedParklyData(): Promise<void> {
  const existing = await db.select({ id: locationsTable.id }).from(locationsTable).limit(1);
  if (existing.length > 0) return;

  const isDevelopment = process.env.NODE_ENV !== "production";
  if (isDevelopment) {
    await db
      .insert(usersTable)
      .values([
        { id: "demo-driver", name: "Riya Mehta", email: "driver@parkly.demo", role: "driver" },
        { id: "demo-owner", name: "Arjun Rao", email: "owner@parkly.demo", role: "owner" },
        { id: "demo-admin", name: "Maya Kapoor", email: "admin@parkly.demo", role: "admin" },
      ])
      .onConflictDoNothing();
  }

  await db.insert(locationsTable).values(
    cities.map((location, index) => ({
      ...location,
      ownerId: isDevelopment ? "demo-owner" : null,
      country: "India",
      timezone: "Asia/Kolkata",
      currency: "INR",
      openingHours: { weekdays: "06:00–23:00", weekends: "07:00–23:00" },
      imageUrl: parkingIllustration(location.city, index),
    })),
  );

  const bays = cities.flatMap((location, locationIndex) =>
    ["A", "B", "C", "D"].flatMap((level, levelIndex) =>
      Array.from({ length: 6 }, (_, bayIndex) => {
        const n = levelIndex * 6 + bayIndex + 1;
        const status =
          n === 1
            ? "reserved"
            : n === 2 || n === 8 || (locationIndex + n) % 11 === 0
              ? "occupied"
              : n === 6 || (locationIndex + n) % 29 === 0
                ? "out_of_service"
                : "free";
        const type = n === 3 ? "accessible" : n === 4 ? "ev" : "standard";
        return {
          id: `${location.id}-${level}${String(bayIndex + 1).padStart(2, "0")}`,
          locationId: location.id,
          level,
          code: `${level}${String(bayIndex + 1).padStart(2, "0")}`,
          type,
          status,
          sensorId: `sensor-${location.id}-${level}${String(bayIndex + 1).padStart(2, "0")}`,
        };
      }),
    ),
  );

  await db.insert(baysTable).values(bays).onConflictDoNothing();

  if (!isDevelopment) return;

  const existingReservation = await db
    .select({ id: reservationsTable.id })
    .from(reservationsTable)
    .where(eq(reservationsTable.id, "demo-reservation"))
    .limit(1);
  if (existingReservation.length === 0) {
    const arrivalAt = new Date();
    arrivalAt.setDate(arrivalAt.getDate() + 1);
    arrivalAt.setHours(10, 0, 0, 0);
    const departureAt = new Date(arrivalAt);
    departureAt.setHours(departureAt.getHours() + 2);
    await db.insert(reservationsTable).values({
      id: "demo-reservation",
      userId: "demo-driver",
      locationId: "blr-lavelle",
      bayId: "blr-lavelle-A01",
      vehiclePlate: "KA 03 MN 2048",
      arrivalAt,
      departureAt,
      duration: 2,
      status: "upcoming",
      amount: 160,
      currency: "INR",
      passCode: `PK${randomUUID().slice(0, 6).toUpperCase()}`,
    });
    await db.insert(paymentsTable).values({
      id: randomUUID(),
      reservationId: "demo-reservation",
      amount: 160,
      currency: "INR",
      status: "paid",
      provider: "demo",
      providerReference: "PARKLY-DEMO",
    });
    await db.insert(auditEventsTable).values({
      id: randomUUID(),
      actorId: "demo-driver",
      action: "reservation.seeded",
      entityType: "reservation",
      entityId: "demo-reservation",
      details: { source: "development seed" },
    });
  }
}
