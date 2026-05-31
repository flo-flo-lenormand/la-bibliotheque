import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const books = sqliteTable("books", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  author: text("author").notNull(),
  coverImageUrl: text("cover_image_url"),
  pageCount: integer("page_count"),
  status: text("status").notNull(), // 'lu' | 'suggéré'
  personalNote: text("personal_note"),
  dateAdded: integer("date_added", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  isbn: text("isbn"),
  category: text("category"),
});
