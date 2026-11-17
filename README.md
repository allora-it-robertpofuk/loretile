# Loretile

A learning platform built on a knowledge graph: small learning objects, a
per-learner mastery model, and an AI tutor that works on top of the graph.
It also works as a graph tool for any ontology. Runs entirely in the browser;
AI features use your own provider key.

Live: https://loretile.com

## Build

Needs Node 22 and Java 21 (shadow-cljs).

    make dev     # local dev server
    make test    # unit tests + codebase-graph check

Comments in the code cite `wiki/*.md` pages. Those design notes are not
published.

## Licence

Copyright © 2026 smogstate. Licensed under the GNU Affero General Public
License v3.0 or later — see [LICENSE](LICENSE). Third-party files are listed
in [THIRD_PARTY.md](THIRD_PARTY.md).
