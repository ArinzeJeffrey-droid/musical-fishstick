const { createHandler } = require('@app-core/server');
const { appLogger } = require('@app-core/logger');
const parsePaymentInstruction = require('@app/services/payment-processor/parse-instruction');
module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [],
  async handler(rc, helpers) {
    const payload = rc.body;
    const response = await parsePaymentInstruction(payload);
    // Determine HTTP status code based on transaction status
    let httpStatus = helpers.http_statuses.HTTP_200_OK;
    if (response.status === 'failed') {
      httpStatus = helpers.http_statuses.HTTP_400_BAD_REQUEST;
    }
    appLogger.info(
      {
        status: response.status,
        statusCode: response.status_code,
      },
      'payment-instruction-response'
    );
    return {
      status: httpStatus,
      data: response,
    };
  },
});
