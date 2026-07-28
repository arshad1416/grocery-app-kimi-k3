# Alexa Skill — GroceryApp

This directory contains the Alexa Skill configuration and Lambda handler for the GroceryApp voice interface.

## Architecture

The Alexa Skill uses **account linking** to connect Alexa users to their GroceryApp account. All requests are forwarded to the **relay server** (`/api/alexa/*` endpoints), which authenticates via OAuth2 access token and proxies operations to the Yjs shared document.

### Intents

| Intent | Sample Utterance | Action |
|--------|-----------------|--------|
| `AddItemIntent` | "Alexa, add milk to my grocery list" | Adds item to the user's active list |
| `GetListIntent` | "Alexa, what's on my grocery list?" | Reads the current list (up to 10 items) |
| `CheckOffIntent` | "Alexa, mark eggs as done" | Marks an item as checked/completed |

### Support for Natural Quantities

The skill's interaction model includes slots for `ItemName` (AMAZON.Food), `Quantity` (AMAZON.NUMBER), and `Unit` (AMAZON.Unit). Alexa's built-in entity resolution handles common variations like:

- "a dozen eggs" → Quantity: 12, ItemName: eggs
- "2 litres of milk" → Quantity: 2, Unit: litres, ItemName: milk
- "half a kilo of chicken" → Alexa sends raw utterance, NLP on relay processes it

## Deployment

### Option 1: ASK CLI (Recommended)

1. Install ASK CLI:
   ```bash
   npm install -g ask-cli
   ask configure
   ```

2. Deploy the skill:
   ```bash
   cd alexa-skill
   ask deploy
   ```

3. The Lambda function will be created automatically by ASK CLI.

### Option 2: Manual Lambda Upload

1. Create a Lambda function in AWS Console:
   - Runtime: Node.js 18+
   - Role: Basic Lambda execution role
   - Handler: `index.handler`

2. Zip and upload:
   ```bash
   cd alexa-skill
   npm install
   zip -r ../alexa-skill.zip . -x node_modules/ask-sdk/node_modules/
   aws lambda update-function-code --function-name GroceryAppAlexaSkill --zip-file fileb://../alexa-skill.zip
   ```

3. Configure environment variables:
   - `RELAY_BASE_URL` — URL of your relay server (e.g., `https://relay.example.com`)

### Option 3: ASK + AWS SAM

For production deployments with CI/CD, use the SAM template:

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Resources:
  GroceryAppAlexaSkill:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: ./alexa-skill
      Handler: index.handler
      Runtime: nodejs18.x
      Environment:
        Variables:
          RELAY_BASE_URL: !Ref RelayBaseUrl
Parameters:
  RelayBaseUrl:
    Type: String
```

## Account Linking Setup

The skill uses OAuth2 Authorization Code Grant for account linking.

### Configuration in Alexa Developer Console

1. Go to the **Account Linking** tab in your skill configuration.
2. Set **Authorization URL**: `https://relay.yourdomain.com/oauth/authorize`
3. Set **Access Token URL**: `https://relay.yourdomain.com/oauth/token`
4. Set **Client ID**: `alexa-groceryapp-skill`
5. Set **Scopes**: `grocery:read grocery:write`
6. Set redirect URI in your relay server to: `https://pitangui.amazon.com/api/skill/link/XXXXXXXXX`

### Relay Server Endpoints

The relay server must implement the following endpoints:

- `POST /api/alexa/add-item` — Add item to grocery list
- `POST /api/alexa/get-list` — Get current grocery list
- `POST /api/alexa/check-off` — Check off an item

All endpoints expect `Authorization: Bearer <accessToken>` header.

## Local Development

For local testing without deploying to AWS:

1. Start your relay server locally
2. Use the Alexa Simulator in the Alexa Developer Console
3. Set `RELAY_BASE_URL` to your ngrok tunnel URL

## Files

| File | Purpose |
|------|---------|
| `index.js` | Lambda handler with all intent handlers |
| `interaction-model.json` | Alexa interaction model (en-US) |
| `skill.json` | Skill manifest with account linking config |
| `package.json` | Dependencies (ASK SDK v2, Axios) |
| `README.md` | This file |