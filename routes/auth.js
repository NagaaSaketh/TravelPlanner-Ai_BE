const express = require("express");
const userAuth = require("../middlewares/auth");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const User = require("../models/User");

const authRouter = express.Router();

authRouter.post("/register", async (req, res) => {
  try {
    const { fullname, email, password } = req.body;

    if (!fullname || !email || !password) {
      return res.status(400).json({
        message: "Fullname , email , password are required!",
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ message: "Email already exists!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      fullname,
      email,
      password: hashedPassword,
    });

    await user.save();
    res.status(201).json({ message: "User registration successful!", user });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Something went wrong!", error: err.message });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials!" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials!" });
    }

    const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.status(200).json({ message: "Login successful" });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Something went wrong!", error: err.message });
  }
});

authRouter.post("/logout", userAuth, (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.status(200).json({ message: "Logged out successfully!" });
});

authRouter.get("/me", userAuth, (req, res) => {
  try {
    const user = req.user;
    res.status(200).json({ user });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Something went wrong!", error: err.message });
  }
});

module.exports = authRouter;
