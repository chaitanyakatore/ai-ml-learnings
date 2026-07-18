// StadiumPulse AI — Custom Sliding Window Rate Limiter Middleware
const requestStore = {}; // IP -> Array of timestamps

/**
 * Creates an Express rate-limiting middleware
 * @param {number} maxRequests - Maximum requests allowed inside the window
 * @param {number} windowMs - Time window in milliseconds (default 15 minutes)
 * @param {string} rateLimitName - Identifying name for user clarity
 */
export function rateLimiter(maxRequests, windowMs = 15 * 60 * 1000, rateLimitName = 'General API') {
  return (req, res, next) => {
    // Extract Client IP address
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!requestStore[ip]) {
      requestStore[ip] = [];
    }

    // Filter out log timestamps that fell outside the sliding window
    requestStore[ip] = requestStore[ip].filter(timestamp => now - timestamp < windowMs);

    // Check rate limit threshold
    if (requestStore[ip].length >= maxRequests) {
      return res.status(429).json({
        error: `Too many requests for [${rateLimitName}]. Rate limit threshold exceeded. Please try again in 15 minutes.`
      });
    }

    // Register active request timestamp
    requestStore[ip].push(now);
    next();
  };
}
