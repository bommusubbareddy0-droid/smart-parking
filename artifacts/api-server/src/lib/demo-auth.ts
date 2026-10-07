import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { logger } from "./logger";

const demoAccounts = [
  {
    email: "driver@parklydemo.com",
    firstName: "Riya",
    lastName: "Mehta",
    role: "driver",
  },
  {
    email: "owner@parklydemo.com",
    firstName: "Arjun",
    lastName: "Rao",
    role: "owner",
  },
  {
    email: "admin@parklydemo.com",
    firstName: "Maya",
    lastName: "Kapoor",
    role: "admin",
  },
] as const;

export async function ensureDemoAuthAccounts(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  for (const demo of demoAccounts) {
    try {
      const existing = await clerkClient.users.getUserList({
        emailAddress: [demo.email],
        limit: 1,
      });
      const user =
        existing.data[0] ??
        (await clerkClient.users.createUser({
          emailAddress: [demo.email],
          password: "ParklyDemo2026!",
          firstName: demo.firstName,
          lastName: demo.lastName,
          publicMetadata: { role: demo.role },
        }));

      const emailAddress = user.emailAddresses.find(
        (address) => address.emailAddress === demo.email,
      );
      if (emailAddress) {
        await clerkClient.emailAddresses.updateEmailAddress(emailAddress.id, {
          verified: true,
          primary: true,
        });
      }

      if (user.publicMetadata.role !== demo.role) {
        await clerkClient.users.updateUserMetadata(user.id, {
          publicMetadata: { role: demo.role },
        });
      }

      await db
        .update(usersTable)
        .set({ clerkUserId: user.id, updatedAt: new Date() })
        .where(eq(usersTable.email, demo.email));
    } catch (err) {
      logger.warn(
        { err, accountRole: demo.role },
        "Could not provision a Parkly demo sign-in account",
      );
    }
  }
}
