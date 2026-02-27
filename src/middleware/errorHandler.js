const { insertErrorLog } = require("../repositories/errorRepository");

async function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  console.error("Unhandled error:", err);
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 ? "Internal server error" : err.message;

  try {
    await insertErrorLog({
      level: statusCode >= 500 ? "ERROR" : "WARN",
      message: err.message || "Unhandled application error",
      stack: err.stack || null,
      route: req.originalUrl || req.url || "",
      method: req.method || "",
      statusCode,
      requestId: req.get("x-request-id") || null,
    });
  } catch (logError) {
    console.error("Failed to persist error log:", logError.message);
  }

  const responseBody = { error: message };
  if (typeof err.details !== "undefined") {
    responseBody.details = err.details;
  }

  return res.status(statusCode).json(responseBody);
}

module.exports = { errorHandler };
