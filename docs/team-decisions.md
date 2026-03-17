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
