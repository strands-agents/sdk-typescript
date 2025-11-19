// This file assumes that its run from an environment that already has github and core imported:
// const github = require('@actions/github');
// const core = require('@actions/core');

const fs = require('fs');

async function getIssueInfo(github, context, inputs) {
  const issueId = context.eventName === 'workflow_dispatch' 
    ? inputs.issue_id
    : context.payload.issue.number.toString();
  const command = context.eventName === 'workflow_dispatch'
    ? inputs.command
    : (context.payload.comment.body.match(/^\/strands\s*(.*)$/)?.[1]?.trim() || '');

  console.log(`Event: ${context.eventName}, Issue ID: ${issueId}, Command: "${command}"`);

  const issue = await github.rest.issues.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueId
  });

  return { issueId, command, issue };
}

async function determineBranch(github, context, issueId, mode, isPullRequest) {
  let branchName = 'main';

  if (mode === 'implementer' && !isPullRequest) {
    branchName = `agent-tasks/${issueId}`;
    
    const mainRef = await github.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: 'heads/main'
    });
    
    try {
      await github.rest.git.createRef({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: `refs/heads/${branchName}`,
        sha: mainRef.data.object.sha
      });
      console.log(`Created branch ${branchName}`);
    } catch (error) {
      if (error.status === 422 || error.message?.includes('already exists')) {
        console.log(`Branch ${branchName} already exists`);
      } else {
        throw error;
      }
    }
  } else if (isPullRequest) {
    const pr = await github.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: issueId
    });
    branchName = pr.data.head.ref;
  }

  return branchName;
}

function buildPrompts(mode, issueId, isPullRequest, command, branchName, inputs) {
  const sessionId = inputs.session_id || (mode === 'implementer' 
    ? `${mode}-${branchName}`.replace(/[\/\\]/g, '-')
    : `${mode}-${issueId}`);

  const scriptFile = mode === 'implementer' 
    ? '.github/agent-sops/task-implementer.sop.md'
    : '.github/agent-sops/task-refiner.sop.md';
  
  const systemPrompt = fs.readFileSync(scriptFile, 'utf8');
  
  let prompt = (isPullRequest) 
    ? 'The pull request id is:'
    : 'The issue id is:';
  prompt += `${issueId}\n${command}\nreview and continue`;

  return { sessionId, systemPrompt, prompt };
}

module.exports = async (context, github, core, inputs) => {
  try {
    const { issueId, command, issue } = await getIssueInfo(github, context, inputs);
    
    const isPullRequest = !!issue.data.pull_request;
    const mode = (isPullRequest || command.startsWith('implement')) ? 'implementer' : 'refiner';
    console.log(`Is PR: ${isPullRequest}, Mode: ${mode}`);

    const branchName = await determineBranch(github, context, issueId, mode, isPullRequest);
    console.log(`Building prompts - mode: ${mode}, issue: ${issueId}, is PR: ${isPullRequest}`);

    const { sessionId, systemPrompt, prompt } = buildPrompts(mode, issueId, isPullRequest, command, branchName, inputs);
    
    console.log(`Session ID: ${sessionId}`);
    console.log(`Task prompt: "${prompt}"`);

    core.setOutput('branch_name', branchName);
    core.setOutput('session_id', sessionId);
    core.setOutput('system_prompt', systemPrompt);
    core.setOutput('prompt', prompt);

  } catch (error) {
    const errorMsg = `Failed: ${error.message}`;
    console.error(errorMsg);
    core.setFailed(errorMsg);
  }
};
