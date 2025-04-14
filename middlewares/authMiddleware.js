const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

exports.protect = async (req, res, next) => {
  let token = req.headers.authorization;

  if (token && token.startsWith("Bearer ")) {
    token = token.split(" ")[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
      req.user = await User.findById(decoded.id).select("-password");
      next();
    } catch (error) {
      return res.status(401).json({ message: "Unauthorized - Invalid Token" });
    }
  } else {
    return res.status(401).json({ message: "No token provided" });
  }
};

exports.adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ message: "Forbidden - Admins only" });
  }
};