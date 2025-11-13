const validator = require('@app-core/validator');
const { appLogger } = require('@app-core/logger');
const { PaymentMessages } = require('@app/messages');

// Define validation spec for the service input
const spec = `root {
  accounts[] {
    id string
    balance number
    currency string
  }
  instruction string
}`;

// Parse the spec once (outside the function)
const parsedSpec = validator.parse(spec);

// Supported currencies
const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS'];

// Status codes
const STATUS_CODES = {
  AM01: 'AM01', // Amount validation
  CU01: 'CU01', // Currency mismatch
  CU02: 'CU02', // Unsupported currency
  AC01: 'AC01', // Insufficient funds
  AC02: 'AC02', // Same account
  AC03: 'AC03', // Account not found
  AC04: 'AC04', // Invalid account ID format
  DT01: 'DT01', // Invalid date format
  SY01: 'SY01', // Missing keyword
  SY02: 'SY02', // Invalid keyword order
  SY03: 'SY03', // Malformed instruction
  AP00: 'AP00', // Success
  AP02: 'AP02', // Pending
};

/**
 * Validates account ID format (letters, numbers, hyphens, periods, @ symbols only)
 * @param {string} accountId - The account ID to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function isValidAccountId(accountId) {
  // Check if account ID contains only allowed characters
  for (let i = 0; i < accountId.length; i += 1) {
    const char = accountId[i];
    const isLetter = (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
    const isNumber = char >= '0' && char <= '9';
    const isAllowedSpecial = char === '-' || char === '.' || char === '@';

    if (!isLetter && !isNumber && !isAllowedSpecial) {
      return false;
    }
  }
  return accountId.length > 0;
}

/**
 * Validates date format (YYYY-MM-DD) and checks if it's a valid date
 * @param {string} dateStr - The date string to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function isValidDate(dateStr) {
  if (!dateStr || dateStr.length !== 10) return false;

  // Check format manually: YYYY-MM-DD
  if (dateStr[4] !== '-' || dateStr[7] !== '-') return false;

  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(5, 7);
  const day = dateStr.substring(8, 10);

  // Check if all parts are numeric
  for (let i = 0; i < year.length; i += 1) {
    if (year[i] < '0' || year[i] > '9') return false;
  }
  for (let i = 0; i < month.length; i += 1) {
    if (month[i] < '0' || month[i] > '9') return false;
  }
  for (let i = 0; i < day.length; i += 1) {
    if (day[i] < '0' || day[i] > '9') return false;
  }

  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);

  // Basic range checks
  if (monthNum < 1 || monthNum > 12) return false;
  if (dayNum < 1 || dayNum > 31) return false;
  if (yearNum < 1000) return false;

  // Create date and verify it's valid
  const date = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
  return (
    date.getUTCFullYear() === yearNum &&
    date.getUTCMonth() === monthNum - 1 &&
    date.getUTCDate() === dayNum
  );
}

/**
 * Compares instruction date with current UTC date
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} - 'past', 'today', or 'future'
 */
function compareDateWithToday(dateStr) {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const parts = dateStr.split('-');
  const instructionDate = new Date(
    Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
  );

  if (instructionDate < todayUTC) return 'past';
  if (instructionDate.getTime() === todayUTC.getTime()) return 'today';
  return 'future';
}

/**
 * Validates if a string is a positive integer
 * @param {string} amountStr - The amount string to validate
 * @returns {boolean} - True if valid positive integer, false otherwise
 */
function isPositiveInteger(amountStr) {
  if (!amountStr || amountStr.length === 0) return false;

  // Check for decimal point or negative sign
  if (amountStr.indexOf('.') !== -1 || amountStr.indexOf('-') !== -1) return false;

  // Check if all characters are digits
  for (let i = 0; i < amountStr.length; i += 1) {
    if (amountStr[i] < '0' || amountStr[i] > '9') return false;
  }

  const num = parseInt(amountStr, 10);
  return num > 0;
}

/**
 * Finds the index of a keyword in the instruction (case-insensitive)
 * @param {string} instruction - The instruction string
 * @param {string} keyword - The keyword to find
 * @param {number} startFrom - Index to start searching from
 * @returns {number} - Index of keyword or -1 if not found
 */
function findKeywordIndex(instruction, keyword, startFrom = 0) {
  const lowerInstruction = instruction.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  return lowerInstruction.indexOf(lowerKeyword, startFrom);
}

/**
 * Extracts text between two positions
 * @param {string} instruction - The instruction string
 * @param {number} startPos - Start position (after start keyword)
 * @param {number} endPos - End position (before end keyword), -1 means end of string
 * @returns {string} - Extracted and trimmed text
 */
function extractBetween(instruction, startPos, endPos) {
  if (endPos === -1) {
    return instruction.substring(startPos).trim();
  }
  return instruction.substring(startPos, endPos).trim();
}

/**
 * Parse instruction and extract components
 * @param {string} instruction - The instruction string
 * @returns {object} - Parsed components or null if cannot parse
 */
function parseInstruction(instruction) {
  const trimmedInstruction = instruction.trim();

  // Check if instruction starts with DEBIT or CREDIT
  const startsWithDebit = findKeywordIndex(trimmedInstruction, 'DEBIT', 0) === 0;
  const startsWithCredit = findKeywordIndex(trimmedInstruction, 'CREDIT', 0) === 0;

  if (!startsWithDebit && !startsWithCredit) {
    return null; // Cannot determine type
  }

  const type = startsWithDebit ? 'DEBIT' : 'CREDIT';
  let amount = null;
  let currency = null;
  let debitAccount = null;
  let creditAccount = null;
  let executeBy = null;

  try {
    if (type === 'DEBIT') {
      // DEBIT format: DEBIT [amount] [currency] FROM ACCOUNT [account_id] FOR CREDIT TO ACCOUNT [account_id] [ON [date]]

      // Find amount and currency (between DEBIT and FROM)
      const fromIndex = findKeywordIndex(trimmedInstruction, 'FROM', 5);
      if (fromIndex === -1) return null;

      const amountCurrencyPart = extractBetween(trimmedInstruction, 5, fromIndex);
      const amountCurrencyTokens = amountCurrencyPart.split(' ').filter((t) => t.length > 0);

      if (amountCurrencyTokens.length < 2) return null;

      amount = amountCurrencyTokens[0];
      currency = amountCurrencyTokens[1].toUpperCase();

      // Find debit account (between FROM ACCOUNT and FOR)
      const accountKeywordAfterFrom = findKeywordIndex(trimmedInstruction, 'ACCOUNT', fromIndex);
      if (accountKeywordAfterFrom === -1) return null;

      const forIndex = findKeywordIndex(trimmedInstruction, 'FOR', accountKeywordAfterFrom + 7);
      if (forIndex === -1) return null;

      debitAccount = extractBetween(
        trimmedInstruction,
        accountKeywordAfterFrom + 7,
        forIndex
      ).trim();

      // Find credit account (between FOR CREDIT TO ACCOUNT and ON or end)
      const creditIndex = findKeywordIndex(trimmedInstruction, 'CREDIT', forIndex);
      if (creditIndex === -1) return null;

      const toIndex = findKeywordIndex(trimmedInstruction, 'TO', creditIndex + 6);
      if (toIndex === -1) return null;

      const accountKeywordAfterTo = findKeywordIndex(trimmedInstruction, 'ACCOUNT', toIndex);
      if (accountKeywordAfterTo === -1) return null;

      const onIndex = findKeywordIndex(trimmedInstruction, 'ON', accountKeywordAfterTo + 7);

      if (onIndex !== -1) {
        creditAccount = extractBetween(
          trimmedInstruction,
          accountKeywordAfterTo + 7,
          onIndex
        ).trim();

        // Extract date after ON
        executeBy = extractBetween(trimmedInstruction, onIndex + 2, -1).trim();
      } else {
        creditAccount = extractBetween(trimmedInstruction, accountKeywordAfterTo + 7, -1).trim();
      }
    } else {
      // CREDIT format: CREDIT [amount] [currency] TO ACCOUNT [account_id] FOR DEBIT FROM ACCOUNT [account_id] [ON [date]]

      // Find amount and currency (between CREDIT and TO)
      const toIndex = findKeywordIndex(trimmedInstruction, 'TO', 6);
      if (toIndex === -1) return null;

      const amountCurrencyPart = extractBetween(trimmedInstruction, 6, toIndex);
      const amountCurrencyTokens = amountCurrencyPart.split(' ').filter((t) => t.length > 0);

      if (amountCurrencyTokens.length < 2) return null;

      amount = amountCurrencyTokens[0];
      currency = amountCurrencyTokens[1].toUpperCase();

      // Find credit account (between TO ACCOUNT and FOR)
      const accountKeywordAfterTo = findKeywordIndex(trimmedInstruction, 'ACCOUNT', toIndex);
      if (accountKeywordAfterTo === -1) return null;

      const forIndex = findKeywordIndex(trimmedInstruction, 'FOR', accountKeywordAfterTo + 7);
      if (forIndex === -1) return null;

      creditAccount = extractBetween(
        trimmedInstruction,
        accountKeywordAfterTo + 7,
        forIndex
      ).trim();

      // Find debit account (between FOR DEBIT FROM ACCOUNT and ON or end)
      const debitIndex = findKeywordIndex(trimmedInstruction, 'DEBIT', forIndex);
      if (debitIndex === -1) return null;

      const fromIndex = findKeywordIndex(trimmedInstruction, 'FROM', debitIndex + 5);
      if (fromIndex === -1) return null;

      const accountKeywordAfterFrom = findKeywordIndex(trimmedInstruction, 'ACCOUNT', fromIndex);
      if (accountKeywordAfterFrom === -1) return null;

      const onIndex = findKeywordIndex(trimmedInstruction, 'ON', accountKeywordAfterFrom + 7);

      if (onIndex !== -1) {
        debitAccount = extractBetween(
          trimmedInstruction,
          accountKeywordAfterFrom + 7,
          onIndex
        ).trim();

        // Extract date after ON
        executeBy = extractBetween(trimmedInstruction, onIndex + 2, -1).trim();
      } else {
        debitAccount = extractBetween(trimmedInstruction, accountKeywordAfterFrom + 7, -1).trim();
      }
    }

    return {
      type,
      amount,
      currency,
      debitAccount,
      creditAccount,
      executeBy: executeBy || null,
    };
  } catch (error) {
    appLogger.errorX(error, 'parse-instruction-parsing-error');
    return null;
  }
}

/**
 * Main service function to parse payment instruction
 */
async function parsePaymentInstruction(serviceData, options = {}) {
  let response;

  // Validate input data first
  const data = validator.validate(serviceData, parsedSpec);

  const { accounts, instruction } = data;

  try {
    // Parse the instruction
    const parsed = parseInstruction(instruction);

    // If parsing completely failed, return unparseable response
    if (!parsed) {
      appLogger.warn({ instruction }, 'instruction-unparseable');

      response = {
        type: null,
        amount: null,
        currency: null,
        debit_account: null,
        credit_account: null,
        execute_by: null,
        status: 'failed',
        status_reason: `${PaymentMessages.MALFORMED_INSTRUCTION}: unable to parse keywords`,
        status_code: STATUS_CODES.SY03,
        accounts: [],
      };

      return response;
    }

    const { type, amount, currency, debitAccount, creditAccount, executeBy } = parsed;

    // Validate amount is a positive integer
    if (!isPositiveInteger(amount)) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amount ? parseInt(amount, 10) : null,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.INVALID_AMOUNT,
        status_code: STATUS_CODES.AM01,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    const amountInt = parseInt(amount, 10);

    // Validate account ID formats
    if (!isValidAccountId(debitAccount)) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: `${PaymentMessages.INVALID_ACCOUNT_ID}: ${debitAccount}`,
        status_code: STATUS_CODES.AC04,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    if (!isValidAccountId(creditAccount)) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: `${PaymentMessages.INVALID_ACCOUNT_ID}: ${creditAccount}`,
        status_code: STATUS_CODES.AC04,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    // Validate date format if provided
    if (executeBy && !isValidDate(executeBy)) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.INVALID_DATE_FORMAT,
        status_code: STATUS_CODES.DT01,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    // Validate currency is supported
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: `${PaymentMessages.UNSUPPORTED_CURRENCY}. Only NGN, USD, GBP, and GHS are supported`,
        status_code: STATUS_CODES.CU02,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    // Check if debit and credit accounts are the same
    if (debitAccount === creditAccount) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.SAME_ACCOUNT_ERROR,
        status_code: STATUS_CODES.AC02,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    // Find accounts in the accounts array
    const debitAccountObj = accounts.find((acc) => acc.id === debitAccount);
    const creditAccountObj = accounts.find((acc) => acc.id === creditAccount);

    // Check if accounts exist
    if (!debitAccountObj) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: `${PaymentMessages.ACCOUNT_NOT_FOUND}: ${debitAccount}`,
        status_code: STATUS_CODES.AC03,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    if (!creditAccountObj) {
      const accountsWithOriginalBalances = accounts.map((acc) => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency.toUpperCase(),
      }));

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: `${PaymentMessages.ACCOUNT_NOT_FOUND}: ${creditAccount}`,
        status_code: STATUS_CODES.AC03,
        accounts: accountsWithOriginalBalances,
      };

      return response;
    }

    // Check currency match between accounts
    if (debitAccountObj.currency.toUpperCase() !== creditAccountObj.currency.toUpperCase()) {
      // Return accounts in original order from request
      const transactionAccounts = [];
      accounts.forEach((acc) => {
        if (acc.id === debitAccount || acc.id === creditAccount) {
          transactionAccounts.push({
            id: acc.id,
            balance: acc.balance,
            balance_before: acc.balance,
            currency: acc.currency.toUpperCase(),
          });
        }
      });

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.CURRENCY_MISMATCH,
        status_code: STATUS_CODES.CU01,
        accounts: transactionAccounts,
      };

      return response;
    }

    // Check if instruction currency matches account currency
    if (currency !== debitAccountObj.currency.toUpperCase()) {
      // Return accounts in original order from request
      const transactionAccounts = [];
      accounts.forEach((acc) => {
        if (acc.id === debitAccount || acc.id === creditAccount) {
          transactionAccounts.push({
            id: acc.id,
            balance: acc.balance,
            balance_before: acc.balance,
            currency: acc.currency.toUpperCase(),
          });
        }
      });

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.CURRENCY_MISMATCH,
        status_code: STATUS_CODES.CU01,
        accounts: transactionAccounts,
      };

      return response;
    }

    // Check sufficient funds
    if (debitAccountObj.balance < amountInt) {
      // Return accounts in original order from request
      const transactionAccounts = [];
      accounts.forEach((acc) => {
        if (acc.id === debitAccount || acc.id === creditAccount) {
          transactionAccounts.push({
            id: acc.id,
            balance: acc.balance,
            balance_before: acc.balance,
            currency: acc.currency.toUpperCase(),
          });
        }
      });

      response = {
        type,
        amount: amountInt,
        currency,
        debit_account: debitAccount,
        credit_account: creditAccount,
        execute_by: executeBy,
        status: 'failed',
        status_reason: `${PaymentMessages.INSUFFICIENT_FUNDS}: has ${debitAccountObj.balance} ${currency}, needs ${amountInt} ${currency}`,
        status_code: STATUS_CODES.AC01,
        accounts: transactionAccounts,
      };

      return response;
    }

    // Determine if transaction should be executed immediately or pending
    let shouldExecute = true;
    let status = 'successful';
    let statusCode = STATUS_CODES.AP00;
    let statusReason = PaymentMessages.TRANSACTION_SUCCESSFUL;

    if (executeBy) {
      const dateComparison = compareDateWithToday(executeBy);
      if (dateComparison === 'future') {
        shouldExecute = false;
        status = 'pending';
        statusCode = STATUS_CODES.AP02;
        statusReason = PaymentMessages.TRANSACTION_PENDING;
      }
    }

    // Execute transaction or mark as pending
    let newDebitBalance = debitAccountObj.balance;
    let newCreditBalance = creditAccountObj.balance;

    if (shouldExecute) {
      newDebitBalance = debitAccountObj.balance - amountInt;
      newCreditBalance = creditAccountObj.balance + amountInt;
    }

    // Build response with accounts in original order
    const transactionAccounts = [];
    accounts.forEach((acc) => {
      if (acc.id === debitAccount) {
        transactionAccounts.push({
          id: acc.id,
          balance: newDebitBalance,
          balance_before: debitAccountObj.balance,
          currency: acc.currency.toUpperCase(),
        });
      } else if (acc.id === creditAccount) {
        transactionAccounts.push({
          id: acc.id,
          balance: newCreditBalance,
          balance_before: creditAccountObj.balance,
          currency: acc.currency.toUpperCase(),
        });
      }
    });

    response = {
      type,
      amount: amountInt,
      currency,
      debit_account: debitAccount,
      credit_account: creditAccount,
      execute_by: executeBy,
      status,
      status_reason: statusReason,
      status_code: statusCode,
      accounts: transactionAccounts,
    };

    appLogger.info(
      {
        type,
        debitAccount,
        creditAccount,
        amount: amountInt,
        currency,
        status,
      },
      'payment-instruction-processed'
    );
  } catch (error) {
    appLogger.errorX(error, 'parse-payment-instruction-error');
    throw error;
  }

  return response;
}

module.exports = parsePaymentInstruction;