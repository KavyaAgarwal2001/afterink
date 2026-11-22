# Afterink

A working, AI-powered prototype of a contract repository for the stage after signature. Built for the Sirion assignment set through ISB.

**Open the prototype:** https://akshatj28.github.io/afterink/
Start with **Guided tour** in the top bar. It takes about two minutes.

## In 30 seconds

| | |
|---|---|
| **Stage** | Intelligent repository: one searchable, AI-understood record of every signed contract |
| **Users** | Legal Operations (files contracts), Procurement (decides renewals), Accounts Payable (checks invoices), plus anyone who asks a question |
| **Problem** | The brief's three losses (unreviewed auto-renewals, missed service levels, invoices above agreed prices) all come from signed terms nobody could see when it mattered |
| **How it works** | AI reads, code calculates, people decide. Every extracted term links to the sentence it came from, and code checks the value really is in that sentence |
| **North star** | The share of contract dates that got a recorded decision before they passed |
| **Demo data** | An invented company, Kestrel Mobility: 10 filed contracts, 3 unfiled signed documents, 5 invoices. Demo date fixed at 17 November 2026 |

The five sections the brief asks for (why this stage, stakeholder map, the problem, the working prototype, success metrics) are all inside the page, numbered in the left menu.

## AI in this copy

This GitHub Pages copy replays saved AI results, prepared in advance from the same documents. Filing, deadlines, invoice checks and every sum run live in your browser. The AI steps run live only in the [Claude-hosted copy](https://claude.ai/artifact/QvDrGbxDgdboEDAN2mFeEJ), for a viewer signed in to Claude.

Nothing in the prototype sends an email, makes a payment or contacts a supplier. Use **Reset demo** to return to the starting state.

## Files

| File | What it holds |
|---|---|
| `index.html` | The page: layout, styles and the case sections |
| `app.js` | Logic: extraction review, filing, renewal dates, invoice checks, cited answers, guided tour |
| `data.js` | Invented contracts, documents and invoices |
| `APPROACH.md` | The reasoning: decisions, assumptions, and where an evaluator is likely to push |

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8765
```
