const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const verifyToken = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Access denied. No token provided.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid token. User not found.' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired. Please login again.' 
      });
    }
    
    return res.status(401).json({ 
      error: 'Invalid token.' 
    });
  }
};

// Check if user is admin
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Access denied. Admin privileges required.' 
    });
  }
  next();
};

// Check if user has active membership
const hasActiveMembership = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Authentication required.' 
    });
  }

  if (req.user.membershipStatus !== 'active' || !req.user.paymentVerified) {
    return res.status(403).json({ 
      error: 'Active membership required. Please complete your payment verification.',
      membershipStatus: req.user.membershipStatus,
      paymentVerified: req.user.paymentVerified
    });
  }

  next();
};

// Check semester access
const hasSemesterAccess = (semester) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required.' 
      });
    }

    // Admin has access to all semesters
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user has access to requested semester
    if (!req.user.semesterAccess.includes(parseInt(semester))) {
      return res.status(403).json({ 
        error: `Access denied to semester ${semester} content.` 
      });
    }

    next();
  };
};

// Rate limiting for sensitive operations
const createRateLimiter = (windowMs, max) => {
  const rateLimit = require('express-rate-limit');
  return rateLimit({
    windowMs,
    max,
    message: {
      error: 'Too many requests, please try again later.',
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Specific rate limiters
const loginRateLimit = createRateLimiter(15 * 60 * 1000, 5); // 5 attempts per 15 minutes
const registerRateLimit = createRateLimiter(60 * 60 * 1000, 3); // 3 attempts per hour
const downloadRateLimit = createRateLimiter(60 * 1000, 10); // 10 downloads per minute

// Optional authentication - for public endpoints that can benefit from user context
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      req.user = user;
    }
  } catch (error) {
    // Ignore token errors for optional auth
    req.user = null;
  }
  
  next();
};

// Check if user owns resource or is admin
const isOwnerOrAdmin = (resourceModel, resourceIdField = 'id') => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params[resourceIdField];
      const resource = await resourceModel.findById(resourceId);
      
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found.' });
      }
      
      // Admin can access everything
      if (req.user.role === 'admin') {
        req.resource = resource;
        return next();
      }
      
      // Check ownership
      if (resource.uploadedBy && resource.uploadedBy.toString() === req.user._id.toString()) {
        req.resource = resource;
        return next();
      }
      
      if (resource.userId && resource.userId.toString() === req.user._id.toString()) {
        req.resource = resource;
        return next();
      }
      
      return res.status(403).json({ 
        error: 'Access denied. You can only access your own resources.' 
      });
    } catch (error) {
      return res.status(500).json({ 
        error: 'Error checking resource ownership.' 
      });
    }
  };
};

module.exports = {
  verifyToken,
  isAdmin,
  hasActiveMembership,
  hasSemesterAccess,
  loginRateLimit,
  registerRateLimit,
  downloadRateLimit,
  optionalAuth,
  isOwnerOrAdmin
};