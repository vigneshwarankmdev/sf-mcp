# Salesforce MCP Server

This project exposes two MCP tools:

- `create_sent_message_record`: creates a `Sent_Message_vod__c` record in Salesforce.
- `get_accounts`: fetches up to 10 `Account` records.

The app now supports two transports:

- HTTP at `/mcp` for Azure App Service and remote clients.
- stdio for local VS Code MCP and Inspector workflows.

## Configuration

Set these environment variables instead of hardcoding values in source:

- `SALESFORCE_INSTANCE_URL`
- `SALESFORCE_SESSION_ID`
- `SALESFORCE_API_VERSION`
- `PORT` for HTTP hosting
- `HOST` if you do not want the default `0.0.0.0`

PowerShell example:

```powershell
$env:SALESFORCE_INSTANCE_URL = 'https://azna--usfull.sandbox.my.salesforce.com'
$env:SALESFORCE_SESSION_ID = 'paste-session-id-here'
$env:SALESFORCE_API_VERSION = '61.0'
```

## Local Run

- HTTP mode: `npm start`
- stdio mode: `npm run start:stdio`
- Health check: `http://localhost:3000/health`
- MCP endpoint: `http://localhost:3000/mcp`

For VS Code local MCP or Inspector config files, this repo keeps stdio entries in [.vscode/mcp.json](.vscode/mcp.json) and [mcp.json](mcp.json).

## Azure App Service

Use App Service to run `npm start`. Configure these application settings in the App Service resource:

- `SALESFORCE_INSTANCE_URL`
- `SALESFORCE_SESSION_ID`
- `SALESFORCE_API_VERSION`
- `PORT` is provided by App Service automatically in most Node hosting flows

After deployment, your MCP endpoint will be:

- `https://<app-name>.azurewebsites.net/mcp`

Recommended App Service setup:

- Runtime: Node.js 20+
- Startup command: `npm start`
- Health probe path: `/health`

## Render.com

This repo now includes [render.yaml](render.yaml) for Render Blueprint deployment.

Render service settings:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Public MCP endpoint after deploy: `https://<your-render-service>.onrender.com/mcp`

Environment variables on Render:

- `SALESFORCE_INSTANCE_URL`
- `SALESFORCE_SESSION_ID`
- `SALESFORCE_API_VERSION`

How to deploy on Render:

1. Push this repository to GitHub.
2. In Render, create a new Blueprint or Web Service from that repository.
3. If you use Blueprint deploy, Render reads [render.yaml](render.yaml) automatically.
4. When prompted, provide the secret value for `SALESFORCE_SESSION_ID`.
5. Deploy the service.
6. After deploy, use `https://<your-render-service>.onrender.com/health` to verify it is live.
7. Use `https://<your-render-service>.onrender.com/mcp` as the MCP endpoint.

Notes for Render:

- Render injects `PORT`, so the app binds automatically.
- Keep `SALESFORCE_SESSION_ID` as a secret in the Render dashboard and do not commit it.
- If your service sleeps on the free plan, the first request can be slow.

## Notes

- The `create_sent_message_record` tool uses the field values you requested as defaults and hardcoded values where specified.
- System-managed and calculated Salesforce fields are intentionally omitted from create payloads.
- The current Salesforce session token should be rotated if it was ever committed or shared outside a private local test.