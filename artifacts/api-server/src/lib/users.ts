import { randomUUID } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, type User } from "@workspace/db/schema";

const roles = new Set(["driver", "owner", "admin"]);

export async function getParklyUser(req: Request): Promise<User | null> {
  const clerkId = getAuth(req).userId;
  if (!clerkId) return null;

  const [byClerkId] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkId))
    .limit(1);
  if (byClerkId) return byClerkId;

  const clerkUser = await clerkClient.users.getUser(clerkId);
  const email = clerkUser.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId,
  )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? null;
  const phone = clerkUser.phoneNumbers.find(
    (number) => number.id === clerkUser.primaryPhoneNumberId,
  )?.phoneNumber ?? clerkUser.phoneNumbers[0]?.phoneNumber ?? null;
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    phone ||
    email ||
    "Parkly driver";
  const metadataRole = (clerkUser.publicMetadata as { role?: string }).role;
  const role = metadataRole && roles.has(metadataRole) ? metadataRole : "driver";

  const identityMatch = email
    ? await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1)
    : phone
      ? await db
          .select()
          .from(usersTable)
          .where(and(isNotNull(usersTable.phone), eq(usersTable.phone, phone)))
          .limit(1)
      : [];

  if (identityMatch[0]) {
    if (
      (identityMatch[0].clerkUserId && identityMatch[0].clerkUserId !== clerkId) ||
      (identityMatch[0].role !== "driver" &&
        identityMatch[0].clerkUserId !== clerkId &&
        metadataRole !== identityMatch[0].role)
    ) {
      return null;
    }
    const [updated] = await db
      .update(usersTable)
      .set({
        clerkUserId: clerkId,
        name,
        phone: phone ?? identityMatch[0].phone,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, identityMatch[0].id))
      .returning();
    return updated ?? identityMatch[0];
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      id: randomUUID(),
      clerkUserId: clerkId,
      email,
      phone,
      name,
      role,
    })
    .returning();
  return created ?? null;
}

export function roleMatches(role: string, allowed: string[]): boolean {
  return allowed.includes(role);
}
