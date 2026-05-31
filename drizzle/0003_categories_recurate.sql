-- Recurate the collection and let shelves organise by style (category).
ALTER TABLE books ADD COLUMN category TEXT;
--> statement-breakpoint
-- Remove the manually-added placeholder book.
DELETE FROM books WHERE title = 'Ejejsjs';
--> statement-breakpoint
-- Give the seeded volumes a style.
UPDATE books SET category = 'Romans'
  WHERE title IN ('Tomorrow, and Tomorrow, and Tomorrow', 'A Visit from the Goon Squad');
--> statement-breakpoint
-- Add the requested title.
INSERT INTO books (title, author, cover_image_url, page_count, status, personal_note, date_added, isbn, category)
VALUES (
  'Middle of the Night',
  'Riley Sager',
  'https://covers.openlibrary.org/b/id/15125995-L.jpg',
  352,
  'suggéré',
  'Thriller nocturne : un ami disparu une nuit d''été ressurgit trente ans plus tard. Tension de banlieue, secrets enfouis, paranoïa douce.',
  (CAST(strftime('%s','now') AS INTEGER) * 1000),
  '0593472373',
  'Thriller'
);
