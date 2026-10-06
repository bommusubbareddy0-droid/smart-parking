import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  StartPhoneVerificationBody,
  StartPhoneVerificationResponse,
  VerifyPhoneCodeBody,
  VerifyPhoneCodeResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { phoneChallengesTable } from "@workspace/db/schema";

const router: IRouter = Router();
const connectors = new ReplitConnectors();
const E164_PHONE = /^\+[1-9]\d{7,14}$/;
const CODE_LIFETIME_MS = 5 * 60 * 1000;
const requestCounts = new Map<string, { count: number; startedAt: number }>();

function phoneCodeHash(phone: string, code: string): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET is required to verify phone numbers.");
  return createHash("sha256").update(`${key}:${phone}:${code}`).digest("hex");
}

function secureHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function allowRequest(key: string): boolean {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const previous = requestCounts.get(key);
  if (!previous || now - previous.startedAt >= windowMs) {
    requestCounts.set(key, { count: 1, startedAt: now });
    return true;
  }
  previous.count += 1;
  return previous.count <= 10;
}

async function sendSms(to: string, code: string): Promise<void> {
  const accountsResponse = await connectors.proxy(
    "twilio",
    "/2010-04-01/Accounts.json?PageSize=1",
  );
  if (!accountsResponse.ok) throw new Error("Could not access the connected Twilio account.");
  const accounts = (await accountsResponse.json()) as {
    accounts?: Array<{ sid?: string; status?: string }>;
  };
  const accountSid = accounts.accounts?.find((account) => account.status === "active")?.sid ??
    accounts.accounts?.[0]?.sid;
  if (!accountSid) throw new Error("No active Twilio account was found.");

  const configuredSender = process.env.TWILIO_FROM_NUMBER;
  let sender = configuredSender;
  if (!sender) {
    const numbersResponse = await connectors.proxy(
      "twilio",
      `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=1`,
    );
    if (!numbersResponse.ok) throw new Error("Could not find a Twilio sending number.");
    const numbers = (await numbersResponse.json()) as {
      incoming_phone_numbers?: Array<{ phone_number?: string }>;
    };
    sender = numbers.incoming_phone_numbers?.[0]?.phone_number;
  }
  if (!sender) throw new Error("Add a Twilio phone number before sending verification codes.");

  const body = new URLSearchParams({
    To: to,
    From: sender,
    Body: `Your Parkly verification code is ${code}. It expires in 5 minutes.`,
  });
  const messageResponse = await connectors.proxy(
    "twilio",
    `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    { method: "POST", body },
  );
  if (!messageResponse.ok) {
    const status = messageResponse.status;
    await messageResponse.body?.cancel().catch(() => undefined);
    throw new Error(`Twilio could not send the verification SMS (status ${status}).`);
  }
  await messageResponse.body?.cancel().catch(() => undefined);
}

router.post("/auth/phone/start", async (req, res): Promise<void> => {
  const parsed = StartPhoneVerificationBody.safeParse(req.body);
  if (!parsed.success || !E164_PHONE.test(parsed.data.phoneNumber)) {
    res.status(400).json({ error: "Enter a valid phone number in international format, such as +14155550123." });
    return;
  }

  const rateKey = req.ip ?? "unknown";
  if (!allowRequest(rateKey)) {
    res.status(429).json({ error: "Too many verification attempts. Try again later." });
    return;
  }
  const { phoneNumber } = parsed.data;
  const now = new Date();
  const recent = await db
    .select({ createdAt: phoneChallengesTable.createdAt })
    .from(phoneChallengesTable)
    .where(and(eq(phoneChallengesTable.phone, phoneNumber), gte(phoneChallengesTable.createdAt, new Date(now.getTime() - 60 * 60 * 1000))))
    .orderBy(desc(phoneChallengesTable.createdAt))
    .limit(5);
  if (recent.some((challenge) => now.getTime() - challenge.createdAt.getTime() < 60_000) || recent.length >= 4) {
    res.status(429).json({ error: "A code was sent recently. Wait before requesting another." });
    return;
  }

  const code = String(randomInt(100000, 1000000));
  try {
    await sendSms(phoneNumber, code);
  } catch (err) {
    req.log.warn({ err }, "Phone verification SMS could not be sent");
    res.status(503).json({ error: "Phone verification is temporarily unavailable. Try again later." });
    return;
  }

  await db.insert(phoneChallengesTable).values({
    id: randomUUID(),
    phone: phoneNumber,
    codeHash: phoneCodeHash(phoneNumber, code),
    expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
  });
  res.status(202).json(
    StartPhoneVerificationResponse.parse({
      accepted: true,
      expiresInSeconds: CODE_LIFETIME_MS / 1000,
    }),
  );
});

router.post("/auth/phone/verify", async (req, res): Promise<void> => {
  const parsed = VerifyPhoneCodeBody.safeParse(req.body);
  if (!parsed.success || !E164_PHONE.test(parsed.data.phoneNumber)) {
    res.status(400).json({ error: "Enter the phone number and verification code." });
    return;
  }
  const { phoneNumber, code } = parsed.data;
  const [challenge] = await db
    .select()
    .from(phoneChallengesTable)
    .where(and(eq(phoneChallengesTable.phone, phoneNumber), isNull(phoneChallengesTable.consumedAt)))
    .orderBy(desc(phoneChallengesTable.createdAt))
    .limit(1);
  if (!challenge || challenge.expiresAt.getTime() <= Date.now() || challenge.attempts >= 5) {
    res.status(400).json({ error: "This code has expired. Request a new one." });
    return;
  }
  if (!secureHashEquals(challenge.codeHash, phoneCodeHash(phoneNumber, code))) {
    await db
      .update(phoneChallengesTable)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(phoneChallengesTable.id, challenge.id));
    res.status(400).json({ error: "That code did not match. Check it and try again." });
    return;
  }

  const listedUsers = await clerkClient.users.getUserList({ phoneNumber: [phoneNumber], limit: 1 });
  const user =
    listedUsers.data[0] ??
    (await clerkClient.users.createUser({
      phoneNumber: [phoneNumber],
      firstName: "Parkly Driver",
      publicMetadata: { role: "driver" },
    }));
  const signInToken = await clerkClient.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 60,
  });
  await db
    .update(phoneChallengesTable)
    .set({ consumedAt: new Date() })
    .where(eq(phoneChallengesTable.id, challenge.id));
  res.json(VerifyPhoneCodeResponse.parse({ ticket: signInToken.token }));
});

export default router;
