import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Dev-only fake mail so the shell works without Gmail. Idempotent: every seeded
// thread has a `seed-` Gmail thread id and is replaced on each run.

type Bucket = "inbox" | "news" | "paper_trail" | "triage";

type SeedMessage = {
  from: { name: string | null; email: string } | "me";
  minutesAgo: number;
  text: string;
  html?: string;
  attachments?: { filename: string; mimeType: string; size: number }[];
};

type SeedThread = {
  account: "personal" | "work1" | "work2";
  subject: string;
  bucket: Bucket;
  seen?: boolean;
  snoozedHours?: number;
  pinned?: boolean;
  suggested?: boolean;
  /** Sender let in by the AI screener instead of the user. Triage senders are undecided. */
  aiAllowed?: boolean;
  messages: SeedMessage[];
};

const ACCOUNTS = {
  personal: { email: "me@personal.example", label: "personal", color: "#39FF9E" },
  work1: { email: "me@work1.example", label: "work1", color: "#EDE95C" },
  work2: { email: "me@work2.example", label: "work2", color: "#C792EA" },
} as const;

const H = 60;
const D = 24 * H;

const lightNewsletter = (title: string, body: string) => `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;font-family:Helvetica,Arial,sans-serif">
  <tr><td align="center" style="padding:24px">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px">
      <tr><td style="padding:24px">
        <img src="https://picsum.photos/seed/superfer/512/160" width="512" height="160" alt="header" style="display:block;border-radius:4px">
        <h1 style="color:#111;font-size:22px;margin:20px 0 8px">${title}</h1>
        <p style="color:#333;font-size:15px;line-height:1.6">${body}</p>
        <p><a href="https://example.com/read" style="background:#0a66ff;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none">Read more</a></p>
        <p style="color:#888;font-size:12px">You are receiving this because you subscribed. <a href="https://example.com/unsubscribe">Unsubscribe</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

const darkEmail = `
<html><head><meta name="color-scheme" content="dark"><style>:root{color-scheme:dark}</style></head>
<body style="background:#111418;color:#e6e6e6;font-family:system-ui,sans-serif;padding:24px">
  <h2 style="margin:0 0 12px">Deploy succeeded</h2>
  <p>Production deployment <code style="color:#7ee787">superfer-9f3a</code> is live.</p>
  <p style="color:#8b949e">Build 38s, 12 functions, 0 warnings.</p>
</body></html>`;

const receipt = (vendor: string, amount: string) => `
<div style="font-family:Arial,sans-serif;color:#222;max-width:480px">
  <h2 style="margin:0 0 8px">${vendor} receipt</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;border-bottom:1px solid #ddd">Plan</td><td style="text-align:right;border-bottom:1px solid #ddd">Pro, monthly</td></tr>
    <tr><td style="padding:6px 0;border-bottom:1px solid #ddd">Amount</td><td style="text-align:right;border-bottom:1px solid #ddd">${amount}</td></tr>
    <tr><td style="padding:6px 0">Status</td><td style="text-align:right;color:#1a7f37">Paid</td></tr>
  </table>
</div>`;

const THREADS: SeedThread[] = [
  {
    account: "work2",
    subject: "Cohort 14 schedule, final version?",
    bucket: "inbox",
    messages: [
      { from: { name: "Lena Park", email: "lena@work2.example" }, minutesAgo: 3 * D, text: "Hi Fer, attaching the draft schedule for cohort 14. Can you check the AI module dates?", attachments: [{ filename: "cohort-14-schedule.pdf", mimeType: "application/pdf", size: 184_320 }] },
      { from: "me", minutesAgo: 2 * D, text: "Looks good. Can we move the AI module one week later? I am travelling that week." },
      { from: { name: "Lena Park", email: "lena@work2.example" }, minutesAgo: 25, text: "Done, moved it. Sending the final version now, please confirm before Friday so we can publish it.", attachments: [{ filename: "cohort-14-schedule-v2.pdf", mimeType: "application/pdf", size: 190_004 }, { filename: "room-plan.png", mimeType: "image/png", size: 88_210 }] },
    ],
  },
  {
    account: "work1",
    subject: "Re: website relaunch project, next steps",
    bucket: "inbox",
    messages: [
      { from: { name: "Hugo Lind", email: "hugo@agency.example" }, minutesAgo: 5 * D, text: "Buenos días Fer, ¿podemos agendar una reunión para revisar el alcance de la fase 2?" },
      { from: "me", minutesAgo: 4 * D, text: "Claro Javier, ¿te viene bien el jueves a las 10:00?" },
      { from: { name: "Hugo Lind", email: "hugo@agency.example" }, minutesAgo: 90, text: "Perfecto, el jueves a las 10:00. Te envío la invitación. Adjunto el documento de alcance actualizado.", attachments: [{ filename: "alcance-fase-2.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 54_000 }] },
    ],
  },
  {
    account: "personal",
    subject: "the school's class calendar 2026-27",
    bucket: "inbox",
    messages: [
      { from: { name: "Northside School", email: "office@school.example" }, minutesAgo: 4 * H, text: "Estimadas familias, adjuntamos el calendario escolar del curso 2026-27.", attachments: [{ filename: "calendario-2026-27.pdf", mimeType: "application/pdf", size: 402_112 }] },
    ],
  },
  {
    account: "work1",
    subject: "Vercel: payment failed for team work1",
    bucket: "inbox",
    suggested: true,
    messages: [
      { from: { name: "Vercel", email: "billing@vercel.com" }, minutesAgo: 6 * H, text: "We could not charge your card ending 4242. Update your payment method within 7 days to avoid service interruption.", html: `<div style="font-family:Arial,sans-serif;color:#111"><h2>Payment failed</h2><p>We could not charge your card ending <b>4242</b>.</p><p>Update your payment method within 7 days to avoid service interruption.</p></div>` },
    ],
  },
  {
    account: "personal",
    subject: "Dinner Saturday?",
    bucket: "inbox",
    seen: true,
    messages: [
      { from: { name: "Iris", email: "iris@example.net" }, minutesAgo: 1 * D, text: "Are you free Saturday night? Thinking of trying the new place in the old town." },
      { from: "me", minutesAgo: 1 * D - 30, text: "Yes, 21:00 works." },
    ],
  },
  {
    account: "work2",
    subject: "Invoice question from a student",
    bucket: "inbox",
    seen: true,
    messages: [
      { from: { name: "Owen Hale", email: "owen@example.net" }, minutesAgo: 2 * D, text: "Hola, necesito la factura del bootcamp a nombre de mi empresa. ¿Es posible?" },
    ],
  },
  {
    account: "work1",
    subject: "Deploy succeeded: superfer-9f3a",
    bucket: "inbox",
    seen: true,
    messages: [{ from: { name: "Vercel", email: "notifications@vercel.com" }, minutesAgo: 3 * D, text: "Production deployment superfer-9f3a is live.", html: darkEmail }],
  },
  {
    account: "personal",
    subject: "Your flight to Madrid is confirmed",
    bucket: "inbox",
    seen: true,
    messages: [{ from: { name: "Skyline Air", email: "noreply@airline.example" }, minutesAgo: 6 * D, text: "Booking ABC123. LIS to BER, 14 Oct 08:15.", attachments: [{ filename: "boarding-pass.pdf", mimeType: "application/pdf", size: 61_200 }] }],
  },
  {
    account: "personal",
    subject: "Lenny's Newsletter: How the best teams run planning",
    bucket: "news",
    messages: [{ from: { name: "Lenny Rachitsky", email: "lenny@substack.com" }, minutesAgo: 2 * H, text: "This week: how the best product teams run planning.", html: lightNewsletter("How the best teams run planning", "Planning is where most teams lose a month a year. Here is how the best ones compress it into two weeks without losing alignment.") }],
  },
  {
    account: "work1",
    subject: "The Batch: agents that actually ship",
    bucket: "news",
    messages: [{ from: { name: "DeepLearning.AI", email: "thebatch@deeplearning.ai" }, minutesAgo: 9 * H, text: "Agents that actually ship, plus new open weights.", html: lightNewsletter("Agents that actually ship", "A look at what separates agent demos from agent products, and three open-weight releases worth trying this week.") }],
  },
  {
    account: "personal",
    subject: "Stratechery: the platform shift",
    bucket: "news",
    seen: true,
    messages: [{ from: { name: "Ben Thompson", email: "email@stratechery.com" }, minutesAgo: 2 * D, text: "An essay on the platform shift.", html: lightNewsletter("The platform shift", "Every platform shift rewards the companies that own the new default, not the ones that build the best feature on top of the old one.") }],
  },
  {
    account: "work2",
    subject: "JS Weekly #712",
    bucket: "news",
    seen: true,
    messages: [{ from: { name: "JavaScript Weekly", email: "jsw@cooperpress.com" }, minutesAgo: 4 * D, text: "Issue 712.", html: lightNewsletter("JavaScript Weekly #712", "Node 26 lands, a deep dive on React compiler output, and a tiny library for keyboard shortcuts.") }],
  },
  {
    account: "work1",
    subject: "Your receipt from Anthropic",
    bucket: "paper_trail",
    messages: [{ from: { name: "Anthropic", email: "invoice@anthropic.com" }, minutesAgo: 7 * H, text: "Receipt 2026-0921, $100.00, paid.", html: receipt("Anthropic", "$100.00"), attachments: [{ filename: "receipt-2026-0921.pdf", mimeType: "application/pdf", size: 32_000 }] }],
  },
  {
    account: "personal",
    subject: "Your Amazon.es order has shipped",
    bucket: "paper_trail",
    seen: true,
    messages: [{ from: { name: "Amazon.es", email: "envios@amazon.es" }, minutesAgo: 1 * D, text: "Your order 402-555 has shipped and arrives Thursday." }],
  },
  {
    account: "work1",
    subject: "GitHub: receipt for September",
    bucket: "paper_trail",
    seen: true,
    messages: [{ from: { name: "GitHub", email: "billing@github.com" }, minutesAgo: 3 * D, text: "Receipt for GitHub Team, $48.00.", html: receipt("GitHub", "$48.00") }],
  },
  {
    account: "work2",
    subject: "Factura Holded F-2026-311",
    bucket: "paper_trail",
    seen: true,
    messages: [{ from: { name: "Holded", email: "no-reply@holded.com" }, minutesAgo: 8 * D, text: "Adjuntamos la factura F-2026-311.", attachments: [{ filename: "F-2026-311.pdf", mimeType: "application/pdf", size: 44_800 }] }],
  },
  {
    account: "personal",
    subject: "Quick question about your course",
    bucket: "triage",
    messages: [{ from: { name: "Milo Reyes", email: "milo@example.net" }, minutesAgo: 50, text: "Hi, I saw your talk at the meetup. Is the AI course open to people without coding experience?" }],
  },
  {
    account: "work1",
    subject: "Partnership opportunity: 10x your leads",
    bucket: "triage",
    messages: [{ from: { name: "Growth Team", email: "hello@leadrocket.io" }, minutesAgo: 5 * H, text: "We help AI startups 10x their inbound leads. 15 minutes this week?", html: lightNewsletter("10x your leads", "We help AI startups 10x their inbound leads with done-for-you outbound. Book 15 minutes this week.") }],
  },
  {
    account: "work2",
    subject: "Speaker invitation: Codemotion Madrid",
    bucket: "triage",
    messages: [{ from: { name: "Codemotion", email: "speakers@codemotion.com" }, minutesAgo: 1 * D, text: "We would love to have you speak about AI in education at Codemotion Madrid in November." }],
  },
  {
    account: "work1",
    subject: "Intro: Rafa from Studio North",
    bucket: "inbox",
    aiAllowed: true,
    messages: [{ from: { name: "Rafa Cole", email: "rafa@studio.example" }, minutesAgo: 3 * H, text: "Hola Fer, Ana me pasó tu contacto. Estamos montando un programa de formación en IA para pymes y me encantaría hablar contigo." }],
  },
  {
    account: "personal",
    subject: "Sign the rental renewal",
    bucket: "inbox",
    snoozedHours: 30,
    messages: [{ from: { name: "Harbor Lettings", email: "office@lettings.example" }, minutesAgo: 2 * D, text: "Le enviamos la renovación del contrato para su firma antes del día 30.", attachments: [{ filename: "renovacion.pdf", mimeType: "application/pdf", size: 120_000 }] }],
  },
  {
    account: "work1",
    subject: "Proposal review for council",
    bucket: "inbox",
    seen: true,
    snoozedHours: 72,
    messages: [{ from: { name: "Sofia Lane", email: "sofia@work1.example" }, minutesAgo: 1 * D, text: "Can you review the council proposal when you have an hour? No rush, next week is fine." }],
  },
  {
    account: "work2",
    subject: "Alumni demo day photos",
    bucket: "inbox",
    seen: true,
    pinned: true,
    messages: [{ from: { name: "Lena Park", email: "lena@work2.example" }, minutesAgo: 5 * D, text: "Here are the demo day photos for the website.", attachments: [{ filename: "demo-day.zip", mimeType: "application/zip", size: 48_000_000 }] }],
  },
  {
    account: "personal",
    subject: "Recipe: papas arrugadas with mojo",
    bucket: "inbox",
    seen: true,
    pinned: true,
    messages: [{ from: { name: "Mum", email: "mum@example.net" }, minutesAgo: 9 * D, text: "Como me pediste: papas pequeñas, mucha sal, y el mojo con comino, ajo, pimienta palmera y vinagre." }],
  },
];

// Pad with older seen mail so the list scrolls.
const FILLER_SENDERS = [
  { name: "Notion", email: "notify@mail.notion.so", bucket: "paper_trail" as const, account: "work1" as const },
  { name: "Linear", email: "notifications@linear.app", bucket: "inbox" as const, account: "work1" as const },
  { name: "Medium Daily Digest", email: "noreply@medium.com", bucket: "news" as const, account: "personal" as const },
  { name: "Google Calendar", email: "calendar-notification@google.com", bucket: "inbox" as const, account: "work2" as const },
];
for (let i = 0; i < 18; i++) {
  const s = FILLER_SENDERS[i % FILLER_SENDERS.length];
  THREADS.push({
    account: s.account,
    subject: `${s.name} update #${100 - i}`,
    bucket: s.bucket,
    seen: true,
    messages: [{ from: { name: s.name, email: s.email }, minutesAgo: (10 + i) * D, text: `Routine update number ${100 - i} from ${s.name}.` }],
  });
}

async function main() {
  const { db } = await import("@/lib/db");
  const { accounts, attachments, messages, senders, threads } = await import("@/lib/db/schema");
  const { inArray, like, sql } = await import("drizzle-orm");

  const accountIds: Record<string, string> = {};
  for (const [key, a] of Object.entries(ACCOUNTS)) {
    const [row] = await db
      .insert(accounts)
      .values(a)
      .onConflictDoUpdate({ target: accounts.email, set: { label: sql`${accounts.label}` } })
      .returning({ id: accounts.id });
    accountIds[key] = row.id;
  }
  await db
    .update(accounts)
    .set({ lastSyncAt: new Date() })
    .where(inArray(accounts.id, Object.values(accountIds)));

  await db.delete(threads).where(like(threads.gmailThreadId, "seed-%"));

  const senderIds = new Map<string, string>();
  async function senderId(from: { name: string | null; email: string }, screener: "user" | "ai" | "none" = "user") {
    const email = from.email.toLowerCase();
    const cached = senderIds.get(email);
    if (cached) return cached;
    const decision =
      screener === "none"
        ? { screenerDecision: "none" as const, decidedBy: null, decidedAt: null, defaultBucket: null }
        : { screenerDecision: "allowed" as const, decidedBy: screener, decidedAt: new Date(), defaultBucket: null };
    const [row] = await db
      .insert(senders)
      .values({ email, domain: email.split("@")[1], displayName: from.name, ...decision })
      .onConflictDoUpdate({ target: senders.email, set: { displayName: from.name, ...decision } })
      .returning({ id: senders.id });
    senderIds.set(email, row.id);
    return row.id;
  }

  const now = Date.now();
  let messageCount = 0;
  for (const [i, t] of THREADS.entries()) {
    const account = ACCOUNTS[t.account];
    const accountId = accountIds[t.account];
    const first = t.messages.find((m) => m.from !== "me")!.from as { name: string | null; email: string };
    const last = t.messages[t.messages.length - 1];
    const lastAt = new Date(now - last.minutesAgo * 60_000);

    const [thread] = await db
      .insert(threads)
      .values({
        accountId,
        gmailThreadId: `seed-${i.toString(16).padStart(8, "0")}`,
        senderId: await senderId(first, t.bucket === "triage" ? "none" : t.aiAllowed ? "ai" : "user"),
        subject: t.subject,
        lastMessageAt: lastAt,
        bucket: t.bucket,
        bucketSource: "ai",
        bucketConfidence: t.suggested ? 0.62 : 0.94,
        bucketSuggested: t.suggested ?? false,
        seenAt: t.seen ? lastAt : null,
        snoozedUntil: t.snoozedHours ? new Date(now + t.snoozedHours * 3_600_000) : null,
        pinnedAt: t.pinned ? lastAt : null,
        participantsSummary: [
          ...new Set(t.messages.map((m) => (m.from === "me" ? "me" : (m.from.name ?? m.from.email)))),
        ].join(", "),
      })
      .returning({ id: threads.id });

    for (const [j, m] of t.messages.entries()) {
      const from = m.from === "me" ? { name: "Fer Martin", email: account.email } : m.from;
      const [msg] = await db
        .insert(messages)
        .values({
          threadId: thread.id,
          accountId,
          gmailMessageId: `seed-${i}-${j}`,
          senderId: m.from === "me" ? null : await senderId(from),
          fromEmail: from.email,
          fromName: from.name,
          to: [m.from === "me" ? { name: first.name, email: first.email } : { name: "Fer Martin", email: account.email }],
          subject: j === 0 ? t.subject : `Re: ${t.subject}`,
          date: new Date(now - m.minutesAgo * 60_000),
          snippet: m.text.slice(0, 140),
          htmlSanitized: m.html ?? null,
          text: m.text,
          isInbound: m.from !== "me",
          gmailLabels: t.seen ? ["INBOX"] : ["INBOX", "UNREAD"],
        })
        .returning({ id: messages.id });
      messageCount++;
      if (m.attachments?.length) {
        await db.insert(attachments).values(
          m.attachments.map((a, k) => ({ ...a, messageId: msg.id, gmailAttachmentId: `seed-att-${i}-${j}-${k}` })),
        );
      }
    }
  }

  console.log(`seeded ${THREADS.length} threads, ${messageCount} messages across ${Object.keys(ACCOUNTS).length} accounts`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
