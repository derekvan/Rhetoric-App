# Learnings — Rhetoric App

## 🔥 Critical Patterns (Quick Reference)

| Category | Pattern | Signpost |
|----------|---------|----------|
| Data | engsource has no committed results.json | ALWAYS verify GitHub repos have pre-built data before assuming a raw URL works |
| Data | Wiktionary category API is reliable for etymology | USE `action=query&list=categorymembers` with 150ms delays between pages |
| Network | Parallel Promise.all against Wiktionary hits rate limits | ALWAYS fetch Wiktionary pages sequentially with sleep(150) between requests |

## 🆕 Recent Fixes (Last 5 Days)

### 2026-03-03 - Etymology dataset source
**Issue**: Planned to use engsource `results.json` but it's generated output, not committed to the repo (returns HTTP 404 from raw.githubusercontent.com).
**Fix**: Switched to Wiktionary category API (`Category:English_terms_inherited_from_Old_English`, etc.) which is stable, free, and returns clean word lists.
**Signpost**: CHECK FIRST if a GitHub project's output files are committed before using a raw URL — many data projects expect you to run their scripts locally.

### 2026-03-03 - Rate limiting on category fetching
**Issue**: `Promise.all` on 3+ Wiktionary API category requests triggered HTTP 429.
**Fix**: Changed to sequential fetching with try/catch per category and 150ms sleep between paginated requests.
**Signpost**: NEVER hit Wikimedia in parallel — they enforce rate limits aggressively; sequential with delay is the correct pattern.
