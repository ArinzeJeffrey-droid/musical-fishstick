# Payment Instruction Parser

A REST API that parses payment instructions, validates them against business rules, and executes transactions on provided accounts.

## Overview

This project implements a payment instruction parser that supports two instruction formats:
- **DEBIT format**: `DEBIT [amount] [currency] FROM ACCOUNT [account_id] FOR CREDIT TO ACCOUNT [account_id] [ON [date]]`
- **CREDIT format**: `CREDIT [amount] [currency] TO ACCOUNT [account_id] FOR DEBIT FROM ACCOUNT [account_id] [ON [date]]`

## Features

- ✅ Parse payment instructions without regex (string manipulation only)
- ✅ Validate business rules (currency matching, sufficient funds, etc.)
- ✅ Execute transactions or schedule for future dates
- ✅ Case-insensitive keyword parsing
- ✅ Comprehensive error handling with specific status codes
- ✅ Support for NGN, USD, GBP, and GHS currencies

## Getting Started

### Prerequisites

- Node.js 14+ 
- npm

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd node-template
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (or use the existing one):
```env
PORT=3000
APP_BASE_URL=http://localhost:3000
APP_NAME=PaymentInstructionParser
PINO_LOG_LEVEL=info
SHOW_RAW_HEADERS=false
LOG_APP_REQUEST=true
NO_SINGLE_ERRORS=false
TOP_LEVEL_ERROR_MESSAGE=Validation error
```

4. Start the server:
```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoint

### POST `/payment-instructions`

Process a payment instruction.

**Request Body:**
```json
{
  "accounts": [
    {"id": "a", "balance": 230, "currency": "USD"},
    {"id": "b", "balance": 300, "currency": "USD"}
  ],
  "instruction": "DEBIT 30 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b"
}
```

**Success Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "type": "DEBIT",
    "amount": 30,
    "currency": "USD",
    "debit_account": "a",
    "credit_account": "b",
    "execute_by": null,
    "status": "successful",
    "status_reason": "Transaction executed successfully",
    "status_code": "AP00",
    "accounts": [
      {
        "id": "a",
        "balance": 200,
        "balance_before": 230,
        "currency": "USD"
      },
      {
        "id": "b",
        "balance": 330,
        "balance_before": 300,
        "currency": "USD"
      }
    ]
  }
}
```

**Error Response (HTTP 400):**
```json
{
  "status": "success",
  "data": {
    "type": "DEBIT",
    "amount": 30,
    "currency": "EUR",
    "debit_account": "a",
    "credit_account": "b",
    "execute_by": null,
    "status": "failed",
    "status_reason": "Unsupported currency. Only NGN, USD, GBP, and GHS are supported",
    "status_code": "CU02",
    "accounts": [...]
  }
}
```

## Testing

Use curl or any HTTP client to test:

```bash
# Test successful transaction
curl http://localhost:3000/payment-instructions \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": [
      {"id": "a", "balance": 230, "currency": "USD"},
      {"id": "b", "balance": 300, "currency": "USD"}
    ],
    "instruction": "DEBIT 30 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b"
  }'

# Test with future date (pending transaction)
curl http://localhost:3000/payment-instructions \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": [
      {"id": "acc-001", "balance": 1000, "currency": "NGN"},
      {"id": "acc-002", "balance": 500, "currency": "NGN"}
    ],
    "instruction": "CREDIT 300 NGN TO ACCOUNT acc-002 FOR DEBIT FROM ACCOUNT acc-001 ON 2026-12-31"
  }'

# Test currency mismatch error
curl http://localhost:3000/payment-instructions \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": [
      {"id": "a", "balance": 100, "currency": "USD"},
      {"id": "b", "balance": 500, "currency": "GBP"}
    ],
    "instruction": "DEBIT 50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b"
  }'
```

## Status Codes

| Code | Description |
|------|-------------|
| AP00 | Transaction executed successfully |
| AP02 | Transaction scheduled for future execution |
| AM01 | Amount must be a positive integer |
| CU01 | Account currency mismatch |
| CU02 | Unsupported currency |
| AC01 | Insufficient funds in debit account |
| AC02 | Debit and credit accounts cannot be the same |
| AC03 | Account not found |
| AC04 | Invalid account ID format |
| DT01 | Invalid date format |
| SY01 | Missing required keyword |
| SY02 | Invalid keyword order |
| SY03 | Malformed instruction |

## Project Structure

```
├── app.js                           # Main application entry point
├── package.json                     # Dependencies and scripts
├── .env                             # Environment configuration
├── Procfile                         # Heroku deployment config
│
├── endpoints/
│   └── payment-instructions/
│       └── process.js               # API endpoint handler
│
├── services/
│   └── payment-processor/
│       └── parse-instruction.js     # Main parsing and business logic
│
├── messages/
│   ├── index.js
│   └── payment.js                   # Error messages
│
├── middlewares/                     # Middleware support
│
└── core/                            # Core framework modules
    ├── express/                     # Web server
    ├── errors/                      # Error handling
    ├── logger/                      # Logging system
    ├── security/                    # Security utilities
    └── validator-vsl/               # Input validation
```
