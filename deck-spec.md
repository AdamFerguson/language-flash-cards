# Deck content spec

Both languages share the same 24 unit ids and English titles. Each language file:

```json
{
  "lang": "es",
  "units": [
    {
      "id": "u01",
      "title": "Saludos y presentaciones",
      "cards": [
        {
          "term": "hola",
          "en": "hello",
          "example": "¡Hola! ¿Cómo estás?",
          "exampleEn": "Hi! How are you?"
        }
      ]
    }
  ]
}
```

## Units (id — English title)

- u01 — Greetings & Introductions
- u02 — Please, Thanks & Politeness
- u03 — Numbers & Counting
- u04 — Days, Months & Calendar
- u05 — Time, Frequency & Speed
- u06 — Family & People
- u07 — Food: Meals & Staples
- u08 — Fruits, Vegetables & Kitchen
- u09 — Drinks & Café
- u10 — At the Restaurant
- u11 — House & Rooms
- u12 — Objects & Furniture
- u13 — City & Places
- u14 — Directions & Transport
- u15 — Travel: Airport & Hotel
- u16 — Shopping & Money
- u17 — Work & School
- u18 — Body & Health
- u19 — Weather & Nature
- u20 — Animals
- u21 — Colors, Sizes & Opposites
- u22 — Feelings & Personality
- u23 — Everyday Verbs
- u24 — Communication & Question Words

## Card rules

- **16 cards per unit.**
- High-frequency CEFR A1 vocabulary: concrete, immediately useful in daily conversation.
- `term`: the target-language word/phrase. Nouns **always carry the definite article** (`el pan`, `o pão`). Verbs as infinitive. Fixed phrases as-is.
- `en`: English translation matching `term` exactly in scope.
- `example`: natural, colloquial sentence of 4–10 words that clearly demonstrates the word; the target word must appear in it (conjugated/inflected forms fine).
- `exampleEn`: faithful English translation of the example.
- Spanish: neutral Latin-American. Portuguese: **Brazilian**. Correct accents/diacritics (á é í ó ú ñ ü ã õ ç à). No European-PT constructions (use "você", "estou fazendo", possessives with `de`).
- No proper nouns, no slang, no vulgarity.
- Avoid duplicates within your units. Keep gender/number defaults simple (singular).
