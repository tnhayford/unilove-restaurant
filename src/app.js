const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const env = require("./config/env");
const { publicRoutes } = require("./routes/publicRoutes");
const { adminRoutes } = require("./routes/adminRoutes");
const { errorHandler } = require("./middleware/errorHandler");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  app.use(helmet());

  app.use(cookieParser());
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  // Admin-friendly entrypoint for bare domain access.
  app.get("/", (req, res) => {
    res.redirect(302, "/admin/login.html");
  });

  app.get("/admin", (req, res) => {
    res.redirect(302, "/admin/login.html");
  });

  app.get("/track", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public/customer/track.html"));
  });

  const adminStaticOptions = {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
    },
  };

  app.use("/admin", express.static(path.join(process.cwd(), "public/admin"), adminStaticOptions));
  app.use("/customer", express.static(path.join(process.cwd(), "public/customer"), adminStaticOptions));
  app.use("/receipts", express.static(path.join(process.cwd(), "data/receipts")));

  const publicApiLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  const adminApiLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.adminApiRateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  app.use("/api/admin", adminApiLimiter, adminRoutes);
  app.use("/api", publicApiLimiter, publicRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
