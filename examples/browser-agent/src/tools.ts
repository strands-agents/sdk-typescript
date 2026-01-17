import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

export const updateCanvasTool = tool({
    name: 'update_canvas',
    description: 'Update the style and content of the canvas element on the page',
    inputSchema: z.object({
        backgroundColor: z.string().optional().describe('CSS color for the background'),
        textColor: z.string().optional().describe('CSS color for the text'),
        text: z.string().optional().describe('Text content to display'),
        borderRadius: z.string().optional().describe('CSS border radius value (e.g., "50%" for circle, "0" for square)'),
        borderColor: z.string().optional().describe('CSS color for the border'),
        width: z.string().optional().describe('CSS width (e.g., "200px")'),
        height: z.string().optional().describe('CSS height (e.g., "200px")'),
        style: z.record(z.string()).optional().describe('JSON object containing CSS properties to apply to the canvas element (e.g. {"backgroundColor": "red", "fontSize": "20px"}). This allows you to set any CSS property.'),
    }),
    callback: async (input: any) => {
        const canvas = document.getElementById('canvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }

        const updates: string[] = [];

        // Apply specific properties if provided
        if (input.backgroundColor) {
            canvas.style.backgroundColor = input.backgroundColor;
            updates.push(`background=${input.backgroundColor}`);
        }
        if (input.textColor) {
            canvas.style.color = input.textColor;
            updates.push(`color=${input.textColor}`);
        }
        if (input.text) {
            canvas.innerText = input.text;
            updates.push(`text="${input.text}"`);
        }
        if (input.borderRadius) {
            canvas.style.borderRadius = input.borderRadius;
            updates.push(`borderRadius=${input.borderRadius}`);
        }
        if (input.borderColor) {
            canvas.style.borderColor = input.borderColor;
            updates.push(`borderColor=${input.borderColor}`);
        }
        if (input.width) {
            canvas.style.width = input.width;
            updates.push(`width=${input.width}`);
        }
        if (input.height) {
            canvas.style.height = input.height;
            updates.push(`height=${input.height}`);
        }

        // Apply raw styles if provided
        if (input.style) {
            Object.assign(canvas.style, input.style);
            updates.push(`styleObject=${JSON.stringify(input.style)}`);
        }

        if (updates.length === 0) {
            return "No changes made.";
        }

        return `Canvas updated with: ${updates.join(', ')}`;
    },
});
