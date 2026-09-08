# FotMob Fantasy Draft

A Premier League fantasy draft utility that loads season player ratings from FotMob, lets multiple teams build an 11-player XI, prevents duplicate picks, and calculates average ratings automatically.

## Deploy

This app is designed for a Node.js host. It needs the server because FotMob data is fetched server-side.

## Local

Install Node.js 18+, run `npm install`, then `npm start` and open port 3000.

## Note

FotMob's relevant web/API endpoints are unofficial/internal and may change. The server isolates the FotMob requests so they can be updated if necessary.
