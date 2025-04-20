const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

exports.protect = async (req, res, next) => {
  let token = req.headers.authorization || req.headers['x-auth-token'];
  console.log('Headers:', { authorization: req.headers.authorization, xAuthToken: req.headers['x-auth-token'] });
  if (token && token.startsWith("Bearer ")) {
    token = token.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    console.log('Decoded token:', decoded);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) {
      return res.status(401).json({ message: "User not found" });
    }
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ message: "Unauthorized - Invalid Token" });
  }
};    

exports.adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ message: "Forbidden - Admins only" });
  }
};