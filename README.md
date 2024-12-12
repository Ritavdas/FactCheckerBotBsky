# Bluesky FactChecker Bot 🤖

A powerful Bluesky bot that helps verify information and provides additional context through fact-checking and information retrieval. Mention the bot on any post to get started!

## 🎯 How to Use

### Fact Checking (#factcheck)

To verify a claim or statement:

1. Reply to any post containing the claim
2. Mention @factchecker.bsky.social with #factcheck
3. Receive a threaded response with:
   - Verdict (True/False/Misleading/Unverified)
   - Clear explanation
   - Up to 5 reliable sources

Example:
> @factchecker.bsky.social #factcheck
> Please verify this claim about climate change

### More Information (#moreinfo)

To get additional context about any topic:

1. Reply to the post you want to learn more about
2. Mention @factchecker.bsky.social with #moreinfo
3. Receive a concise thread containing:
   - Main information (comprehensive yet brief)
   - Up to 5 relevant sources

Example:
> @factchecker.bsky.social #moreinfo
> Tell me more about this historical event

## ⚡️ Features

- Real-time monitoring and quick responses
- AI-powered analysis using Perplexity
- Source verification and citation
- Rate-limited to ensure service stability
- Clean, threaded responses
- Character-optimized outputs (300 char limit)

## 🛠 Technical Setup

### Prerequisites

- Node.js
- npm
- Bluesky account
- Perplexity API key

### Installation

```bash
# Clone repository
git clone [repository-url]

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### Environment Configuration

```env
BLUESKY_USERNAME=your-username.bsky.social
BLUESKY_PASSWORD=your-password
PERPLEXITY_API_KEY=your-perplexity-api-key
NODE_ENV=development
```

### Running the Bot

```bash
# Development 
npm run dev

# Production
npm run start
```

## 🚦 Rate Limits

- Hourly: 5,000 points
- Daily: 35,000 points
- Each action costs 3 points

## 📦 Architecture

- TypeScript-based
- Express server for health monitoring
- Modular service architecture
  - Bluesky API interaction
  - Perplexity AI integration
  - Rate limiting system
  - Session management

## 🔄 Deployment

Supports deployment on:

- Docker containers
- Fly.io
- Any Node.js hosting platform

## 🤝 Contributing

Contributions welcome! Please check our issues page and feel free to submit PRs.

## 📝 License

MIT License - feel free to use and modify!
