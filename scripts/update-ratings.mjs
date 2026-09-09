import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const season = '36781';
const seasonName = '2026/2027';
const url = `https://www.fotmob.com/leagues/47/stats/season/${season}/players/rating/premier-league-1000-players`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const text = await page.locator('body').innerText();
  const lines = text.split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const players = [];
  const seen = new Map();

  for (const line of lines) {
    const m = line.match(/^\d+\s+\d+\s+(.+?)\s+Player of the Match:\s+\d+\s+(\d+(?:\.\d+)?)$/i);
    if (!m) continue;
    const name = m[1].trim();
    const rating = Number(m[2]);
    if (!name || !Number.isFinite(rating) || rating <= 0 || rating >= 10) continue;

    const base = `fotmob-${name.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    players.push({ id: count ? `${base}-${count}` : base, name, rating, teamId: null, teamName: null, position: null, appearances: null, photo: null });
  }

  if (players.length < 100) {
    console.error('Only parsed', players.length, 'players. Page title:', await page.title());
    console.error(text.slice(0, 5000));
    process.exit(1);
  }

  players.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  const output = {
    season,
    seasonName,
    source: 'FotMob Premier League player rating table',
    sourceUrl: url,
    updatedAt: new Date().toISOString(),
    players
  };

  await fs.mkdir('public', { recursive: true });
  await fs.writeFile('public/players.json', JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${players.length} FotMob player ratings.`);
} finally {
  await browser.close();
}
