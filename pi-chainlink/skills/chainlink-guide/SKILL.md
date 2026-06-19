---
name: chainlink-guide
description: Chainlink issue tracker workflow. Use when working on chainlink-tracked projects — creating issues, managing sessions, tracking work across conversations.
---

# Chainlink Issue Tracker

Track tasks across AI sessions. Data in `.chainlink/issues.db`.

## Commands

```bash
# Issues
chainlink issue create "title" [-p high] [-d "desc"]
chainlink issue quick "title" [-p high] [-l label]
chainlink issue list [-s all|closed] [-l label] [-p priority]
chainlink issue show <id>
chainlink issue update <id>
chainlink issue close <id>
chainlink issue reopen <id>
chainlink issue delete <id>
chainlink issue subissue <parent> "title"
chainlink issue ready
chainlink issue next
chainlink issue tree

# Organization
chainlink issue comment <id> "text"
chainlink issue label|unlabel <id> <label>
chainlink issue block|unblock <id> <blocker>
chainlink issue blocked

# Sessions
chainlink session start
chainlink session status
chainlink session end [--notes "handoff context"]
chainlink session work <id>
chainlink session action "current task"
chainlink session last-handoff
```

## Workflow

1. `chainlink session start` → see previous handoff
2. `chainlink session work <id>` → mark focus
3. Work, add comments
4. `chainlink session end --notes "..."` → save context

## Best Practices

- Start sessions when beginning work
- Use `chainlink issue ready` to find unblocked issues
- Use subissues for tasks >500 lines
- End with handoff notes before context compresses
