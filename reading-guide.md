# Reading guide

A companion to the [main doc](doc.md). Read them side by side. This explains what each section is arguing and calls out the numbers that matter.

## Executive summary

Today we build the same SDK twice, once in Python and once in TypeScript, totaling ~131,000 lines of code that do the same thing. Every feature, bug fix, and integration costs double. This doc proposes building it once and sharing it across languages. If you only read one section of the main doc, read this one.

## Implementation

How the shared architecture works. The TypeScript SDK, which already exists and is already maintained, gets compiled into a portable format and wrapped thinly for each language. This section includes a working demo, not a slide deck.

### The WIT contract

A 201-line file that defines the exact interface between the shared core and every language wrapper. If either side breaks the contract, the build fails. This is what prevents the Python and TypeScript SDKs from silently diverging, which they already do today (42% of Python has no TypeScript equivalent).

### The TypeScript SDK

The existing TypeScript SDK becomes the single shared implementation. Nothing new is written from scratch. The polyglot architecture rides on top of a codebase the team already ships and tests.

### The WASM bridge

A 496-line adapter that connects the TypeScript SDK to the contract. This is the only new code between the SDK and the portable format.

### The Rust host

The runtime that loads the portable component and provides it with network access. ~1,500 lines, changes infrequently. Makes startup fast (milliseconds after first load). The Q&A section in the main doc addresses why Rust is necessary.

### The Python wrapper

A thin Python layer with the same imports, same API, and same decorator syntax as the existing Python SDK. Users don't know the internals changed. Passes 54 of 106 upstream integration tests today with zero test code of its own.

### Adding a new language

Each new language costs ~1,400 lines of wrapper code instead of reimplementing the entire ~13,750-line runtime from scratch. This has already been validated.

## Results

The evidence:

- 46% reduction in total code for two languages at parity (~61,000 fewer lines)
- 10x faster import, 15x faster agent construction vs the native Python SDK
- Invocation performance identical (network latency dominates, not the architecture)
- 54 of 106 upstream integration tests pass with no test code written

### Caveats

The honest costs. The binary is 35% larger (96 MB vs 71 MB, though it's 1 package vs 49). 42% of Python SDK features don't have TypeScript equivalents yet and need to be built.

## Summary

One paragraph that captures the full argument. If someone skips to the end, this is what they read.

## Q&A

Direct answers to the questions people will ask, sorted by importance. "Does this break the Python SDK?" No. "Will development be harder?" Yes, and here's why it's worth it. "Why Rust?" Because the alternative doesn't support the networking the SDK needs.

## Glossary

If you hit an unfamiliar term, check here. The main ones: WASM is the portable compilation format, WIT is the contract language, "host" is the runtime, "guest" is the code running inside it.

## Appendix A: Line counts

Where every number in the doc comes from.

## Appendix B: Line count projections

The scaling argument. ~1,600 lines per language with the shared approach vs. ~13,750 without it. Pays for itself before the second language.

## Appendix C: Discrepancy analysis

What Python has that TypeScript doesn't. 42% unmatched, mostly model providers and experimental features.

## Appendix D: Reimplementation analysis

40% of the Python wrapper duplicates work the shared core could do. Fixing that cuts per-language cost in half.

## Appendix E: On-disk size analysis

96 MB (1 package) vs. 71 MB (49 packages). Larger but simpler.

## Appendix F: Performance analysis

10x faster import, 15x faster startup. Invocations identical.

## Appendix G: Test status

54 of 106 upstream tests pass. Most likely failures were addressed first. No fundamental blockers in the remaining failures.
