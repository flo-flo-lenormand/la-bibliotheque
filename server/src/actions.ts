import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import * as schema from "./schema";

async function fetchCoverUrl(title: string, author: string, isbn?: string): Promise<string | null> {
  try {
    if (isbn) {
      const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`;
      const res = await fetch(url, { 
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://example.com/" }
      });
      if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) {
        return url;
      }
    }
    const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=1`;
    const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data = await res.json() as { docs?: Array<{ cover_i?: number }> };
    const coverId = data.docs?.[0]?.cover_i;
    if (coverId) {
      const url = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
      const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://example.com/" } });
      if (head.ok) return url;
    }
  } catch {}
  return null;
}

export const Actions = {
  list_books: defineAction({
    request: z.object({}),
    response: z.object({
      books: z.array(z.object({
        id: z.number(),
        title: z.string(),
        author: z.string(),
        cover_image_url: z.string().nullable(),
        page_count: z.number().nullable(),
        status: z.string(),
        personal_note: z.string().nullable(),
        date_added: z.string(),
        isbn: z.string().nullable(),
      })),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.books).orderBy(desc(schema.books.dateAdded));
      return {
        books: rows.map(r => ({
          id: r.id,
          title: r.title,
          author: r.author,
          cover_image_url: r.coverImageUrl,
          page_count: r.pageCount,
          status: r.status,
          personal_note: r.personalNote,
          date_added: r.dateAdded.toISOString(),
          isbn: r.isbn,
        })),
      };
    },
  }),

  add_book: defineAction({
    request: z.object({
      title: z.string().min(1),
      author: z.string().min(1),
      status: z.enum(["lu", "suggéré"]),
      personal_note: z.string().optional(),
      page_count: z.number().int().positive().optional(),
      isbn: z.string().optional(),
      date_added: z.string().datetime().optional(),
      cover_image_url: z.string().url().optional(),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let cover = args.cover_image_url ?? null;
      if (!cover) {
        cover = await fetchCoverUrl(args.title, args.author, args.isbn);
      }
      const date = args.date_added ? new Date(args.date_added) : new Date();
      const result = await db.insert(schema.books).values({
        title: args.title,
        author: args.author,
        coverImageUrl: cover,
        pageCount: args.page_count ?? null,
        status: args.status,
        personalNote: args.personal_note ?? null,
        dateAdded: date,
        isbn: args.isbn ?? null,
      }).returning({ id: schema.books.id });
      const inserted = result[0];
      if (!inserted) throw new Error("Insert failed");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  update_book: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      title: z.string().optional(),
      author: z.string().optional(),
      status: z.enum(["lu", "suggéré"]).optional(),
      personal_note: z.string().optional(),
      page_count: z.number().int().positive().optional(),
      isbn: z.string().optional(),
      cover_image_url: z.string().url().optional(),
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const updates: Partial<typeof schema.books.$inferInsert> = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.author !== undefined) updates.author = args.author;
      if (args.status !== undefined) updates.status = args.status;
      if (args.personal_note !== undefined) updates.personalNote = args.personal_note;
      if (args.page_count !== undefined) updates.pageCount = args.page_count;
      if (args.isbn !== undefined) updates.isbn = args.isbn;
      if (args.cover_image_url !== undefined) updates.coverImageUrl = args.cover_image_url;
      if (Object.keys(updates).length === 0) return { ok: true };
      await db.update(schema.books).set(updates).where(eq(schema.books.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  seed_initial_books: defineAction({
    request: z.object({}),
    response: z.object({ inserted: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.books).limit(1);
      if (existing.length > 0) return { inserted: 0 };
      const books = [
        {
          title: "Tomorrow, and Tomorrow, and Tomorrow",
          author: "Gabrielle Zevin",
          status: "lu" as const,
          personalNote: "Deux créatifs qui construisent ensemble sur 30 ans. La collaboration, l'amitié, le craft comme obsession.",
          pageCount: 416,
          dateAdded: new Date("2026-05-29T00:00:00Z"),
        },
        {
          title: "A Visit from the Goon Squad",
          author: "Jennifer Egan",
          status: "suggéré" as const,
          personalNote: "Des vies créatives qui s'entrelacent sur des décennies. Structure inventive, le temps comme personnage principal. Dans la lignée de Zevin.",
          pageCount: 352,
          dateAdded: new Date(),
        },
      ];
      let inserted = 0;
      for (const b of books) {
        const cover = await fetchCoverUrl(b.title, b.author);
        await db.insert(schema.books).values({
          title: b.title,
          author: b.author,
          coverImageUrl: cover,
          pageCount: b.pageCount,
          status: b.status,
          personalNote: b.personalNote,
          dateAdded: b.dateAdded,
          isbn: null,
        });
        inserted++;
      }
      ctx.invalidateQueries();
      return { inserted };
    },
  }),
} satisfies ActionsModule;
