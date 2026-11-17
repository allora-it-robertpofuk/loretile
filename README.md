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

Additional permission under GNU AGPL version 3 section 7: if you modify this
Program, or any covered work, by linking or combining it with ClojureScript,
malli, or any other library licensed under the Eclipse Public License 1.0 or
2.0 (or a modified version of such a library), containing parts covered by
the terms of the Eclipse Public License, the licensors of this Program grant
you additional permission to convey the resulting work. Corresponding Source
for a non-source form of such a combination shall include the source code for
the parts of those libraries used as well as that of the covered work.
