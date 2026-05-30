CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  cover_image_url TEXT,
  page_count INTEGER,
  status TEXT NOT NULL,
  personal_note TEXT,
  date_added INTEGER NOT NULL,
  isbn TEXT
);
