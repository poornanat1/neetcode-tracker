# Loop Club

Loop Club is a personal tracker for the NeetCode 250. It shows what to practice today, what to review next, and how far you’ve come.

- Browse all 250 problems by topic, difficulty, or status.
- Log attempts, time spent, and notes.
- Revisit problems in your review queue and track progress by topic.

Each account has its own progress, which syncs across devices. Email addresses and passwords are stored as hashes.

## Run locally

Copy `.env.example` to `.env`, then set `EMAIL_HASH_KEY` to a secret generated with `openssl rand -hex 32`.

```sh
docker compose up --build
```

Open [localhost:3000](http://localhost:3000) and create an account.