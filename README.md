# Bluesky Fact Checker Bot

A Bluesky bot that performs fact-checking on mentioned posts using Perplexity AI.

## Features

- Monitors mentions with #factcheck hashtag
- Uses Perplexity AI for fact verification
- Provides confidence levels (✅, ⚠️, ❌)
- Includes sources when available
- Rate limiting to respect Bluesky API limits

## Setup

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3.Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

## Environment Variables

```env
BLUESKY_USERNAME=your-username.bsky.social
BLUESKY_PASSWORD=your-password
PERPLEXITY_API_KEY=your-perplexity-api-key
NODE_ENV=development
```

## Running the Bot

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run start
```

## Usage

1. Mention the bot with #factcheck hashtag
2. Bot will respond with:
   - Fact check result
   - Confidence indicator
   - Sources (when available)

## Rate Limits

- Hourly: 5,000 points
- Daily: 35,000 points
- Each post costs 3 points
