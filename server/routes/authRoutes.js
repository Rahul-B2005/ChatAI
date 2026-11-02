// ======================================
// BACKEND : routes/auth.js
// ======================================

const router = require("express").Router();

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

// ======================================
// REGISTER
// ======================================
router.post("/register", async (req, res) => {

  try {

    const {
      name,
      email,
      password,
    } = req.body;

    // CHECK EXISTING USER
    const existingUser =
      await User.findOne({ email });

    if (existingUser) {
      return res.json({
        success: false,
        message: "Email already exists",
      });
    }

    // HASH PASSWORD
    const hash =
      await bcrypt.hash(password, 10);

    // CREATE USER
    const user =
      await User.create({
        name,
        email,
        password: hash,
      });

    res.json({
      success: true,
      message:
        "Account created successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      message: "Register failed",
    });
  }
});

// ======================================
// LOGIN
// ======================================
router.post("/login", async (req, res) => {

  try {

    const {
      email,
      password,
    } = req.body;

    // FIND USER
    const user =
      await User.findOne({ email });

    if (!user) {
      return res.json({
        success: false,
        message: "User not found",
      });
    }

    // CHECK PASSWORD
    const match =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!match) {
      return res.json({
        success: false,
        message: "Wrong password",
      });
    }

    // TOKEN
    const token = jwt.sign(
      {
        id: user._id,
      },
      "secretkey",
      {
        expiresIn: "7d",
      }
    );

    // RESPONSE
    res.json({
      success: true,

      token,

      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
});

module.exports = router;