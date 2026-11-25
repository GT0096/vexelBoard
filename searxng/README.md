# Optional Self-Hosted SearXNG for Vexelboard

> **Zero setup needed:** Vexelboard already includes a **built-in open metasearch engine** (DuckDuckGo, Wikipedia, arXiv, Stack Overflow, OpenAlex & Hacker News) that works out of the box when you launch the app — **Docker and SearXNG are completely optional** and only needed if an advanced user prefers to route queries through their own SearXNG server.

[SearXNG](https://github.com/searxng/searxng) is a free, open-source (AGPL-3.0) internet metasearch engine that aggregates results locally.

## Optional Quick Start (Advanced Users)

1. Make sure **Docker Desktop** (or Docker Engine + Compose) is installed and running.
2. Start SearXNG from this directory:

   ```bash
   docker compose up -d
   ```

3. Verify the JSON API is responding in your browser or terminal:

   ```
   http://localhost:8888/search?q=test&format=json
   ```

4. In Vexelboard, open **AI Settings -> Web Search -> Advanced: Use a custom self-hosted SearXNG URL (optional)**, enable custom mode, enter `http://localhost:8888`, and click **Test search**.
