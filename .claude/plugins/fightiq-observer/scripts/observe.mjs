#!/usr/bin/env node
// A shim, not a copy. The observer lives at .claude/hooks/observe.mjs and this
// plugin points at it, so installing the plugin and running the repo hooks
// directly can never drift apart into two versions of the same check.
import "../../../hooks/observe.mjs";
