## Versioning

As we have to reimplement a lot of our distribution, we have to make a decision on how we version our SDK's.

### Lockstep versioning

Lockstep versioning is a strategy where every SDK is versioned the same. For example, the release of TypeScript version 2.0 would also be the release of Rust 2.0.

**Pros**

- Greatly simplifies debugging. If a customer reports a bug in the latest Python, we know they're using the latest Typescript SDK under the hood.
- Greatly simplifies release. A single release represents every one of our SDK's. To run the MCM:
  - You won't have to jump across repositories collecting SDK versions or changelogs.
  - This matters more if we introduce additional SDK's.
- Customers know that SDK's are compatible with each other. Python 2.0 uses Typescript 2.0 under the hood.

**Cons**

- A bug fix in one SDK requires releasing all SDK's.
  - This is likely to be required in any case as the Typescript SDK itself is upstream of all the other SDK's.
- It's a little weird for customers to see version bumps without changes. Language specific features might look strange in a changelog.

**Other considerations**

- We will have to release Typescript 2.0 at the same time as Python 2.0.

### Independent versioning

Independent versioning is a strategy where each SDK is versioned independently. For example, the release of TypeScript version 2.0 might be accompanied by the release of Python 2.2. This is what we do today.

**Pros**

- A bug fix in one SDK only requires releasing that SDK.
- There is no risk of empty version bumps and the compute overhead of releasing new versions.

**Cons**

- Debugging is more difficult. If a customer reports a bug in the latest Python, we have to compare it with the version of the typescript SDK we released it with. We have to match that version with a commit in the repo and investigate to see if bugs are still relevant.
- Releasing is more difficult. Each SDK requires its own release process. This manifests itself in the MCM where the on-call must manually release each SDK separately.
- Customers can be sure that Python version 2.0 has the same features as Typescript 2.0.

**Other considerations**

- Python 2.0 will initially depend on Typescript 1.x.

### Recommendation

I recommend lockstep versioning. At Fig we tried both and settled for lockstep versioning because debugging across versions became incredibly difficult. This is a two way door decision but with the release of WASM we have to make a decision. Versions can diverge at any point in the future, and I believe we can move faster in the short term this way.

## Repo structure

Historically, we've placed Strands across different repositories to simplify project management of independent codebases. This approach has merits, but it's also at risk of getting in the way now that our codebases are unified.

### Multiple repositories

Today, our SDK's live across multiple repositories. sdk-typescript and sdk-python.

**Pros**

- Granular contribution metrics for each repository. We can see how much interest each individual SDK has without relying exclusively on downloads.

**Cons**

- Work done in one SDK is isolated from others. This has been a pro historically, but with unified SDK's, this is no longer in our favor.
- The development CLI relies on known locations for each SDK. This means the development CLI will have to expand in scope to handle uncloned repositories, and would have implicit constraints on file structure.
- A change in the Typescript SDK would require making N PR's where N is the number of langugages we support. With WASM, that is a minimum of three Pr's and 6 reviews for a single change.
- Agents making changes across SDK's will have to traverse the filesystem and make network requests in order to understand the codebase. This is possible, but add a lot of friction and overhead for agentic reviewers and contributors.

### Monorepo

This definiton of a monorepo is one where all of our SDK's exist in the same repository.

**Pros**

- The WASM approach is already written this way, so no additional work is required.
- Only one PR is needed for a change in every SDK.
- The friction for an agent to understand the codebase is essentially eliminated. All the code is in one place.
- Development of the development CLI is simplified. It can rely on known locations.

**Cons**

- We lose granular contribution metrics for each repository. We can only see contributions to the monorepo.

### Recommendation

I recommend publishing Strands WASM as written. This greatly simplifies the contribution model of the SDK's, and the development of the development CLI. Rather than making many small PR's across many repositories, all with 2 approver requirements, a feature owner can push a single PR, and get batch approval for every SDK.

## TypeScript SDK ownership

The TS SDK currently lives in `strands-agents/sdk-typescript`. This repo consumes it as a git subtree. The question is whether TS development should move into this repo permanently.

### Separate repositories

The TS SDK stays in its own repo. This repo imports it as a dependency or subtree.

**Pros**

- TS team keeps their existing workflow and CI.
- TS repo has its own stars, issues, and contributor community.

**Cons**

- The TS SDK cannot use WIT-generated type declarations. Types that cross the WASM boundary must be defined independently in both the WIT contract and the TS SDK, with no compile-time check that they agree.
- The TS SDK cannot be tested against the WASM component. A TS change that breaks the bridge is not discovered until someone manually integrates it.
- Cross-cutting changes (new stream event types, new lifecycle hooks, new model config fields) require coordinated releases across repos. The TS release must ship before the monorepo can consume it.
- Lockstep versioning requires releasing the TS SDK and the monorepo in sync, which means coordinating two CI pipelines, two changelogs, and two approval chains for every release.

### Move TS into this repo

The TS SDK becomes a directory in the monorepo. `strands-agents/sdk-typescript` becomes a mirror or archive.

**Pros**

- WIT-generated type declarations can be shared. The TS SDK imports from `strands-ts/generated/` which is produced from `wit/agent.wit`. If the contract changes and the TS types don't match, the build fails.
- A TS change and its WASM bridge update land in one PR. CI validates the full pipeline (TS → WASM → Rust → Python) on every change.
- One release process. Lockstep versioning is enforced by the build, not by cross-repo coordination.
- The dev CLI already orchestrates TS builds, tests, and linting. No tooling changes needed.

**Cons**

- The upstream `sdk-typescript` repo loses its independent community presence. Stars, issues, and PR history would need to migrate or be archived.
- TS contributors see Rust, Python, and Kotlin code in the same repo.
- PR reviews for bridge-touching changes require cross-language awareness.

### Recommendation

Move TS development into this repo. The inability to share WIT-generated types and the inability to test TS changes against the WASM pipeline are the deciding factors. Separate repos means separate releases, manual integration, and type drift with no compile-time safety net. The community cost of archiving `sdk-typescript` is real but manageable. The repo redirects to the monorepo and existing contributors follow.

## Potential breaking changes

Changes we could make that would simplify the codebase but break upstream Python SDK compatibility. Each needs a decision before the 2.0 release.

### Drop Bedrock dict format from stream_async

`event_to_dict` in `_conversions.py` fabricates Bedrock raw API dicts (`{"event": {"contentBlockDelta": {"delta": {"text": "..."}}}}`) from WIT stream events. This exists because the upstream Python SDK's streaming API yields Bedrock's raw converse-stream format directly, and we need to match that for compatibility.

Neither the TS SDK nor the WIT contract produce this format. It's manufactured in the Python wrapper purely to match upstream expectations.

If we yield WIT stream events directly from `stream_async()` (objects with `.kind`, `.text_delta`, `.tool_use`, etc.), we delete `event_to_dict` and its 80 lines of dict construction.

**Merits:** eliminates a fabrication layer, stream events are typed objects instead of untyped dicts, consistent with what every other language wrapper sees, eliminates a Bedrock-specific format from a model-agnostic streaming API.

**Cost:** any user code that iterates `stream_async()` and reads `chunk["event"]["contentBlockDelta"]` breaks.

### Drop message format conversion

`convert_message` in `_conversions.py` translates messages from TS SDK format (`{"type": "textBlock", "text": "..."}`) to upstream Python SDK format (`{"text": "..."}`). The TS SDK uses typed blocks with a `type` discriminator. The upstream Python SDK uses untyped dicts without a `type` field, using the presence of keys (`text`, `toolUse`, `toolResult`) as implicit discriminators.

This runs on every `agent.messages` access.

If we adopt the TS block format, we delete `convert_message` and `_convert_block`. Users who access `agent.messages` and expect upstream Python SDK keys would need to update.

**Merits:** eliminates a per-message translation layer, message format matches what the TS runtime produces, typed blocks are less ambiguous than key-presence discrimination.

**Cost:** any user code that reads `msg["content"][i]["toolUse"]` instead of checking `msg["content"][i]["type"] == "toolUseBlock"` breaks.

### Adopt WIT stop reason format

`stop_reason_to_snake` converts WIT stop reasons from kebab-case (`end-turn`) to snake_case (`end_turn`). The upstream Python SDK uses snake_case. The TS SDK and WIT use kebab-case.

If we adopt kebab-case, we delete the conversion and `stop_reason` values match what the WIT contract and TS SDK produce.

**Merits:** one fewer conversion, consistent with WIT and TS SDK.

**Cost:** any user code that checks `result.stop_reason == "end_turn"` breaks. Would need `result.stop_reason == "end-turn"`.

### Flatten the Python package

The upstream Python SDK has 31 `.py` files across 8 nested directories. The polyglot wrapper mirrors this structure for import compatibility, but the files are much smaller. Most are under 100 lines, many `__init__.py` files exist only to make directories importable.

The upstream import surface is deep:

```python
from strands.models.bedrock import BedrockModel
from strands.session.file_session_manager import FileSessionManager
from strands.tools.mcp.mcp_client import MCPClient
from strands.types.content import Messages, ContentBlock, Message
from strands.types.exceptions import MaxTokensReachedException
from strands.agent.conversation_manager.sliding_window_conversation_manager import SlidingWindowConversationManager
from strands.multiagent.graph import GraphBuilder
from strands.experimental.bidi.agent.agent import BidiAgent
```

These paths encode internal package structure into the public API. Users must know that `FileSessionManager` lives in `strands.session.file_session_manager`, not `strands.session` or `strands`.

Two changes, independent of each other:

**1. Flatten the file tree.** Collapse the 8 nested directories into flat modules. `models/` (5 files, 4 under 70 lines each) becomes `models.py`. `types/` (3 small dataclass files) becomes `types.py`. `session/` (2 stub managers) becomes `session.py`. `tools/mcp/` (2 files) becomes `mcp.py`. `_conversions.py` folds into `agent.py` since nothing else imports it. Result: ~11 files instead of 31, no nested directories except `_generated/`.

**2. Flatten imports.** Re-export everything from `strands/__init__.py` so users can write `from strands import Agent, BedrockModel, MCPClient`. The internal file layout becomes an implementation detail that can change without breaking user code.

These can be done together or separately. Flattening the file tree without flattening imports preserves the existing import paths (via re-exports from the old module locations). Flattening imports without flattening files is just adding re-exports to `__init__.py`.

**Merits:** fewer files to navigate, no `__init__.py` boilerplate, `from strands import X` works for everything, internal refactors don't break user code, new contributors see the whole wrapper without exploring subdirectories.

**Cost:** existing deep import paths break. Migration is mechanical (find-and-replace).
