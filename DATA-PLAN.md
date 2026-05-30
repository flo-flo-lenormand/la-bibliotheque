# Data Plan

## User-specific design inputs
- **recent_conversation** (from proposer) → Flo just finished 'Tomorrow, and Tomorrow, and Tomorrow' by Gabrielle Zevin (2026-05-29); themes of creatives building together shape the two starter books and the note copy.
- **recent_conversation** (from proposer) → Lucy recommended 'A Visit from the Goon Squad' as follow-up; used as the initial 'suggéré' book.
- **memory** (from proposer) → 'Jours Barbares' noted as future recommendation; informs recommendation tone, not seeded now.

## Tested sources
### Open Library Search API (https://openlibrary.org/search.json)
**Used by**: add_book cover fetch fallback
**Test command**: `curl -s 'https://openlibrary.org/search.json?title=Tomorrow%20and%20Tomorrow%20and%20Tomorrow&author=Gabrielle%20Zevin&limit=1'`
**Sample output**: docs[0] includes cover_i: 12859975, author_name, title
**Processing**: If isbn provided, try covers.openlibrary.org/b/isbn/<isbn>-L.jpg; else search by title+author, use first doc's cover_i to build cover URL https://covers.openlibrary.org/b/id/<cover_i>-L.jpg; validate with HEAD request.

### Open Library Covers
**Used by**: direct cover URL construction
**Test command**: `curl -fsSLI -A 'Mozilla/5.0' -H 'Referer: https://example.com/' 'https://covers.openlibrary.org/b/isbn/9780593321447-L.jpg'`
**Sample output**: HTTP/2 200 content-type: image/jpeg
**Processing**: Accept only 2xx image/*; fallback to generated spine if missing.

## Rejected approaches
- **Tried**: Google Books API for covers
  **Why rejected**: Requires API key setup; Open Library is open and sufficient for ISBN/title lookup.
- **Tried**: Client-side cover fetch
  **Why rejected**: Want server to store stable cover_image_url at insert time for offline render.
