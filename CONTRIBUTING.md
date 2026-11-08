# Contributing

Work goes on a feature branch with a pull request against `dev`; nothing is pushed to `main`. The rules for names, licensing and claims are in `AGENTS.md`; code style is in `.claude/CLAUDE.md`.

## Contributor License Agreement

Every outside contribution needs a signed **Contributor License Agreement (CLA)** first. Owner's decision, 2026-11-07: a CLA rather than DCO.

**What it grants.** Contributors keep their copyright and give Trifold a license; nothing is assigned. That license is:
- perpetual, worldwide and irrevocable, covering copyright and patents;
- broad enough that Trifold may release the contribution under any license, including FSL-1.1-ALv2, Apache-2.0, CC0 and proprietary terms.

**Why a CLA.** This repository mixes FSL, Apache-2.0, CC0 and proprietary code (`LICENSING.md`), and code moves between them. For example, a spec file moves from FSL to Apache-2.0, or engine code moves into the proprietary hosted service. A DCO only certifies that you may contribute under the file's current license, so contributed code could never move. A CLA keeps that possible.

**The text.** There are two forms, both adapted from the Apache Software Foundation's ICLA and CCLA, the base most company CLAs use:
- an individual CLA, `legal/cla/individual.md`;
- a corporate CLA, `legal/cla/corporate.md`, for contributors whose employer owns their work.

Each file lists where it differs from Apache's text. Both are drafts (v0.1) that a lawyer hasn't reviewed: don't sign them. A bot, CLA assistant, will collect individual signatures on pull requests; companies sign the corporate CLA as a PDF. `legal/cla/SETUP.md` is the owner's checklist for turning that on.

**Until the reviewed text is published,** outside contributions can't be accepted. Open an issue instead. A lawyer reviews the text before it's used, once the legal entity exists (the licensor is "Trifold" until then).

## Trademarks

A fork must rename itself. What you may say about Trifold, tfd and Rifo is in `TRADEMARKS.md`.
