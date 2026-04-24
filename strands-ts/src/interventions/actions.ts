export type Proceed = { type: 'proceed'; reason?: string }
export type Deny = { type: 'deny'; reason: string }
export type Guide = { type: 'guide'; feedback: string; reason?: string }
export type Interrupt = { type: 'interrupt'; prompt: string; reason?: string }

export type InterventionAction = Proceed | Deny | Guide | Interrupt
