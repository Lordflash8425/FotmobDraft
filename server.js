import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'public', 'players.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function readRatings() {
  const text = await fs.readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(text);
  if (!Array.isArray(data.players) || data.players.length < 50) {
    throw new Error('The ratings snapshot is incomplete.');
  }
  return data;
}

app.get('/api/seasons', async (_req, res) => {
  try {
    const data = await readRatings();
    res.json({
      seasons: [{ id: data.season, name: data.seasonName }],
      selected: data.season
    });
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: 'Ratings are still being updated. Please refresh in a moment.' });
  }
});

app.get('/api/players', async (_req, res) => {
  try {
    res.json(await readRatings());
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: 'Ratings are still being updated. Please refresh in a moment.' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const term = String(req.query.term || '').trim().toLowerCase();
    if (term.length < 2) return res.json({ suggestions: [] });
    const data = await readRatings();
    const suggestions = data.players
      .filter(p => p.name.toLowerCase().includes(term))
      .slice(0, 20)
      .map(p => ({ name: p.name, id: p.id }));
    res.json({ suggestions });
  } catch (e) {
    res.status(503).json({ error: 'Ratings are still being updated.' });
  }
});

app.listen(PORT, () => console.log(`FotMob Fantasy Draft running on port ${PORT}`));
