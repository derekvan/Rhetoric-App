'use strict';

/**
 * build-wordlist.js
 *
 * Pulls word lists from Wiktionary's etymology categories, intersects with a
 * common-word frequency list, and writes data/etymology.json for the app.
 *
 * Usage: node scripts/build-wordlist.js
 *
 * All data is cached in scripts/cache/ after the first run so re-runs are instant.
 * The script is respectful of Wikimedia rate limits (150 ms between requests).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'etymology.json');

// Word frequency list — top 10K English words (no profanity variant)
const FREQ_LIST_URL =
  'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt';

// Wiktionary categories to collect, grouped by origin type.
// "inherited" categories are stronger signals (continuous use from Old English).
const GERMANIC_CATEGORIES = [
  'English_terms_inherited_from_Old_English',   // strongest signal (~6K words)
  'English_terms_derived_from_Old_Norse',        // Viking borrowings (~1.7K)
  'English_terms_inherited_from_Proto-Germanic', // deep Germanic roots
];

const LATINATE_CATEGORIES = [
  'English_terms_derived_from_Latin',            // classical / learned (~26K)
  'English_terms_derived_from_Old_French',       // Norman conquest layer (~6K)
  'English_terms_derived_from_Anglo-Norman',     // Anglo-Norman French (~1.6K)
  'English_terms_derived_from_Middle_French',    // later French loans
];

// Function words — excluded from both output buckets (app uses its own NEUTRAL_COMMON)
const NEUTRAL_WORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from',
  'i','if','in','into','is','it','me','my','of','on',
  'or','our','so','that','the','their','them','then','there','these',
  'they','this','to','we','with','you','your',
  'but','not','what','all','were','has','had','been','have',
  'its','who','him','his','her','she','he','no','up','do','did',
  'was','am','will','would','could','should','may','might','shall',
  'can','been','being',
]);

// ── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rhetoric-app-build/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function download(url, cachePath) {
  if (fs.existsSync(cachePath)) {
    return Promise.resolve(fs.readFileSync(cachePath, 'utf8'));
  }
  return httpsGet(url).then(text => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, text, 'utf8');
    return text;
  });
}

// ── Wiktionary category fetching ─────────────────────────────────────────────

/**
 * Fetch all page titles from a Wiktionary category (handles pagination).
 * Results are cached as a JSON file to avoid repeated API calls.
 */
async function fetchCategory(categoryName) {
  const safeFileName = categoryName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cachePath = path.join(CACHE_DIR, `cat_${safeFileName}.json`);

  if (fs.existsSync(cachePath)) {
    const words = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    process.stdout.write(` [cache] ${categoryName} (${words.length} words)\n`);
    return words;
  }

  process.stdout.write(` [fetch] ${categoryName}... `);
  const words = [];
  let cmcontinue = null;

  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmlimit: '500',
      cmtype: 'page',
      cmnamespace: '0',
      format: 'json',
    });
    if (cmcontinue) params.set('cmcontinue', cmcontinue);

    const url = `https://en.wiktionary.org/w/api.php?${params}`;
    const json = JSON.parse(await httpsGet(url));

    for (const member of json.query.categorymembers) {
      const title = member.title.toLowerCase().trim();
      // Keep only pure lowercase alphabetic words (no spaces, hyphens, apostrophes)
      if (/^[a-z]+$/.test(title) && title.length >= 3 && title.length <= 20) {
        words.push(title);
      }
    }

    cmcontinue = json.continue ? json.continue.cmcontinue : null;
    if (cmcontinue) await sleep(150); // be polite to Wikimedia servers
  } while (cmcontinue);

  process.stdout.write(`${words.length} words\n`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(words), 'utf8');
  return words;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Etymology Word List Builder ===\n');

  // 1. Frequency list
  console.log('Fetching frequency list...');
  let freqSet = null;
  try {
    const freqRaw = await download(
      FREQ_LIST_URL,
      path.join(CACHE_DIR, 'freq-10k.txt')
    );
    freqSet = new Set(
      freqRaw.trim().split('\n').map(w => w.trim().toLowerCase()).filter(Boolean)
    );
    console.log(`  Loaded ${freqSet.size} frequency words\n`);
  } catch {
    console.warn('  Warning: could not load frequency list — will use all category words.\n');
  }

  // 2. Fetch Wiktionary categories sequentially (avoids rate limiting)
  async function fetchAll(categories, label) {
    console.log(`Fetching ${label} categories from Wiktionary...`);
    const results = [];
    for (const cat of categories) {
      try {
        results.push(await fetchCategory(cat));
      } catch (err) {
        console.warn(`  Warning: skipping ${cat}: ${err.message}`);
        results.push([]);
      }
    }
    return results;
  }

  const germanicSets = await fetchAll(GERMANIC_CATEGORIES, 'Germanic');
  const latinateSets = await fetchAll(LATINATE_CATEGORIES, 'Latinate');

  // 3. Merge into flat sets
  const allGermanic = new Set(germanicSets.flat());
  const allLatinate = new Set(latinateSets.flat());

  // Remove neutral function words and words in both categories (ambiguous)
  for (const word of NEUTRAL_WORDS) {
    allGermanic.delete(word);
    allLatinate.delete(word);
  }
  // Remove ambiguous overlap — appears in both Germanic and Latinate categories
  for (const word of allGermanic) {
    if (allLatinate.has(word)) {
      allGermanic.delete(word);
      allLatinate.delete(word);
    }
  }

  console.log(`\nRaw pool: ${allGermanic.size} Germanic, ${allLatinate.size} Latinate`);

  // 4. Build output — prioritise frequency-list words, fill remaining slots from pool
  const TARGET = 10000;
  const germanic = new Set();
  const latinate = new Set();

  function addWord(word, target) {
    if (!word || NEUTRAL_WORDS.has(word)) return;
    if (!/^[a-z]+$/.test(word) || word.length < 3) return;
    target.add(word);
  }

  // Pass 1: frequency-list words that have a known etymology
  if (freqSet) {
    for (const word of freqSet) {
      if (allGermanic.has(word)) addWord(word, germanic);
      else if (allLatinate.has(word)) addWord(word, latinate);
    }
  }
  console.log(`After frequency pass: ${germanic.size} Germanic, ${latinate.size} Latinate`);

  // Pass 2: fill remaining slots from the full category pools (shorter first)
  const remainingG = [...allGermanic]
    .filter(w => !germanic.has(w))
    .sort((a, b) => a.length - b.length);
  const remainingL = [...allLatinate]
    .filter(w => !latinate.has(w))
    .sort((a, b) => a.length - b.length);

  for (const w of remainingG) {
    if (germanic.size >= TARGET) break;
    addWord(w, germanic);
  }
  for (const w of remainingL) {
    if (latinate.size >= TARGET) break;
    addWord(w, latinate);
  }

  // 5. Write output
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const output = {
    g: [...germanic].sort(),
    l: [...latinate].sort(),
  };
  const json = JSON.stringify(output);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf8');

  const sizeKB = (json.length / 1024).toFixed(1);
  console.log(`\nOutput: ${OUTPUT_PATH}`);
  console.log(`  ${output.g.length.toLocaleString()} Germanic + ${output.l.length.toLocaleString()} Latinate words`);
  console.log(`  ${sizeKB} KB (uncompressed)`);
  console.log('\nDone! Serve the app and the dataset will load automatically.');
}

main().catch(err => {
  console.error('\nBuild failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
