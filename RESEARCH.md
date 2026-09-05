# Product research notes

Checked September 4, 2026 against the public product pages for [Motion](https://www.usemotion.com/), [Reclaim](https://www.reclaim.ai/), and [Sunsama](https://www.sunsama.com/).

## Patterns worth borrowing

- **Reclaim:** protect focus time, schedule tasks and habits around existing calendar events, preserve buffer time, and expose time-performance analytics.
- **Motion:** combine tasks, projects, calendar, notes, workflows, meeting follow-ups, and business reporting so the assistant has enough context to make useful recommendations.
- **Sunsama:** guide a realistic daily plan, show tasks and meetings together, support focus mode, capture daily wins, and close the day with a shutdown ritual.

## JARVIS direction

JARVIS should be better for one person by being more personal and more transparent, not by trying to become a large team project-management suite. The differentiators are:

1. A single daily briefing across personal, school, and business priorities.
2. Recommendations that explain why an item is next and allow approval before changing the calendar.
3. A private Google Apps Script data layer with a local offline cache.
4. Performance tracking that measures outcomes and energy, not just completed tasks.
5. A daily shutdown that turns unfinished work into a deliberate next step instead of guilt.

For Sasha specifically, the core object is not a generic task. It is a **day** with available energy, academic commitments, training load, coding output, business outcomes, and recovery. The app should recommend tradeoffs across those areas rather than reward filling every empty minute.

## PocketAthlete

PocketAthlete publicly describes readiness, sleep, soreness, training load, workouts, personal records, position-specific plans, and on-device video analysis. That makes it the specialist training system in the stack. JARVIS should not duplicate its coaching logic. It should use PocketAthlete's official export/API, once available, to answer a different question: given today's readiness and training load, what is the smartest overall day across university, gym, coding, business, and recovery?

The current frontend implements local briefing, categorized capture, focus mode, and daily shutdown. Calendar scheduling, Groq-backed reasoning, and synced analytics should be added only after the Apps Script request/response contract is available.