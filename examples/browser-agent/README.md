# Browser Agent Example

This example demonstrates how to run the Strands Agent directly in a browser environment using Vite.

The agent uses the OpenAI model provider (via API Key) and has access to a tool (`update_canvas`) that allows it to modify the DOM elements on the page.

## Prerequisites

- Node.js 20+
- An OpenAI API Key (you will be prompted to enter this in the browser)

## Setup

1. Install dependencies from the root of the repo:
   ```bash
   npm install
   ```

## Running the Example

1. Navigate to this directory:
   ```bash
   cd examples/browser-agent
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open the URL shown in the terminal (usually `http://localhost:5173`).

4. Enter your OpenAI API Key when prompted.

5. Interact with the agent! Try commands like:
   - "Change the background color to soft blue"
   - "Make the canvas a circle"
   - "Change the text to Hello Strands!"
