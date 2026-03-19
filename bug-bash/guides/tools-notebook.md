# Tools - Notebook

A vended tool for managing text notebooks. The agent can create, read, update, and delete entries. Import from `@strands-agents/sdk/vended-tools/notebook`.

Templates: [tools-notebook.ts](../templates/tools-notebook.ts)

---

## CRUD operations

- Create, read, update, and delete notebook entries
- Use the tool across multiple turns, verify state persists
- Multiple notebooks in the same session

Watch for: Does the model use the tool correctly based on the description? Is notebook state consistent across turns?
