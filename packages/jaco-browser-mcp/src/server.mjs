#!/usr/bin/env node
// jaco-browser-mcp: an MCP server (stdio) that lets an AI agent use a real Chrome browser safely.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createBrowser } from './browser.mjs';

const port = Number(process.env.JACO_CDP_PORT || 9222);
const browser = createBrowser({ port });
const server = new McpServer({ name: 'jaco-browser-mcp', version: '0.1.0' });

const reply = async fn => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await fn(), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: String(error?.message || error) }] }; }
};
const KEYS = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space'];
const keyName = key => (key === 'Space' ? ' ' : key);

server.registerTool('browser_open', {
  title: 'Open a page',
  description: 'Open a web page in a new tab of a separate browser profile and return its title, text and the names of its links and buttons. Sign-in and payment pages are refused.',
  inputSchema: { url: z.string().describe('An http or https address') },
  annotations: { readOnlyHint: false, openWorldHint: true },
}, ({ url }) => reply(() => browser.open(url)));

server.registerTool('browser_read', {
  title: 'Read the current page',
  description: 'Return the current page: address, title, readable text and the names of its links and buttons.',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
}, () => reply(() => browser.read()));

server.registerTool('browser_click', {
  title: 'Click a link or button',
  description: 'Click with a real mouse event. Give the name as it reads on the page (from browser_read); a miss returns the names that are there. The result says where the page went, so you can check it.',
  inputSchema: {
    name: z.string().optional().describe('The visible name of the link or button'),
    selector: z.string().optional().describe('A CSS selector, if you know one'),
    expect: z.object({ url: z.string().optional(), selector: z.string().optional() }).optional().describe('What should appear after the click, if you know'),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
}, args => reply(() => browser.click(args)));

server.registerTool('browser_type', {
  title: 'Type into a field',
  description: 'Type text into a field with real key events and check that it arrived. Password fields are refused.',
  inputSchema: { name: z.string().optional().describe('The field label or placeholder'), selector: z.string().optional(), text: z.string() },
  annotations: { readOnlyHint: false, openWorldHint: true },
}, args => reply(() => browser.type(args)));

server.registerTool('browser_press', {
  title: 'Press a key',
  description: 'Press a key on the current page, for example Enter to submit a search.',
  inputSchema: { key: z.enum(KEYS), modifiers: z.array(z.enum(['alt', 'ctrl', 'meta', 'shift'])).optional() },
  annotations: { readOnlyHint: false, openWorldHint: true },
}, ({ key, modifiers }) => reply(() => browser.press({ key: keyName(key), modifiers })));

server.registerTool('browser_tabs', {
  title: 'List tabs',
  description: 'List the tabs this server opened. Your own tabs are never shown or touched.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, () => reply(() => browser.tabs()));

server.registerTool('browser_switch_tab', {
  title: 'Switch tab',
  description: 'Switch to one of the tabs this server opened and read it.',
  inputSchema: { id: z.string() },
  annotations: { readOnlyHint: true },
}, ({ id }) => reply(() => browser.switchTab(id)));

server.registerTool('browser_close_tab', {
  title: 'Close tab',
  description: 'Close one of the tabs this server opened.',
  inputSchema: { id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, ({ id }) => reply(() => browser.closeTab(id)));

await server.connect(new StdioServerTransport());
