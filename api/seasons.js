export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).json({
    selected: '36781',
    seasons: [{ id: '36781', name: '2026/2027' }]
  });
}
