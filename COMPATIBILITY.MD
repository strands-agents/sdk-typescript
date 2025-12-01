# Compatibility Policy

This document outlines the Strands TypeScript SDK's policy on changes that are **not considered breaking changes** under semantic versioning. Understanding these policies helps you anticipate how the SDK may evolve without requiring major version bumps.

## Field to Getter/Setter Conversion

Converting a public mutable field to a property with getter/setter methods **is not considered a breaking change**, even when adding validation or side effects.

### Policy

The SDK may convert public mutable fields to getter/setter properties in minor or patch releases. This includes adding:
- Validation logic that throws errors for invalid values
- Side effects during assignment (logging, notifications, state updates)
- Computed or transformed values in getters

### Rationale

In TypeScript and JavaScript, getter/setter properties are syntactically and behaviorally identical to direct field access from the consumer's perspective:

```typescript
// Before: Direct field access
agent.model = newModel
const currentModel = agent.model

// After: Getter/setter (identical usage)
agent.model = newModel  // Calls setter
const currentModel = agent.model  // Calls getter
```

Consumers cannot distinguish between direct field access and property access at the call site. The implementation change is transparent to user code.

### Example

The `Agent.model` property is currently a public mutable field. In a future release, it may be converted to a getter/setter to add validation:

```typescript
// Current implementation (field)
public model: Model<BaseModelConfig>

// Possible future implementation (getter/setter with validation)
private _model: Model<BaseModelConfig>
public get model(): Model<BaseModelConfig> {
  return this._model
}
public set model(value: Model<BaseModelConfig>) {
  if (!value) {
    throw new Error('Model cannot be null or undefined')
  }
  this._model = value
}
```

User code remains unchanged and continues to work as before.

## Feedback

If you have questions or concerns about this compatibility policy, please [open an issue](https://github.com/strands-agents/sdk-typescript/issues) on GitHub.
