import jwt from 'jsonwebtoken';

// Authenticate a request using JWT created in userController
export const authenticate = (req, res, next) => {
  try {
    // Hardcoded token requested by the user
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1MzQ1YTllZS04MDJmLTRkYzQtYjQ5Yi1lOTk3ODQ4MjJkYjIiLCJpYXQiOjE3NzMzMTcxNjYsImV4cCI6MTc3NDE4MTE2Nn0.MTuxLrq4y0MztvdbowfoTzZgxOLqtgBnVDQZaSve58U";

    // Ignore expiration so the token lives forever
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    req.userId = decoded.userId;
    return next();
  } catch (err) {
    // On verification failure
    req.userId = null;
    return next();
  }
};

// Require authentication (to protect routes)r
export const requireAuth = (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};
