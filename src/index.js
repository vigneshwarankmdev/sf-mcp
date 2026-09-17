import { createServer as createNodeHttpServer } from 'node:http';
import { Readable } from 'node:stream';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import jsforce from 'jsforce';
import * as z from 'zod/v4';

const SALESFORCE_INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL || 'https://<ORG>.sandbox.my.salesforce.com';
const SALESFORCE_SESSION_ID = process.env.SALESFORCE_SESSION_ID || '';
const SALESFORCE_API_VERSION = process.env.SALESFORCE_API_VERSION || '61.0';
const SERVER_HOST = process.env.HOST || '0.0.0.0';
const SERVER_PORT = Number.parseInt(process.env.PORT || '3000', 10);

const DEFAULT_SENT_MESSAGE_VALUES = {
  AZ_Country_Code__c: 'US',
  AZ_Direction__c: 'outbound-api',
  AZ_Message_Body__c: 'Hi Dr. Teffau! Be on the lookout for an email from me on an exciting NASCAR race taking place on Fox this Sunday, March 31st at 7 PM EST! Looking forward to sharing the details and hope you’re able to watch:)\n\nReply STOP to Opt Out. MsgFreqMayVary.',
  Status_vod__c: 'Saved_AZ',
  AZ_To_Number__c: '+918300661992'
};

const DEFAULT_REFERENCE_VALUES = {
  Account_vod__c: '0010P000022xC7WQAU',
  RecordTypeId: '0124U000000omlrQAA',
  Template_vod__c: 'a1n4U000007QzLcQAK'
};

function ensureConfigured() {
  if (!SALESFORCE_SESSION_ID || SALESFORCE_SESSION_ID === 'PASTE_SALESFORCE_SESSION_ID_HERE') {
    throw new Error('Populate SALESFORCE_SESSION_ID in src/index.js before calling Salesforce tools.');
  }

  if (!SALESFORCE_INSTANCE_URL.startsWith('https://')) {
    throw new Error('Populate SALESFORCE_INSTANCE_URL in src/index.js with a valid Salesforce base URL.');
  }
}

function createConnection() {
  ensureConfigured();

  return new jsforce.Connection({
    instanceUrl: SALESFORCE_INSTANCE_URL,
    accessToken: SALESFORCE_SESSION_ID,
    version: SALESFORCE_API_VERSION
  });
}

function buildSentMessagePayload(input) {
  return {
    ...DEFAULT_SENT_MESSAGE_VALUES,
    ...DEFAULT_REFERENCE_VALUES,
    Account_vod__c: input.accountId || DEFAULT_REFERENCE_VALUES.Account_vod__c,
    RecordTypeId: DEFAULT_REFERENCE_VALUES.RecordTypeId,
    Template_vod__c: DEFAULT_REFERENCE_VALUES.Template_vod__c,
    AZ_Message_Body__c: input.messageBody || DEFAULT_SENT_MESSAGE_VALUES.AZ_Message_Body__c,
    AZ_To_Number__c: input.toNumber || DEFAULT_SENT_MESSAGE_VALUES.AZ_To_Number__c,
    AZ_Direction__c: DEFAULT_SENT_MESSAGE_VALUES.AZ_Direction__c,
    Status_vod__c: DEFAULT_SENT_MESSAGE_VALUES.Status_vod__c
  };
}

export function createServer() {
  const server = new McpServer({
    name: 'salesforce-sent-message-server',
    version: '1.0.0'
  });

  server.registerTool(
    'create_sent_message_record',
    {
      description: 'Create a Sent_Message_vod__c record in Salesforce using the configured environment variables.',
      inputSchema: z.object({
        accountId: z.string().optional(),
        messageBody: z.string().optional(),
        toNumber: z.string().optional()
      })
    },
    async (input) => {
      const conn = createConnection();
      const payload = buildSentMessagePayload(input);
      const result = await conn.sobject('Sent_Message_vod__c').create(payload);

      if (!result.success) {
        const errorMessages = Array.isArray(result.errors) ? result.errors.join('; ') : 'Unknown Salesforce error';
        throw new Error(`Salesforce create failed: ${errorMessages}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                id: result.id,
                object: 'Sent_Message_vod__c',
                payload
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    'get_accounts',
    {
      description: 'Fetch up to 10 Salesforce Account records for testing.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).optional(),
        nameLike: z.string().optional()
      })
    },
    async ({ limit = 10, nameLike }) => {
      const conn = createConnection();
      const safeLimit = Math.min(limit, 10);
      const filter = nameLike ? ` WHERE ispersonAccount = true AND Name LIKE '%${nameLike.replace(/'/g, "\\'")}%'` : ' WHERE ispersonAccount = true';
      const query = `SELECT Id, Name, Phone, PersonMobilePhone, OwnerId FROM Account${filter} ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
      const result = await conn.query(query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                totalSize: result.totalSize,
                done: result.done,
                records: result.records
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  return server;
}

async function toWebRequest(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || `localhost:${SERVER_PORT}`;
  const url = new URL(req.url || '/', `${protocol}://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRequestBody(req);

  return new Request(url, {
    method: req.method,
    headers,
    body
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined);
    });

    req.on('error', reject);
  });
}

async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const bodyStream = Readable.fromWeb(response.body);
  bodyStream.on('error', (error) => {
    console.error(error);
    if (!res.writableEnded) {
      res.end();
    }
  });
  bodyStream.pipe(res);
}

export async function mainStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function mainHttp() {
  const handler = createMcpHandler(() => createServer(), { legacy: 'reject' });

  const server = createNodeHttpServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end('Missing request URL');
        return;
      }

      if (req.url === '/' || req.url.startsWith('/health')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', endpoint: '/mcp' }));
        return;
      }

      if (!req.url.startsWith('/mcp')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const request = await toWebRequest(req);
      const response = await handler.fetch(request);
      await writeNodeResponse(res, response);
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown server error' }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(SERVER_PORT, SERVER_HOST, () => {
      server.off('error', reject);
      console.error(`Salesforce MCP HTTP server listening on http://${SERVER_HOST}:${SERVER_PORT}/mcp`);
      resolve();
    });
  });
}

export async function main(mode = process.argv[2] || process.env.MCP_TRANSPORT || 'http') {
  if (mode === 'stdio') {
    await mainStdio();
    return;
  }

  await mainHttp();
}

const isEntrypoint = process.argv[1] && new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href === import.meta.url;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}